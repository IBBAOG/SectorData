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

function emptyPlot(h = 360): { data: PlotData[]; layout: Partial<Layout> } {
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
  const [serieLoading, setSerieLoading] = useState(false);
  const [filtros, setFiltros]           = useState<AnpPprodutoresFiltros>({
    produtos: [], regioes: [], data_min: null, data_max: null,
  });
  const [serieRows, setSerieRows]       = useState<AnpPprodutoresRow[]>([]);
  const [allYears, setAllYears]         = useState<number[]>([]);
  const [yearRange, setYearRange]       = useState<[number, number]>([0, 0]);
  const [selectedProduto, setProduto]   = useState<string>("");
  const [selectedRegioes, setRegioes]   = useState<string[]>(ALL_REGIOES);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial load: filtros + first serie fetch in parallel ────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpPprodutoresFiltros(supabase);
      if (cancelled) return;

      setFiltros(f);

      const yMin = f.data_min ? parseInt(f.data_min.slice(0, 4)) : new Date().getFullYear() - 10;
      const yMax = f.data_max ? parseInt(f.data_max.slice(0, 4)) : new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMin; y <= yMax; y++) years.push(y);
      const startIdx = Math.max(0, years.findIndex(y => y >= yMax - 9));
      const fromYear = years[startIdx] ?? yMin;
      setAllYears(years);
      setYearRange([startIdx, years.length - 1]);

      const defaultProduto = f.produtos.includes("Gasolina A Comum")
        ? "Gasolina A Comum"
        : f.produtos[0] ?? "";
      setProduto(defaultProduto);

      // First paint with initial data — debounced refetch will fire after loading=false
      // but with identical params, so no UX impact (just a redundant network call).
      if (defaultProduto) {
        const rows = await rpcGetAnpPprodutoresSerie(supabase, {
          produto:    defaultProduto,
          dataInicio: `${fromYear}-01-01`,
          dataFim:    `${yMax}-12-31`,
        });
        if (!cancelled) setSerieRows(rows);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) ────────────────────────────────
  const fetchSerie = useCallback(() => {
    if (!supabase || loading || !selectedProduto) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSerieLoading(true);
      const yMin = allYears[yearRange[0]];
      const yMax = allYears[yearRange[1]];
      const rows = await rpcGetAnpPprodutoresSerie(supabase, {
        produto:    selectedProduto,
        dataInicio: yMin ? `${yMin}-01-01` : null,
        dataFim:    yMax ? `${yMax}-12-31` : null,
      });
      setSerieRows(rows);
      setSerieLoading(false);
    }, 400);
  }, [supabase, loading, selectedProduto, yearRange, allYears]);

  useEffect(() => { fetchSerie(); }, [fetchSerie]);

  const chart = useMemo(
    () => buildChart(serieRows, selectedRegioes),
    [serieRows, selectedRegioes],
  );

  if (visLoading || !visible) return null;

  const toggleRegiao = (r: string) =>
    setRegioes(prev =>
      prev.includes(r)
        ? prev.length > 1 ? prev.filter(x => x !== r) : prev
        : [...prev, r]
    );

  const hasYears = allYears.length > 0;
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
                <div className="sidebar-filter-label">
                  Região{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedRegioes.length}/{ALL_REGIOES.length})
                  </span>
                </div>
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
                {selectedRegioes.length < ALL_REGIOES.length && (
                  <button className="filter-btn-link filter-btn-link--secondary"
                    style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10 }}
                    onClick={() => setRegioes(ALL_REGIOES)}>
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
              <div className="mb-2">
                <div className="page-header-title">
                  ANP — Preços Médios Ponderados Produtores e Importadores
                </div>
                <div className="page-header-sub">
                  Preços semanais médios ponderados praticados por produtores e importadores, por região
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
                <div className="row mb-2">
                  <div className="col-12">
                    <div className="chart-container" style={{ position: "relative" }}>
                      <div className="section-title">
                        Preço por Região — {selectedProduto}
                        {serieLoading && (
                          <span style={{ marginLeft: 10, fontSize: 11, color: "#aaa", fontWeight: 400 }}>
                            atualizando…
                          </span>
                        )}
                      </div>
                      <hr className="section-hr" />
                      <PlotlyChart
                        data={chart.data}
                        layout={chart.layout}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: "100%", height: 360, opacity: serieLoading ? 0.5 : 1 }}
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
