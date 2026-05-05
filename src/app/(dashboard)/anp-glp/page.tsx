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
  rpcGetAnpGlpSerie,
  rpcGetAnpGlpFiltros,
  type AnpGlpSerieRow,
  type AnpGlpFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIA_INFO: Record<string, { label: string; color: string }> = {
  "P13":                { label: "P13 (Botijão 13 kg)", color: "#2196F3" },
  "Outros - GLP":       { label: "Outros - GLP",        color: "#4CAF50" },
  "Outros - Especiais": { label: "Outros - Especiais",  color: "#9C27B0" },
};
const MAIN_CATEGORIAS = Object.keys(CATEGORIA_INFO);

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

function buildTrendChart(
  rows: AnpGlpSerieRow[],
  categorias: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => categorias.includes(r.categoria));
  if (!filtered.length) return emptyPlot(300);

  // Aggregate by (ano, mes, categoria)
  const agg: Record<string, Record<string, number>> = {};
  for (const r of filtered) {
    const key = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
    if (!agg[r.categoria]) agg[r.categoria] = {};
    agg[r.categoria][key] = (agg[r.categoria][key] ?? 0) + (r.vendas_kg ?? 0);
  }

  const allKeys = Array.from(
    new Set(filtered.map(r => `${r.ano}-${String(r.mes).padStart(2, "0")}`))
  ).sort();

  const traces: PlotData[] = categorias
    .filter(c => agg[c])
    .map(c => {
      const info = CATEGORIA_INFO[c];
      return {
        type: "scatter", mode: "lines",
        name: info?.label ?? c,
        x: allKeys,
        y: allKeys.map(k => (agg[c][k] ?? 0) / 1e6),
        line: { width: 2, color: info?.color ?? "#999" },
        hovertemplate: `${info?.label ?? c}: %{y:.1f} mil t<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 300,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "mil t / mês" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function buildTopDistChart(
  rows: AnpGlpSerieRow[],
  categoria: string,
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => r.categoria === categoria);
  if (!filtered.length) return emptyPlot(360);

  const byDist: Record<string, number> = {};
  for (const r of filtered) {
    byDist[r.distribuidora] = (byDist[r.distribuidora] ?? 0) + (r.vendas_kg ?? 0);
  }

  const sorted = Object.entries(byDist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const color = CATEGORIA_INFO[categoria]?.color ?? "#2196F3";

  return {
    data: [{
      type: "bar", orientation: "h",
      x: sorted.map(([, v]) => v / 1e6),
      y: sorted.map(([k]) => k),
      marker: { color },
      hovertemplate: "%{y}: %{x:.1f} mil t<extra></extra>",
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT,
      height: 420,
      margin: { t: 36, b: 40, l: 160, r: 20 },
      xaxis: { ...AXIS_LINE, title: { text: "mil t" } },
      yaxis: { autorange: "reversed" as const, showgrid: false, zeroline: false, tickfont: { size: 10 } },
      title: {
        text: `Top 15 Distribuidoras — ${CATEGORIA_INFO[categoria]?.label ?? categoria}`,
        font: { size: 13, family: "Arial" },
        x: 0, xanchor: "left",
        pad: { l: 0 },
      },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpGlpPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-glp");
  const supabase = getSupabaseClient();

  const [loading, setLoading]                 = useState(true);
  const [serieLoading, setSerieLoading]       = useState(false);
  const [, setFiltros]                        = useState<AnpGlpFiltros>({ distribuidoras: [], categorias: [], ano_min: null, ano_max: null });
  const [serieRows, setSerieRows]             = useState<AnpGlpSerieRow[]>([]);
  const [allYears, setAllYears]               = useState<number[]>([]);
  const [yearRange, setYearRange]             = useState<[number, number]>([0, 0]);
  const [selectedCats, setSelectedCats]       = useState<string[]>(MAIN_CATEGORIAS);
  const [topDistCat, setTopDistCat]           = useState<string>("P13");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial load: filtros + first serie fetch (last 10 years) ────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpGlpFiltros(supabase);
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

      const rows = await rpcGetAnpGlpSerie(supabase, {
        anoInicio: fromYear,
        anoFim:    yMax,
      });
      if (!cancelled) {
        setSerieRows(rows);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) — period changes only ─────────
  const yearTuple = useMemo<[number, number]>(
    () => [yearRange[0], yearRange[1]],
    [yearRange],
  );

  const fetchSerie = useCallback(() => {
    if (!supabase || loading) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSerieLoading(true);
      const yMin = allYears[yearTuple[0]];
      const yMax = allYears[yearTuple[1]];
      const rows = await rpcGetAnpGlpSerie(supabase, {
        anoInicio: yMin ?? null,
        anoFim:    yMax ?? null,
      });
      setSerieRows(rows);
      setSerieLoading(false);
    }, 400);
  }, [supabase, loading, yearTuple, allYears]);

  useEffect(() => { fetchSerie(); }, [fetchSerie]);

  const trendChart = useMemo(
    () => buildTrendChart(serieRows, selectedCats),
    [serieRows, selectedCats],
  );

  const topDistChart = useMemo(
    () => buildTopDistChart(serieRows, topDistCat),
    [serieRows, topDistCat],
  );

  if (visLoading || !visible) return null;

  const toggleCat = (c: string) =>
    setSelectedCats(prev =>
      prev.includes(c)
        ? prev.length > 1 ? prev.filter(x => x !== c) : prev
        : [...prev, c]
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
                <div className="sidebar-filter-label">
                  Categoria{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedCats.length}/{MAIN_CATEGORIAS.length})
                  </span>
                </div>
                {MAIN_CATEGORIAS.map(c => (
                  <div key={c} className="form-check" style={{ marginBottom: 6 }}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`cat-${c}`}
                      checked={selectedCats.includes(c)}
                      onChange={() => toggleCat(c)}
                    />
                    <label className="form-check-label" htmlFor={`cat-${c}`}
                      style={{ fontFamily: "Arial", fontSize: 12, cursor: "pointer" }}>
                      <span style={{
                        display: "inline-block", width: 9, height: 9,
                        borderRadius: "50%", backgroundColor: CATEGORIA_INFO[c].color,
                        marginRight: 6, verticalAlign: "middle",
                      }} />
                      {CATEGORIA_INFO[c].label}
                    </label>
                  </div>
                ))}
                {selectedCats.length < MAIN_CATEGORIAS.length && (
                  <button className="filter-btn-link filter-btn-link--secondary"
                    style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10 }}
                    onClick={() => setSelectedCats(MAIN_CATEGORIAS)}>
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

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Top Distribuidoras — Categoria</div>
                <select
                  className="form-select form-select-sm"
                  value={topDistCat}
                  onChange={e => setTopDistCat(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {MAIN_CATEGORIAS.map(c => (
                    <option key={c} value={c}>{CATEGORIA_INFO[c].label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <div className="mb-2">
                <div className="page-header-title">ANP — Vendas de GLP por Recipiente</div>
                <div className="page-header-sub">
                  Vendas mensais de GLP por distribuidora e categoria de recipiente (P13, Outros - GLP, Outros - Especiais)
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
                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container" style={{ position: "relative" }}>
                        <div className="section-title">
                          Vendas Mensais — Total Nacional (mil t)
                          {serieLoading && (
                            <span style={{ marginLeft: 10, fontSize: 11, color: "#aaa", fontWeight: 400 }}>
                              atualizando…
                            </span>
                          )}
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={trendChart.data}
                          layout={trendChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 300, opacity: serieLoading ? 0.5 : 1 }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container" style={{ minHeight: 460, position: "relative" }}>
                        <PlotlyChart
                          data={topDistChart.data}
                          layout={topDistChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 420, opacity: serieLoading ? 0.5 : 1 }}
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
