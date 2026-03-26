"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../components/NavBar";
import PlotlyChart from "../../components/PlotlyChart";
import PeriodSlider from "../../components/PeriodSlider";
import CheckList from "../../components/CheckList";
import RegionStateFilter from "../../components/RegionStateFilter";
import { resolverDatas } from "../../lib/filterUtils";
import { getSupabaseClient } from "../../lib/supabaseClient";
import {
  rpcGetMsOpcoesFiltros,
  rpcGetMsSerie,
  type MarketShareFilters,
  type MsSerieRow,
} from "../../lib/rpc";
import { downloadMarketShareExcel } from "../../lib/exportExcel";

const _NO_DATA = "No data for the selected filters.";
const BIG3_MEMBERS = ["Vibra", "Ipiranga", "Raizen"];

const COLORS_IND: Record<string, string> = {
  Vibra: "#f26522",
  Raizen: "#1a1a1a",
  Ipiranga: "#73C6A1",
  Others: "#A9A9A9",
};

const COLORS_BIG3: Record<string, string> = {
  "Big-3": "#FF5000",
  Others: "#A9A9A9",
};

const ALL_PLAYERS_IND = ["Vibra", "Ipiranga", "Raizen", "Others"];
const ALL_PLAYERS_BIG3 = ["Big-3", "Others"];

function emptyPlot(height = 300): { data: PlotData[]; layout: Partial<Layout> } {
  return {
    data: [],
    layout: {
      paper_bgcolor: "white",
      plot_bgcolor: "white",
      xaxis: { visible: false },
      yaxis: { visible: false },
      annotations: [
        {
          text: _NO_DATA,
          xref: "paper",
          yref: "paper",
          showarrow: false,
          font: { size: 13, family: "Arial", color: "#888" },
        },
      ],
      height,
      margin: { t: 20, b: 30, l: 10, r: 10 },
    },
  };
}

function toIsoDate(d: string): string {
  // Dash/Python uses YYYY-MM-DD strings.
  // Plotly can parse them, but we keep ISO-like strings for sorting/format.
  return d;
}

function buildMarketShareLine(params: {
  serieRows: MsSerieRow[];
  produto: string;
  segmento?: string | null;
  players: string[];
  big3: boolean;
}): { data: PlotData[]; layout: Partial<Layout> } {
  const { serieRows, produto, segmento = null, players, big3 } = params;
  if (!serieRows || serieRows.length === 0) return emptyPlot(300);

  // Filter by product + segment
  let rows = serieRows.filter((r) => r.nome_produto === produto);
  if (segmento) rows = rows.filter((r) => r.segmento === segmento);
  if (rows.length === 0) return emptyPlot(300);

  // Aggregate by (date, classificacao) summing quantidade
  const groupMap = new Map<string, number>();
  for (const r of rows) {
    let classificacao = r.classificacao;
    if (big3) classificacao = BIG3_MEMBERS.includes(classificacao) ? "Big-3" : classificacao;
    const dateKey = String(r.date);
    const key = `${dateKey}|${classificacao}`;
    groupMap.set(key, (groupMap.get(key) ?? 0) + Number(r.quantidade ?? 0));
  }

  // Compute totals per date
  const totalByDate = new Map<string, number>();
  for (const [key, qty] of groupMap.entries()) {
    const [dateKey] = key.split("|");
    totalByDate.set(dateKey, (totalByDate.get(dateKey) ?? 0) + qty);
  }

  // Convert grouped map to array with pct and filter by players
  const grouped: Array<{
    date: string;
    classificacao: string;
    quantidade: number;
    pct: number;
  }> = [];

  for (const [key, qty] of groupMap.entries()) {
    const [date, classificacao] = key.split("|");
    if (!players.includes(classificacao)) continue;
    const total = totalByDate.get(date) ?? 0;
    if (total <= 0) continue;
    grouped.push({
      date,
      classificacao,
      quantidade: qty,
      pct: (qty / total) * 100,
    });
  }

  if (grouped.length === 0) return emptyPlot(300);

  grouped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const yVals = grouped.map((g) => g.pct);
  const yMin = Math.min(...yVals);
  const yMax = Math.max(...yVals);
  const spread = yMax - yMin > 0 ? yMax - yMin : 1.0;
  const pad = spread * 0.2;
  const yLo = Math.max(0, yMin - pad);
  const yHi = Math.min(100, yMax + pad);

  const ultimaData = grouped[grouped.length - 1].date;

  const colorsMap = big3 ? COLORS_BIG3 : COLORS_IND;

  const traces: PlotData[] = [];
  const annotations: Array<{
    x: string;
    y: number;
    text: string;
    showarrow: false;
    xanchor: "left";
    xshift: number;
    yanchor: "middle";
    font: { family: string; size: number; color: string };
  }> = [];

  for (const player of players) {
    const series = grouped.filter((g) => g.classificacao === player);
    if (series.length === 0) continue;
    traces.push({
      type: "scatter",
      mode: "lines",
      x: series.map((s) => toIsoDate(s.date)),
      y: series.map((s) => s.pct),
      name: player,
      line: { width: 2.5, color: colorsMap[player] ?? "#000000" },
      hovertemplate: "%{fullData.name}: %{y:.1f}%<extra></extra>",
    } as PlotData);

    const last = series.find((s) => s.date === ultimaData);
    if (last) {
      annotations.push({
        x: toIsoDate(ultimaData),
        y: last.pct,
        text: `${last.pct.toFixed(1)}%`,
        showarrow: false,
        xanchor: "left",
        xshift: 6,
        yanchor: "middle",
        font: { family: "Arial", size: 12, color: colorsMap[player] ?? "#000000" },
      });
    }
  }

  const layout: Partial<Layout> = {
    title: { text: "" },
    margin: { t: 10, b: 80, l: 60, r: 60 },
    font: { family: "Arial", size: 12, color: "#000000" },
    yaxis: {
      title: { text: "Market Share (%)" },
      ticksuffix: "%",
      range: [yLo, yHi],
      nticks: 10,
      showgrid: false,
      zeroline: false,
      showline: true,
      linecolor: "#000000",
      linewidth: 1,
    },
    xaxis: {
      title: { text: "" },
      tickformat: "%b-%y",
      tickangle: -90,
      tickmode: "auto",
      nticks: 12,
      automargin: true,
      showgrid: false,
      zeroline: false,
      showline: true,
      linecolor: "#000000",
      linewidth: 1,
      type: "date",
    },
    legend: {
      orientation: "h",
      yanchor: "top",
      y: -0.28,
      xanchor: "center",
      x: 0.5,
    },
    hoverlabel: { font: { family: "Arial", color: "#000000" } },
    plot_bgcolor: "white",
    paper_bgcolor: "white",
    height: 300,
    hovermode: "x unified",
    annotations,
  };

  return { data: traces, layout };
}

