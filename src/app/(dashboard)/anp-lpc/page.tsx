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
  rpcGetAnpLpcNacional,
  rpcGetAnpLpcSerie,
  rpcGetAnpLpcFiltros,
  type AnpLpcNacionalRow,
  type AnpLpcSerieRow,
  type AnpLpcFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const PRODUTO_COLORS: Record<string, string> = {
  "GASOLINA COMUM":  "#FF5000",
  "GASOLINA ADITIVADA": "#FF8C42",
  "ETANOL HIDRATADO": "#8BC34A",
  "DIESEL S10":      "#2196F3",
  "DIESEL S500":     "#64B5F6",
  "GNV":             "#9C27B0",
  "GLP":             "#FF9800",
};
const PALETTE = [
  "#FF5000","#2196F3","#8BC34A","#FF9800","#9C27B0",
  "#E53935","#00ACC1","#FF8C42","#64B5F6","#7CB342",
];

const UF_REGIAO: Record<string, string> = {
  AC:"N", AM:"N", AP:"N", PA:"N", RO:"N", RR:"N", TO:"N",
  AL:"NE", BA:"NE", CE:"NE", MA:"NE", PB:"NE", PE:"NE", PI:"NE", RN:"NE", SE:"NE",
  DF:"CO", GO:"CO", MS:"CO", MT:"CO",
  ES:"SE", MG:"SE", RJ:"SE", SP:"SE",
  PR:"S", RS:"S", SC:"S",
};

const REGIAO_COLORS: Record<string, string> = {
  N: "#009688", NE: "#FF5722", CO: "#9C27B0", SE: "#F44336", S: "#3F51B5",
};

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

const AXIS_LINE = { showgrid: false, zeroline: false, showline: true, linecolor: "#000000", linewidth: 1 };

// ── Helpers ────────────────────────────────────────────────────────────────────

function emptyPlot(h = 300): { data: PlotData[]; layout: Partial<Layout> } {
  return {
    data: [],
    layout: {
      ...COMMON_LAYOUT, height: h, margin: { t: 20, b: 30, l: 10, r: 10 },
      annotations: [{ text: "Sem dados.", xref: "paper", yref: "paper", showarrow: false, font: { size: 13, color: "#888" } }],
    },
  };
}

