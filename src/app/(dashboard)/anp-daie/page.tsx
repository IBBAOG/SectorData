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

function emptyPlot(h = 280): { data: PlotData[]; layout: Partial<Layout> } {
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

function buildOperacaoChart(
  rows: AnpDaieRow[],
  operacao: string,
  produtos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!operacao) return emptyPlot(280);
  const filtered = rows.filter(
    r => r.operacao === operacao && produtos.includes(r.produto),
  );
  if (!filtered.length) return emptyPlot(280);

  const byProduto: Record<string, AnpDaieRow[]> = {};
  for (const r of filtered) (byProduto[r.produto] ??= []).push(r);

  const traces: PlotData[] = produtos
    .filter(p => byProduto[p])
    .map((p, i) => {
      const data = byProduto[p].sort(
        (a, b) => a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes,
      );
      const color = PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
      return {
        type: "scatter", mode: "lines",
        name: p,
        x: data.map(r => `${r.ano}-${String(r.mes).padStart(2, "0")}`),
        y: data.map(r => (r.volume_m3 ?? 0) / 1e3),
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

// Capitaliza só a primeira letra (resto lowercase). Suporta acento.
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1).toLocaleLowerCase("pt-BR");
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpDaiePage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-daie");
  const supabase = getSupabaseClient();

  const [loading, setLoading]                 = useState(true);
  const [serieLoading, setSerieLoading]       = useState(false);
  const [filtros, setFiltros]                 = useState<AnpDaieFiltros>({
    produtos: [], operacoes: [], ano_min: null, ano_max: null,
  });
  const [serieRows, setSerieRows]             = useState<AnpDaieRow[]>([]);
  const [allYears, setAllYears]               = useState<number[]>([]);
  const [yearRange, setYearRange]             = useState<[number, number]>([0, 0]);
  const [selectedProdutos, setSelectedProdutos] = useState<string[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial load: filtros + first serie fetch (last 10 years) ─────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpDaiFiltros(supabase);
      if (cancelled) return;
      setFiltros(f);
      setSelectedProdutos(f.produtos);

      const yMin = f.ano_min ?? new Date().getFullYear() - 10;
      const yMax = f.ano_max ?? new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMin; y <= yMax; y++) years.push(y);
      const startIdx = Math.max(0, years.findIndex(y => y >= yMax - 9));
      const fromYear = years[startIdx] ?? yMin;
      setAllYears(years);
      setYearRange([startIdx, years.length - 1]);

      // Empty table guard: if no data, skip serie fetch
      if (!years.length || !f.produtos.length) {
        if (!cancelled) {
          setSerieRows([]);
          setLoading(false);
        }
        return;
      }

      const rows = await rpcGetAnpDaieSerie(supabase, {
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
      const rows = await rpcGetAnpDaieSerie(supabase, {
        anoInicio: yMin ?? null,
        anoFim:    yMax ?? null,
      });
      setSerieRows(rows);
      setSerieLoading(false);
    }, 400);
  }, [supabase, loading, yearTuple, allYears]);

  useEffect(() => { fetchSerie(); }, [fetchSerie]);

  // Detect Importação / Exportação operations defensively (alphabetic order
  // in pt-BR puts "Exportação" before "Importação", so don't trust [0]/[1])
  const operacoes = useMemo(() => filtros.operacoes ?? [], [filtros.operacoes]);
  const importOp = useMemo(
    () => operacoes.find(o => o.toLowerCase().includes("import")) ?? "",
    [operacoes],
  );
  const exportOp = useMemo(
    () => operacoes.find(o => o.toLowerCase().includes("export")) ?? "",
    [operacoes],
  );

  const importChart = useMemo(
    () => buildOperacaoChart(serieRows, importOp, selectedProdutos),
    [serieRows, importOp, selectedProdutos],
  );

  const exportChart = useMemo(
    () => buildOperacaoChart(serieRows, exportOp, selectedProdutos),
    [serieRows, exportOp, selectedProdutos],
  );

  if (visLoading || !visible) return null;

  const toggleProduto = (p: string) =>
    setSelectedProdutos(prev =>
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
                  Produto{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedProdutos.length}/{filtros.produtos.length})
                  </span>
                </div>
                {filtros.produtos.map((p, i) => (
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
                      {capitalize(p)}
                    </label>
                  </div>
                ))}
                {selectedProdutos.length < filtros.produtos.length && (
                  <button className="filter-btn-link filter-btn-link--secondary"
                    style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10 }}
                    onClick={() => setSelectedProdutos(filtros.produtos)}>
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
                  ANP — Dados Abertos Importações e Exportações
                </div>
                <div className="page-header-sub">
                  Volumes mensais de importações e exportações de derivados de petróleo (volume em mil m³)
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
                          {capitalize(importOp || "Importação")} (mil m³ / mês)
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

                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container" style={{ position: "relative" }}>
                        <div className="section-title">
                          {capitalize(exportOp || "Exportação")} (mil m³ / mês)
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
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
