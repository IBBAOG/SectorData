"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import PlotlyChart from "../../../components/PlotlyChart";
import PeriodSlider from "../../../components/PeriodSlider";
import CheckList from "../../../components/CheckList";
import SearchableMultiSelect from "../../../components/SearchableMultiSelect";
import RegionStateFilter from "../../../components/RegionStateFilter";
import { resolverDatas } from "../../../lib/filterUtils";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import {
  rpcGetSvOpcoesFiltros,
  rpcGetSvSerieFast,
  rpcGetSvSerieOthers,
  rpcGetSvOthersPlayers,
  type MarketShareFilters,
  type MsSerieRow,
} from "../../../lib/rpc";
import { downloadSalesVolumesExcel } from "../../../lib/exportExcel";

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

// Plotly discrete color sequence for dynamic "Others" mode
const PLOTLY_COLORS = [
  "#636EFA","#EF553B","#00CC96","#AB63FA","#FFA15A",
  "#19D3F3","#FF6692","#B6E880","#FF97FF","#FECB52",
];
function dynColor(i: number) { return PLOTLY_COLORS[i % PLOTLY_COLORS.length]; }

type Mode = "Individual" | "Big-3" | "Others";

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

function buildSalesVolumeLine(params: {
  serieRows: MsSerieRow[];
  produto: string;
  segmento?: string | null;
  players: string[];
  big3: boolean;
  xMin?: string | null;
  xMax?: string | null;
  groupBy?: "classificacao" | "agente_regulado";
  colorsOverride?: Record<string, string>;
}): { data: PlotData[]; layout: Partial<Layout> } {
  const { serieRows, produto, segmento = null, players, big3, xMin, xMax, groupBy = "classificacao", colorsOverride } = params;
  if (!serieRows || serieRows.length === 0) return emptyPlot(300);

  // Filter by product + segment
  let rows = serieRows.filter((r) => r.nome_produto === produto);
  if (segmento) rows = rows.filter((r) => r.segmento === segmento);
  if (rows.length === 0) return emptyPlot(300);

  // Aggregate by (date, player-key) summing quantidade
  const groupMap = new Map<string, number>();
  for (const r of rows) {
    let classificacao = groupBy === "agente_regulado"
      ? (r.agente_regulado ?? r.classificacao)
      : r.classificacao;
    if (big3 && groupBy !== "agente_regulado")
      classificacao = BIG3_MEMBERS.includes(classificacao) ? "Big-3" : classificacao;
    const dateKey = String(r.date);
    const key = `${dateKey}|${classificacao}`;
    groupMap.set(key, (groupMap.get(key) ?? 0) + Number(r.quantidade ?? 0));
  }

  // Convert to array filtering by players — raw volumes, no percentage
  const grouped: Array<{ date: string; classificacao: string; volume: number }> = [];
  for (const [key, qty] of groupMap.entries()) {
    const [date, classificacao] = key.split("|");
    if (!players.includes(classificacao)) continue;
    grouped.push({ date, classificacao, volume: qty });
  }

  if (grouped.length === 0) return emptyPlot(300);

  grouped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const yVals = grouped.map((g) => g.volume);
  const yMin = Math.min(...yVals);
  const yMax = Math.max(...yVals);
  const spread = yMax - yMin > 0 ? yMax - yMin : 1.0;
  const pad = spread * 0.2;
  const yLo = Math.max(0, yMin - pad);
  const yHi = yMax + pad;

  const ultimaData = grouped[grouped.length - 1].date;

  const colorsMap = colorsOverride ?? (big3 ? COLORS_BIG3 : COLORS_IND);

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
      x: series.map((s) => s.date),
      y: series.map((s) => s.volume),
      name: player,
      line: { width: 2.5, color: colorsMap[player] ?? "#000000" },
      hovertemplate: "%{fullData.name}: %{y:,.1f} mil m³<extra></extra>",
    } as PlotData);

    const last = series.find((s) => s.date === ultimaData);
    if (last) {
      annotations.push({
        x: ultimaData,
        y: last.volume,
        text: last.volume.toFixed(1),
        showarrow: false,
        xanchor: "left",
        xshift: 6,
        yanchor: "middle",
        font: { family: "Arial", size: 12, color: colorsMap[player] ?? "#000000" },
      });
    }
  }

  const allDates = traces.flatMap((t) => (t.x as string[]) ?? []).sort();
  const dataMin = allDates[0];
  const dataMax = allDates[allDates.length - 1];

  const layout: Partial<Layout> = {
    title: { text: "" },
    margin: { t: 10, b: 80, l: 60, r: 75 },
    font: { family: "Arial", size: 12, color: "#000000" },
    yaxis: {
      title: { text: "Volume (mil m³)" },
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
      range: [xMin ?? dataMin, xMax ?? dataMax],
      showspikes: true,
      spikemode: "across" as const,
      spikedash: "solid",
      spikecolor: "#555555",
      spikethickness: 1,
    },
    legend: {
      orientation: "h",
      yanchor: "top",
      y: -0.28,
      xanchor: "center",
      x: 0.5,
    },
    hoverlabel: {
      bgcolor: "rgba(255, 255, 255, 0.95)",
      bordercolor: "rgba(180, 180, 180, 0.5)",
      font: { family: "Arial", color: "#1a1a1a", size: 12 },
      namelength: -1,
    },
    plot_bgcolor: "white",
    paper_bgcolor: "white",
    height: 300,
    hovermode: "x unified",
    annotations,
  };

  return { data: traces, layout };
}

