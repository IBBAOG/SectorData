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
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, PALETTE } from "../../../lib/plotlyDefaults";
import { kgToMilTon, LABEL } from "../../../lib/units";
import { downloadGenericExcel } from "../../../lib/exportExcel";
import { downloadCsv } from "../../../lib/exportCsv";
import {
  rpcGetAnpDesembaracosSerie,
  rpcGetAnpDesembaracosTopPaises,
  rpcGetAnpDesembaracosFiltros,
  type AnpDesembaracosRow,
  type AnpDesembaracosTopPaisRow,
  type AnpDesembaracosFiltros,
} from "../../../lib/rpc";

// ── Helpers ────────────────────────────────────────────────────────────────────

// quantidade_kg → mil t (kton): kg / 1e6 = thousands of metric tons.
// Math: 1 mil t = 1.000 t = 1.000.000 kg. Divisor 1e6 matches label "mil t".
function buildSerieChart(
  rows: AnpDesembaracosRow[],
  ncms: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  // Server already filtered by NCM/period; aggregate by (ano, mes, ncm_codigo) summing across paises.
  const filtered = rows.filter(r => ncms.includes(r.ncm_codigo));
  if (!filtered.length) return emptyPlot(300);

  const byKey: Record<string, number> = {};
  const ncmNames: Record<string, string> = {};
  for (const r of filtered) {
    const key = `${r.ncm_codigo}|${r.ano}-${String(r.mes).padStart(2, "0")}`;
    byKey[key] = (byKey[key] ?? 0) + (r.quantidade_kg ?? 0);
    ncmNames[r.ncm_codigo] = r.ncm_nome ?? r.ncm_codigo;
  }

  const allDates = Array.from(
    new Set(filtered.map(r => `${r.ano}-${String(r.mes).padStart(2, "0")}`))
  ).sort();

  const traces: PlotData[] = ncms
    .filter(ncm => filtered.some(r => r.ncm_codigo === ncm))
    .map((ncm, i) => ({
      type: "scatter", mode: "lines",
      name: ncmNames[ncm] ?? ncm,
      x: allDates,
      y: allDates.map(d => kgToMilTon(byKey[`${ncm}|${d}`] ?? 0)),
      line: { width: 2, color: PALETTE[i % PALETTE.length] },
      hovertemplate: `${ncmNames[ncm] ?? ncm}: %{y:.1f} ${LABEL.MIL_T}<extra></extra>`,
    } as PlotData));

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT, height: 300,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: `${LABEL.MIL_T} / mês` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0, font: { size: 10 } },
    },
  };
}

