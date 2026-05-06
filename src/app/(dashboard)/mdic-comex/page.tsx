"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import DashboardHeader from "../../../components/dashboard/DashboardHeader";
import MultiSelectFilter from "../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../components/dashboard/ChartSection";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";
import { kgToMilTon, LABEL } from "../../../lib/units";
import {
  rpcGetMdicComexSerie,
  rpcGetMdicComexTopPaises,
  rpcGetMdicComexFiltros,
  type MdicComexSerieRow,
  type MdicComexTopPaisRow,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const NCM_INFO: Record<string, { label: string; color: string }> = {
  "27090010": { label: "Petróleo Cru", color: "#1a1a1a" },
  "27101259": { label: "Gasolina",     color: "#FF5000" },
  "27101921": { label: "Diesel",       color: "#2196F3" },
};
const ALL_NCMS = Object.keys(NCM_INFO);

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
              />

              {loading ? (
                <div className="d-flex justify-content-center my-5">
                  <img src="/barrel_loading.png" alt="Carregando..." width={160} height={160} />
                </div>
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
    </div>
  );
}
