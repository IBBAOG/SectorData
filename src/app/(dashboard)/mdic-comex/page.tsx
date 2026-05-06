"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout, PlotData } from "plotly.js";
import Slider from "rc-slider";
import "rc-slider/assets/index.css";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { getSupabaseClient } from "../../../lib/supabaseClient";
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

const COMMON_LAYOUT: Partial<Layout> = {
  paper_bgcolor: "white",
  plot_bgcolor:  "white",
  font: { family: "Arial", size: 12, color: "#000000" },
  hoverlabel: {
    bgcolor:     "rgba(255,255,255,0.95)",
    bordercolor: "rgba(180,180,180,0.5)",
    font: { family: "Arial", color: "#1a1a1a", size: 12 },
    namelength: -1,
  },
};

const AXIS_LINE = {
  showgrid: false, zeroline: false,
  showline: true,  linecolor: "#000000", linewidth: 1,
};

// ── Chart helpers ──────────────────────────────────────────────────────────────

function emptyPlot(h = 280): { data: PlotData[]; layout: Partial<Layout> } {
  return {
    data: [],
    layout: {
      ...COMMON_LAYOUT,
      height: h,
      margin: { t: 20, b: 30, l: 10, r: 10 },
      annotations: [{
        text: "Sem dados para o período selecionado.",
        xref: "paper", yref: "paper", showarrow: false,
        font: { size: 13, family: "Arial", color: "#888" },
      }],
    },
  };
}

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
        y: data.map(r => (r.volume_kg ?? 0) / 1e6),
        line:  { width: 2, color: info?.color ?? "#999" },
        hovertemplate: `${info?.label}: %{y:.0f} mil t<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 280,
      margin: { t: 10, b: 50, l: 70, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "mil t / mês" } },
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
      x: sorted.map(r => (r.volume_kg ?? 0) / 1e6),
      y: sorted.map(r => r.pais),
      marker: { color },
      hovertemplate: "%{y}: %{x:.0f} mil t<extra></extra>",
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT,
      height: 380,
      margin: { t: 36, b: 40, l: 130, r: 20 },
      xaxis: { ...AXIS_LINE, title: { text: "mil t" } },
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
  const [serieLoading, setSerieLoading]           = useState(false);
  const [topLoading, setTopLoading]               = useState(false);
  const [serieRows, setSerieRows]                 = useState<MdicComexSerieRow[]>([]);
  const [anos, setAnos]                           = useState<number[]>([]);
  const [yearRange, setYearRange]                 = useState<[number, number]>([0, 0]);
  const [selectedNCMs, setSelectedNCMs]           = useState<string[]>(ALL_NCMS);
  const [selectedNcmPaises, setSelectedNcmPaises] = useState<string>("27090010");
  const [topImport, setTopImport]                 = useState<MdicComexTopPaisRow[]>([]);
  const [topExport, setTopExport]                 = useState<MdicComexTopPaisRow[]>([]);

  const serieDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topDebounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ── Ref-stable year tuple to avoid spurious refetches ─────────────────────
  const yearTuple = useMemo<[number, number]>(
    () => [yearRange[0], yearRange[1]],
    [yearRange],
  );

  // ── Reactive serie fetch (debounced 400ms) — period changes only ─────────
  const fetchSerie = useCallback(() => {
    if (!supabase || loading) return;
    if (serieDebounceRef.current) clearTimeout(serieDebounceRef.current);
    serieDebounceRef.current = setTimeout(async () => {
      setSerieLoading(true);
      const yMin = anos[yearTuple[0]];
      const yMax = anos[yearTuple[1]];
      const rows = await rpcGetMdicComexSerie(supabase, {
        anoInicio: yMin ?? null,
        anoFim:    yMax ?? null,
      });
      setSerieRows(rows);
      setSerieLoading(false);
    }, 400);
  }, [supabase, loading, yearTuple, anos]);

  useEffect(() => { fetchSerie(); }, [fetchSerie]);

  // ── Reactive top countries fetch (debounced 400ms) ────────────────────────
  const fetchTop = useCallback(() => {
    if (!supabase || loading) return;
    if (topDebounceRef.current) clearTimeout(topDebounceRef.current);
    topDebounceRef.current = setTimeout(async () => {
      setTopLoading(true);
      const yMin = anos[yearTuple[0]];
      const yMax = anos[yearTuple[1]];
      if (!yMin || !yMax) { setTopLoading(false); return; }
      const [imp, exp] = await Promise.all([
        rpcGetMdicComexTopPaises(supabase, "import", selectedNcmPaises, yMin, yMax),
        rpcGetMdicComexTopPaises(supabase, "export", selectedNcmPaises, yMin, yMax),
      ]);
      setTopImport(imp);
      setTopExport(exp);
      setTopLoading(false);
    }, 400);
  }, [supabase, loading, selectedNcmPaises, yearTuple, anos]);

  useEffect(() => { fetchTop(); }, [fetchTop]);

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

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Produto{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedNCMs.length}/{ALL_NCMS.length})
                  </span>
                </div>
                {ALL_NCMS.map(ncm => (
                  <div key={ncm} className="form-check" style={{ marginBottom: 6 }}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`ncm-${ncm}`}
                      checked={selectedNCMs.includes(ncm)}
                      onChange={() => toggleNcm(ncm)}
                    />
                    <label className="form-check-label" htmlFor={`ncm-${ncm}`}
                      style={{ fontFamily: "Arial", fontSize: 12, cursor: "pointer" }}>
                      <span style={{
                        display: "inline-block", width: 9, height: 9,
                        borderRadius: "50%", backgroundColor: NCM_INFO[ncm].color,
                        marginRight: 6, verticalAlign: "middle",
                      }} />
                      {NCM_INFO[ncm].label}
                    </label>
                  </div>
                ))}
                {selectedNCMs.length < ALL_NCMS.length && (
                  <button className="filter-btn-link filter-btn-link--secondary"
                    style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10 }}
                    onClick={() => setSelectedNCMs(ALL_NCMS)}>
                    Limpar
                  </button>
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && hasYears && (
                  <>
                    <div style={{ marginTop: 18, marginBottom: 10, paddingLeft: 4, paddingRight: 4 }}>
                      <Slider
                        range
                        min={0}
                        max={anos.length - 1}
                        value={yearRange}
                        onChange={v => {
                          const arr = v as number[];
                          setYearRange([arr[0], arr[1]]);
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555", fontFamily: "Arial" }}>
                      <span style={{ fontWeight: 600 }}>{yMin}</span>
                      <span style={{ fontWeight: 600 }}>{yMax}</span>
                    </div>
                  </>
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
              <div className="mb-2">
                <div className="page-header-title">MDIC Comex Stat — Importações e Exportações</div>
                <div className="page-header-sub">
                  Volume mensal de importação e exportação de petróleo cru, gasolina e diesel por NCM e país de origem/destino
                  {hasYears && (
                    <span style={{ marginLeft: 12, fontSize: 11, color: "#888" }}>
                      Período: {yMin}–{yMax}
                    </span>
                  )}
                </div>
              </div>

              <hr style={{ borderTop: "2px solid #e0e0e0", marginBottom: 12 }} />

              {loading ? (
                <div className="d-flex justify-content-center my-5">
                  <img src="/barrel_loading.png" alt="Carregando..." width={160} height={160} />
                </div>
              ) : (
                <>
                  {/* ── Volume Importado ─────────────────────────────── */}
                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container" style={{ position: "relative" }}>
                        <div className="section-title">
                          Importações (mil t / mês)
                          {serieLoading && (
                            <span style={{ marginLeft: 10, fontSize: 11, color: "#aaa", fontWeight: 400 }}>
                              atualizando…
                            </span>
                          )}
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={importChart.data}
                          layout={importChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280, opacity: serieLoading ? 0.5 : 1 }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* ── Volume Exportado ─────────────────────────────── */}
                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container" style={{ position: "relative" }}>
                        <div className="section-title">
                          Exportações (mil t / mês)
                          {serieLoading && (
                            <span style={{ marginLeft: 10, fontSize: 11, color: "#aaa", fontWeight: 400 }}>
                              atualizando…
                            </span>
                          )}
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={exportChart.data}
                          layout={exportChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280, opacity: serieLoading ? 0.5 : 1 }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* ── Top Países ───────────────────────────────────── */}
                  <div className="row mb-2">
                    <div className="col-lg-6">
                      <div className="chart-container" style={{ minHeight: 420, position: "relative" }}>
                        <PlotlyChart
                          data={topImportChart.data}
                          layout={topImportChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 380, opacity: topLoading ? 0.5 : 1 }}
                        />
                      </div>
                    </div>
                    <div className="col-lg-6">
                      <div className="chart-container" style={{ minHeight: 420, position: "relative" }}>
                        <PlotlyChart
                          data={topExportChart.data}
                          layout={topExportChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 380, opacity: topLoading ? 0.5 : 1 }}
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
