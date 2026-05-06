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
  rpcGetSindicomSerie,
  rpcGetSindicomFiltros,
  type SindicomSerieRow,
  type SindicomFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const PRODUTO_COLORS: Record<string, string> = {
  "GASOLINA C COMUM":     "#FF5000",
  "GASOLINA C ADITIVADA": "#FF8C42",
  "ETANOL HIDRATADO":     "#8BC34A",
  "DIESEL B S10":         "#2196F3",
  "DIESEL B S500":        "#64B5F6",
  "GLP":                  "#FF9800",
  "GNV":                  "#9C27B0",
  "ÓLEO DIESEL A S10":    "#1565C0",
  "ÓLEO DIESEL A S500":   "#42A5F5",
};
const PALETTE = [
  "#FF5000", "#2196F3", "#8BC34A", "#FF9800", "#9C27B0",
  "#E53935", "#00ACC1", "#FF8C42", "#64B5F6", "#7CB342",
  "#FF7043", "#26C6DA", "#D4E157", "#AB47BC", "#EF5350",
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

function rowDateKey(r: SindicomSerieRow) {
  return `${r.ano}-${String(r.mes).padStart(2, "0")}`;
}

function buildVolumeChart(
  rows: SindicomSerieRow[],
  produtos: string[],
  segmentos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const segSet = new Set(segmentos);
  const filtered = rows.filter(r =>
    produtos.includes(r.nome_produto) && segSet.has(r.segmento)
  );
  if (!filtered.length) return emptyPlot(320);

  // Aggregate by (produto, date_key) summing volume across empresas+segmentos
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
      ...COMMON_LAYOUT,
      height: 320,
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
): { data: PlotData[]; layout: Partial<Layout> } {
  const segSet = new Set(segmentos);
  const filtered = rows.filter(r =>
    r.nome_produto === produto && segSet.has(r.segmento)
  );
  if (!filtered.length) return emptyPlot(400);

  // Sum by empresa
  const byEmpresa: Record<string, number> = {};
  for (const r of filtered) {
    byEmpresa[r.empresa] = (byEmpresa[r.empresa] ?? 0) + (r.volume ?? 0);
  }

  const sorted = Object.entries(byEmpresa)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15);

  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const topShare = sorted.length > 0 && total > 0 ? (sorted[0][1] / total) * 100 : 0;

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
      ...COMMON_LAYOUT,
      height: 400,
      margin: { t: 10, b: 50, l: 180, r: 60 },
      xaxis: { ...AXIS_LINE, title: { text: "Participação (%)" }, range: [0, Math.min(100, topShare * 1.1 + 5)] },
      yaxis: { ...AXIS_LINE, autorange: "reversed" as const },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SindicomPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("sindicom");
  const supabase = getSupabaseClient();

  const [loading, setLoading]                   = useState(true);
  const [serieLoading, setSerieLoading]         = useState(false);
  const [filtros, setFiltros]                   = useState<SindicomFiltros>({
    empresas: [], produtos: [], segmentos: [], ano_min: null, ano_max: null,
  });
  const [allRows, setAllRows]                   = useState<SindicomSerieRow[]>([]);
  const [allYears, setAllYears]                 = useState<number[]>([]);
  const [yearRange, setYearRange]               = useState<[number, number]>([0, 0]);
  const [selectedProdutos, setSelectedProdutos] = useState<string[]>([]);
  const [selectedSegmentos, setSelectedSegs]    = useState<string[]>([]);
  const [msProduto, setMsProduto]               = useState<string>("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial load: filtros + first serie fetch ────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetSindicomFiltros(supabase);
      if (cancelled) return;
      setFiltros(f);
      setSelectedProdutos(f.produtos);
      setSelectedSegs(f.segmentos);
      setMsProduto(f.produtos[0] ?? "");

      // Build years array. If table is empty (ano_min/max null), allYears stays []
      // and the period slider doesn't render — empty state messaging takes over.
      if (f.ano_min != null && f.ano_max != null) {
        const years: number[] = [];
        for (let y = f.ano_min; y <= f.ano_max; y++) years.push(y);
        const currentYear = new Date().getFullYear();
        const startIdx    = Math.max(0, years.findIndex(y => y >= currentYear - 5));
        const fromYear    = years[startIdx] ?? f.ano_min;
        const toYear      = f.ano_max;
        setAllYears(years);
        setYearRange([startIdx, years.length - 1]);

        const rows = await rpcGetSindicomSerie(supabase, {
          anoInicio: fromYear,
          anoFim:    toYear,
        });
        if (!cancelled) {
          setAllRows(rows);
        }
      }

      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Ref-stable year tuple to avoid spurious refetches ─────────────────────
  const yearTuple = useMemo<[number, number]>(
    () => [yearRange[0], yearRange[1]],
    [yearRange],
  );

  // ── Reactive refetch (debounced 400ms) — period changes only ─────────────
  const fetchSerie = useCallback(() => {
    if (!supabase || loading || allYears.length === 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSerieLoading(true);
      const yMin = allYears[yearTuple[0]];
      const yMax = allYears[yearTuple[1]];
      const rows = await rpcGetSindicomSerie(supabase, {
        anoInicio: yMin ?? null,
        anoFim:    yMax ?? null,
      });
      setAllRows(rows);
      setSerieLoading(false);
    }, 400);
  }, [supabase, loading, yearTuple, allYears]);

  useEffect(() => { fetchSerie(); }, [fetchSerie]);

  const volChart = useMemo(
    () => buildVolumeChart(allRows, selectedProdutos, selectedSegmentos),
    [allRows, selectedProdutos, selectedSegmentos],
  );
  const msChart = useMemo(
    () => buildMarketShareChart(allRows, msProduto, selectedSegmentos),
    [allRows, msProduto, selectedSegmentos],
  );

  if (visLoading || !visible) return null;

  const toggleProduto = (p: string) =>
    setSelectedProdutos(prev =>
      prev.includes(p)
        ? prev.length > 1 ? prev.filter(x => x !== p) : prev
        : [...prev, p]
    );
  const toggleSegmento = (s: string) =>
    setSelectedSegs(prev =>
      prev.includes(s)
        ? prev.length > 1 ? prev.filter(x => x !== s) : prev
        : [...prev, s]
    );

  const hasYears = allYears.length > 0;
  const hasData  = filtros.produtos.length > 0;
  const yMin     = hasYears ? allYears[yearRange[0]] : null;
  const yMax     = hasYears ? allYears[yearRange[1]] : null;

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
                  <div key={p} className="form-check" style={{ marginBottom: 6 }}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`sind-p-${p}`}
                      checked={selectedProdutos.includes(p)}
                      onChange={() => toggleProduto(p)}
                    />
                    <label className="form-check-label" htmlFor={`sind-p-${p}`}
                      style={{ fontFamily: "Arial", fontSize: 12, cursor: "pointer" }}>
                      <span style={{
                        display: "inline-block", width: 9, height: 9,
                        borderRadius: "50%",
                        backgroundColor: PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length],
                        marginRight: 6, verticalAlign: "middle",
                      }} />
                      {p}
                    </label>
                  </div>
                ))}
                {filtros.produtos.length > 0 && selectedProdutos.length < filtros.produtos.length && (
                  <button className="filter-btn-link filter-btn-link--secondary"
                    style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10 }}
                    onClick={() => setSelectedProdutos(filtros.produtos)}>
                    Limpar
                  </button>
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Segmento{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedSegmentos.length}/{filtros.segmentos.length})
                  </span>
                </div>
                {filtros.segmentos.map(s => (
                  <div key={s} className="form-check" style={{ marginBottom: 6 }}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`sind-s-${s}`}
                      checked={selectedSegmentos.includes(s)}
                      onChange={() => toggleSegmento(s)}
                    />
                    <label className="form-check-label" htmlFor={`sind-s-${s}`}
                      style={{ fontFamily: "Arial", fontSize: 12, cursor: "pointer" }}>
                      {s}
                    </label>
                  </div>
                ))}
                {filtros.segmentos.length > 0 && selectedSegmentos.length < filtros.segmentos.length && (
                  <button className="filter-btn-link filter-btn-link--secondary"
                    style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10 }}
                    onClick={() => setSelectedSegs(filtros.segmentos)}>
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
                <div className="sidebar-filter-label">Market Share — Produto</div>
                <select
                  className="form-select form-select-sm"
                  value={msProduto}
                  onChange={e => setMsProduto(e.target.value)}
                  disabled={filtros.produtos.length === 0}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {filtros.produtos.length === 0 && <option value="">—</option>}
                  {filtros.produtos.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <div className="mb-2">
                <div className="page-header-title">
                  SINDICOM — Distribuição de Combustíveis por Empresa
                </div>
                <div className="page-header-sub">
                  Volumes mensais de venda das distribuidoras associadas ao SINDICOM, por empresa, produto e segmento (mercado / consumidor)
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
                <div className="chart-container" style={{ padding: "32px 24px", textAlign: "center" }}>
                  <div style={{ fontFamily: "Arial", fontSize: 14, color: "#555", marginBottom: 8 }}>
                    Aguardando dados — pipeline ainda não rodou.
                  </div>
                  <div style={{ fontFamily: "Arial", fontSize: 12, color: "#888" }}>
                    O scraper SINDICOM é bloqueado por Cloudflare quando rodado localmente. Dispare o workflow{" "}
                    <code style={{ fontSize: 11 }}>sindicom_sync.yml</code> via GitHub Actions{" "}
                    (<em>Actions → SINDICOM — Sync → Run workflow</em>) para popular a tabela.
                    Ver <code style={{ fontSize: 11 }}>docs/app/sindicom.md</code> para detalhes.
                  </div>
                </div>
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container" style={{ position: "relative" }}>
                        <div className="section-title">
                          Volume Mensal por Produto (m³)
                          {serieLoading && (
                            <span style={{ marginLeft: 10, fontSize: 11, color: "#aaa", fontWeight: 400 }}>
                              atualizando…
                            </span>
                          )}
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={volChart.data}
                          layout={volChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 320, opacity: serieLoading ? 0.5 : 1 }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container" style={{ position: "relative" }}>
                        <div className="section-title">
                          Market Share por Empresa — {msProduto} (Top 15)
                          {serieLoading && (
                            <span style={{ marginLeft: 10, fontSize: 11, color: "#aaa", fontWeight: 400 }}>
                              atualizando…
                            </span>
                          )}
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={msChart.data}
                          layout={msChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 400, opacity: serieLoading ? 0.5 : 1 }}
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
