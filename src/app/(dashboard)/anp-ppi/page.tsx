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
  rpcGetAnpPpiMediaSerie,
  rpcGetAnpPpiLocaisSerie,
  rpcGetAnpPpiFiltros,
  type AnpPpiSerieRow,
  type AnpPpiLocaisRow,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const PRODUTO_INFO: Record<string, { label: string; color: string; unidade: string }> = {
  "Gasolina A Comum": { label: "Gasolina A Comum", color: "#FF5000", unidade: "R$/litro" },
  "Diesel A S10":     { label: "Diesel A S10",     color: "#2196F3", unidade: "R$/litro" },
  "QAV":              { label: "QAV",              color: "#8BC34A", unidade: "R$/litro" },
  "GLP":              { label: "GLP",              color: "#FF9800", unidade: "R$/13kg"  },
};
const ALL_PRODUTOS = Object.keys(PRODUTO_INFO);

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

function buildMediaChart(
  rows: AnpPpiSerieRow[],
  produtos: string[],
  yearRange: [number, number],
  allYears: number[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const yMin = allYears[yearRange[0]];
  const yMax = allYears[yearRange[1]];
  const filtered = rows.filter(r => {
    if (!r.data_fim) return false;
    const year = parseInt(r.data_fim.slice(0, 4));
    return year >= yMin && year <= yMax && produtos.includes(r.produto);
  });
  if (!filtered.length) return emptyPlot(300);

  const byProduto: Record<string, AnpPpiSerieRow[]> = {};
  for (const r of filtered) (byProduto[r.produto] ??= []).push(r);

  const traces: PlotData[] = produtos
    .filter(p => byProduto[p])
    .map(p => {
      const info = PRODUTO_INFO[p];
      const data = byProduto[p].sort((a, b) => a.data_fim.localeCompare(b.data_fim));
      return {
        type: "scatter", mode: "lines",
        name: info?.label ?? p,
        x: data.map(r => r.data_fim),
        y: data.map(r => r.preco_medio),
        line: { width: 2, color: info?.color ?? "#999" },
        hovertemplate: `${info?.label ?? p}: R$ %{y:.4f}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 300,
      margin: { t: 10, b: 50, l: 70, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "R$ / L (ou kg)" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function buildLocaisChart(
  rows: AnpPpiLocaisRow[],
  produto: string,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!rows.length) return emptyPlot(320);

  const byLocal: Record<string, AnpPpiLocaisRow[]> = {};
  for (const r of rows) (byLocal[r.local] ??= []).push(r);

  const locais = Object.keys(byLocal).sort();
  const palette = [
    "#E53935","#1E88E5","#43A047","#FB8C00","#8E24AA",
    "#00ACC1","#D81B60","#6D4C41","#F4511E","#039BE5",
    "#7CB342","#FFB300","#546E7A","#AB47BC","#26A69A",
    "#EC407A",
  ];

  const traces: PlotData[] = locais.map((local, i) => {
    const data = byLocal[local].sort((a, b) => a.data_fim.localeCompare(b.data_fim));
    return {
      type: "scatter", mode: "lines",
      name: local,
      x: data.map(r => r.data_fim),
      y: data.map(r => r.preco),
      line: { width: 1.5, color: palette[i % palette.length] },
      hovertemplate: `${local}: R$ %{y:.4f}<extra></extra>`,
    } as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 320,
      margin: { t: 10, b: 50, l: 70, r: 10 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "R$ / L (ou kg)" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0, font: { size: 10 } },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpPpiPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-ppi");
  const supabase = getSupabaseClient();

  const [loading, setLoading]             = useState(true);
  const [allSerie, setAllSerie]           = useState<AnpPpiSerieRow[]>([]);
  const [allYears, setAllYears]           = useState<number[]>([]);
  const [yearRange, setYearRange]         = useState<[number, number]>([0, 0]);
  const [selectedProdutos, setSelected]   = useState<string[]>(ALL_PRODUTOS);
  const [detailProduto, setDetailProduto] = useState<string>("Gasolina A Comum");
  const [locaisRows, setLocaisRows]       = useState<AnpPpiLocaisRow[]>([]);
  const [locaisLoading, setLocaisLoading] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const [filtros, serie] = await Promise.all([
        rpcGetAnpPpiFiltros(supabase),
        rpcGetAnpPpiMediaSerie(supabase),
      ]);
      if (cancelled) return;

      const years = Array.from(
        new Set(serie.map(r => parseInt(r.data_fim.slice(0, 4))))
      ).sort((a, b) => a - b);

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

  useEffect(() => {
    if (!supabase || !detailProduto) return;
    let cancelled = false;
    setLocaisLoading(true);
    (async () => {
      const yMin = allYears[yearRange[0]];
      const yMax = allYears[yearRange[1]];
      const rows = await rpcGetAnpPpiLocaisSerie(supabase, detailProduto, {
        dataInicio: yMin ? `${yMin}-01-01` : null,
        dataFim:    yMax ? `${yMax}-12-31` : null,
      });
      if (cancelled) return;
      setLocaisRows(rows);
      setLocaisLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, detailProduto, yearRange[0], yearRange[1], allYears]);

  const mediaChart = useMemo(
    () => buildMediaChart(allSerie, selectedProdutos, yearRange, allYears),
    [allSerie, selectedProdutos, yearRange, allYears],
  );

  const locaisChart = useMemo(
    () => buildLocaisChart(locaisRows, detailProduto),
    [locaisRows, detailProduto],
  );

  if (visLoading || !visible) return null;

  const toggleProduto = (p: string) =>
    setSelected(prev =>
      prev.includes(p)
        ? prev.length > 1 ? prev.filter(x => x !== p) : prev
        : [...prev, p]
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
                {ALL_PRODUTOS.map(p => (
                  <div key={p} className="form-check" style={{ marginBottom: 6 }}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`ppi-${p}`}
                      checked={selectedProdutos.includes(p)}
                      onChange={() => toggleProduto(p)}
                    />
                    <label className="form-check-label" htmlFor={`ppi-${p}`}
                      style={{ fontFamily: "Arial", fontSize: 12, cursor: "pointer" }}>
                      <span style={{
                        display: "inline-block", width: 9, height: 9,
                        borderRadius: "50%", backgroundColor: PRODUTO_INFO[p].color,
                        marginRight: 6, verticalAlign: "middle",
                      }} />
                      {PRODUTO_INFO[p].label}
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

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Detalhe por Local — Produto</div>
                <select
                  className="form-select form-select-sm"
                  value={detailProduto}
                  onChange={e => setDetailProduto(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {ALL_PRODUTOS.map(p => (
                    <option key={p} value={p}>{PRODUTO_INFO[p].label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <div className="page-header-title" style={{ marginBottom: 16 }}>
                ANP — Preços de Paridade de Importação (PPI)
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
                        <div className="section-title">PPI — Média Nacional (R$/L ou R$/kg)</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={mediaChart.data}
                          layout={mediaChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container">
                        <div className="section-title">
                          PPI por Local — {PRODUTO_INFO[detailProduto]?.label ?? detailProduto}
                        </div>
                        <hr className="section-hr" />
                        {locaisLoading ? (
                          <div className="d-flex justify-content-center align-items-center" style={{ height: 320 }}>
                            <div className="spinner-border spinner-border-sm text-secondary" />
                          </div>
                        ) : (
                          <PlotlyChart
                            data={locaisChart.data}
                            layout={locaisChart.layout}
                            config={{ responsive: true, displayModeBar: false }}
                            style={{ width: "100%", height: 320 }}
                          />
                        )}
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
