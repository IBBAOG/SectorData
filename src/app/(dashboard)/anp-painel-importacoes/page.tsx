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

// volume_m3 → mil m³: m3 / 1e3 = thousands of cubic meters.
// Source pipeline: scraper reads "Quantidade (mil m³)" * 1000 → stores as m³.
// Math: 1 mil m³ = 1.000 m³. Divisor 1e3 matches label "mil m³".
function buildSerieChart(
  rows: AnpPainelImpSerieRow[],
  produtos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  // Server already filtered by period (and optionally produtos/UFs).
  const filtered = rows.filter(r => produtos.includes(r.nome_produto));
  if (!filtered.length) return emptyPlot(300);

  const byProduto: Record<string, AnpPainelImpSerieRow[]> = {};
  for (const r of filtered) (byProduto[r.nome_produto] ??= []).push(r);

  const traces: PlotData[] = produtos
    .filter(p => byProduto[p])
    .map((p, i) => {
      const data = byProduto[p].sort(
        (a, b) => a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes,
      );
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
      ...COMMON_LAYOUT, height: 300,
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
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!rows.length) return emptyPlot(420);
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
      ...COMMON_LAYOUT, height: 420,
      margin: { t: 10, b: 40, l: 200, r: 20 },
      xaxis: { ...AXIS_LINE, title: { text: "mil m³" } },
      yaxis: { autorange: "reversed" as const, showgrid: false, zeroline: false, tickfont: { size: 10 } },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpPainelImportacoesPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-painel-importacoes");
  const supabase = getSupabaseClient();

  const [loading, setLoading]               = useState(true);
  const [serieLoading, setSerieLoading]     = useState(false);
  const [topLoading, setTopLoading]         = useState(false);
  const [filtros, setFiltros]               = useState<AnpPainelImpFiltros>({
    produtos: [], ufs: [], distribuidores: [], ano_min: null, ano_max: null,
  });
  const [serieRows, setSerieRows]           = useState<AnpPainelImpSerieRow[]>([]);
  const [allYears, setAllYears]             = useState<number[]>([]);
  const [yearRange, setYearRange]           = useState<[number, number]>([0, 0]);
  const [selectedProdutos, setSelectedProd] = useState<string[]>([]);
  const [topProduto, setTopProduto]         = useState<string>("");
  const [topRows, setTopRows]               = useState<AnpPainelImpTopDistRow[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial load: filtros + first serie fetch (last 10 years) ──────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpPainelImpFiltros(supabase);
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
      if (!years.length || !f.produtos.length) {
        if (!cancelled) {
          setSerieRows([]);
          setLoading(false);
        }
        return;
      }

      // Fetch serie for the visible window (server-side period filter)
      const rows = await rpcGetAnpPainelImpSerie(supabase, {
        anoInicio: fromYear,
        anoFim:    yMax,
      });
      if (cancelled) return;

      // Default selection: all products (small count) for the line chart;
      // top dropdown defaults to product with largest volume in window.
      const prodVols: Record<string, number> = {};
      for (const r of rows) prodVols[r.nome_produto] = (prodVols[r.nome_produto] ?? 0) + (r.volume_m3 ?? 0);
      const sortedByVol = Object.entries(prodVols).sort((a, b) => b[1] - a[1]).map(([k]) => k);
      setSelectedProd(f.produtos);
      setTopProduto(sortedByVol[0] ?? f.produtos[0] ?? "");
      setSerieRows(rows);
      setLoading(false);
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
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSerieLoading(true);
      const yMin = allYears[yearTuple[0]];
      const yMax = allYears[yearTuple[1]];
      const rows = await rpcGetAnpPainelImpSerie(supabase, {
        anoInicio: yMin ?? null,
        anoFim:    yMax ?? null,
      });
      setSerieRows(rows);
      setSerieLoading(false);
    }, 400);
  }, [supabase, loading, yearTuple, allYears]);

  useEffect(() => { fetchSerie(); }, [fetchSerie]);

  // ── Top distribuidores: refetch on topProduto or period change (debounced) ─
  useEffect(() => {
    if (!supabase || !topProduto || allYears.length === 0 || loading) return;
    let cancelled = false;
    setTopLoading(true);
    const handle = setTimeout(async () => {
      const rows = await rpcGetAnpPainelImpTopDist(
        supabase, topProduto,
        allYears[yearTuple[0]] ?? null,
        allYears[yearTuple[1]] ?? null,
      );
      if (cancelled) return;
      setTopRows(rows);
      setTopLoading(false);
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [supabase, topProduto, yearTuple, allYears, loading]);

  const serieChart = useMemo(
    () => buildSerieChart(serieRows, selectedProdutos),
    [serieRows, selectedProdutos],
  );

  const topChart = useMemo(
    () => buildTopDistChart(topRows),
    [topRows],
  );

  if (visLoading || !visible) return null;

  const toggleProduto = (p: string) =>
    setSelectedProd(prev =>
      prev.includes(p)
        ? prev.length > 1 ? prev.filter(x => x !== p) : prev
        : [...prev, p]
    );

  const hasYears = allYears.length > 0;
  const hasData  = filtros.produtos.length > 0;
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
                <div className="sidebar-filter-label">
                  Produto (Série){" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedProdutos.length}/{filtros.produtos.length})
                  </span>
                </div>
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
                {filtros.produtos.length > 0 && selectedProdutos.length < filtros.produtos.length && (
                  <button className="filter-btn-link filter-btn-link--secondary"
                    style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10 }}
                    onClick={() => setSelectedProd(filtros.produtos)}>
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
                          const a = v as number[];
                          setYearRange([a[0], a[1]]);
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

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <div className="mb-2">
                <div className="page-header-title">
                  ANP Painel — Importações de Distribuidores
                </div>
                <div className="page-header-sub">
                  Volumes mensais importados por distribuidor, UF e produto (volume em mil m³)
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
              ) : !hasData ? (
                <div className="d-flex justify-content-center align-items-center my-5"
                  style={{ minHeight: 240, color: "#888", fontFamily: "Arial", fontSize: 14 }}>
                  Sem dados disponíveis para este módulo no momento.
                </div>
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container" style={{ position: "relative" }}>
                        <div className="section-title">
                          Volume Mensal Importado por Produto — Total Nacional (mil m³ / mês)
                          {serieLoading && (
                            <span style={{ marginLeft: 10, fontSize: 11, color: "#aaa", fontWeight: 400 }}>
                              atualizando…
                            </span>
                          )}
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={serieChart.data}
                          layout={serieChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 300, opacity: serieLoading ? 0.5 : 1 }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container" style={{ position: "relative", minHeight: 460 }}>
                        <div className="section-title">
                          Top 15 Distribuidores — {topProduto} (mil m³)
                          {topLoading && (
                            <span style={{ marginLeft: 10, fontSize: 11, color: "#aaa", fontWeight: 400 }}>
                              atualizando…
                            </span>
                          )}
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={topChart.data}
                          layout={topChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 420, opacity: topLoading ? 0.5 : 1 }}
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
