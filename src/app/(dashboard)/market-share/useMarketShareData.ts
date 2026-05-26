"use client";

// THE BRAIN for /market-share.
//
// Single hook that owns:
//   - 4 RPC calls (rpcGetMsOpcoesFiltros, rpcGetMsSerieFast,
//     rpcGetMsSerieOthers, rpcGetOthersPlayers)
//   - All filter state (product, period, region, UF, segment, mode, topN,
//     competidores)
//   - Derived values: charts (buildMarketShareLine), comparison rows
//     (buildComparisonData), topPlayers ranking, export-filter snapshot,
//     export-size estimate via useExportSize.
//
// Both desktop/View.tsx and mobile/View.tsx consume ONLY this hook.
// Neither view calls Supabase directly.
//
// Shared RPCs with /sales-volumes:
//   get_ms_serie_fast, get_ms_serie_others, get_others_players
//   → Wrappers live in the "Market Share" section of src/lib/rpc.ts.
//   → Any signature change must be coordinated with worker_dash-sales-volumes.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import type { PlotData, Layout } from "plotly.js";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetMsOpcoesFiltros,
  rpcGetMsSerieFast,
  rpcGetMsSerieOthers,
  rpcGetOthersPlayers,
  getMsExportCount,
  fetchVendasFiltered,
  type MsSerieRow,
  type MsExportCountFilters,
} from "@/lib/rpc";
import { resolverDatas } from "@/lib/filterUtils";
import { useExportSize } from "@/hooks/useExportSize";
import { downloadMarketShareExcel } from "@/lib/exportExcel";
import { downloadCsv } from "@/lib/exportCsv";

// ─── Constants ────────────────────────────────────────────────────────────────

export const BIG3_MEMBERS = ["Vibra", "Ipiranga", "Raizen"];

export const COLORS_IND: Record<string, string> = {
  Vibra: "#f26522",
  Raizen: "#1a1a1a",
  Ipiranga: "#73C6A1",
  Others: "#A9A9A9",
};

export const COLORS_BIG3: Record<string, string> = {
  "Big-3": "#FF5000",
  Others: "#A9A9A9",
};

export const ALL_PLAYERS_IND = ["Vibra", "Ipiranga", "Raizen", "Others"];
export const ALL_PLAYERS_BIG3 = ["Big-3", "Others"];

// Mobile chart palette (leader = brand orange, rest = neutral hues)
export const MOBILE_PALETTE = ["#ff5000", "#3b82f6", "#8b5cf6", "#14b8a6", "#94a3b8"];

// Plotly discrete color sequence for "Others" mode
const PLOTLY_COLORS = [
  "#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
  "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52",
];
export function dynColor(i: number): string {
  return PLOTLY_COLORS[i % PLOTLY_COLORS.length];
}

export type Mode = "Individual" | "Big-3" | "Others";
export const MODE_OPTIONS: Mode[] = ["Individual", "Big-3", "Others"];

/** Unit mode toggle — controls whether charts/exports show market-share % or
 *  absolute volume in thousand m³. Default: 'share'. The 'volume' mode is the
 *  former /sales-volumes dashboard, folded into /market-share. */
export type UnitMode = "share" | "volume";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarketShareFiltersState {
  mode: Mode;
  sliderRange: [number, number];
  regioesSelected: string[];
  ufsSelected: string[];
  competidoresSelected: string[];
  // Applied (committed) filters after Apply button:
  appliedFilters: AppliedMarketShareFilters;
  // Export modal filters:
  exportOpen: boolean;
  exportRange: [number, number];
  exportRegioes: string[];
  exportUfs: string[];
  exportMercados: string[];
}

export interface AppliedMarketShareFilters {
  data_inicio?: string | null;
  data_fim?: string | null;
  regioes?: string[] | null;
  ufs?: string[] | null;
  mercados?: string[] | null;
  competidores?: string[] | null;
  modo_big3?: boolean;
  modo?: Mode;
}

export type CompRow = {
  player: string;
  mom: number | null;
  q3m: number | null;
  yoy: number | null;
  ytd: number | null;
};

export interface TopPlayerRow {
  rank: number;
  player: string;
  pct: number;
  /** MoM delta in pp */
  deltaMoM: number | null;
  /** Relative bar width 0-100 (relative to leader) */
  barWidth: number;
  isLeader: boolean;
  color: string;
}

export type ChartResult = { data: PlotData[]; layout: Partial<Layout> };

export interface MarketShareCharts {
  dieselRetail: ChartResult;
  dieselB2B: ChartResult;
  dieselTrR: ChartResult;
  dieselTotal: ChartResult;
  gasRetail: ChartResult;
  gasB2B: ChartResult;
  gasTotal: ChartResult;
  ethRetail: ChartResult;
  ethB2B: ChartResult;
  ethTotal: ChartResult;
  ottoRetail: ChartResult;
  ottoB2B: ChartResult;
  ottoTotal: ChartResult;
}

export type ChartKey = keyof MarketShareCharts;

export type ProductKey = "Diesel B" | "Gasolina C" | "Etanol Hidratado" | "Otto-Cycle";
export type SegmentKey = "Total" | "Retail" | "B2B" | "TRR";

