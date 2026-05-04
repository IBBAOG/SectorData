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
  rpcGetAnpPainelImpSerie,
  rpcGetAnpPainelImpTopDist,
  rpcGetAnpPainelImpFiltros,
  type AnpPainelImpSerieRow,
  type AnpPainelImpTopDistRow,
  type AnpPainelImpFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const PALETTE = [
  "#1E88E5","#FF5000","#43A047","#FB8C00","#8E24AA",
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
  rows: AnpPainelImpSerieRow[],
  produtos: string[],
  allYears: number[],
  yearRange: [number, number],
): { data: PlotData[]; layout: Partial<Layout> } {
  const yMin = allYears[yearRange[0]];
  const yMax = allYears[yearRange[1]];
  const filtered = rows.filter(
    r => produtos.includes(r.nome_produto) && r.ano >= yMin && r.ano <= yMax
  );
  if (!filtered.length) return emptyPlot(280);

  const byProduto: Record<string, AnpPainelImpSerieRow[]> = {};
  for (const r of filtered) (byProduto[r.nome_produto] ??= []).push(r);

  const traces: PlotData[] = produtos.filter(p => byProduto[p]).map((p, i) => {
    const data = byProduto[p].sort((a, b) => a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes);
    return {
      type: "scatter", mode: "lines",
      name: p,
      x: data.map(r => `${r.ano}-${String(r.mes).padStart(2, "0")}`),
      y: data.map(r => (r.volume_m3 ?? 0) / 1e3),
      line: { width: 2, color: PALETTE[i % PALETTE.length] },
      hovertemplate: `${p}: %{y:.1f} mil m³<extra></extra>`,
    } as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT, height: 280,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "mil m³ / mês" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0, font: { size: 10 } },
    },
  };
}

function buildTopDistChart(
  rows: AnpPainelImpTopDistRow[],
  produto: string,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!rows.length) return emptyPlot(380);
  const sorted = [...rows].sort((a, b) => (b.total_m3 ?? 0) - (a.total_m3 ?? 0));
  return {
    data: [{
      type: "bar", orientation: "h",
      x: sorted.map(r => (r.total_m3 ?? 0) / 1e3),
      y: sorted.map(r => r.distribuidor),
      marker: { color: "#1E88E5" },
      hovertemplate: "%{y}: %{x:.1f} mil m³<extra></extra>",
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT, height: 440,
      margin: { t: 36, b: 40, l: 180, r: 20 },
      xaxis: { ...AXIS_LINE, title: { text: "mil m³" } },
      yaxis: { autorange: "reversed" as const, showgrid: false, zeroline: false, tickfont: { size: 10 } },
      title: {
        text: `Top 15 Distribuidores — ${produto}`,
        font: { size: 13, family: "Arial" }, x: 0, xanchor: "left", pad: { l: 0 },
      },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpPainelImportacoesPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-painel-importacoes");
  const supabase = getSupabaseClient();

  const [loading, setLoading]             = useState(true);
  const [filtros, setFiltros]             = useState<AnpPainelImpFiltros>({ produtos: [], ufs: [], distribuidores: [], ano_min: null, ano_max: null });
  const [allSerie, setAllSerie]           = useState<AnpPainelImpSerieRow[]>([]);
  const [allYears, setAllYears]           = useState<number[]>([]);
  const [yearRange, setYearRange]         = useState<[number, number]>([0, 0]);
  const [selectedProdutos, setSelected]   = useState<string[]>([]);
  const [topProduto, setTopProduto]       = useState<string>("");
  const [topRows, setTopRows]             = useState<AnpPainelImpTopDistRow[]>([]);
  const [topLoading, setTopLoading]       = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const [f, serie] = await Promise.all([
        rpcGetAnpPainelImpFiltros(supabase),
        rpcGetAnpPainelImpSerie(supabase),
      ]);
      if (cancelled) return;
      setFiltros(f);
      setSelected(f.produtos);
      setTopProduto(f.produtos[0] ?? "");

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
    if (!supabase || !topProduto || allYears.length === 0) return;
    let cancelled = false;
    setTopLoading(true);
    (async () => {
      const rows = await rpcGetAnpPainelImpTopDist(
        supabase, topProduto,
        allYears[yearRange[0]] ?? null,
        allYears[yearRange[1]] ?? null,
      );
      if (cancelled) return;
      setTopRows(rows);
      setTopLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, topProduto, yearRange[0], yearRange[1], allYears]);

  const serieChart = useMemo(
    () => buildSerieChart(allSerie, selectedProdutos, allYears, yearRange),
    [allSerie, selectedProdutos, allYears, yearRange],
  );

  const topChart = useMemo(
    () => buildTopDistChart(topRows, topProduto),
    [topRows, topProduto],
  );

  if (visLoading || !visible) return null;

  const toggleProduto = (p: string) =>
    setSelected(prev =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter(x => x !== p) : prev) : [...prev, p]
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
                <div className="sidebar-filter-label">Produto</div>
                {filtros.produtos.map((p, i) => (
                  <div key={p} className="form-check" style={{ marginBottom: 4 }}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`pimp-${p}`}
                      checked={selectedProdutos.includes(p)}
                      onChange={() => toggleProduto(p)}
                    />
                    <label className="form-check-label" htmlFor={`pimp-${p}`}
                      style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}>
                      <span style={{
                        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                        backgroundColor: PALETTE[i % PALETTE.length],
                        marginRight: 5, verticalAlign: "middle",
                      }} />
                      {p}
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
                <div className="sidebar-filter-label">Top Distribuidores — Produto</div>
                <select
                  className="form-select form-select-sm"
                  value={topProduto}
                  onChange={e => setTopProduto(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 11 }}
                >
                  {filtros.produtos.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <div className="page-header-title" style={{ marginBottom: 16 }}>
                ANP Painel — Importações de Distribuidores
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
                        <div className="section-title">Volume Mensal Importado por Distribuidores (mil m³)</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={serieChart.data}
                          layout={serieChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280 }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container" style={{ minHeight: 480 }}>
                        {topLoading ? (
                          <div className="d-flex justify-content-center align-items-center" style={{ height: 440 }}>
                            <div className="spinner-border spinner-border-sm text-secondary" />
                          </div>
                        ) : (
                          <PlotlyChart
                            data={topChart.data}
                            layout={topChart.layout}
                            config={{ responsive: true, displayModeBar: false }}
                            style={{ width: "100%", height: 440 }}
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
