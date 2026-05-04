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
  rpcGetSindicomSerie,
  rpcGetSindicomFiltros,
  type SindicomSerieRow,
  type SindicomFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const PRODUTO_COLORS: Record<string, string> = {
  "GASOLINA C COMUM":   "#FF5000",
  "GASOLINA C ADITIVADA": "#FF8C42",
  "ETANOL HIDRATADO":   "#8BC34A",
  "DIESEL B S10":       "#2196F3",
  "DIESEL B S500":      "#64B5F6",
  "GLP":                "#FF9800",
  "GNV":                "#9C27B0",
  "ÓLEO DIESEL A S10":  "#1565C0",
  "ÓLEO DIESEL A S500": "#42A5F5",
};
const PALETTE = [
  "#FF5000","#2196F3","#8BC34A","#FF9800","#9C27B0",
  "#E53935","#00ACC1","#FF8C42","#64B5F6","#7CB342",
  "#FF7043","#26C6DA","#D4E157","#AB47BC","#EF5350",
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

function rowDateKey(r: SindicomSerieRow) {
  return `${r.ano}-${String(r.mes).padStart(2, "0")}`;
}

function buildVolumeChart(
  rows: SindicomSerieRow[],
  produtos: string[],
  segmentos: string[],
  allYears: number[],
  yearRange: [number, number],
): { data: PlotData[]; layout: Partial<Layout> } {
  const yMin = allYears[yearRange[0]];
  const yMax = allYears[yearRange[1]];

  const filtered = rows.filter(r =>
    r.ano >= yMin && r.ano <= yMax &&
    produtos.includes(r.nome_produto) &&
    segmentos.includes(r.segmento)
  );
  if (!filtered.length) return emptyPlot(300);

  // Aggregate by (produto, date_key) summing volume across empresas
  const agg: Record<string, Record<string, number>> = {};
  for (const r of filtered) {
    if (!agg[r.nome_produto]) agg[r.nome_produto] = {};
    const k = rowDateKey(r);
    agg[r.nome_produto][k] = (agg[r.nome_produto][k] ?? 0) + (r.volume ?? 0);
  }

  const traces: PlotData[] = produtos
    .filter(p => agg[p])
    .map((p, i) => {
      const entries = Object.entries(agg[p]).sort(([a], [b]) => a.localeCompare(b));
      const color = PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
      return {
        type: "scatter", mode: "lines",
        name: p,
        x: entries.map(([d]) => d + "-01"),
        y: entries.map(([, v]) => v),
        line: { width: 2, color },
        hovertemplate: `${p}: %{y:,.0f} m³<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT, height: 320,
      margin: { t: 10, b: 50, l: 90, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "Volume (m³)" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function buildMarketShareChart(
  rows: SindicomSerieRow[],
  produto: string,
  segmentos: string[],
  allYears: number[],
  yearRange: [number, number],
): { data: PlotData[]; layout: Partial<Layout> } {
  const yMin = allYears[yearRange[0]];
  const yMax = allYears[yearRange[1]];

  const filtered = rows.filter(r =>
    r.nome_produto === produto &&
    r.ano >= yMin && r.ano <= yMax &&
    segmentos.includes(r.segmento)
  );
  if (!filtered.length) return emptyPlot(320);

  // Sum by empresa
  const byEmpresa: Record<string, number> = {};
  for (const r of filtered) {
    byEmpresa[r.empresa] = (byEmpresa[r.empresa] ?? 0) + (r.volume ?? 0);
  }

  const sorted = Object.entries(byEmpresa)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15);

  const total = sorted.reduce((s, [, v]) => s + v, 0);

  return {
    data: [{
      type: "bar",
      orientation: "h",
      x: sorted.map(([, v]) => total > 0 ? (v / total) * 100 : 0),
      y: sorted.map(([e]) => e),
      marker: { color: "#2196F3" },
      hovertemplate: "%{y}: %{x:.1f}%<extra></extra>",
      text: sorted.map(([, v]) => total > 0 ? `${((v / total) * 100).toFixed(1)}%` : ""),
      textposition: "outside",
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT, height: 400,
      margin: { t: 10, b: 50, l: 180, r: 60 },
      xaxis: { ...AXIS_LINE, title: { text: "Participação (%)" }, range: [0, Math.min(100, (sorted[0]?.[1] ?? 0) / total * 110 + 5)] },
      yaxis: { ...AXIS_LINE, autorange: "reversed" as const },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SindicomPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("sindicom");
  const supabase = getSupabaseClient();

  const [loading, setLoading]           = useState(true);
  const [filtros, setFiltros]           = useState<SindicomFiltros>({ empresas: [], produtos: [], segmentos: [], ano_min: null, ano_max: null });
  const [allRows, setAllRows]           = useState<SindicomSerieRow[]>([]);
  const [allYears, setAllYears]         = useState<number[]>([]);
  const [yearRange, setYearRange]       = useState<[number, number]>([0, 0]);
  const [selectedProdutos, setSelected] = useState<string[]>([]);
  const [selectedSegmentos, setSegs]    = useState<string[]>([]);
  const [msProduto, setMsProduto]       = useState<string>("");

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const [f, rows] = await Promise.all([
        rpcGetSindicomFiltros(supabase),
        rpcGetSindicomSerie(supabase),
      ]);
      if (cancelled) return;
      setFiltros(f);
      setSelected(f.produtos);
      setSegs(f.segmentos);
      setMsProduto(f.produtos[0] ?? "");

      const years = Array.from(new Set(rows.map(r => r.ano))).sort((a, b) => a - b);
      setAllYears(years);
      if (years.length > 0) {
        const currentYear = new Date().getFullYear();
        const startIdx = Math.max(0, years.findIndex(y => y >= currentYear - 5));
        setYearRange([startIdx, years.length - 1]);
      }
      setAllRows(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const volChart = useMemo(
    () => buildVolumeChart(allRows, selectedProdutos, selectedSegmentos, allYears, yearRange),
    [allRows, selectedProdutos, selectedSegmentos, allYears, yearRange],
  );
  const msChart = useMemo(
    () => buildMarketShareChart(allRows, msProduto, selectedSegmentos, allYears, yearRange),
    [allRows, msProduto, selectedSegmentos, allYears, yearRange],
  );

  if (visLoading || !visible) return null;

  const toggleProduto = (p: string) =>
    setSelected(prev => prev.includes(p) ? (prev.length > 1 ? prev.filter(x => x !== p) : prev) : [...prev, p]);
  const toggleSegmento = (s: string) =>
    setSegs(prev => prev.includes(s) ? (prev.length > 1 ? prev.filter(x => x !== s) : prev) : [...prev, s]);

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
                    <input className="form-check-input" type="checkbox" id={`sind-p-${p}`}
                      checked={selectedProdutos.includes(p)} onChange={() => toggleProduto(p)} />
                    <label className="form-check-label" htmlFor={`sind-p-${p}`}
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
                <div className="sidebar-filter-label">Segmento</div>
                {filtros.segmentos.map(s => (
                  <div key={s} className="form-check" style={{ marginBottom: 4 }}>
                    <input className="form-check-input" type="checkbox" id={`sind-s-${s}`}
                      checked={selectedSegmentos.includes(s)} onChange={() => toggleSegmento(s)} />
                    <label className="form-check-label" htmlFor={`sind-s-${s}`}
                      style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}>
                      {s}
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
                <div className="sidebar-filter-label">Market Share — Produto</div>
                <select className="form-select form-select-sm" value={msProduto}
                  onChange={e => setMsProduto(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 11 }}>
                  {filtros.produtos.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <div className="page-header-title" style={{ marginBottom: 16 }}>
                SINDICOM — Distribuição de Combustíveis por Empresa
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
                        <div className="section-title">Volume Mensal por Produto (m³)</div>
                        <hr className="section-hr" />
                        <PlotlyChart data={volChart.data} layout={volChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 320 }} />
                      </div>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container">
                        <div className="section-title">
                          Market Share por Empresa — {msProduto} (Top 15)
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart data={msChart.data} layout={msChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 400 }} />
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