/** Maps (product, segment) → chart key. TRR only exists for Diesel B. */
export const CHART_KEY_MATRIX: Record<ProductKey, Partial<Record<SegmentKey, ChartKey>>> = {
  "Diesel B": {
    Total: "dieselTotal",
    Retail: "dieselRetail",
    B2B: "dieselB2B",
    TRR: "dieselTrR",
  },
  "Gasolina C": {
    Total: "gasTotal",
    Retail: "gasRetail",
    B2B: "gasB2B",
  },
  "Etanol Hidratado": {
    Total: "ethTotal",
    Retail: "ethRetail",
    B2B: "ethB2B",
  },
  "Otto-Cycle": {
    Total: "ottoTotal",
    Retail: "ottoRetail",
    B2B: "ottoB2B",
  },
};

/** Segments available per product (drives the segment selector UI). */
export const SEGMENTS_BY_PRODUCT: Record<ProductKey, SegmentKey[]> = {
  "Diesel B": ["Total", "Retail", "B2B", "TRR"],
  "Gasolina C": ["Total", "Retail", "B2B"],
  "Etanol Hidratado": ["Total", "Retail", "B2B"],
  "Otto-Cycle": ["Total", "Retail", "B2B"],
};

export const PRODUCT_KEYS: ProductKey[] = ["Diesel B", "Gasolina C", "Etanol Hidratado", "Otto-Cycle"];

/** English display label for a product (used in mobile selectors). */
export const PRODUCT_LABEL: Record<ProductKey, string> = {
  "Diesel B": "Diesel B",
  "Gasolina C": "Gasoline C",
  "Etanol Hidratado": "Hydrous Ethanol",
  "Otto-Cycle": "Otto-Cycle",
};

export interface MarketShareCompData {
  dieselRetail: CompRow[];
  dieselB2B: CompRow[];
  dieselTrR: CompRow[];
  dieselTotal: CompRow[];
  gasRetail: CompRow[];
  gasB2B: CompRow[];
  gasTotal: CompRow[];
  ethRetail: CompRow[];
  ethB2B: CompRow[];
  ethTotal: CompRow[];
  ottoRetail: CompRow[];
  ottoB2B: CompRow[];
  ottoTotal: CompRow[];
}

export interface UseMarketShareData {
  // Raw data
  serieRows: MsSerieRow[];
  ottoCycleRows: MsSerieRow[];
  seriesLoading: boolean;
  seriesError: Error | null;

  // Filter options (from DB)
  opcoes: Record<string, unknown> | null;
  datas: string[];
  regioesAll: string[];
  ufsAll: string[];
  mercadosAll: string[];

  // Unit mode toggle (% Share vs thousand m³). State-driven, but initialized
  // from ?unit=volume URL param on first render. See useMarketShareData impl.
  unitMode: UnitMode;
  setUnitMode: (u: UnitMode) => void;

  // UI filter state (pre-apply)
  mode: Mode;
  setMode: (m: Mode) => void;
  sliderRange: [number, number];
  setSliderRange: (r: [number, number]) => void;
  regioesSelected: string[];
  setRegioesSelected: (r: string[]) => void;
  ufsSelected: string[];
  setUfsSelected: (u: string[]) => void;
  competidoresSelected: string[];
  setCompetidoresSelected: (c: string[]) => void;
  playersOptions: string[];

  // Applied state
  appliedFilters: AppliedMarketShareFilters;
  applyFilters: () => void;
  clearFilters: () => void;

  // Toast
  showToast: boolean;

  // Others players
  othersPlayers: string[];

  // Derived
  big3: boolean;
  appliedMode: Mode;
  players: string[];
  xMin: string | null;
  xMax: string | null;
  latestDate: string | null;
  chartColors: Record<string, string>;
  charts: MarketShareCharts | null;
  compData: MarketShareCompData | null;
  /** Top-N players ranked by latest share for the mobile overview card */
  topPlayers: TopPlayerRow[];

  // Mobile chart selector — navigates through the 13 product × segment charts
  selectedProduct: ProductKey;
  setSelectedProduct: (p: ProductKey) => void;
  selectedSegment: SegmentKey;
  setSelectedSegment: (s: SegmentKey) => void;
  /** Resolved chart key from (product, segment). Falls back to product Total when segment unavailable. */
  selectedChartKey: ChartKey;
  /** The currently selected chart (one of the 13). */
  activeChart: ChartResult | null;
  /** Comparison rows for the selected chart (used by mobile Compare tab). */
  activeCompRows: CompRow[];
  /** Top players ranked for the SELECTED product (mobile overview reflects the picker). */
  topPlayersForSelected: TopPlayerRow[];

  // Mobile Compare tab — which players to surface side-by-side
  compareSet: string[];
  setCompareSet: (players: string[]) => void;
  toggleCompareMember: (player: string) => void;