// ── Otto-Cycle volume combination ─────────────────────────────────────────────

function makeOttoCycleRows(rows: MsSerieRow[]): MsSerieRow[] {
  const result: MsSerieRow[] = [];
  for (const r of rows) {
    if (r.nome_produto === "Gasolina C") {
      result.push({ ...r, nome_produto: "Otto-Cycle" });
    } else if (r.nome_produto === "Etanol Hidratado") {
      result.push({
        ...r,
        nome_produto: "Otto-Cycle",
        quantidade: r.quantidade != null ? Number(r.quantidade) * 0.7 : r.quantidade,
      });
    }
  }
  return result;
}

// ── Period comparison helpers ─────────────────────────────────────────────────

function shiftMonth(dateStr: string, n: number): string {
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(5, 7), 10) - 1 + n;
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, "0")}-01`;
}

function getSvAtDate(
  rows: MsSerieRow[],
  produto: string,
  segmento: string | null,
  date: string,
  big3: boolean,
  groupBy: "classificacao" | "agente_regulado" = "classificacao",
): Map<string, number> {
  let filtered = rows.filter((r) => r.nome_produto === produto && r.date === date);
  if (segmento) filtered = filtered.filter((r) => r.segmento === segmento);
  const grp = new Map<string, number>();
  for (const r of filtered) {
    let cls = groupBy === "agente_regulado"
      ? (r.agente_regulado ?? r.classificacao)
      : r.classificacao;
    if (big3 && groupBy !== "agente_regulado")
      cls = BIG3_MEMBERS.includes(cls) ? "Big-3" : cls;
    grp.set(cls, (grp.get(cls) ?? 0) + Number(r.quantidade ?? 0));
  }
  return grp; // raw volumes, no percentage conversion
}

type CompRow = { player: string; mom: number | null; q3m: number | null; yoy: number | null; ytd: number | null };

function buildSvComparisonData(
  rows: MsSerieRow[],
  produto: string,
  segmento: string | null,
  players: string[],
  big3: boolean,
  latestDate: string,
  groupBy: "classificacao" | "agente_regulado" = "classificacao",
): CompRow[] {
  const prevYearDec = `${parseInt(latestDate.slice(0, 4), 10) - 1}-12-01`;
  const volNow = getSvAtDate(rows, produto, segmento, latestDate, big3, groupBy);
  const volMoM = getSvAtDate(rows, produto, segmento, shiftMonth(latestDate, -1), big3, groupBy);
  const vol3M  = getSvAtDate(rows, produto, segmento, shiftMonth(latestDate, -3), big3, groupBy);
  const volYoY = getSvAtDate(rows, produto, segmento, shiftMonth(latestDate, -12), big3, groupBy);
  const volYtd = getSvAtDate(rows, produto, segmento, prevYearDec, big3, groupBy);
  const delta = (a: Map<string, number>, b: Map<string, number>, p: string): number | null => {
    const va = a.get(p); const vb = b.get(p);
    return va !== undefined && vb !== undefined ? va - vb : null;
  };
  return players.map((player) => ({
    player,
    mom: delta(volNow, volMoM, player),
    q3m: delta(volNow, vol3M, player),
    yoy: delta(volNow, volYoY, player),
    ytd: delta(volNow, volYtd, player),
  }));
}

function ComparisonTable({ rows, colors }: { rows: CompRow[]; colors: Record<string, string> }) {
  const fmt = (v: number | null) =>
    v === null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1);
  const cellStyle = (v: number | null) => ({
    backgroundColor:
      v === null ? "transparent" : v > 0 ? "#C6E8D9" : v < 0 ? "#FFDDCC" : "transparent",
    color: v === null ? "#bbb" : "#1a1a1a",
    textAlign: "center" as const,
    padding: "2px 10px",
    fontSize: 11,
    fontFamily: "Arial",
    whiteSpace: "nowrap" as const,
    fontWeight: 400,
    border: "none",
  });
  const thStyle = {
    fontFamily: "Arial",
    fontSize: 10,
    fontWeight: 700,
    color: "#ffffff",
    backgroundColor: "#000512",
    textAlign: "center" as const,
    padding: "4px 10px",
    border: "none",
  };
  // suppress unused warning — colors accepted for API symmetry with Market Share
  void colors;
  return (
    <table style={{ borderCollapse: "collapse", width: "calc(100% - 191px)", margin: "6px 0 0 60px", tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: "30%" }} />
        <col style={{ width: "17.5%" }} />
        <col style={{ width: "17.5%" }} />
        <col style={{ width: "17.5%" }} />
        <col style={{ width: "17.5%" }} />
      </colgroup>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: "left" as const, paddingLeft: 8 }}>Volume Var. (mil m³)</th>
          <th style={thStyle}>MoM</th>
          <th style={thStyle}>QTD</th>
          <th style={thStyle}>YoY</th>
          <th style={thStyle}>YTD</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.player} style={i === rows.length - 1 ? { borderBottom: "2px solid #d0d0d0" } : {}}>
            <td style={{ fontFamily: "Arial", fontSize: 11, color: "#1a1a1a", fontWeight: 400, padding: "2px 12px 2px 8px", whiteSpace: "nowrap" as const, border: "none" }}>{row.player}</td>
            <td style={cellStyle(row.mom)}>{fmt(row.mom)}</td>
            <td style={cellStyle(row.q3m)}>{fmt(row.q3m)}</td>
            <td style={cellStyle(row.yoy)}>{fmt(row.yoy)}</td>
            <td style={cellStyle(row.ytd)}>{fmt(row.ytd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SalesVolumesPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("sales-volumes");
  const supabase = getSupabaseClient();

  type AppliedSvFilters = {
    data_inicio?: string | null;
    data_fim?: string | null;
    regioes?: string[] | null;
    ufs?: string[] | null;
    mercados?: string[] | null;
    competidores?: string[] | null;
    modo_big3?: boolean;
    modo?: Mode;
  };

  const [opcoes, setOpcoes] = useState<Record<string, unknown> | null>(null);

  const datas = useMemo(() => resolverDatas(opcoes ?? {}), [opcoes]);

  const [mode, setMode] = useState<Mode>("Individual");
  const MODE_OPTIONS: Mode[] = ["Individual", "Big-3", "Others"];
  const modeActiveIdx = MODE_OPTIONS.indexOf(mode);

  const [competidoresSelected, setCompetidoresSelected] = useState<string[]>([]);
  const [regioesSelected, setRegioesSelected] = useState<string[]>([]);
  const [ufsSelected, setUfsSelected] = useState<string[]>([]);

  const [sliderRange, setSliderRange] = useState<[number, number]>([0, 0]);

  const [appliedFilters, setAppliedFilters] = useState<AppliedSvFilters>({});
  const [showToast, setShowToast] = useState(false);

  const [seriesLoading, setSeriesLoading] = useState(false);
  const [serieRows, setSerieRows] = useState<MsSerieRow[]>([]);
  const [excelLoading, setExcelLoading] = useState(false);
  const [cachedOthersPlayers, setCachedOthersPlayers] = useState<string[]>([]);

  // Unique agente_regulado values: from current data or cached list
  const othersPlayers = useMemo(() => {
    const seen = new Set<string>();
    for (const r of serieRows) if (r.agente_regulado) seen.add(r.agente_regulado);
    const fromData = Array.from(seen).sort();
    return fromData.length > 0 ? fromData : cachedOthersPlayers;
  }, [serieRows, cachedOthersPlayers]);

  const playersOptions =
    mode === "Big-3" ? ALL_PLAYERS_BIG3 :
    mode === "Others" ? othersPlayers :
    ALL_PLAYERS_IND;
  const playersDefault = playersOptions;

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const data = await rpcGetSvOpcoesFiltros(supabase);
      if (!cancelled) setOpcoes(data);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  useEffect(() => {
    if (!datas || datas.length === 0) return;
    setSliderRange([0, datas.length - 1]);
  }, [datas.length]);

  useEffect(() => {
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

    const isOthers = (appliedFilters?.modo as string) === "Others";
    (async () => {
      try {
        const rows = isOthers
          ? await rpcGetSvSerieOthers(supabase, seriesFilters)
          : await rpcGetSvSerieFast(supabase, seriesFilters);
        if (cancelled) return;
        setSerieRows(rows ?? []);
        if (isOthers) {
          const seen = new Set<string>();
          for (const r of rows ?? []) if (r.agente_regulado) seen.add(r.agente_regulado);
          setCachedOthersPlayers(Array.from(seen).sort());
        }
      } finally {
        if (!cancelled) setSeriesLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [appliedFilters, opcoes, supabase]);

  // Pre-fetch Others player list on first load
  useEffect(() => {
    if (!opcoes || !supabase || cachedOthersPlayers.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const players = await rpcGetSvOthersPlayers(supabase);
        if (cancelled) return;
        setCachedOthersPlayers(players);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [opcoes, supabase, cachedOthersPlayers.length]);

  const big3 = appliedFilters?.modo_big3 ?? false;
  const appliedMode: Mode = appliedFilters?.modo ?? "Individual";
  const groupBy: "classificacao" | "agente_regulado" =
    appliedMode === "Others" ? "agente_regulado" : "classificacao";

  const appliedPlayersDefault =
    appliedMode === "Big-3" ? ALL_PLAYERS_BIG3 :
    appliedMode === "Others" ? othersPlayers :
    ALL_PLAYERS_IND;

  const players =
    appliedFilters?.competidores && (appliedFilters?.competidores as string[]).length > 0
      ? (appliedFilters?.competidores as string[])
      : appliedPlayersDefault;

  const xMin = appliedFilters?.data_inicio ?? null;
  const xMax = appliedFilters?.data_fim ?? null;

  const latestDate = useMemo(() => {
    if (appliedFilters.data_fim) return appliedFilters.data_fim;
    if (serieRows.length === 0) return null;
    return serieRows.reduce((max, r) => (r.date > max ? r.date : max), serieRows[0].date);
  }, [appliedFilters.data_fim, serieRows]);

  const chartColors = useMemo(() => {
    if (big3) return COLORS_BIG3;
    if (appliedMode === "Others") {
      return Object.fromEntries(players.map((p, i) => [p, dynColor(i)]));
    }
    return COLORS_IND;
  }, [big3, appliedMode, players]);

  const ottoCycleRows = useMemo(() => makeOttoCycleRows(serieRows), [serieRows]);

  const charts = useMemo(() => {
    const common = { players, big3, xMin, xMax, groupBy, colorsOverride: chartColors };
    return {
      dieselRetail: buildSalesVolumeLine({ serieRows, produto: "Diesel B",         segmento: "Retail", ...common }),
      dieselB2B:    buildSalesVolumeLine({ serieRows, produto: "Diesel B",         segmento: "B2B",    ...common }),
      dieselTrR:    buildSalesVolumeLine({ serieRows, produto: "Diesel B",         segmento: "TRR",    ...common }),
      dieselTotal:  buildSalesVolumeLine({ serieRows, produto: "Diesel B",         segmento: null,     ...common }),
      gasRetail:    buildSalesVolumeLine({ serieRows, produto: "Gasolina C",       segmento: "Retail", ...common }),
      gasB2B:       buildSalesVolumeLine({ serieRows, produto: "Gasolina C",       segmento: "B2B",    ...common }),
      gasTotal:     buildSalesVolumeLine({ serieRows, produto: "Gasolina C",       segmento: null,     ...common }),
      ethRetail:    buildSalesVolumeLine({ serieRows, produto: "Etanol Hidratado", segmento: "Retail", ...common }),
      ethB2B:       buildSalesVolumeLine({ serieRows, produto: "Etanol Hidratado", segmento: "B2B",    ...common }),
      ethTotal:     buildSalesVolumeLine({ serieRows, produto: "Etanol Hidratado", segmento: null,     ...common }),
      ottoRetail:   buildSalesVolumeLine({ serieRows: ottoCycleRows, produto: "Otto-Cycle", segmento: "Retail", ...common }),
      ottoB2B:      buildSalesVolumeLine({ serieRows: ottoCycleRows, produto: "Otto-Cycle", segmento: "B2B",    ...common }),
      ottoTotal:    buildSalesVolumeLine({ serieRows: ottoCycleRows, produto: "Otto-Cycle", segmento: null,     ...common }),
    };
  }, [serieRows, ottoCycleRows, players, big3, xMin, xMax, groupBy, chartColors]);

  const compData = useMemo(() => {
    if (!latestDate) return null;
    return {
      dieselRetail: buildSvComparisonData(serieRows, "Diesel B", "Retail", players, big3, latestDate, groupBy),
      dieselB2B:    buildSvComparisonData(serieRows, "Diesel B", "B2B", players, big3, latestDate, groupBy),
      dieselTrR:    buildSvComparisonData(serieRows, "Diesel B", "TRR", players, big3, latestDate, groupBy),
      dieselTotal:  buildSvComparisonData(serieRows, "Diesel B", null, players, big3, latestDate, groupBy),
      gasRetail:    buildSvComparisonData(serieRows, "Gasolina C", "Retail", players, big3, latestDate, groupBy),
      gasB2B:       buildSvComparisonData(serieRows, "Gasolina C", "B2B", players, big3, latestDate, groupBy),
      gasTotal:     buildSvComparisonData(serieRows, "Gasolina C", null, players, big3, latestDate, groupBy),
      ethRetail:    buildSvComparisonData(serieRows, "Etanol Hidratado", "Retail", players, big3, latestDate, groupBy),
      ethB2B:       buildSvComparisonData(serieRows, "Etanol Hidratado", "B2B", players, big3, latestDate, groupBy),
      ethTotal:     buildSvComparisonData(serieRows, "Etanol Hidratado", null, players, big3, latestDate, groupBy),
      ottoRetail:   buildSvComparisonData(ottoCycleRows, "Otto-Cycle", "Retail", players, big3, latestDate, groupBy),
      ottoB2B:      buildSvComparisonData(ottoCycleRows, "Otto-Cycle", "B2B", players, big3, latestDate, groupBy),
      ottoTotal:    buildSvComparisonData(ottoCycleRows, "Otto-Cycle", null, players, big3, latestDate, groupBy),
    };
  }, [serieRows, ottoCycleRows, players, big3, latestDate, groupBy]);

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
      modo: mode,
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

  if (!opcoes) return null;
  if (visLoading || !visible) return null;

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
          <div className="col-2 p-0" style={{ display: "flex", flexDirection: "column" }}>
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <img
                  src="/logo.png"
                  alt="Itaú BBA"
                  style={{ width: "100%", maxWidth: 300, marginBottom: 16 }}
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
                  sliderId="sv-slider-period"
                  fmtLabel={(d) => {
                    try {
                      const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                      return `${MONTHS[parseInt(d.slice(5,7),10)-1]}, ${d.slice(0,4)}`;
                    } catch { return d; }
                  }}
                />
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">View Mode</div>
                <div style={{ position: "relative", display: "flex", alignItems: "center", backgroundColor: "#f0f0f0", borderRadius: 999, padding: "3px 4px", width: "100%" }}>
                  {/* sliding background */}
                  <div style={{
                    position: "absolute",
                    top: 3,
                    bottom: 3,
                    left: `calc(4px + ${modeActiveIdx} * (100% - 8px) / 3)`,
                    width: `calc((100% - 8px) / 3)`,
                    backgroundColor: "#ff5000",
                    borderRadius: 999,
                    transition: "left 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
                    zIndex: 0,
                    pointerEvents: "none",
                  }} />
                  {MODE_OPTIONS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      style={{
                        position: "relative",
                        zIndex: 1,
                        background: "transparent",
                        color: mode === m ? "#ffffff" : "#555555",
                        border: "none",
                        borderRadius: 999,
                        padding: "4px 0",
                        flex: 1,
                        textAlign: "center",
                        fontFamily: "Arial",
                        fontSize: 12,
                        fontWeight: mode === m ? 700 : 500,
                        cursor: "pointer",
                        transition: "color 0.18s",
                        lineHeight: 1.4,
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Competitors</div>
                {mode === "Others" ? (
                  <SearchableMultiSelect
                    options={playersOptions}
                    value={competidoresSelected}
                    onChange={setCompetidoresSelected}
                  />
                ) : (
                  <CheckList
                    label="Competitors"
                    options={playersOptions}
                    value={competidoresSelected}
                    onChange={setCompetidoresSelected}
                    allLabel="All"
                    clearLabel="Clear"
                  />
                )}
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div className="page-header-title">Brazil Fuel Distribution Sales Volumes</div>
                  <div className="page-header-sub">
                    Temporal evolution of sales volume by distributor (mil m³)
                  </div>
                </div>

                <div style={{ position: "relative", minWidth: 180 }}>
                  {excelLoading && (
                    <div style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      zIndex: 20,
                      border: "1px solid #e0e0e0",
                      borderRadius: 12,
                      padding: "24px 32px",
                      backgroundColor: "rgba(255,255,255,0.97)",
                      backdropFilter: "blur(8px)",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 12,
                    }}>
                      <img src="/barrel_loading.png" alt="Carregando..." width={120} height={120} />
                      <span style={{ fontFamily: "Arial", fontSize: 13, fontWeight: 600, color: "#555", letterSpacing: "0.3px" }}>
                        Gerando Excel...
                      </span>
                    </div>
                  )}
                  <div style={{ border: "1px solid #d0d0d0", borderRadius: 6, padding: "10px 16px", backgroundColor: "#fafafa" }}>
                    <div style={{ fontFamily: "Arial", fontSize: 11, fontWeight: 700, color: "#1a1a1a", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Export Data
                    </div>
                    <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={async () => {
                          setExcelLoading(true);
                          try {
                            await downloadSalesVolumesExcel(serieRows, players, big3);
                          } catch (e) {
                            console.error("Excel export failed", e);
                          } finally {
                            setExcelLoading(false);
                          }
                        }}
                        disabled={!serieRows || serieRows.length === 0 || seriesLoading || excelLoading}
                        style={{ fontFamily: "Arial" }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" style={{ marginRight: 5, verticalAlign: "middle" }} xmlns="http://www.w3.org/2000/svg">
                          <rect x="2" y="2" width="20" height="20" rx="3" fill="#217346"/>
                          <text x="4" y="17" fontFamily="Arial" fontWeight="bold" fontSize="12" fill="#ffffff">X</text>
                        </svg>
                        formated data .xl
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {seriesLoading ? (
                <div className="d-flex justify-content-center my-5">
                  <img src="/barrel_loading.png" alt="Carregando..." width={160} height={160} />
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
                        <div className="section-title" style={{ fontSize: 15 }}>Retail</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts.dieselRetail.data}
                          layout={charts.dieselRetail.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "calc(100% - 56px)", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.dieselRetail} colors={chartColors} />}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>B2B</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts.dieselB2B.data}
                          layout={charts.dieselB2B.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "calc(100% - 56px)", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.dieselB2B} colors={chartColors} />}
                      </div>
                    </div>
                  </div>

                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>TRR</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts.dieselTrR.data}
                          layout={charts.dieselTrR.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "calc(100% - 56px)", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.dieselTrR} colors={chartColors} />}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>Total</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts.dieselTotal.data}
                          layout={charts.dieselTotal.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "calc(100% - 56px)", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.dieselTotal} colors={chartColors} />}
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
                        <div className="section-title" style={{ fontSize: 15 }}>Retail</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts.gasRetail.data}
                          layout={charts.gasRetail.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "calc(100% - 56px)", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.gasRetail} colors={chartColors} />}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>B2B</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts.gasB2B.data}
                          layout={charts.gasB2B.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "calc(100% - 56px)", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.gasB2B} colors={chartColors} />}
                      </div>
                    </div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>Total</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts.gasTotal.data}
                          layout={charts.gasTotal.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "calc(100% - 56px)", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.gasTotal} colors={chartColors} />}
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
                        <div className="section-title" style={{ fontSize: 15 }}>Retail</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts.ethRetail.data}
                          layout={charts.ethRetail.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "calc(100% - 56px)", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.ethRetail} colors={chartColors} />}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>B2B</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts.ethB2B.data}
                          layout={charts.ethB2B.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "calc(100% - 56px)", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.ethB2B} colors={chartColors} />}
                      </div>
                    </div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>Total</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts.ethTotal.data}
                          layout={charts.ethTotal.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "calc(100% - 56px)", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.ethTotal} colors={chartColors} />}
                      </div>
                    </div>
                  </div>

                  <hr style={{ borderTop: "1px solid #e0e0e0", margin: "20px 0" }} />

                  <div style={{ marginBottom: 10 }}>
                    <div className="section-title" style={{ color: "#1a1a1a" }}>Otto-Cycle</div>
                    <hr className="section-hr" />
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>Retail</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts.ottoRetail.data}
                          layout={charts.ottoRetail.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "calc(100% - 56px)", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.ottoRetail} colors={chartColors} />}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>B2B</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts.ottoB2B.data}
                          layout={charts.ottoB2B.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "calc(100% - 56px)", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.ottoB2B} colors={chartColors} />}
                      </div>
                    </div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>Total</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts.ottoTotal.data}
                          layout={charts.ottoTotal.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "calc(100% - 56px)", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.ottoTotal} colors={chartColors} />}
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
