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
  rpcGetAnpPprodutoresSerie,
  rpcGetAnpPprodutoresFiltros,
  type AnpPprodutoresRow,
  type AnpPprodutoresFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const REGIAO_COLOR: Record<string, string> = {
  "Norte":        "#009688",
  "Nordeste":     "#FF5722",
  "Centro-Oeste": "#9C27B0",
  "Sul":          "#3F51B5",
  "Sudeste":      "#F44336",
};
const ALL_REGIOES = Object.keys(REGIAO_COLOR);

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

function emptyPlot(h = 320): { data: PlotData[]; layout: Partial<Layout> } {
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

function buildChart(
  rows: AnpPprodutoresRow[],
  regioes: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => regioes.includes(r.regiao));
  if (!filtered.length) return emptyPlot();

  const byRegiao: Record<string, AnpPprodutoresRow[]> = {};
  for (const r of filtered) (byRegiao[r.regiao] ??= []).push(r);

  const unidade = rows[0]?.unidade ?? "";

  const traces: PlotData[] = regioes
    .filter(r => byRegiao[r])
    .map(r => {
      const data = byRegiao[r].sort((a, b) => a.data_inicio.localeCompare(b.data_inicio));
      return {
        type: "scatter", mode: "lines",
        name: r,
        x: data.map(d => d.data_inicio),
        y: data.map(d => d.preco),
        line: { width: 2, color: REGIAO_COLOR[r] ?? "#999" },
        hovertemplate: `${r}: R$ %{y:.4f}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 360,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: `R$ / ${unidade || "L"}` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpPrecosProdutoresPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-precos-produtores");
  const supabase = getSupabaseClient();

  const [loading, setLoading]           = useState(true);
  const [filtros, setFiltros]           = useState<AnpPprodutoresFiltros>({ produtos: [], regioes: [], data_min: null, data_max: null });
  const [allSerie, setAllSerie]         = useState<AnpPprodutoresRow[]>([]);
  const [allYears, setAllYears]         = useState<number[]>([]);
  const [yearRange, setYearRange]       = useState<[number, number]>([0, 0]);
  const [selectedProduto, setProduto]   = useState<string>("");
  const [selectedRegioes, setRegioes]   = useState<string[]>(ALL_REGIOES);
  const [serieLoading, setSerieLoading] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpPprodutoresFiltros(supabase);
      if (cancelled) return;
      setFiltros(f);
      const defaultProduto = f.produtos.includes("Gasolina A Comum") ? "Gasolina A Comum" : f.produtos[0] ?? "";
      setProduto(defaultProduto);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !selectedProduto) return;
    let cancelled = false;
    setSerieLoading(true);
    (async () => {
      const rows = await rpcGetAnpPprodutoresSerie(supabase, { produto: selectedProduto });
      if (cancelled) return;

      const years = Array.from(
        new Set(rows.map(r => parseInt(r.data_inicio.slice(0, 4))))
      ).sort((a, b) => a - b);

      setAllYears(years);
      if (years.length > 0) {
        const currentYear = new Date().getFullYear();
        const startIdx = Math.max(0, years.findIndex(y => y >= currentYear - 9));
        setYearRange([startIdx, years.length - 1]);
      }
      setAllSerie(rows);
      setSerieLoading(false);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, selectedProduto]);

  const filteredSerie = useMemo(() => {
    const yMin = allYears[yearRange[0]];
    const yMax = allYears[yearRange[1]];
    if (!yMin || !yMax) return allSerie;
    return allSerie.filter(r => {
      const y = parseInt(r.data_inicio.slice(0, 4));
      return y >= yMin && y <= yMax;
    });
  }, [allSerie, yearRange, allYears]);

  const chart = useMemo(
    () => buildChart(filteredSerie, selectedRegioes),
    [filteredSerie, selectedRegioes],
  );

  if (visLoading || !visible) return null;

  const toggleRegiao = (r: string) =>
    setRegioes(prev =>
      prev.includes(r)
        ? prev.length > 1 ? prev.filter(x => x !== r) : prev
        : [...prev, r]
    );

  const yMin = allYears[yearRange[0]] ?? "—";
  const yMax = allYears[yearRange[1]] ?? "—";

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
                <div className="sidebar-filter-label">Produto</div>
                <select
                  className="form-select form-select-sm"
                  value={selectedProduto}
                  onChange={e => setProduto(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {filtros.produtos.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Região</div>
                {ALL_REGIOES.map(r => (
                  <div key={r} className="form-check" style={{ marginBottom: 6 }}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`reg-${r}`}
                      checked={selectedRegioes.includes(r)}
                      onChange={() => toggleRegiao(r)}
                    />
                    <label className="form-check-label" htmlFor={`reg-${r}`}
                      style={{ fontFamily: "Arial", fontSize: 12, cursor: "pointer" }}>
                      <span style={{
                        display: "inline-block", width: 9, height: 9,
                        borderRadius: "50%", backgroundColor: REGIAO_COLOR[r],
                        marginRight: 6, verticalAlign: "middle",
                      }} />
                      {r}
                    </label>
                  </div>
                ))}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && allYears.length > 0 && (
                  <>
                    <div style={{ marginTop: 18, marginBottom: 10, paddingLeft: 4, paddingRight: 4 }}>
                      <Slider
                        range
                        min={0}
                        max={allYears.length - 1}
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
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <div className="page-header-title" style={{ marginBottom: 16 }}>
                ANP — Preços Médios Ponderados Produtores e Importadores
                {selectedProduto ? ` · ${selectedProduto}` : ""}
                {yMin && yMax ? ` · ${yMin}–${yMax}` : ""}
              </div>

              {(loading || serieLoading) ? (
                <div className="d-flex justify-content-center my-5">
                  <img src="/barrel_loading.png" alt="Carregando..." width={160} height={160} />
                </div>
              ) : (
                <div className="row mb-2">
                  <div className="col-12">
                    <div className="chart-container">
                      <div className="section-title">
                        Preço por Região — {selectedProduto}
                      </div>
                      <hr className="section-hr" />
                      <PlotlyChart
                        data={chart.data}
                        layout={chart.layout}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: "100%", height: 360 }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