function buildNacionalChart(
  rows: AnpLpcNacionalRow[],
  produtos: string[],
  allYears: number[],
  yearRange: [number, number],
): { data: PlotData[]; layout: Partial<Layout> } {
  const yMin = allYears[yearRange[0]];
  const yMax = allYears[yearRange[1]];
  const filtered = rows.filter(r => {
    const y = parseInt(r.data_fim.slice(0, 4));
    return y >= yMin && y <= yMax && produtos.includes(r.produto);
  });
  if (!filtered.length) return emptyPlot(300);

  const byProduto: Record<string, AnpLpcNacionalRow[]> = {};
  for (const r of filtered) (byProduto[r.produto] ??= []).push(r);

  const traces: PlotData[] = produtos.filter(p => byProduto[p]).map((p, i) => {
    const data = byProduto[p].sort((a, b) => a.data_fim.localeCompare(b.data_fim));
    const color = PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
    return {
      type: "scatter", mode: "lines",
      name: p,
      x: data.map(r => r.data_fim),
      y: data.map(r => r.preco_medio_venda),
      line: { width: 2, color },
      hovertemplate: `${p}: R$ %{y:.3f}<extra></extra>`,
    } as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT, height: 320,
      margin: { t: 10, b: 50, l: 75, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "R$ / L (ou kg)" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function buildEstadoChart(
  rows: AnpLpcSerieRow[],
  produto: string,
  allYears: number[],
  yearRange: [number, number],
): { data: PlotData[]; layout: Partial<Layout> } {
  const yMin = allYears[yearRange[0]];
  const yMax = allYears[yearRange[1]];
  const filtered = rows.filter(r => {
    const y = parseInt(r.data_fim.slice(0, 4));
    return r.produto === produto && y >= yMin && y <= yMax;
  });
  if (!filtered.length) return emptyPlot(320);

  // Aggregate by regiao (avg across states per week)
  const byRegiao: Record<string, { dates: string[]; prices: number[] }> = {};
  const regiaoTotals: Record<string, Record<string, { sum: number; cnt: number }>> = {};
  for (const r of filtered) {
    const reg = UF_REGIAO[r.estado] ?? r.estado;
    if (!regiaoTotals[reg]) regiaoTotals[reg] = {};
    if (!regiaoTotals[reg][r.data_fim]) regiaoTotals[reg][r.data_fim] = { sum: 0, cnt: 0 };
    regiaoTotals[reg][r.data_fim].sum += r.preco_medio_venda ?? 0;
    regiaoTotals[reg][r.data_fim].cnt += 1;
  }

  const regioes = Object.keys(regiaoTotals).sort();
  const traces: PlotData[] = regioes.map(reg => {
    const entries = Object.entries(regiaoTotals[reg])
      .sort(([a], [b]) => a.localeCompare(b));
    return {
      type: "scatter", mode: "lines",
      name: reg,
      x: entries.map(([d]) => d),
      y: entries.map(([, v]) => v.sum / v.cnt),
      line: { width: 1.5, color: REGIAO_COLORS[reg] ?? "#999" },
      hovertemplate: `${reg}: R$ %{y:.3f}<extra></extra>`,
    } as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT, height: 280,
      margin: { t: 10, b: 50, l: 75, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "R$ / L" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpLpcPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-lpc");
  const supabase = getSupabaseClient();

  const [loading, setLoading]             = useState(true);
  const [filtros, setFiltros]             = useState<AnpLpcFiltros>({ produtos: [], estados: [], data_min: null, data_max: null });
  const [allNacional, setAllNacional]     = useState<AnpLpcNacionalRow[]>([]);
  const [allEstado, setAllEstado]         = useState<AnpLpcSerieRow[]>([]);
  const [allYears, setAllYears]           = useState<number[]>([]);
  const [yearRange, setYearRange]         = useState<[number, number]>([0, 0]);
  const [selectedProdutos, setSelected]   = useState<string[]>([]);
  const [detailProduto, setDetail]        = useState<string>("");

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const [f, nacional, estado] = await Promise.all([
        rpcGetAnpLpcFiltros(supabase),
        rpcGetAnpLpcNacional(supabase),
        rpcGetAnpLpcSerie(supabase),
      ]);
      if (cancelled) return;
      setFiltros(f);
      setSelected(f.produtos);
      setDetail(f.produtos[0] ?? "");

      const years = Array.from(
        new Set(nacional.map(r => parseInt(r.data_fim.slice(0, 4))))
      ).sort((a, b) => a - b);
      setAllYears(years);
      if (years.length > 0) {
        const currentYear = new Date().getFullYear();
        const startIdx = Math.max(0, years.findIndex(y => y >= currentYear - 4));
        setYearRange([startIdx, years.length - 1]);
      }
      setAllNacional(nacional);
      setAllEstado(estado);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const nacChart   = useMemo(() => buildNacionalChart(allNacional, selectedProdutos, allYears, yearRange), [allNacional, selectedProdutos, allYears, yearRange]);
  const regChart   = useMemo(() => buildEstadoChart(allEstado, detailProduto, allYears, yearRange), [allEstado, detailProduto, allYears, yearRange]);

  if (visLoading || !visible) return null;

  const toggleProduto = (p: string) =>
    setSelected(prev => prev.includes(p) ? (prev.length > 1 ? prev.filter(x => x !== p) : prev) : [...prev, p]);

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
                  width: "100%", maxWidth: 300, height: 60, display: "flex",
                  alignItems: "center", justifyContent: "center",
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
                    <input className="form-check-input" type="checkbox" id={`lpc-${p}`}
                      checked={selectedProdutos.includes(p)} onChange={() => toggleProduto(p)} />
                    <label className="form-check-label" htmlFor={`lpc-${p}`}
                      style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}>
                      <span style={{
                        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                        backgroundColor: PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length],
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
                <div className="sidebar-filter-label">Detalhe por Região — Produto</div>
                <select className="form-select form-select-sm" value={detailProduto}
                  onChange={e => setDetail(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 11 }}>
                  {filtros.produtos.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <div className="page-header-title" style={{ marginBottom: 16 }}>
                ANP LPC — Preços Semanais de Combustíveis (Média Ponderada por Postos)
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
                        <div className="section-title">Preço Médio Nacional — Venda (R$/L ou R$/kg)</div>
                        <hr className="section-hr" />
                        <PlotlyChart data={nacChart.data} layout={nacChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 320 }} />
                      </div>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container">
                        <div className="section-title">
                          Preço por Região — {detailProduto}
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart data={regChart.data} layout={regChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280 }} />
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