  // Export
  exportOpen: boolean;
  openExportModal: () => void;
  closeExportModal: () => void;
  exportRange: [number, number];
  setExportRange: (r: [number, number]) => void;
  exportRegioes: string[];
  setExportRegioes: (r: string[]) => void;
  exportUfs: string[];
  setExportUfs: (u: string[]) => void;
  exportMercados: string[];
  setExportMercados: (m: string[]) => void;
  exportFilters: MsExportCountFilters;
  exportSizeEstimate: ReturnType<typeof useExportSize>;
  /** Fetches the count for the ExportModal size calculator. Encapsulates the
   *  Supabase client so views never touch it directly. */
  fetchExportCount: () => Promise<number>;
  excelLoading: boolean;
  csvLoading: boolean;
  /** Excel export handler — generates the formatted spreadsheet and closes the modal. */
  onExportExcel: () => Promise<void>;
  /** CSV export handler — fetches raw `vendas` rows for `exportFilters` and downloads them. */
  onExportCsv: () => Promise<void>;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function emptyPlot(height = 300): ChartResult {
  return {
    data: [],
    layout: {
      paper_bgcolor: "white",
      plot_bgcolor: "white",
      xaxis: { visible: false },
      yaxis: { visible: false },
      annotations: [
        {
          text: "No data for the selected filters.",
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

export function buildMarketShareLine(params: {
  serieRows: MsSerieRow[];
  produto: string;
  segmento?: string | null;
  players: string[];
  big3: boolean;
  xMin?: string | null;
  xMax?: string | null;
  groupBy?: "classificacao" | "agente_regulado";
  colorsOverride?: Record<string, string>;
  /** 'share' = % participation (default), 'volume' = absolute thousand m³. */
  unitMode?: UnitMode;
}): ChartResult {
  const {
    serieRows,
    produto,
    segmento = null,
    players,
    big3,
    xMin,
    xMax,
    groupBy = "classificacao",
    colorsOverride,
    unitMode = "share",
  } = params;
  if (!serieRows || serieRows.length === 0) return emptyPlot(300);

  let rows = serieRows.filter((r) => r.nome_produto === produto);
  if (segmento) rows = rows.filter((r) => r.segmento === segmento);
  if (rows.length === 0) return emptyPlot(300);

  const groupMap = new Map<string, number>();
  for (const r of rows) {
    let classificacao =
      groupBy === "agente_regulado"
        ? (r.agente_regulado ?? r.classificacao)
        : r.classificacao;
    if (big3 && groupBy !== "agente_regulado")
      classificacao = BIG3_MEMBERS.includes(classificacao) ? "Big-3" : classificacao;
    const dateKey = String(r.date);
    const key = `${dateKey}|${classificacao}`;
    groupMap.set(key, (groupMap.get(key) ?? 0) + Number(r.quantidade ?? 0));
  }

  const totalByDate = new Map<string, number>();
  for (const [key, qty] of groupMap.entries()) {
    const [dateKey] = key.split("|");
    totalByDate.set(dateKey, (totalByDate.get(dateKey) ?? 0) + qty);
  }

  // y holds the rendered value: percentage when unitMode='share', absolute
  // quantidade (thousand m³) when unitMode='volume'. We still compute pct so
  // the calling code can keep a single record shape downstream if needed.
  const grouped: Array<{ date: string; classificacao: string; quantidade: number; pct: number; y: number }> = [];
  for (const [key, qty] of groupMap.entries()) {
    const [date, classificacao] = key.split("|");
    if (!players.includes(classificacao)) continue;
    if (unitMode === "share") {
      const total = totalByDate.get(date) ?? 0;
      if (total <= 0) continue;
      const pct = (qty / total) * 100;
      grouped.push({ date, classificacao, quantidade: qty, pct, y: pct });
    } else {
      grouped.push({ date, classificacao, quantidade: qty, pct: 0, y: qty });
    }
  }

  if (grouped.length === 0) return emptyPlot(300);

  grouped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const yVals = grouped.map((g) => g.y);
  const yMin = Math.min(...yVals);
  const yMax = Math.max(...yVals);
  const spread = yMax - yMin > 0 ? yMax - yMin : 1.0;
  const pad = spread * 0.2;
  // In 'share' mode we clamp to [0, 100]; in 'volume' mode we let yHi float.
  const yLo = Math.max(0, yMin - pad);
  const yHi = unitMode === "share" ? Math.min(100, yMax + pad) : yMax + pad;

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

  // Format helpers for hover + annotation labels.
  const fmtAnnot = (v: number): string =>
    unitMode === "share" ? `${v.toFixed(1)}%` : v.toFixed(1);
  const hoverTpl =
    unitMode === "share"
      ? "%{fullData.name}: %{y:.1f}%<extra></extra>"
      : "%{fullData.name}: %{y:.1f}<extra></extra>";

  for (const player of players) {
    const series = grouped.filter((g) => g.classificacao === player);
    if (series.length === 0) continue;
    traces.push({
      type: "scatter",
      mode: "lines",
      x: series.map((s) => s.date),
      y: series.map((s) => s.y),
      name: player,
      line: { width: 2.5, color: colorsMap[player] ?? "#000000" },
      hovertemplate: hoverTpl,
    } as PlotData);

    const last = series.find((s) => s.date === ultimaData);
    if (last) {
      annotations.push({
        x: ultimaData,
        y: last.y,
        text: fmtAnnot(last.y),
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

  const yAxis: NonNullable<Layout["yaxis"]> =
    unitMode === "share"
      ? {
          title: { text: "Market Share (%)" },
          ticksuffix: "%",
          range: [yLo, yHi],
          nticks: 10,
          showgrid: false,
          zeroline: false,
          showline: true,
          linecolor: "#000000",
          linewidth: 1,
        }
      : {
          title: { text: "Volume (thousand m³)" },
          range: [yLo, yHi],
          nticks: 10,
          showgrid: false,
          zeroline: false,
          showline: true,
          linecolor: "#000000",
          linewidth: 1,
        };

  const layout: Partial<Layout> = {
    title: { text: "" },
    margin: { t: 10, b: 80, l: 60, r: 75 },
    font: { family: "Arial", size: 12, color: "#000000" },
    yaxis: yAxis,
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

/** Stacked-area trace for mobile hero chart (last N months of a single product/segmento) */
export function buildMobileStackedArea(params: {
  serieRows: MsSerieRow[];
  produto: string;
  segmento?: string | null;
  players: string[];
  nMonths?: number;
  colorsOverride?: Record<string, string>;
}): PlotData[] {
  const { serieRows, produto, segmento = null, players, nMonths = 12, colorsOverride } = params;
  let rows = serieRows.filter((r) => r.nome_produto === produto);
  if (segmento) rows = rows.filter((r) => r.segmento === segmento);
  if (rows.length === 0) return [];

  // Collect all dates, take last nMonths
  const allDates = Array.from(new Set(rows.map((r) => r.date))).sort();
  const dates = allDates.slice(-nMonths);

  // Aggregate per (date, classificacao)
  const groupMap = new Map<string, number>();
  for (const r of rows) {
    if (!dates.includes(r.date)) continue;
    const key = `${r.date}|${r.classificacao}`;
    groupMap.set(key, (groupMap.get(key) ?? 0) + Number(r.quantidade ?? 0));
  }

  // Totals per date
  const totalByDate = new Map<string, number>();
  for (const [key, qty] of groupMap.entries()) {
    const [d] = key.split("|");
    totalByDate.set(d, (totalByDate.get(d) ?? 0) + qty);
  }

  const traces: PlotData[] = [];
  players.forEach((player, idx) => {
    const ys = dates.map((d) => {
      const qty = groupMap.get(`${d}|${player}`) ?? 0;
      const total = totalByDate.get(d) ?? 0;
      return total > 0 ? (qty / total) * 100 : 0;
    });
    const colors = colorsOverride ?? COLORS_IND;
    const color = colors[player] ?? MOBILE_PALETTE[idx % MOBILE_PALETTE.length];
    traces.push({
      type: "scatter",
      mode: "lines",
      name: player,
      x: dates,
      y: ys,
      stackgroup: "one",
      line: { color, width: 1.4, shape: "spline" as const, smoothing: 0.5 },
      fillcolor: color + "cc",
      hovertemplate: `<b>${player}</b><br>%{x}<br>%{y:.1f}%<extra></extra>`,
    } as PlotData);
  });

  return traces;
}

export function makeOttoCycleRows(rows: MsSerieRow[]): MsSerieRow[] {
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

function shiftMonth(dateStr: string, n: number): string {
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(5, 7), 10) - 1 + n;
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, "0")}-01`;
}

function getMsAtDate(
  rows: MsSerieRow[],
  produto: string,
  segmento: string | null,
  date: string,
  big3: boolean,
  groupBy: "classificacao" | "agente_regulado" = "classificacao",
  unitMode: UnitMode = "share",
): Map<string, number> {
  let filtered = rows.filter((r) => r.nome_produto === produto && r.date === date);
  if (segmento) filtered = filtered.filter((r) => r.segmento === segmento);
  const grp = new Map<string, number>();
  for (const r of filtered) {
    let cls =
      groupBy === "agente_regulado"
        ? (r.agente_regulado ?? r.classificacao)
        : r.classificacao;
    if (big3 && groupBy !== "agente_regulado")
      cls = BIG3_MEMBERS.includes(cls) ? "Big-3" : cls;
    grp.set(cls, (grp.get(cls) ?? 0) + Number(r.quantidade ?? 0));
  }
  // 'volume' branch: return absolute quantidade per player. Mirrors
  // getSvAtDate in the (now-retired) useSalesVolumesData hook.
  if (unitMode === "volume") return grp;

  const total = Array.from(grp.values()).reduce((a, b) => a + b, 0);
  if (total <= 0) return new Map();
  const result = new Map<string, number>();
  for (const [cls, qty] of grp) result.set(cls, (qty / total) * 100);
  return result;
}

export function buildComparisonData(
  rows: MsSerieRow[],
  produto: string,
  segmento: string | null,
  players: string[],
  big3: boolean,
  latestDate: string,
  groupBy: "classificacao" | "agente_regulado" = "classificacao",
  unitMode: UnitMode = "share",
): CompRow[] {
  // In 'share' mode the deltas are percentage-point variations (units = pp).
  // In 'volume' mode the deltas are absolute differences in thousand m³,
  // mirroring buildSvComparisonData from the retired /sales-volumes hook
  // (lines 258-285 of useSalesVolumesData.ts in commit history).
  const prevYearDec = `${parseInt(latestDate.slice(0, 4), 10) - 1}-12-01`;
  const msNow = getMsAtDate(rows, produto, segmento, latestDate, big3, groupBy, unitMode);
  const msMoM = getMsAtDate(rows, produto, segmento, shiftMonth(latestDate, -1), big3, groupBy, unitMode);
  const ms3M  = getMsAtDate(rows, produto, segmento, shiftMonth(latestDate, -3), big3, groupBy, unitMode);
  const msYoY = getMsAtDate(rows, produto, segmento, shiftMonth(latestDate, -12), big3, groupBy, unitMode);
  const msYtd = getMsAtDate(rows, produto, segmento, prevYearDec, big3, groupBy, unitMode);
  const delta = (a: Map<string, number>, b: Map<string, number>, p: string): number | null => {
    const va = a.get(p);
    const vb = b.get(p);
    return va !== undefined && vb !== undefined ? va - vb : null;
  };
  return players.map((player) => ({
    player,
    mom: delta(msNow, msMoM, player),
    q3m: delta(msNow, ms3M, player),
    yoy: delta(msNow, msYoY, player),
    ytd: delta(msNow, msYtd, player),
  }));
}

/** Compute the top-N ranked players for the mobile overview card. */
function buildTopPlayers(
  rows: MsSerieRow[],
  produto: string,
  latestDate: string,
  big3: boolean,
  groupBy: "classificacao" | "agente_regulado",
  chartColors: Record<string, string>,
  topN = 5,
  unitMode: UnitMode = "share",
): TopPlayerRow[] {
  const msNow = getMsAtDate(rows, produto, null, latestDate, big3, groupBy, unitMode);
  const msMoM = getMsAtDate(rows, produto, null, shiftMonth(latestDate, -1), big3, groupBy, unitMode);
  if (msNow.size === 0) return [];

  const entries = Array.from(msNow.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  const leader = entries[0]?.[1] ?? 1;

  return entries.map(([player, pct], idx) => {
    const prevPct = msMoM.get(player);
    const deltaMoM = prevPct !== undefined ? pct - prevPct : null;
    const colorKeys = Object.keys(chartColors);
    const color =
      chartColors[player] ??
      MOBILE_PALETTE[idx % MOBILE_PALETTE.length];
    void colorKeys;
    return {
      rank: idx + 1,
      player,
      pct,
      deltaMoM,
      barWidth: leader > 0 ? (pct / leader) * 100 : 0,
      isLeader: idx === 0,
      color,
    };
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMarketShareData(): UseMarketShareData {
  const supabase = getSupabaseClient();

  // --- Options / datas ---
  const [opcoes, setOpcoes] = useState<Record<string, unknown> | null>(null);
  const datas = useMemo(() => resolverDatas(opcoes ?? {}), [opcoes]);

  // --- Unit mode (share | volume) ---
  // Read ?unit=volume from URL once on mount and seed state. Subsequent
  // changes are user-driven (SegmentedToggle wired below). We don't sync
  // back to the URL — the toggle is local state, the URL param is a
  // deep-link convenience used by the /sales-volumes → /market-share?unit=volume
  // 301 redirect (Frente 4).
  const searchParams = useSearchParams();
  const initialUnitMode: UnitMode =
    searchParams?.get("unit") === "volume" ? "volume" : "share";
  const [unitMode, setUnitMode] = useState<UnitMode>(initialUnitMode);

  // --- UI filter state ---
  const [mode, setMode] = useState<Mode>("Individual");
  const [sliderRange, setSliderRange] = useState<[number, number]>([0, 0]);
  const [regioesSelected, setRegioesSelected] = useState<string[]>([]);
  const [ufsSelected, setUfsSelected] = useState<string[]>([]);
  const [competidoresSelected, setCompetidoresSelected] = useState<string[]>([]);
  const [showToast, setShowToast] = useState(false);

  // --- Applied filters ---
  const [appliedFilters, setAppliedFilters] = useState<AppliedMarketShareFilters>({});

  // --- Series data ---
  const [serieRows, setSerieRows] = useState<MsSerieRow[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<Error | null>(null);
  const fetchIdRef = useRef(0);

  // --- Others players ---
  const [cachedOthersPlayers, setCachedOthersPlayers] = useState<string[]>([]);

  // --- Mobile chart selector state ---
  const [selectedProduct, setSelectedProduct] = useState<ProductKey>("Diesel B");
  const [selectedSegment, setSelectedSegment] = useState<SegmentKey>("Total");

  // --- Mobile Compare set state (players chosen for side-by-side compare) ---
  const [compareSet, setCompareSet] = useState<string[]>([]);

  // --- Export state ---
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<[number, number]>([0, 0]);
  const [exportRegioes, setExportRegioes] = useState<string[]>([]);
  const [exportUfs, setExportUfs] = useState<string[]>([]);
  const [exportMercados, setExportMercados] = useState<string[]>([]);
  const [excelLoading, setExcelLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  // --- Load filter options ---
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const data = await rpcGetMsOpcoesFiltros(supabase);
      if (!cancelled) setOpcoes(data);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // Init slider to full range when datas loads
  useEffect(() => {
    if (!datas || datas.length === 0) return;
    setSliderRange([0, datas.length - 1]);
  }, [datas.length]);

  // Reset competitors on mode change
  useEffect(() => {
    setCompetidoresSelected([]);
  }, [mode]);

  // --- Pre-fetch Others players list ---
  useEffect(() => {
    if (!opcoes || !supabase || cachedOthersPlayers.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const players = await rpcGetOthersPlayers(supabase);
        if (!cancelled) setCachedOthersPlayers(players);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [opcoes, supabase, cachedOthersPlayers.length]);

  // --- Fetch series data when applied filters change ---
  useEffect(() => {
    if (!opcoes || !supabase) return;
    const id = ++fetchIdRef.current;
    setSeriesLoading(true);
    setSeriesError(null);

    const seriesFilters = {
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
          ? await rpcGetMsSerieOthers(supabase, seriesFilters)
          : await rpcGetMsSerieFast(supabase, seriesFilters);
        if (id !== fetchIdRef.current) return;
        setSerieRows(rows ?? []);
        if (isOthers) {
          const seen = new Set<string>();
          for (const r of rows ?? []) if (r.agente_regulado) seen.add(r.agente_regulado);
          setCachedOthersPlayers(Array.from(seen).sort());
        }
        setSeriesLoading(false);
      } catch (e) {
        if (id !== fetchIdRef.current) return;
        setSeriesError(e instanceof Error ? e : new Error(String(e)));
        setSeriesLoading(false);
      }
    })();

    return () => { fetchIdRef.current++; };
  }, [appliedFilters, opcoes, supabase]);

  // --- Derived: Others players ---
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

  // --- Apply / clear ---
  const applyFilters = useCallback(() => {
    if (!datas || datas.length === 0) return;
    const [a, b] = sliderRange;
    const d_inicio = datas[a] ?? null;
    const d_fim = datas[b] ?? null;
    const playersFinal =
      competidoresSelected.length ? competidoresSelected : playersOptions;
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
  }, [datas, sliderRange, competidoresSelected, playersOptions, regioesSelected, ufsSelected, mode]);

  const clearFilters = useCallback(() => {
    setAppliedFilters({});
    setCompetidoresSelected([]);
    setRegioesSelected([]);
    setUfsSelected([]);
  }, []);

  // --- Export modal ---
  const openExportModal = useCallback(() => {
    setExportRegioes(regioesSelected ?? []);
    setExportUfs(ufsSelected ?? []);
    setExportMercados([]);
    setExportRange(sliderRange);
    setExportOpen(true);
  }, [regioesSelected, ufsSelected, sliderRange]);

  const closeExportModal = useCallback(() => setExportOpen(false), []);

  const exportFilters = useMemo<MsExportCountFilters>(() => {
    const [a, b] = exportRange;
    const dataInicio = datas[a] ?? null;
    const dataFim    = datas[b] ?? null;
    return {
      dataInicio,
      dataFim,
      regioes:  exportRegioes.length  ? exportRegioes  : null,
      ufs:      exportUfs.length      ? exportUfs      : null,
      mercados: exportMercados.length ? exportMercados : null,
    };
  }, [exportRange, exportRegioes, exportUfs, exportMercados, datas]);

  // Encapsulates the Supabase client behind a closure so views never touch it.
  const fetchExportCount = useCallback(async (): Promise<number> => {
    if (!supabase) return 0;
    return getMsExportCount(supabase, exportFilters);
  }, [supabase, exportFilters]);

  // Export size estimate (live, debounced 300ms)
  const exportSizeEstimate = useExportSize(
    exportFilters,
    async (f) => {
      if (!supabase) return 0;
      return getMsExportCount(supabase, f);
    },
    "vendas",
  );

  // --- Derived values ---
  const big3 = appliedFilters?.modo_big3 ?? false;
  const appliedMode: Mode = appliedFilters?.modo ?? "Individual";
  const groupBy: "classificacao" | "agente_regulado" =
    appliedMode === "Others" ? "agente_regulado" : "classificacao";

  const appliedPlayersDefault =
    appliedMode === "Big-3" ? ALL_PLAYERS_BIG3 :
    appliedMode === "Others" ? othersPlayers :
    ALL_PLAYERS_IND;

  const players =
    appliedFilters?.competidores && (appliedFilters.competidores as string[]).length > 0
      ? (appliedFilters.competidores as string[])
      : appliedPlayersDefault;

  const xMin = appliedFilters?.data_inicio ?? null;
  const xMax = appliedFilters?.data_fim ?? null;

  // ── Export handlers (own the Supabase client so views stay client-agnostic) ─
  const onExportExcel = useCallback(async () => {
    setExcelLoading(true);
    try {
      await downloadMarketShareExcel(serieRows, players, big3, unitMode);
      setExportOpen(false);
    } catch (e) {
      console.error("Excel export failed", e);
    } finally {
      setExcelLoading(false);
    }
  }, [serieRows, players, big3, unitMode]);

  const onExportCsv = useCallback(async () => {
    if (!supabase) return;
    setCsvLoading(true);
    try {
      const rows = await fetchVendasFiltered(supabase, exportFilters);
      // Filename mirrors the active unit mode so downloads carry the right
      // semantic label — "SalesVolumes" in volume mode, "MarketShare" in share.
      const filename = unitMode === "volume" ? "SalesVolumes" : "MarketShare";
      downloadCsv({ rows, filename });
      setExportOpen(false);
    } catch (e) {
      console.error("CSV export failed", e);
    } finally {
      setCsvLoading(false);
    }
  }, [supabase, exportFilters, unitMode]);

  const latestDate = useMemo(() => {
    if (appliedFilters.data_fim) return appliedFilters.data_fim;
    if (serieRows.length === 0) return null;
    return serieRows.reduce(
      (max, r) => (r.date > max ? r.date : max),
      serieRows[0].date,
    );
  }, [appliedFilters.data_fim, serieRows]);

  const chartColors = useMemo(() => {
    if (big3) return COLORS_BIG3;
    if (appliedMode === "Others")
      return Object.fromEntries(players.map((p, i) => [p, dynColor(i)]));
    return COLORS_IND;
  }, [big3, appliedMode, players]);

  const ottoCycleRows = useMemo(() => makeOttoCycleRows(serieRows), [serieRows]);

  const charts = useMemo<MarketShareCharts | null>(() => {
    if (seriesLoading) return null;
    const common = { players, big3, xMin, xMax, groupBy, colorsOverride: chartColors, unitMode };
    return {
      dieselRetail: buildMarketShareLine({ serieRows, produto: "Diesel B",         segmento: "Retail", ...common }),
      dieselB2B:    buildMarketShareLine({ serieRows, produto: "Diesel B",         segmento: "B2B",    ...common }),
      dieselTrR:    buildMarketShareLine({ serieRows, produto: "Diesel B",         segmento: "TRR",    ...common }),
      dieselTotal:  buildMarketShareLine({ serieRows, produto: "Diesel B",         segmento: null,     ...common }),
      gasRetail:    buildMarketShareLine({ serieRows, produto: "Gasolina C",       segmento: "Retail", ...common }),
      gasB2B:       buildMarketShareLine({ serieRows, produto: "Gasolina C",       segmento: "B2B",    ...common }),
      gasTotal:     buildMarketShareLine({ serieRows, produto: "Gasolina C",       segmento: null,     ...common }),
      ethRetail:    buildMarketShareLine({ serieRows, produto: "Etanol Hidratado", segmento: "Retail", ...common }),
      ethB2B:       buildMarketShareLine({ serieRows, produto: "Etanol Hidratado", segmento: "B2B",    ...common }),
      ethTotal:     buildMarketShareLine({ serieRows, produto: "Etanol Hidratado", segmento: null,     ...common }),
      ottoRetail:   buildMarketShareLine({ serieRows: ottoCycleRows, produto: "Otto-Cycle", segmento: "Retail", ...common }),
      ottoB2B:      buildMarketShareLine({ serieRows: ottoCycleRows, produto: "Otto-Cycle", segmento: "B2B",    ...common }),
      ottoTotal:    buildMarketShareLine({ serieRows: ottoCycleRows, produto: "Otto-Cycle", segmento: null,     ...common }),
    };
  }, [serieRows, ottoCycleRows, players, big3, xMin, xMax, groupBy, chartColors, seriesLoading, unitMode]);

  const compData = useMemo<MarketShareCompData | null>(() => {
    if (!latestDate || seriesLoading) return null;
    return {
      dieselRetail: buildComparisonData(serieRows, "Diesel B", "Retail", players, big3, latestDate, groupBy, unitMode),
      dieselB2B:    buildComparisonData(serieRows, "Diesel B", "B2B", players, big3, latestDate, groupBy, unitMode),
      dieselTrR:    buildComparisonData(serieRows, "Diesel B", "TRR", players, big3, latestDate, groupBy, unitMode),
      dieselTotal:  buildComparisonData(serieRows, "Diesel B", null, players, big3, latestDate, groupBy, unitMode),
      gasRetail:    buildComparisonData(serieRows, "Gasolina C", "Retail", players, big3, latestDate, groupBy, unitMode),
      gasB2B:       buildComparisonData(serieRows, "Gasolina C", "B2B", players, big3, latestDate, groupBy, unitMode),
      gasTotal:     buildComparisonData(serieRows, "Gasolina C", null, players, big3, latestDate, groupBy, unitMode),
      ethRetail:    buildComparisonData(serieRows, "Etanol Hidratado", "Retail", players, big3, latestDate, groupBy, unitMode),
      ethB2B:       buildComparisonData(serieRows, "Etanol Hidratado", "B2B", players, big3, latestDate, groupBy, unitMode),
      ethTotal:     buildComparisonData(serieRows, "Etanol Hidratado", null, players, big3, latestDate, groupBy, unitMode),
      ottoRetail:   buildComparisonData(ottoCycleRows, "Otto-Cycle", "Retail", players, big3, latestDate, groupBy, unitMode),
      ottoB2B:      buildComparisonData(ottoCycleRows, "Otto-Cycle", "B2B", players, big3, latestDate, groupBy, unitMode),
      ottoTotal:    buildComparisonData(ottoCycleRows, "Otto-Cycle", null, players, big3, latestDate, groupBy, unitMode),
    };
  }, [serieRows, ottoCycleRows, players, big3, latestDate, groupBy, seriesLoading, unitMode]);

  const topPlayers = useMemo<TopPlayerRow[]>(() => {
    if (!latestDate || serieRows.length === 0) return [];
    // Use Diesel B Total as the overview product (most representative)
    return buildTopPlayers(serieRows, "Diesel B", latestDate, big3, groupBy, chartColors, 5, unitMode);
  }, [serieRows, latestDate, big3, groupBy, chartColors, unitMode]);

  // ─── Mobile chart selector derivations ─────────────────────────────────────
  // Auto-correct: if the user picked a segment that doesn't exist for the
  // current product (e.g. TRR + Gasolina C), fall back to Total.
  const resolvedSegment: SegmentKey = useMemo(() => {
    const allowed = SEGMENTS_BY_PRODUCT[selectedProduct];
    return allowed.includes(selectedSegment) ? selectedSegment : "Total";
  }, [selectedProduct, selectedSegment]);

  const selectedChartKey: ChartKey = useMemo(() => {
    const key = CHART_KEY_MATRIX[selectedProduct][resolvedSegment];
    // Guaranteed to resolve — every product has Total.
    return key ?? "dieselTotal";
  }, [selectedProduct, resolvedSegment]);

  const activeChart: ChartResult | null = useMemo(() => {
    if (!charts) return null;
    return charts[selectedChartKey];
  }, [charts, selectedChartKey]);

  const activeCompRows: CompRow[] = useMemo(() => {
    if (!compData) return [];
    return compData[selectedChartKey];
  }, [compData, selectedChartKey]);

  // Top players for the currently selected product (mobile overview cards).
  const topPlayersForSelected = useMemo<TopPlayerRow[]>(() => {
    if (!latestDate || serieRows.length === 0) return [];
    const sourceRows = selectedProduct === "Otto-Cycle" ? ottoCycleRows : serieRows;
    return buildTopPlayers(sourceRows, selectedProduct, latestDate, big3, groupBy, chartColors, 5, unitMode);
  }, [serieRows, ottoCycleRows, selectedProduct, latestDate, big3, groupBy, chartColors, unitMode]);

  // ─── Mobile Compare toggle ────────────────────────────────────────────────
  const toggleCompareMember = useCallback((player: string) => {
    setCompareSet((prev) => {
      if (prev.includes(player)) return prev.filter((p) => p !== player);
      // Cap compare set at 3 for readability on mobile.
      if (prev.length >= 3) return prev;
      return [...prev, player];
    });
  }, []);

  // Seed compareSet with the top-3 players on first load (once data arrives).
  useEffect(() => {
    if (compareSet.length > 0) return;
    if (topPlayers.length === 0) return;
    setCompareSet(topPlayers.slice(0, 3).map((p) => p.player));
  }, [topPlayers, compareSet.length]);

  const regioesAll = (opcoes?.regioes ?? []) as string[];
  const ufsAll     = (opcoes?.ufs     ?? []) as string[];
  const mercadosAll = (opcoes?.mercados ?? []) as string[];

  return {
    serieRows,
    ottoCycleRows,
    seriesLoading,
    seriesError,
    opcoes,
    datas,
    regioesAll,
    ufsAll,
    mercadosAll,
    unitMode,
    setUnitMode,
    mode,
    setMode,
    sliderRange,
    setSliderRange,
    regioesSelected,
    setRegioesSelected,
    ufsSelected,
    setUfsSelected,
    competidoresSelected,
    setCompetidoresSelected,
    playersOptions,
    appliedFilters,
    applyFilters,
    clearFilters,
    showToast,
    othersPlayers,
    big3,
    appliedMode,
    players,
    xMin,
    xMax,
    latestDate,
    chartColors,
    charts,
    compData,
    topPlayers,
    selectedProduct,
    setSelectedProduct,
    selectedSegment: resolvedSegment,
    setSelectedSegment,
    selectedChartKey,
    activeChart,
    activeCompRows,
    topPlayersForSelected,
    compareSet,
    setCompareSet,
    toggleCompareMember,
    exportOpen,
    openExportModal,
    closeExportModal,
    exportRange,
    setExportRange,
    exportRegioes,
    setExportRegioes,
    exportUfs,
    setExportUfs,
    exportMercados,
    setExportMercados,
    exportFilters,
    exportSizeEstimate,
    fetchExportCount,
    excelLoading,
    csvLoading,
    onExportExcel,
    onExportCsv,
  };
}