function downloadCsv(rows: MsSerieRow[], filename: string) {
  if (!rows || rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const escapeCell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Quote always to be safe
    return `"${s.replaceAll('"', '""')}"`;
  };
  const csvLines = [cols.join(",")].concat(
    rows.map((r) => {
      const obj = r as Record<string, unknown>;
      return cols.map((c) => escapeCell(obj[c])).join(",");
    }),
  );
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function MarketSharePage() {
  const router = useRouter();
  const supabase = getSupabaseClient();

  type AppliedMarketShareFilters = {
    data_inicio?: string | null;
    data_fim?: string | null;
    regioes?: string[] | null;
    ufs?: string[] | null;
    mercados?: string[] | null;
    competidores?: string[] | null;
    modo_big3?: boolean;
  };

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [opcoes, setOpcoes] = useState<Record<string, unknown> | null>(null);

  const datas = useMemo(() => resolverDatas(opcoes ?? {}), [opcoes]);

  const [mode, setMode] = useState<"Individual" | "Big-3">("Individual");

  const playersOptions = mode === "Big-3" ? ALL_PLAYERS_BIG3 : ALL_PLAYERS_IND;
  const playersDefault = mode === "Big-3" ? ALL_PLAYERS_BIG3 : ALL_PLAYERS_IND;

  const [competidoresSelected, setCompetidoresSelected] = useState<string[]>([]);
  const [regioesSelected, setRegioesSelected] = useState<string[]>([]);
  const [ufsSelected, setUfsSelected] = useState<string[]>([]);

  const [sliderRange, setSliderRange] = useState<[number, number]>([0, 0]);

  const [appliedFilters, setAppliedFilters] = useState<AppliedMarketShareFilters>({});
  const [showToast, setShowToast] = useState(false);

  const [seriesLoading, setSeriesLoading] = useState(false);
  const [serieRows, setSerieRows] = useState<MsSerieRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!supabase) {
      setCheckingAuth(false);
      return () => {
        cancelled = true;
      };
    }
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data.session) router.replace("/login");
      })
      .finally(() => {
        if (!cancelled) setCheckingAuth(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  useEffect(() => {
    if (checkingAuth) return;
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const data = await rpcGetMsOpcoesFiltros(supabase);
      if (!cancelled) setOpcoes(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [checkingAuth, supabase]);

  useEffect(() => {
    if (!datas || datas.length === 0) return;
    setSliderRange([0, datas.length - 1]);
  }, [datas.length]);

  useEffect(() => {
    // When view mode changes, dash resets competitor selection.
    setCompetidoresSelected([]);
  }, [mode]);

  useEffect(() => {
    if (!opcoes) return;
    if (!supabase) return;

    let cancelled = false;
    setSeriesLoading(true);

    const seriesFilters: MarketShareFilters = {
      data_inicio: appliedFilters?.data_inicio ?? null,
      data_fim: appliedFilters?.data_fim ?? null,
      regioes: appliedFilters?.regioes ?? [],
      ufs: appliedFilters?.ufs ?? [],
      mercados: appliedFilters?.mercados ?? [],
    };

    (async () => {
      try {
        const rows = await rpcGetMsSerie(supabase, seriesFilters);
        if (cancelled) return;
        // Date conversion for plotly date axis sorting
        setSerieRows(rows ?? []);
      } finally {
        if (!cancelled) setSeriesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appliedFilters, opcoes, supabase]);

  const big3 = appliedFilters?.modo_big3 ?? false;
  const players =
    appliedFilters?.competidores && (appliedFilters?.competidores as string[]).length > 0
      ? (appliedFilters?.competidores as string[])
      : playersDefault;

  const dieselRetail = buildMarketShareLine({
    serieRows,
    produto: "Diesel B",
    segmento: "Retail",
    players,
    big3,
  });
  const dieselB2B = buildMarketShareLine({
    serieRows,
    produto: "Diesel B",
    segmento: "B2B",
    players,
    big3,
  });
  const dieselTrR = buildMarketShareLine({
    serieRows,
    produto: "Diesel B",
    segmento: "TRR",
    players,
    big3,
  });
  const dieselTotal = buildMarketShareLine({
    serieRows,
    produto: "Diesel B",
    segmento: null,
    players,
    big3,
  });

  const gasRetail = buildMarketShareLine({
    serieRows,
    produto: "Gasolina C",
    segmento: "Retail",
    players,
    big3,
  });
  const gasB2B = buildMarketShareLine({
    serieRows,
    produto: "Gasolina C",
    segmento: "B2B",
    players,
    big3,
  });
  const gasTotal = buildMarketShareLine({
    serieRows,
    produto: "Gasolina C",
    segmento: null,
    players,
    big3,
  });

  const ethRetail = buildMarketShareLine({
    serieRows,
    produto: "Etanol Hidratado",
    segmento: "Retail",
    players,
    big3,
  });
  const ethB2B = buildMarketShareLine({
    serieRows,
    produto: "Etanol Hidratado",
    segmento: "B2B",
    players,
    big3,
  });
  const ethTotal = buildMarketShareLine({
    serieRows,
    produto: "Etanol Hidratado",
    segmento: null,
    players,
    big3,
  });

  function applyFilters() {
    if (!datas || datas.length === 0) return;
    const [a, b] = sliderRange;
    const d_inicio = datas[a] ?? null;
    const d_fim = datas[b] ?? null;

    const playersFinal = competidoresSelected.length ? competidoresSelected : playersDefault;

    setAppliedFilters({
      data_inicio: d_inicio,
      data_fim: d_fim,
      competidores: playersFinal,
      regioes: regioesSelected ?? [],
      ufs: ufsSelected ?? [],
      mercados: [],
      modo_big3: mode === "Big-3",
    });

    setShowToast(true);
    window.setTimeout(() => setShowToast(false), 2500);
  }

  function clearFilters() {
    setAppliedFilters({});
    setCompetidoresSelected([]);
    setRegioesSelected([]);
    setUfsSelected([]);
  }

  if (!supabase) {
    return (
      <div className="container" style={{ padding: 24, fontFamily: "Arial" }}>
        <h5 style={{ fontWeight: 700 }}>Missing configuration</h5>
        <div style={{ fontSize: 13, color: "#555" }}>
          Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
          <code>frontend-next/.env.local</code>.
        </div>
      </div>
    );
  }

  if (checkingAuth || !opcoes) return null;

  return (
    <div>
      <NavBar />

      {showToast ? (
        <div
          id="toast-filters"
          className="alert alert-success"
          role="alert"
          style={{
            fontFamily: "Arial",
            fontSize: 13,
            padding: "10px 14px",
            border: "none",
            boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
          }}
        >
          Filters applied!
        </div>
      ) : null}

      <div className="container-fluid g-0">
        <div className="row g-0">
          <div className="col-2 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <img
                  src="/logo.webp"
                  alt="Itaú BBA"
                  style={{ width: "100%", maxWidth: 220, marginBottom: 16 }}
                />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                <PeriodSlider
                  datas={datas}
                  value={sliderRange}
                  onChange={setSliderRange}
                  sliderId="ms-slider-period"
                />
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">View Mode</div>
                <div style={{ display: "flex", gap: 16 }}>
                  <label style={{ fontFamily: "Arial", fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="ms-mode"
                      checked={mode === "Individual"}
                      onChange={() => setMode("Individual")}
                      style={{ accentColor: "#ff5000", marginRight: 5 }}
                    />
                    Individual
                  </label>
                  <label style={{ fontFamily: "Arial", fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="ms-mode"
                      checked={mode === "Big-3"}
                      onChange={() => setMode("Big-3")}
                      style={{ accentColor: "#ff5000", marginRight: 5 }}
                    />
                    Big-3
                  </label>
                </div>
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Competitors</div>
                <CheckList
                  label="Competitors"
                  options={playersOptions}
                  value={competidoresSelected}
                  onChange={setCompetidoresSelected}
                  allLabel="All"
                  clearLabel="Clear"
                />
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Region / State</div>
                <RegionStateFilter
                  regioes={(opcoes?.regioes ?? []) as string[]}
                  ufs={(opcoes?.ufs ?? []) as string[]}
                  selectedRegioes={regioesSelected}
                  selectedUfs={ufsSelected}
                  onRegioesChange={setRegioesSelected}
                  onUfsChange={setUfsSelected}
                />
              </div>

              <div className="row g-1 mt-1">
                <div className="col-6">
                  <button type="button" className="btn btn-apply" onClick={applyFilters}>
                    Apply
                  </button>
                </div>
                <div className="col-6">
                  <button type="button" className="btn btn-clear" onClick={clearFilters}>
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="col-10">
            <div id="page-content">
              <div className="mb-2">
                <div className="page-header-title">Liquid Fuels Market Share</div>
                <div className="page-header-sub">
                  Temporal evolution of market share by distributor (%)
                </div>
              </div>

              <div className="mb-3">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => downloadCsv(serieRows, "ms_series.csv")}
                  disabled={!serieRows || serieRows.length === 0 || seriesLoading}
                  style={{ fontFamily: "Arial" }}
                >
                  Full series (CSV)
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm ms-2"
                  onClick={() => downloadMarketShareExcel(serieRows, players, big3)}
                  disabled={!serieRows || serieRows.length === 0 || seriesLoading}
                  style={{ fontFamily: "Arial" }}
                >
                  Export Excel
                </button>
              </div>

              {seriesLoading ? (
                <div className="d-flex justify-content-center my-5">
                  <div className="spinner-border text-warning" role="status" />
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 10 }}>
                    <div className="section-title" style={{ color: "#1a1a1a" }}>Diesel B</div>
                    <hr className="section-hr" />
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>
                          Retail
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={dieselRetail.data}
                          layout={dieselRetail.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>
                          B2B
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={dieselB2B.data}
                          layout={dieselB2B.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>
                          TRR
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={dieselTrR.data}
                          layout={dieselTrR.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>
                          Total
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={dieselTotal.data}
                          layout={dieselTotal.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </div>
                    </div>
                  </div>

                  <hr style={{ borderTop: "1px solid #e0e0e0", margin: "20px 0" }} />

                  <div style={{ marginBottom: 10 }}>
                    <div className="section-title" style={{ color: "#1a1a1a" }}>Gasoline C</div>
                    <hr className="section-hr" />
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>
                          Retail
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={gasRetail.data}
                          layout={gasRetail.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>
                          B2B
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={gasB2B.data}
                          layout={gasB2B.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-12">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>
                          Total
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={gasTotal.data}
                          layout={gasTotal.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </div>
                    </div>
                  </div>

                  <hr style={{ borderTop: "1px solid #e0e0e0", margin: "20px 0" }} />

                  <div style={{ marginBottom: 10 }}>
                    <div className="section-title" style={{ color: "#1a1a1a" }}>Hydrous Ethanol</div>
                    <hr className="section-hr" />
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>
                          Retail
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={ethRetail.data}
                          layout={ethRetail.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>
                          B2B
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={ethB2B.data}
                          layout={ethB2B.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-12">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>
                          Total
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={ethTotal.data}
                          layout={ethTotal.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
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

