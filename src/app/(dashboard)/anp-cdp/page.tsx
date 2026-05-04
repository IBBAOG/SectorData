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
  rpcGetAnpCdpSerie,
  rpcGetAnpCdpFiltros,
  type AnpCdpSerieRow,
  type AnpCdpFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const BACIA_COLORS: Record<string, string> = {
  "Campos":          "#FF5000",
  "Santos":          "#2196F3",
  "Potiguar":        "#8BC34A",
  "Recôncavo":       "#FF9800",
  "Sergipe":         "#9C27B0",
  "Espírito Santo":  "#00ACC1",
  "Solimões":        "#E53935",
  "Alagoas":         "#FF8C42",
  "Ceará":           "#64B5F6",
  "Parnaíba":        "#7CB342",
  "Barreirinhas":    "#AB47BC",
  "Camamu":          "#FF7043",
  "Amazonas":        "#26C6DA",
  "Paraná":          "#D4E157",
  "Tucano Sul":      "#EF9A9A",
};
const PALETTE = [
  "#FF5000","#2196F3","#8BC34A","#FF9800","#9C27B0",
  "#E53935","#00ACC1","#FF8C42","#64B5F6","#7CB342",
];

const LOCAL_LABELS: Record<string, string> = {
  PreSal: "Pré-Sal",
  PosSal: "Pós-Sal (Mar)",
  Terra:  "Terra",
};

const TOP_BACOES = ["Campos", "Santos", "Potiguar", "Recôncavo", "Sergipe", "Espírito Santo"];

