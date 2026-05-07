"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import DashboardHeader from "../../../components/dashboard/DashboardHeader";
import MultiSelectFilter from "../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../components/dashboard/BarrelLoading";
import ExportPanel from "../../../components/dashboard/ExportPanel";
import ExportModal from "../../../components/dashboard/ExportModal";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";
import { kgToMilTon, LABEL } from "../../../lib/units";
import {
  rpcGetMdicComexSerie,
  rpcGetMdicComexTopPaises,
  rpcGetMdicComexFiltros,
  getMdicComexExportCount,
  rpcGetMdicComexAggregated,
  fetchMdicComexRawFiltered,
  type MdicComexSerieRow,
  type MdicComexTopPaisRow,
  type MdicComexAggregatedFilters,
  type MdicComexGroupBy,
} from "../../../lib/rpc";
import {
  downloadMdicComexRawExcel,
  downloadMdicComexAggregatedExcel,
} from "../../../lib/exportExcel";
import { downloadCsv } from "../../../lib/exportCsv";

// ── Constants ─────────────────────────────────────────────────────────────────

const NCM_INFO: Record<string, { label: string; color: string }> = {
  "27090010": { label: "Petróleo Cru", color: "#1a1a1a" },
  "27101259": { label: "Gasolina",     color: "#FF5000" },
  "27101921": { label: "Diesel",       color: "#2196F3" },
};
const ALL_NCMS = Object.keys(NCM_INFO);

// Hard limits for raw export. Above EXCEL_MAX, disable Excel and route the
// user to CSV. Above ABS_MAX, both are disabled. The `mdic_comex` table is
// small (~1.2k rows) so the default unfiltered case never trips these — but
// the contract from /anp-cdp is mirrored here for consistency.
const RAW_EXCEL_MAX_ROWS = 200_000;
const RAW_ABS_MAX_ROWS   = 500_000;

// Export granularity for /mdic-comex. "raw" pulls from `mdic_comex` directly
// via PostgREST (paginated). All others use the dynamic-aggregator RPC. The
// table has no `uf` column so "Por UF" is intentionally omitted (would require
// a schema change in dept supabase).
type MdicComexGranularity =
  | "raw"
  | "ncm"
  | "pais"
  | "flow"
  | "ano_mes";

const MDIC_GROUPBY_MAP: Record<Exclude<MdicComexGranularity, "raw">, MdicComexGroupBy[]> = {
  ncm:     ["ano", "mes", "ncm_codigo", "ncm_nome"],
  pais:    ["ano", "mes", "pais"],
  flow:    ["ano", "mes", "flow"],
  ano_mes: ["ano", "mes"],
};

const MDIC_GRANULARITY_OPTIONS: Array<{
  value: MdicComexGranularity;
  label: string;
  hint: string;
}> = [
  { value: "raw",     label: "Por linha bruta (raw — todas as dimensões)", hint: "1 linha por (ano, mês, fluxo, NCM, país)" },
  { value: "ncm",     label: "Por NCM",                                    hint: "soma por (ano, mês, NCM)" },
  { value: "pais",    label: "Por país",                                   hint: "soma por (ano, mês, país)" },
  { value: "flow",    label: "Por fluxo (IMP/EXP)",                        hint: "soma por (ano, mês, fluxo)" },
  { value: "ano_mes", label: "Por ano/mês (total)",                        hint: "soma total por mês (≤252 linhas)" },
];

// Hardcoded estimate for aggregated paths (no extra round-trip).
const MDIC_AGG_ESTIMATE: Record<Exclude<MdicComexGranularity, "raw">, number> = {
  ano_mes: 252,
  flow:    252 * 2,    // import | export
  ncm:     252 * 3,    // 3 NCMs fixos (Petróleo Cru, Gasolina, Diesel)
  pais:    252 * 60,   // ~60 países distintos com fluxo
};

// ── Chart helpers ──────────────────────────────────────────────────────────────

