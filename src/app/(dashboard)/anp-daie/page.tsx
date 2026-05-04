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
  rpcGetAnpDaieSerie,
  rpcGetAnpDaiFiltros,
  type AnpDaieRow,
  type AnpDaieFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const PRODUTO_COLORS: Record<string, string> = {
  "PETRÓLEO":                    "#1a1a1a",
  "ÓLEO DIESEL":                 "#2196F3",
  "GASOLINA A":                  "#FF5000",
  "GLP":                         "#FF9800",
  "QUEROSENE DE AVIAÇÃO":        "#8BC34A",
  "NAFTA":                       "#9C27B0",
  "ÓLEO COMBUSTÍVEL":            "#795548",
  "COQUE":                       "#607D8B",
  "COMBUSTÍVEIS PARA AERONAVES": "#00BCD4",
  "COMBUSTÍVEIS PARA NAVIOS":    "#3F51B5",
  "GASOLINA DE AVIAÇÃO":         "#E91E63",
  "QUEROSENE ILUMINANTE":        "#009688",
};

const PALETTE = [
  "#1a1a1a","#2196F3","#FF5000","#FF9800","#8BC34A","#9C27B0",
  "#795548","#607D8B","#00BCD4","#3F51B5","#E91E63","#009688",
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

function buildChart(
  rows: AnpDaieRow[],
  operacao: string,
  produtos: string[],
  allYears: number[],
  yearRange: [number, number],
): { data: PlotData[]; layout: Partial<Layout> } {
  const yMin = allYears[yearRange[0]];
  const yMax = allYears[yearRange[1]];
  const filtered = rows.filter(
    r => r.operacao === operacao && produtos.includes(r.produto)
       && r.ano >= yMin && r.ano <= yMax
  );
  if (!filtered.length) return emptyPlot(280);

  const byProduto: Record<string, AnpDaieRow[]> = {};
  for (const r of filtered) (byProduto[r.produto] ??= []).push(r);

  const traces: PlotData[] = produtos.filter(p => byProduto[p]).map((p, i) => {
    const data = byProduto[p].sort((a, b) => a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes);
    const color = PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
    return {
      type: "scatter", mode: "lines",
      name: p,
      x: data.map(r => `${r.ano}-${String(r.mes).padStart(2, "0")}`),
      y: data.map(r => (r.volume_m3 ?? 0) / 1e6),
      line: { width: 2, color },
      hovertemplate: `${p}: %{y:.2f} mil m³<extra></extra>`,
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpDaiePage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-daie");
  const supabase = getSupabaseClient();

  const [loading, setLoading]         = useState(true);
  const [filtros, setFiltros]         = useState<AnpDaieFiltros>({ produtos: [], operacoes: [], ano_min: null, ano_max: null });
  const [allSerie, setAllSerie]       = useState<AnpDaieRow[]>([]);
  const [allYears, setAllYears]       = useState<number[]>([]);
  const [yearRange, setYearRange]     = useState<[number, number]>([0, 0]);
  const [selectedProdutos, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const [f, serie] = await Promise.all([
        rpcGetAnpDaiFiltros(supabase),
        rpcGetAnpDaieSerie(supabase),
      ]);
      if (cancelled) return;
      setFiltros(f);
      setSelected(f.produtos);

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

  const allProdutos = useMemo(() => filtros.produtos, [filtros.produtos]);

  // Detect available operacoes
  const operacoes = useMemo(
    () => Array.from(new Set(allSerie.map(r => r.operacao))).sort(),
    [allSerie],
  );

  const importChart = useMemo(
    () => buildChart(allSerie, operacoes.find(o => o.toLowerCase().includes("import")) ?? operacoes[0] ?? "", selectedProdutos, allYears, yearRange),
    [allSerie, operacoes, selectedProdutos, allYears, yearRange],
  );

  const exportChart = useMemo(
    () => buildChart(allSerie, operacoes.find(o => o.toLowerCase().includes("export")) ?? operacoes[1] ?? "", selectedProdutos, allYears, yearRange),
    [allSerie, operacoes, selectedProdutos, allYears, yearRange],
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
                {allProdutos.map((p, i) => (
                  <div key={p} className="form-check" style={{ marginBottom: 4 }}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`daie-${p}`}
                      checked={selectedProdutos.includes(p)}
                      onChange={() => toggleProduto(p)}
                    />
                    <label className="form-check-label" htmlFor={`daie-${p}`}
                      style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}>
                      <span style={{
                        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                        backgroundColor: PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length],
                        marginRight: 5, verticalAlign: "middle",
                      }} />
                      {p.charAt(0) + p.slice(1).toLowerCase()}
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
            </div>
          </div>

          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <div className="page-header-title" style={{ marginBottom: 16 }}>
                ANP — Dados Abertos Importações e Exportações
                {yMin && yMax ? ` · ${yMin}–${yMax}` : ""}
              </div>

              {loading ? (
                <div className="d-flex justify-content-center my-5">
                  <img src="/barrel_loading.png" alt="Carregando..." width={160} height={160} />
                </div>
              ) : (
                <>
                  {operacoes.map(op => (
                    <div className="row mb-2" key={op}>
                      <div className="col-12">
                        <div className="chart-container">
                          <div className="section-title">
                            {op.charAt(0).toUpperCase() + op.slice(1).toLowerCase()} (mil m³ / mês)
                          </div>
                          <hr className="section-hr" />
                          <PlotlyChart
                            data={op === (operacoes.find(o => o.toLowerCase().includes("import")) ?? operacoes[0])
                              ? importChart.data : exportChart.data}
                            layout={op === (operacoes.find(o => o.toLowerCase().includes("import")) ?? operacoes[0])
                              ? importChart.layout : exportChart.layout}
                            config={{ responsive: true, displayModeBar: false }}
                            style={{ width: "100%", height: 280 }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