const METRICS = [
  { key: "petroleo_bbl_dia",   label: "Petróleo (bbl/dia)" },
  { key: "gas_total_mm3_dia",  label: "Gás Natural (Mm³/dia)" },
  { key: "oleo_bbl_dia",       label: "Óleo (bbl/dia)" },
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

function buildSerieChart(
  rows: AnpCdpSerieRow[],
  bacoes: string[],
  locais: string[],
  allYears: number[],
  yearRange: [number, number],
  metricKey: string,
  metricLabel: string,
): { data: PlotData[]; layout: Partial<Layout> } {
  const yMin = allYears[yearRange[0]];
  const yMax = allYears[yearRange[1]];

  const filtered = rows.filter(r =>
    r.ano >= yMin && r.ano <= yMax &&
    bacoes.includes(r.bacia) &&
    locais.includes(r.local)
  );
  if (!filtered.length) return emptyPlot(340);

  // Aggregate by (ano, mes, bacia) across operators
  const agg: Record<string, Record<string, number>> = {};
  for (const r of filtered) {
    if (!agg[r.bacia]) agg[r.bacia] = {};
    const k = `${r.ano}-${String(r.mes).padStart(2, "0")}-01`;
    const v = (r[metricKey as keyof AnpCdpSerieRow] as number | null) ?? 0;
    agg[r.bacia][k] = (agg[r.bacia][k] ?? 0) + v;
  }

  const activeBacoes = bacoes.filter(b => agg[b]);
  const traces: PlotData[] = activeBacoes.map((b, i) => {
    const entries = Object.entries(agg[b]).sort(([a], [bb]) => a.localeCompare(bb));
    const color = BACIA_COLORS[b] ?? PALETTE[i % PALETTE.length];
    return {
      type: "scatter", mode: "lines",
      name: b,
      x: entries.map(([d]) => d),
      y: entries.map(([, v]) => v),
      line: { width: 2, color },
      hovertemplate: `${b}: %{y:,.1f}<extra></extra>`,
    } as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT, height: 340,
      margin: { t: 10, b: 50, l: 90, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: metricLabel } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function buildTopOperadoresChart(
  rows: AnpCdpSerieRow[],
  bacoes: string[],
  locais: string[],
  allYears: number[],
  yearRange: [number, number],
  metricKey: string,
  metricLabel: string,
): { data: PlotData[]; layout: Partial<Layout> } {
  const yMin = allYears[yearRange[0]];
  const yMax = allYears[yearRange[1]];

  const filtered = rows.filter(r =>
    r.ano >= yMin && r.ano <= yMax &&
    bacoes.includes(r.bacia) &&
    locais.includes(r.local)
  );
  if (!filtered.length) return emptyPlot(380);

  const byOp: Record<string, number> = {};
  for (const r of filtered) {
    const v = (r[metricKey as keyof AnpCdpSerieRow] as number | null) ?? 0;
    byOp[r.operador] = (byOp[r.operador] ?? 0) + v;
  }

  const sorted = Object.entries(byOp)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15);
  const total = sorted.reduce((s, [, v]) => s + v, 0);

  return {
    data: [{
      type: "bar",
      orientation: "h",
      x: sorted.map(([, v]) => total > 0 ? (v / total) * 100 : 0),
      y: sorted.map(([op]) => op),
      marker: { color: "#FF5000" },
      hovertemplate: "%{y}: %{x:.2f}%<extra></extra>",
      text: sorted.map(([, v]) => total > 0 ? `${((v / total) * 100).toFixed(1)}%` : ""),
      textposition: "outside",
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT, height: 380,
      margin: { t: 10, b: 50, l: 200, r: 70 },
      xaxis: { ...AXIS_LINE, title: { text: "Participação (%)" } },
      yaxis: { ...AXIS_LINE, autorange: "reversed" as const },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpCdpPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp");
  const supabase = getSupabaseClient();

  const [loading, setLoading]           = useState(true);
  const [filtros, setFiltros]           = useState<AnpCdpFiltros>({ bacoes: [], operadores: [], locais: [], ano_min: null, ano_max: null });
  const [allRows, setAllRows]           = useState<AnpCdpSerieRow[]>([]);
  const [allYears, setAllYears]         = useState<number[]>([]);
  const [yearRange, setYearRange]       = useState<[number, number]>([0, 0]);
  const [selectedBacoes, setBacoes]     = useState<string[]>([]);
  const [selectedLocais, setLocais]     = useState<string[]>([]);
  const [metric, setMetric]             = useState(METRICS[0]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const [f, rows] = await Promise.all([
        rpcGetAnpCdpFiltros(supabase),
        rpcGetAnpCdpSerie(supabase),
      ]);
      if (cancelled) return;
      setFiltros(f);
      setLocais(f.locais);
      // Default: top significant bacoes only
      const defaultBacoes = f.bacoes.filter(b => TOP_BACOES.includes(b));
      setBacoes(defaultBacoes.length > 0 ? defaultBacoes : f.bacoes);

      const years = Array.from(new Set(rows.map(r => r.ano))).sort((a, b) => a - b);
      setAllYears(years);
      if (years.length > 0) {
        const currentYear = new Date().getFullYear();
        const startIdx = Math.max(0, years.findIndex(y => y >= currentYear - 9));
        setYearRange([startIdx, years.length - 1]);
      }
      setAllRows(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const serieChart = useMemo(
    () => buildSerieChart(allRows, selectedBacoes, selectedLocais, allYears, yearRange, metric.key, metric.label),
    [allRows, selectedBacoes, selectedLocais, allYears, yearRange, metric],
  );
  const topChart = useMemo(
    () => buildTopOperadoresChart(allRows, selectedBacoes, selectedLocais, allYears, yearRange, metric.key, metric.label),
    [allRows, selectedBacoes, selectedLocais, allYears, yearRange, metric],
  );

  if (visLoading || !visible) return null;

  const toggleBacia = (b: string) =>
    setBacoes(prev => prev.includes(b) ? (prev.length > 1 ? prev.filter(x => x !== b) : prev) : [...prev, b]);
  const toggleLocal = (l: string) =>
    setLocais(prev => prev.includes(l) ? (prev.length > 1 ? prev.filter(x => x !== l) : prev) : [...prev, l]);

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
                <div className="sidebar-filter-label">Métrica</div>
                {METRICS.map(m => (
                  <div key={m.key} className="form-check" style={{ marginBottom: 4 }}>
                    <input className="form-check-input" type="radio" id={`cdp-m-${m.key}`}
                      checked={metric.key === m.key} onChange={() => setMetric(m)} />
                    <label className="form-check-label" htmlFor={`cdp-m-${m.key}`}
                      style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}>
                      {m.label}
                    </label>
                  </div>
                ))}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Local</div>
                {filtros.locais.map(l => (
                  <div key={l} className="form-check" style={{ marginBottom: 4 }}>
                    <input className="form-check-input" type="checkbox" id={`cdp-l-${l}`}
                      checked={selectedLocais.includes(l)} onChange={() => toggleLocal(l)} />
                    <label className="form-check-label" htmlFor={`cdp-l-${l}`}
                      style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}>
                      {LOCAL_LABELS[l] ?? l}
                    </label>
                  </div>
                ))}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Bacia</div>
                {filtros.bacoes.map((b, i) => (
                  <div key={b} className="form-check" style={{ marginBottom: 4 }}>
                    <input className="form-check-input" type="checkbox" id={`cdp-b-${b}`}
                      checked={selectedBacoes.includes(b)} onChange={() => toggleBacia(b)} />
                    <label className="form-check-label" htmlFor={`cdp-b-${b}`}
                      style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}>
                      <span style={{
                        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                        backgroundColor: BACIA_COLORS[b] ?? PALETTE[i % PALETTE.length],
                        marginRight: 5, verticalAlign: "middle",
                      }} />
                      {b}
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
                ANP CDP — Produção por Poço · {metric.label}
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
                        <div className="section-title">
                          Produção Mensal por Bacia — {metric.label}
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart data={serieChart.data} layout={serieChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 340 }} />
                      </div>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container">
                        <div className="section-title">
                          Market Share por Operador — Top 15 · {metric.label} acumulado {yMin}–{yMax}
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart data={topChart.data} layout={topChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 380 }} />
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