function buildLineChart(
  rows: MdicComexSerieRow[],
  flow: string,
  ncms: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => r.flow === flow && ncms.includes(r.ncm_codigo));
  if (!filtered.length) return emptyPlot(280);

  const byNcm: Record<string, MdicComexSerieRow[]> = {};
  for (const r of filtered) {
    (byNcm[r.ncm_codigo] ??= []).push(r);
  }

  const traces: PlotData[] = ncms
    .filter(ncm => byNcm[ncm])
    .map(ncm => {
      const data = byNcm[ncm].sort((a, b) =>
        a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes
      );
      const info = NCM_INFO[ncm];
      return {
        type: "scatter", mode: "lines",
        name: info?.label ?? ncm,
        x: data.map(r => `${r.ano}-${String(r.mes).padStart(2, "0")}`),
        y: data.map(r => kgToMilTon(r.volume_kg ?? 0)),
        line:  { width: 2, color: info?.color ?? "#999" },
        hovertemplate: `${info?.label}: %{y:.0f} ${LABEL.MIL_T}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 280,
      margin: { t: 10, b: 50, l: 70, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: `${LABEL.MIL_T} / mês` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function buildBarChart(
  rows: MdicComexTopPaisRow[],
  flow: string,
  ncm: string,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!rows.length) return emptyPlot(340);

  const sorted = [...rows].sort((a, b) => (b.volume_kg ?? 0) - (a.volume_kg ?? 0));
  const color  = flow === "import" ? "#2196F3" : "#FF5000";
  const label  = NCM_INFO[ncm]?.label ?? ncm;
  const flowPt = flow === "import" ? "Importação" : "Exportação";

  return {
    data: [{
      type: "bar", orientation: "h",
      x: sorted.map(r => kgToMilTon(r.volume_kg ?? 0)),
      y: sorted.map(r => r.pais),
      marker: { color },
      hovertemplate: `%{y}: %{x:.0f} ${LABEL.MIL_T}<extra></extra>`,
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT,
      height: 380,
      margin: { t: 36, b: 40, l: 130, r: 20 },
      xaxis: { ...AXIS_LINE, title: { text: LABEL.MIL_T } },
      yaxis: { autorange: "reversed" as const, showgrid: false, zeroline: false, tickfont: { size: 10 } },
      title: {
        text: `Top Países — ${flowPt} · ${label}`,
        font: { size: 13, family: "Arial" },
        x: 0, xanchor: "left",
        pad: { l: 0 },
      },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MdicComexPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("mdic-comex");
  const supabase = getSupabaseClient();

  const [loading, setLoading]                     = useState(true);
  const [serieRows, setSerieRows]                 = useState<MdicComexSerieRow[]>([]);
  const [anos, setAnos]                           = useState<number[]>([]);
  const [yearRange, setYearRange]                 = useState<[number, number]>([0, 0]);
  const [selectedNCMs, setSelectedNCMs]           = useState<string[]>(ALL_NCMS);
  const [selectedNcmPaises, setSelectedNcmPaises] = useState<string>("27090010");
  const [topImport, setTopImport]                 = useState<MdicComexTopPaisRow[]>([]);
  const [topExport, setTopExport]                 = useState<MdicComexTopPaisRow[]>([]);

  // ── Export modal state (Fase B Tier 2) ────────────────────────────────────
  const [exportOpen, setExportOpen]       = useState(false);
  const [excelLoading, setExcelLoading]   = useState(false);
  const [csvLoading, setCsvLoading]       = useState(false);
  const [exportFlow, setExportFlow]       = useState<string>("ALL");
  const [exportNcms, setExportNcms]       = useState<string[]>(ALL_NCMS);
  const [exportRange, setExportRange]     = useState<[number, number]>([0, 0]);
  // Default = raw (1 row per ano × mes × flow × ncm × pais).
  const [exportGranularity, setExportGranularity] = useState<MdicComexGranularity>("raw");
  const [exportRawCount, setExportRawCount]       = useState<number | null>(null);

  // ── Initial load: filtros + first serie fetch (last 10 years) ────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const filtros = await rpcGetMdicComexFiltros(supabase);
      if (cancelled) return;
      const a = filtros.anos;
      setAnos(a);

      if (a.length === 0) {
        setLoading(false);
        return;
      }

      const currentYear = new Date().getFullYear();
      const startIdx    = Math.max(0, a.findIndex(yr => yr >= currentYear - 9));
      const endIdx      = a.length - 1;
      const fromYear    = a[startIdx];
      const toYear      = a[endIdx];
      setYearRange([startIdx, endIdx]);

      const serie = await rpcGetMdicComexSerie(supabase, {
        anoInicio: fromYear,
        anoFim:    toYear,
      });
      if (!cancelled) {
        setSerieRows(serie);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) — period changes only ─────────
  const { data: refetchedSerie, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const yMin = anos[yearRange[0]];
      const yMax = anos[yearRange[1]];
      return rpcGetMdicComexSerie(supabase, {
        anoInicio: yMin ?? null,
        anoFim:    yMax ?? null,
      });
    },
    [supabase, loading, yearRange[0], yearRange[1], anos],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetchedSerie) setSerieRows(refetchedSerie);
  }, [refetchedSerie]);

  // ── Reactive top countries fetch (debounced 400ms) ────────────────────────
  const { data: refetchedTop, loading: topLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const yMin = anos[yearRange[0]];
      const yMax = anos[yearRange[1]];
      if (!yMin || !yMax) return null;
      const [imp, exp] = await Promise.all([
        rpcGetMdicComexTopPaises(supabase, "import", selectedNcmPaises, yMin, yMax),
        rpcGetMdicComexTopPaises(supabase, "export", selectedNcmPaises, yMin, yMax),
      ]);
      return { imp, exp };
    },
    [supabase, loading, selectedNcmPaises, yearRange[0], yearRange[1], anos],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (refetchedTop) {
      setTopImport(refetchedTop.imp);
      setTopExport(refetchedTop.exp);
    }
  }, [refetchedTop]);

  // ── Charts ────────────────────────────────────────────────────────────────
  const importChart    = useMemo(() => buildLineChart(serieRows, "import", selectedNCMs), [serieRows, selectedNCMs]);
  const exportChart    = useMemo(() => buildLineChart(serieRows, "export", selectedNCMs), [serieRows, selectedNCMs]);
  const topImportChart = useMemo(() => buildBarChart(topImport, "import", selectedNcmPaises), [topImport, selectedNcmPaises]);
  const topExportChart = useMemo(() => buildBarChart(topExport, "export", selectedNcmPaises), [topExport, selectedNcmPaises]);

  // ── Export modal helpers (Fase B Tier 2) ──────────────────────────────────
  function openExportModal() {
    setExportFlow("ALL");
    setExportNcms(selectedNCMs.length ? selectedNCMs : ALL_NCMS);
    setExportRange(yearRange);
    setExportGranularity("raw");
    setExportRawCount(null);
    setExportOpen(true);
  }

  const exportFilters = useMemo<MdicComexAggregatedFilters>(() => {
    const yMin = anos[exportRange[0]] ?? null;
    const yMax = anos[exportRange[1]] ?? null;
    return {
      flow:      exportFlow === "ALL" ? null : exportFlow,
      ncms:      exportNcms.length === ALL_NCMS.length ? null : exportNcms,
      paises:    null,
      anoInicio: yMin,
      anoFim:    yMax,
    };
  }, [exportFlow, exportNcms, exportRange, anos]);

  // Hard-limit flags (raw only — aggregated path is bounded by MDIC_AGG_ESTIMATE).
  const rawOverExcel =
    exportGranularity === "raw" &&
    exportRawCount !== null &&
    exportRawCount > RAW_EXCEL_MAX_ROWS;
  const rawOverAbs =
    exportGranularity === "raw" &&
    exportRawCount !== null &&
    exportRawCount > RAW_ABS_MAX_ROWS;

  if (visLoading || !visible) return null;

  const toggleNcm = (ncm: string) => {
    setSelectedNCMs(prev =>
      prev.includes(ncm)
        ? prev.length > 1 ? prev.filter(n => n !== ncm) : prev
        : [...prev, ncm]
    );
  };

  const hasYears = anos.length > 0;
  const yMin     = hasYears ? anos[yearRange[0]] : null;
  const yMax     = hasYears ? anos[yearRange[1]] : null;

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ───────────────────────────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <div style={{
                  width: "100%", maxWidth: 300, height: 60,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: "2px dashed #ccc", color: "#aaa", fontSize: 18,
                  fontWeight: 700, letterSpacing: 3, marginBottom: 16, borderRadius: 6,
                }}>TBD</div>
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filtros</div>

              <MultiSelectFilter
                label="Produto"
                items={ALL_NCMS}
                selected={selectedNCMs}
                onToggle={toggleNcm}
                onClear={selectedNCMs.length < ALL_NCMS.length ? () => setSelectedNCMs(ALL_NCMS) : undefined}
                swatch={(n) => NCM_INFO[n].color}
                itemLabel={(n) => NCM_INFO[n].label}
                idPrefix="ncm"
                counterTotal={ALL_NCMS.length}
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && hasYears && (
                  <PeriodSlider years={anos} value={yearRange} onChange={setYearRange} />
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Top Países — Produto</div>
                <select
                  className="form-select form-select-sm"
                  value={selectedNcmPaises}
                  onChange={e => setSelectedNcmPaises(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {ALL_NCMS.map(ncm => (
                    <option key={ncm} value={ncm}>{NCM_INFO[ncm].label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="MDIC Comex Stat — Importações e Exportações"
                sub="Volume mensal de importação e exportação de petróleo cru, gasolina e diesel por NCM e país de origem/destino"
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
                rightSlot={
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "Excel",
                        busy: excelLoading,
                        loadingLabel: "Gerando Excel...",
                        disabled: loading || excelLoading || csvLoading,
                        onClick: openExportModal,
                      },
                      {
                        kind: "csv",
                        label: "CSV",
                        busy: csvLoading,
                        loadingLabel: "Baixando CSV...",
                        disabled: loading || excelLoading || csvLoading,
                        onClick: openExportModal,
                      },
                    ]}
                  />
                }
              />

              {loading ? (
                <BarrelLoading />
              ) : (
                <>
                  {/* ── Volume Importado ─────────────────────────────── */}
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Importações (${LABEL.MIL_T} / mês)`}
                        loading={serieLoading}
                        height={280}
                      >
                        <PlotlyChart
                          data={importChart.data}
                          layout={importChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  {/* ── Volume Exportado ─────────────────────────────── */}
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Exportações (${LABEL.MIL_T} / mês)`}
                        loading={serieLoading}
                        height={280}
                      >
                        <PlotlyChart
                          data={exportChart.data}
                          layout={exportChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  {/* ── Top Países ───────────────────────────────────── */}
                  <div className="row mb-2">
                    <div className="col-lg-6">
                      <div className="chart-container" style={{ minHeight: 420, position: "relative", opacity: topLoading ? 0.5 : 1 }}>
                        <PlotlyChart
                          data={topImportChart.data}
                          layout={topImportChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 380 }}
                        />
                      </div>
                    </div>
                    <div className="col-lg-6">
                      <div className="chart-container" style={{ minHeight: 420, position: "relative", opacity: topLoading ? 0.5 : 1 }}>
                        <PlotlyChart
                          data={topExportChart.data}
                          layout={topExportChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 380 }}
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Exportar — MDIC Comex"
        datasetKey="mdic_comex"
        // Re-key by granularity so useExportSize debounces independently for
        // raw vs each aggregated path.
        currentFilters={{ ...exportFilters, _g: exportGranularity }}
        countFetcher={async () => {
          if (!supabase) return 0;
          // Aggregated paths return the hardcoded upper-bound estimate so the
          // size strip doesn't flash misleading numbers (real count would
          // require an extra round-trip we don't pay).
          if (exportGranularity !== "raw") {
            setExportRawCount(null);
            return MDIC_AGG_ESTIMATE[exportGranularity];
          }
          const c = await getMdicComexExportCount(supabase, exportFilters);
          setExportRawCount(c);
          return c;
        }}
        excelBusy={excelLoading}
        csvBusy={csvLoading}
        loadingLabel={excelLoading ? "Gerando Excel..." : "Baixando CSV..."}
        onExportExcel={async () => {
          if (!supabase) return;
          if (rawOverAbs) {
            console.warn("MDIC Comex raw Excel blocked: rows exceed RAW_ABS_MAX_ROWS");
            return;
          }
          if (rawOverExcel) {
            console.warn("MDIC Comex raw Excel blocked: rows exceed RAW_EXCEL_MAX_ROWS — use CSV");
            return;
          }
          setExcelLoading(true);
          try {
            if (exportGranularity === "raw") {
              const rows = await fetchMdicComexRawFiltered(supabase, exportFilters);
              await downloadMdicComexRawExcel(rows);
            } else {
              const groupBy = MDIC_GROUPBY_MAP[exportGranularity];
              const rows = await rpcGetMdicComexAggregated(supabase, exportFilters, groupBy);
              await downloadMdicComexAggregatedExcel(rows, groupBy);
            }
            setExportOpen(false);
          } catch (e) {
            console.error("MDIC Comex Excel export failed", e);
          } finally {
            setExcelLoading(false);
          }
        }}
        onExportCsv={async () => {
          if (!supabase) return;
          if (rawOverAbs) {
            console.warn("MDIC Comex raw CSV blocked: rows exceed RAW_ABS_MAX_ROWS");
            return;
          }
          setCsvLoading(true);
          try {
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, "0");
            const mm = String(now.getMonth() + 1).padStart(2, "0");
            const yy = String(now.getFullYear()).slice(-2);

            if (exportGranularity === "raw") {
              const rows = await fetchMdicComexRawFiltered(supabase, exportFilters);
              downloadCsv({
                rows: rows as unknown as Record<string, unknown>[],
                filename: `mdic_comex_raw_${dd}-${mm}-${yy}`,
              });
            } else {
              const groupBy = MDIC_GROUPBY_MAP[exportGranularity];
              const rows = await rpcGetMdicComexAggregated(supabase, exportFilters, groupBy);
              const metricKeys = ["volume_kg", "valor_fob_usd"] as const;
              const wantedCols = [...groupBy, ...metricKeys] as readonly string[];
              const projected = rows.map((r) => {
                const out: Record<string, unknown> = {};
                for (const k of wantedCols) {
                  out[k] = (r as unknown as Record<string, unknown>)[k];
                }
                return out;
              });
              downloadCsv({
                rows: projected,
                filename: `mdic_comex_${exportGranularity}_${dd}-${mm}-${yy}`,
              });
            }
            setExportOpen(false);
          } catch (e) {
            console.error("MDIC Comex CSV export failed", e);
          } finally {
            setCsvLoading(false);
          }
        }}
        filters={
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Arial" }}>
            {/* Granularidade — default "raw" ───────────────────────────────── */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Granularidade
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {MDIC_GRANULARITY_OPTIONS.map((opt) => (
                  <div key={opt.value} className="form-check" style={{ marginBottom: 0 }}>
                    <input
                      className="form-check-input"
                      type="radio"
                      id={`mdic-export-g-${opt.value}`}
                      name="mdic-export-granularity"
                      checked={exportGranularity === opt.value}
                      onChange={() => setExportGranularity(opt.value)}
                    />
                    <label
                      className="form-check-label"
                      htmlFor={`mdic-export-g-${opt.value}`}
                      style={{ fontFamily: "Arial", fontSize: 12, cursor: "pointer" }}
                    >
                      <strong>{opt.label}</strong>
                      <span style={{ color: "#888", marginLeft: 6, fontSize: 11 }}>
                        — {opt.hint}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Hard-limit warnings (raw only) ────────────────────────────────── */}
            {rawOverAbs && (
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#7a1a1a",
                  backgroundColor: "#fdecea",
                  border: "1px solid #f5c2bc",
                  borderRadius: 4,
                  padding: "8px 10px",
                  lineHeight: 1.4,
                }}
              >
                Volume muito alto ({(exportRawCount ?? 0).toLocaleString("pt-BR")} linhas).
                Escolha uma <strong>granularidade agregada</strong> (NCM, país, fluxo ou ano/mês)
                ou aplique mais filtros (NCM, fluxo, período).
              </div>
            )}
            {!rawOverAbs && rawOverExcel && (
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#7a4a00",
                  backgroundColor: "#fff3cd",
                  border: "1px solid #ffe69c",
                  borderRadius: 4,
                  padding: "8px 10px",
                  lineHeight: 1.4,
                }}
              >
                Volume alto para Excel ({(exportRawCount ?? 0).toLocaleString("pt-BR")} linhas).
                Recomendamos baixar em <strong>CSV</strong> (mais leve) — Excel pode falhar no
                navegador.
              </div>
            )}

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Período</div>
              {hasYears && (
                <PeriodSlider years={anos} value={exportRange} onChange={setExportRange} />
              )}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Fluxo</div>
              <select
                className="form-select form-select-sm"
                value={exportFlow}
                onChange={e => setExportFlow(e.target.value)}
                style={{ fontFamily: "Arial", fontSize: 12, maxWidth: 220 }}
              >
                <option value="ALL">Importação + Exportação</option>
                <option value="import">Importação</option>
                <option value="export">Exportação</option>
              </select>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>NCMs</div>
              <MultiSelectFilter
                label="NCMs"
                items={ALL_NCMS}
                selected={exportNcms}
                onToggle={(ncm) =>
                  setExportNcms(prev =>
                    prev.includes(ncm)
                      ? prev.length > 1 ? prev.filter(n => n !== ncm) : prev
                      : [...prev, ncm]
                  )
                }
                onClear={exportNcms.length < ALL_NCMS.length ? () => setExportNcms(ALL_NCMS) : undefined}
                swatch={(n) => NCM_INFO[n].color}
                itemLabel={(n) => NCM_INFO[n].label}
                idPrefix="ncm-export"
                counterTotal={ALL_NCMS.length}
              />
            </div>
          </div>
        }
      />
    </div>
  );
}
