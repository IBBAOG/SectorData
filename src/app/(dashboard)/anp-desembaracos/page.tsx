"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";
import Slider from "rc-slider";
import "rc-slider/assets/index.css";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import {
  rpcGetAnpDesembaracosSerie,
  rpcGetAnpDesembaracosTopPaises,
  rpcGetAnpDesembaracosFiltros,
  type AnpDesembaracosRow,
  type AnpDesembaracosTopPaisRow,
  type AnpDesembaracosFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const PALETTE = [
  "#E53935","#1E88E5","#43A047","#FB8C00","#8E24AA",
  "#00ACC1","#D81B60","#6D4C41","#F4511E","#039BE5",
  "#7CB342","#FFB300","#546E7A","#AB47BC","#26A69A","#EC407A",
];

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

// ── Helpers ────────────────────────────────────────────────────────────────────

function emptyPlot(h = 300): { data: PlotData[]; layout: Partial<Layout> } {
  return {
    data: [],
    layout: {
      ...COMMON_LAYOUT, height: h,
      margin: { t: 20, b: 30, l: 10, r: 10 },
      annotations: [{
        text: "Sem dados para o período selecionado.",
        xref: "paper", yref: "paper", showarrow: false,
        font: { size: 13, family: "Arial", color: "#888" },
      }],
    },
  };
}

function buildSerieChart(
  rows: AnpDesembaracosRow[],
  ncms: string[],
  allYears: number[],
  yearRange: [number, number],
): { data: PlotData[]; layout: Partial<Layout> } {
  const yMin = allYears[yearRange[0]];
  const yMax = allYears[yearRange[1]];
  const filtered = rows.filter(r => ncms.includes(r.ncm_codigo) && r.ano >= yMin && r.ano <= yMax);
  if (!filtered.length) return emptyPlot(300);

  // Aggregate by (ano, mes, ncm_codigo) — sum across all paises
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

  const traces: PlotData[] = ncms.filter(ncm => filtered.some(r => r.ncm_codigo === ncm)).map((ncm, i) => ({
    type: "scatter", mode: "lines",
    name: ncmNames[ncm] ?? ncm,
    x: allDates,
    y: allDates.map(d => (byKey[`${ncm}|${d}`] ?? 0) / 1e6),
    line: { width: 2, color: PALETTE[i % PALETTE.length] },
    hovertemplate: `${ncmNames[ncm] ?? ncm}: %{y:.1f} mil t<extra></extra>`,
  } as PlotData));

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT, height: 300,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "mil t / mês" } },
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
      x: sorted.map(r => (r.total_kg ?? 0) / 1e6),
      y: sorted.map(r => r.pais_origem),
      marker: { color: "#1E88E5" },
      hovertemplate: "%{y}: %{x:.1f} mil t<extra></extra>",
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT, height: 420,
      margin: { t: 36, b: 40, l: 150, r: 20 },
      xaxis: { ...AXIS_LINE, title: { text: "mil t" } },
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

  const [loading, setLoading]         = useState(true);
  const [filtros, setFiltros]         = useState<AnpDesembaracosFiltros>({ ncms: [], paises: [], ano_min: null, ano_max: null });
  const [allSerie, setAllSerie]       = useState<AnpDesembaracosRow[]>([]);
  const [allYears, setAllYears]       = useState<number[]>([]);
  const [yearRange, setYearRange]     = useState<[number, number]>([0, 0]);
  const [selectedNcms, setSelectedNcms] = useState<string[]>([]);
  const [topNcm, setTopNcm]           = useState<string>("");
  const [topRows, setTopRows]         = useState<AnpDesembaracosTopPaisRow[]>([]);
  const [topLoading, setTopLoading]   = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const [f, serie] = await Promise.all([
        rpcGetAnpDesembaracosFiltros(supabase),
        rpcGetAnpDesembaracosSerie(supabase),
      ]);
      if (cancelled) return;
      setFiltros(f);

      // Default: select top 5 NCMs by volume
      const ncmVols: Record<string, number> = {};
      for (const r of serie) ncmVols[r.ncm_codigo] = (ncmVols[r.ncm_codigo] ?? 0) + (r.quantidade_kg ?? 0);
      const top5 = Object.entries(ncmVols).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
      setSelectedNcms(top5);
      setTopNcm(top5[0] ?? "");

      const years = Array.from(new Set(serie.map(r => r.ano))).sort((a, b) => a - b);
      setAllYears(years);
      if (years.length > 0) {
        const currentYear = new Date().getFullYear();
        const startIdx = Math.max(0, years.findIndex(y => y >= currentYear - 9));
        setYearRange([startIdx, years.length - 1]);
      }
      setAllSerie(serie);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !topNcm || allYears.length === 0) return;
    let cancelled = false;
    setTopLoading(true);
    (async () => {
      const rows = await rpcGetAnpDesembaracosTopPaises(
        supabase, topNcm,
        allYears[yearRange[0]] ?? null,
        allYears[yearRange[1]] ?? null,
      );
      if (cancelled) return;
      setTopRows(rows);
      setTopLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, topNcm, yearRange[0], yearRange[1], allYears]);

  const serieChart = useMemo(
    () => buildSerieChart(allSerie, selectedNcms, allYears, yearRange),
    [allSerie, selectedNcms, allYears, yearRange],
  );

  const topNcmNome = useMemo(
    () => filtros.ncms.find(n => n.ncm_codigo === topNcm)?.ncm_nome ?? topNcm,
    [filtros.ncms, topNcm],
  );

  const topChart = useMemo(
    () => buildTopChart(topRows, topNcmNome),
    [topRows, topNcmNome],
  );

  if (visLoading || !visible) return null;

  const toggleNcm = (ncm: string) =>
    setSelectedNcms(prev =>
      prev.includes(ncm) ? (prev.length > 1 ? prev.filter(x => x !== ncm) : prev) : [...prev, ncm]
    );

  const yMin = allYears[yearRange[0]] ?? "—";
  const yMax = allYears[yearRange[1]] ?? "—";

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

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
                <div className="sidebar-filter-label">NCM (Série)</div>
                {filtros.ncms.map((n, i) => (
                  <div key={n.ncm_codigo} className="form-check" style={{ marginBottom: 4 }}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`ncm-${n.ncm_codigo}`}
                      checked={selectedNcms.includes(n.ncm_codigo)}
                      onChange={() => toggleNcm(n.ncm_codigo)}
                    />
                    <label className="form-check-label" htmlFor={`ncm-${n.ncm_codigo}`}
                      style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}>
                      <span style={{
                        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                        backgroundColor: PALETTE[i % PALETTE.length],
                        marginRight: 5, verticalAlign: "middle",
                      }} />
                      {n.ncm_nome ?? n.ncm_codigo}
                    </label>
                  </div>
                ))}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && allYears.length > 0 && (
                  <>
                    <div style={{ marginTop: 18, marginBottom: 10, paddingLeft: 4, paddingRight: 4 }}>
                      <Slider range min={0} max={allYears.length - 1} value={yearRange}
                        onChange={v => { const a = v as number[]; setYearRange([a[0], a[1]]); }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555", fontFamily: "Arial" }}>
                      <span style={{ fontWeight: 600 }}>{yMin}</span>
                      <span style={{ fontWeight: 600 }}>{yMax}</span>
                    </div>
                  </>
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

          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <div className="page-header-title" style={{ marginBottom: 16 }}>
                ANP — Desembaraços de Importação (Petróleo, Gás e Derivados)
                {yMin && yMax ? ` · ${yMin}–${yMax}` : ""}
              </div>

              {loading ? (
                <div className="d-flex justify-content-center my-5">
                  <img src="/barrel_loading.png" alt="Carregando..." width={160} height={160} />
                </div>
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container">
                        <div className="section-title">Volumes Importados por NCM — Total Nacional (mil t/mês)</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={serieChart.data}
                          layout={serieChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container" style={{ minHeight: 460 }}>
                        {topLoading ? (
                          <div className="d-flex justify-content-center align-items-center" style={{ height: 420 }}>
                            <div className="spinner-border spinner-border-sm text-secondary" />
                          </div>
                        ) : (
                          <PlotlyChart
                            data={topChart.data}
                            layout={topChart.layout}
                            config={{ responsive: true, displayModeBar: false }}
                            style={{ width: "100%", height: 420 }}
                          />
                        )}
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