function buildTopChart(
  rows: AnpDesembaracosTopPaisRow[],
  ncmNome: string,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!rows.length) return emptyPlot(380);
  const sorted = [...rows].sort((a, b) => (b.total_kg ?? 0) - (a.total_kg ?? 0));
  return {
    data: [{
      type: "bar", orientation: "h",
      x: sorted.map(r => kgToMilTon(r.total_kg ?? 0)),
      y: sorted.map(r => r.pais_origem),
      marker: { color: "#1E88E5" },
      hovertemplate: `%{y}: %{x:.1f} ${LABEL.MIL_T}<extra></extra>`,
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT, height: 420,
      margin: { t: 36, b: 40, l: 150, r: 20 },
      xaxis: { ...AXIS_LINE, title: { text: LABEL.MIL_T } },
      yaxis: { autorange: "reversed" as const, showgrid: false, zeroline: false, tickfont: { size: 10 } },
      title: {
        text: `Top Países Origem — ${ncmNome}`,
        font: { size: 13, family: "Arial" }, x: 0, xanchor: "left", pad: { l: 0 },
      },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpDesembaracosPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-desembaracos");
  const supabase = getSupabaseClient();

  const [loading, setLoading]               = useState(true);
  const [filtros, setFiltros]               = useState<AnpDesembaracosFiltros>({
    ncms: [], paises: [], ano_min: null, ano_max: null,
  });
  const [serieRows, setSerieRows]           = useState<AnpDesembaracosRow[]>([]);
  const [allYears, setAllYears]             = useState<number[]>([]);
  const [yearRange, setYearRange]           = useState<[number, number]>([0, 0]);
  const [selectedNcms, setSelectedNcms]     = useState<string[]>([]);
  const [topNcm, setTopNcm]                 = useState<string>("");
  const [topRows, setTopRows]               = useState<AnpDesembaracosTopPaisRow[]>([]);
  const [excelLoading, setExcelLoading]     = useState(false);

  // ── Initial load: filtros + first serie fetch (last 10 years, top 5 NCMs) ──
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpDesembaracosFiltros(supabase);
      if (cancelled) return;
      setFiltros(f);

      const yMin = f.ano_min ?? new Date().getFullYear() - 10;
      const yMax = f.ano_max ?? new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMin; y <= yMax; y++) years.push(y);
      const startIdx = Math.max(0, years.findIndex(y => y >= yMax - 9));
      const fromYear = years[startIdx] ?? yMin;
      setAllYears(years);
      setYearRange([startIdx, years.length - 1]);

      // Empty table guard
      if (!years.length || !f.ncms.length) {
        if (!cancelled) {
          setSerieRows([]);
          setLoading(false);
        }
        return;
      }

      // Fetch serie for the visible window — used both to compute top-5 NCMs
      // and to feed the chart (re-filtered client-side by selected NCMs).
      const rows = await rpcGetAnpDesembaracosSerie(supabase, {
        anoInicio: fromYear,
        anoFim:    yMax,
      });
      if (cancelled) return;

      // Default selection: top 5 NCMs by volume in the window
      const ncmVols: Record<string, number> = {};
      for (const r of rows) ncmVols[r.ncm_codigo] = (ncmVols[r.ncm_codigo] ?? 0) + (r.quantidade_kg ?? 0);
      const top5 = Object.entries(ncmVols)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k]) => k);
      const initialNcms = top5.length ? top5 : f.ncms.slice(0, 5).map(n => n.ncm_codigo);
      setSelectedNcms(initialNcms);
      setTopNcm(initialNcms[0] ?? "");
      setSerieRows(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) — period changes only ─────────
  const { data: refetchedSerie, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const yMin = allYears[yearRange[0]];
      const yMax = allYears[yearRange[1]];
      return rpcGetAnpDesembaracosSerie(supabase, {
        anoInicio: yMin ?? null,
        anoFim:    yMax ?? null,
      });
    },
    [supabase, loading, yearRange[0], yearRange[1], allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetchedSerie) setSerieRows(refetchedSerie);
  }, [refetchedSerie]);

  // ── Top países: refetch on topNcm or period change ────────────────────────
  const { data: refetchedTop, loading: topLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || !topNcm || allYears.length === 0 || loading) return null;
      return rpcGetAnpDesembaracosTopPaises(
        supabase, topNcm,
        allYears[yearRange[0]] ?? null,
        allYears[yearRange[1]] ?? null,
      );
    },
    [supabase, topNcm, yearRange[0], yearRange[1], allYears, loading],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (refetchedTop) setTopRows(refetchedTop);
  }, [refetchedTop]);

  const serieChart = useMemo(
    () => buildSerieChart(serieRows, selectedNcms),
    [serieRows, selectedNcms],
  );

  const topNcmNome = useMemo(
    () => filtros.ncms.find(n => n.ncm_codigo === topNcm)?.ncm_nome ?? topNcm,
    [filtros.ncms, topNcm],
  );

  const topChart = useMemo(
    () => buildTopChart(topRows, topNcmNome),
    [topRows, topNcmNome],
  );

  const ncmCodigos = useMemo(() => filtros.ncms.map(n => n.ncm_codigo), [filtros.ncms]);
  const ncmNomeMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const n of filtros.ncms) m[n.ncm_codigo] = n.ncm_nome ?? n.ncm_codigo;
    return m;
  }, [filtros.ncms]);

  if (visLoading || !visible) return null;

  const toggleNcm = (ncm: string) =>
    setSelectedNcms(prev =>
      prev.includes(ncm)
        ? prev.length > 1 ? prev.filter(x => x !== ncm) : prev
        : [...prev, ncm]
    );

  const hasYears = allYears.length > 0;
  const hasData  = filtros.ncms.length > 0;
  const yMin = hasYears ? allYears[yearRange[0]] : null;
  const yMax = hasYears ? allYears[yearRange[1]] : null;

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

              {/* NCM uses 11px font / 8x8 swatch in original — small variation
                  acceptable; default 12px+9x9 from MultiSelectFilter is close enough. */}
              <MultiSelectFilter
                label="NCM (Série)"
                items={ncmCodigos}
                selected={selectedNcms}
                onToggle={toggleNcm}
                onClear={ncmCodigos.length > 0 && selectedNcms.length < ncmCodigos.length
                  ? () => setSelectedNcms(ncmCodigos)
                  : undefined}
                swatch={(code) => {
                  const i = ncmCodigos.indexOf(code);
                  return PALETTE[i % PALETTE.length];
                }}
                itemLabel={(code) => ncmNomeMap[code] ?? code}
                idPrefix="ncm"
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && hasYears && (
                  <PeriodSlider years={allYears} value={yearRange} onChange={setYearRange} />
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Top Países — NCM</div>
                <select
                  className="form-select form-select-sm"
                  value={topNcm}
                  onChange={e => setTopNcm(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 11 }}
                >
                  {filtros.ncms.map(n => (
                    <option key={n.ncm_codigo} value={n.ncm_codigo}>
                      {n.ncm_nome ?? n.ncm_codigo}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="ANP — Desembaraços de Importação (Petróleo, Gás e Derivados)"
                sub={`Volumes mensais desembaraçados na importação por NCM e país de origem (massa em ${LABEL.MIL_T})`}
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
                rightSlot={hasData ? (
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "formatted data .xl",
                        busy: excelLoading,
                        loadingLabel: "Gerando Excel...",
                        disabled: loading || serieRows.length === 0 || excelLoading,
                        onClick: async () => {
                          setExcelLoading(true);
                          try {
                            await downloadGenericExcel<AnpDesembaracosRow>({
                              rows: serieRows,
                              filename: "ANP-Desembaracos",
                              title: "ANP — Desembaraços de Importação",
                              sheetName: "Desembaraços",
                              columns: [
                                { key: "ano",           header: "Ano" },
                                { key: "mes",           header: "Mês" },
                                { key: "ncm_codigo",    header: "NCM" },
                                { key: "ncm_nome",      header: "Descrição NCM", width: 36 },
                                { key: "pais_origem",   header: "País origem",   width: 22 },
                                { key: "quantidade_kg", header: "Quantidade (kg)", format: "#,##0" },
                              ],
                            });
                          } catch (e) {
                            console.error("Excel export failed", e);
                          } finally {
                            setExcelLoading(false);
                          }
                        },
                      },
                      {
                        kind: "csv",
                        label: "all data .csv",
                        disabled: loading || serieRows.length === 0,
                        onClick: () => {
                          downloadCsv({
                            rows: serieRows as unknown as Record<string, unknown>[],
                            filename: "ANP-Desembaracos",
                          });
                        },
                      },
                    ]}
                  />
                ) : null}
              />

              {loading ? (
                <BarrelLoading />
              ) : !hasData ? (
                <div className="d-flex justify-content-center align-items-center my-5"
                  style={{ minHeight: 240, color: "#888", fontFamily: "Arial", fontSize: 14 }}>
                  Sem dados disponíveis para este módulo no momento.
                </div>
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Volumes Importados por NCM — Total Nacional (${LABEL.MIL_T} / mês)`}
                        loading={serieLoading}
                        height={300}
                      >
                        <PlotlyChart
                          data={serieChart.data}
                          layout={serieChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Top Países Origem — ${topNcmNome} (${LABEL.MIL_T})`}
                        loading={topLoading}
                        height={420}
                        containerStyle={{ minHeight: 460 }}
                      >
                        <PlotlyChart
                          data={topChart.data}
                          layout={topChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 420 }}
                        />
                      </ChartSection>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
