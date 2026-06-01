"use client";

// THE BRAIN for /anp-glp — LPG Market Share.
//
// Faithful clone of useMarketShareData, retargeted at the anp_glp table via the
// get_anp_glp_ms_* RPC family (migration 20260605000000). Same hook SHAPE so
// both Views (desktop + mobile) are presentation layers over a single brain.
//
// DOMAIN MAPPING (decided by CTO — do NOT change):
//   market-share          →  LPG / GLP
//   ──────────────────────   ──────────────────────────────────────────────
//   player (distribuidora)  →  distribuidora
//   produto (Diesel B/…)    →  categoria (P13 / Outros - GLP / Outros - Especiais)
//   synthetic "Total"       →  synthetic "Total (All LPG)" (sum of all categorias)
//   Otto-Cycle              →  DOES NOT EXIST (removed)
//   segment Retail/B2B/TRR  →  DOES NOT EXIST (segment is constant 'GLP')
//   region / UF filters     →  DO NOT EXIST (removed)
//   Big-3 (hardcoded fuel)  →  Big-3 DYNAMIC = top-3 distributors by LPG volume
//   unit "thousand m³"      →  "thousand t" (vendas_kg / 1e6 → thousand tons)
//
// Owns:
//   - 4 RPC calls (rpcGetAnpGlpMsFiltros, rpcGetAnpGlpMsSerieFast,
//     rpcGetAnpGlpMsSerieOthers, rpcGetAnpGlpMsOthersPlayers)
//   - Filter state (period, mode, competitors) — NO region/UF/segment
//   - Derived charts (one line chart per category), comparison rows, top
//     players, dynamic Big-3 set, export-size estimate.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PlotData, Layout } from "plotly.js";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetAnpGlpMsFiltros,
  rpcGetAnpGlpMsSerieFast,
  rpcGetAnpGlpMsSerieOthers,
  rpcGetAnpGlpMsOthersPlayers,
  getAnpGlpMsExportCount,
  type MsSerieRow,
  type AnpGlpMsFilters,
} from "@/lib/rpc";
import { useExportSize } from "@/hooks/useExportSize";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Group key used for the dynamic Big-3 (top-3 distributors by LPG volume). */
export const BIG3_LABEL = "Big-3";

export const COLORS_BIG3: Record<string, string> = {
  "Big-3": "#1D4080",
  Others: "#A9A9A9",
};

// Neutral palette for Individual mode (LPG players are not the fixed fuel trio,
// so we colour them from a stable discrete sequence keyed by rank).
const PLOTLY_COLORS = [
  "#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
  "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52",
];
export function dynColor(i: number): string {
  return PLOTLY_COLORS[i % PLOTLY_COLORS.length];
}

// Mobile chart palette (leader = brand orange, rest = neutral hues)
export const MOBILE_PALETTE = ["#ff5000", "#3b82f6", "#8b5cf6", "#14b8a6", "#94a3b8"];

export type Mode = "Individual" | "Big-3" | "Others";
export const MODE_OPTIONS: Mode[] = ["Individual", "Big-3", "Others"];

/** Unit mode toggle — % share vs absolute volume in thousand tons. Default: 'share'. */
export type UnitMode = "share" | "volume";

/** Constant single LPG segment — there are no Retail/B2B/TRR splits. */
export const GLP_SEGMENT = "GLP";

// ─── Product (category) types ───────────────────────────────────────────────────

/**
 * Product keys. "Total" is synthetic (sum of all categories), always first.
 * The real categories come from the DB: P13 / Outros - GLP / Outros - Especiais.
 */
export const TOTAL_KEY = "Total";

/** English display label per category (synthetic Total first). */
export const CATEGORY_LABEL: Record<string, string> = {
  Total: "Total (All LPG)",
  P13: "P13 (13 kg cylinder)",
  "Outros - GLP": "Other - LPG",
  "Outros - Especiais": "Other - Special",
};

/** Stable display order for the real categories (anything else appended after). */
const CATEGORY_ORDER = ["P13", "Outros - GLP", "Outros - Especiais"];

export function categoryLabel(cat: string): string {
  return CATEGORY_LABEL[cat] ?? cat;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppliedAnpGlpFilters {
  ano_inicio?: number | null;
  ano_fim?: number | null;
  competidores?: string[] | null;
  modo?: Mode;
  modo_big3?: boolean;
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
  /** MoM delta */
  deltaMoM: number | null;
  /** Relative bar width 0-100 (relative to leader) */
  barWidth: number;
  isLeader: boolean;
  color: string;
}

export type ChartResult = { data: PlotData[]; layout: Partial<Layout> };

export interface UseAnpGlpData {
  // Raw data
  serieRows: MsSerieRow[];
  seriesLoading: boolean;
  seriesError: Error | null;

  // Filter options (from DB)
  opcoes: { distribuidoras: string[]; categorias: string[]; ano_min: number | null; ano_max: number | null } | null;
  /** Year list for the period slider (built from ano_min..ano_max). */
  datas: number[];

  // Unit mode toggle (% Share vs thousand t)
  unitMode: UnitMode;
  setUnitMode: (u: UnitMode) => void;

  // UI filter state (pre-apply)
  mode: Mode;
  setMode: (m: Mode) => void;
  sliderRange: [number, number];
  setSliderRange: (r: [number, number]) => void;
  competidoresSelected: string[];
  setCompetidoresSelected: (c: string[]) => void;
  playersOptions: string[];

  // Applied state
  appliedFilters: AppliedAnpGlpFilters;
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
  /** Dynamic top-3 distributor names (the Big-3 set for LPG). */
  big3Members: string[];
  latestDate: string | null;
  chartColors: Record<string, string>;
  /** Ordered list of products to render: Total first, then real categories. */
  productKeys: string[];
  /** Per-product line chart, keyed by category (incl. synthetic "Total"). */
  charts: Record<string, ChartResult> | null;
  /** Per-product comparison rows, keyed by category. */
  compData: Record<string, CompRow[]> | null;
  /** Top-N players ranked for the mobile overview card (uses Total). */
  topPlayers: TopPlayerRow[];

  // Mobile chart selector — navigates through products (one chart each)
  selectedProduct: string;
  setSelectedProduct: (p: string) => void;
  /** Active chart for the selected product. */
  activeChart: ChartResult | null;
  /** Comparison rows for the selected product. */
  activeCompRows: CompRow[];
  /** Top players ranked for the SELECTED product. */
  topPlayersForSelected: TopPlayerRow[];

  // Mobile Compare set
  compareSet: string[];
  setCompareSet: (players: string[]) => void;
  toggleCompareMember: (player: string) => void;

  // Export (unified library size estimator)
  exportFilters: AnpGlpMsFilters;
  exportSizeEstimate: ReturnType<typeof useExportSize>;
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

/**
 * Build a single Plotly line chart for one LPG category (distributors as lines).
 * Mirrors buildMarketShareLine from useMarketShareData, minus segment filtering
 * (LPG has a single 'GLP' segment) and with thousand-tons units in volume mode.
 *
 * @param big3Members  the dynamic top-3 distributor names — when `big3`, every
 *                      member is collapsed into a single "Big-3" line.
 */
export function buildAnpGlpLine(params: {
  serieRows: MsSerieRow[];
  produto: string;
  players: string[];
  big3: boolean;
  big3Members: string[];
  groupBy?: "classificacao" | "agente_regulado";
  colorsOverride?: Record<string, string>;
  unitMode?: UnitMode;
}): ChartResult {
  const {
    serieRows,
    produto,
    players,
    big3,
    big3Members,
    groupBy = "classificacao",
    colorsOverride,
    unitMode = "share",
  } = params;
  if (!serieRows || serieRows.length === 0) return emptyPlot(300);

  const rows = serieRows.filter((r) => r.nome_produto === produto);
  if (rows.length === 0) return emptyPlot(300);

  const groupMap = new Map<string, number>();
  for (const r of rows) {
    let classificacao =
      groupBy === "agente_regulado"
        ? (r.agente_regulado ?? r.classificacao)
        : r.classificacao;
    if (big3 && groupBy !== "agente_regulado")
      classificacao = big3Members.includes(classificacao) ? BIG3_LABEL : classificacao;
    const dateKey = String(r.date);
    const key = `${dateKey}|${classificacao}`;
    groupMap.set(key, (groupMap.get(key) ?? 0) + Number(r.quantidade ?? 0));
  }

  const totalByDate = new Map<string, number>();
  for (const [key, qty] of groupMap.entries()) {
    const [dateKey] = key.split("|");
    totalByDate.set(dateKey, (totalByDate.get(dateKey) ?? 0) + qty);
  }

  // y = percentage (share) OR absolute thousand-tons (volume = vendas_kg / 1e6).
  const grouped: Array<{ date: string; classificacao: string; y: number }> = [];
  for (const [key, qty] of groupMap.entries()) {
    const [date, classificacao] = key.split("|");
    if (!players.includes(classificacao)) continue;
    if (unitMode === "share") {
      const total = totalByDate.get(date) ?? 0;
      if (total <= 0) continue;
      grouped.push({ date, classificacao, y: (qty / total) * 100 });
    } else {
      grouped.push({ date, classificacao, y: qty / 1e6 });
    }
  }

  if (grouped.length === 0) return emptyPlot(300);

  grouped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const yVals = grouped.map((g) => g.y);
  const yMin = Math.min(...yVals);
  const yMax = Math.max(...yVals);
  const spread = yMax - yMin > 0 ? yMax - yMin : 1.0;
  const pad = spread * 0.2;
  const yLo = Math.max(0, yMin - pad);
  const yHi = unitMode === "share" ? Math.min(100, yMax + pad) : yMax + pad;

  const ultimaData = grouped[grouped.length - 1].date;
  const colorsMap = colorsOverride ?? (big3 ? COLORS_BIG3 : {});

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

  const fmtAnnot = (v: number): string =>
    unitMode === "share" ? `${v.toFixed(1)}%` : v.toFixed(1);
  const hoverTpl =
    unitMode === "share"
      ? "%{fullData.name}: %{y:.1f}%<extra></extra>"
      : "%{fullData.name}: %{y:.1f}<extra></extra>";

  players.forEach((player, pIdx) => {
    const series = grouped.filter((g) => g.classificacao === player);
    if (series.length === 0) return;
    const color = colorsMap[player] ?? dynColor(pIdx);
    traces.push({
      type: "scatter",
      mode: "lines",
      x: series.map((s) => s.date),
      y: series.map((s) => s.y),
      name: player,
      line: { width: 2.5, color },
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
        font: { family: "Arial", size: 12, color },
      });
    }
  });

  // Anti-overlap pass on end-of-line annotations (same algorithm as MS).
  if (annotations.length > 1) {
    const axisSpan = yHi - yLo > 0 ? yHi - yLo : 1.0;
    const pixelGap = axisSpan * 0.076;
    const floorGap = unitMode === "share" ? 1.6 : axisSpan * 0.04;
    const minGap = Math.max(pixelGap, floorGap);

    const items = annotations.map((a, i) => ({ i, original: a.y, y: a.y }));
    items.sort((a, b) => a.original - b.original);

    for (let pass = 0; pass < 4; pass++) {
      items[0].y = Math.max(items[0].original, yLo);
      for (let k = 1; k < items.length; k++) {
        const minY = items[k - 1].y + minGap;
        items[k].y = Math.max(items[k].original, minY);
      }
      const top = items[items.length - 1].y;
      if (top <= yHi) break;
      items[items.length - 1].y = yHi;
      for (let k = items.length - 2; k >= 0; k--) {
        const maxY = items[k + 1].y - minGap;
        items[k].y = Math.min(items[k].original, maxY);
        if (items[k].y < yLo) items[k].y = yLo;
      }
    }
    for (const it of items) annotations[it.i].y = it.y;
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
          title: { text: "Volume (thousand t)" },
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
      range: [dataMin, dataMax],
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

/**
 * Synthetic "Total (All LPG)" product = sum of all real categories.
 * One copy per raw row tagged nome_produto:"Total"; downstream grouping
 * (buildAnpGlpLine / getMsAtDate) aggregates by (date, classificacao).
 */
export function makeTotalRows(rows: MsSerieRow[]): MsSerieRow[] {
  return rows.map((r) => ({ ...r, nome_produto: TOTAL_KEY }));
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
  date: string,
  big3: boolean,
  big3Members: string[],
  groupBy: "classificacao" | "agente_regulado" = "classificacao",
  unitMode: UnitMode = "share",
): Map<string, number> {
  const filtered = rows.filter((r) => r.nome_produto === produto && r.date === date);
  const grp = new Map<string, number>();
  for (const r of filtered) {
    let cls =
      groupBy === "agente_regulado"
        ? (r.agente_regulado ?? r.classificacao)
        : r.classificacao;
    if (big3 && groupBy !== "agente_regulado")
      cls = big3Members.includes(cls) ? BIG3_LABEL : cls;
    grp.set(cls, (grp.get(cls) ?? 0) + Number(r.quantidade ?? 0));
  }
  if (unitMode === "volume") {
    // Absolute thousand-tons per player.
    const result = new Map<string, number>();
    for (const [cls, qty] of grp) result.set(cls, qty / 1e6);
    return result;
  }
  const total = Array.from(grp.values()).reduce((a, b) => a + b, 0);
  if (total <= 0) return new Map();
  const result = new Map<string, number>();
  for (const [cls, qty] of grp) result.set(cls, (qty / total) * 100);
  return result;
}

export function buildComparisonData(
  rows: MsSerieRow[],
  produto: string,
  players: string[],
  big3: boolean,
  big3Members: string[],
  latestDate: string,
  groupBy: "classificacao" | "agente_regulado" = "classificacao",
  unitMode: UnitMode = "share",
): CompRow[] {
  const prevYearDec = `${parseInt(latestDate.slice(0, 4), 10) - 1}-12-01`;
  const msNow = getMsAtDate(rows, produto, latestDate, big3, big3Members, groupBy, unitMode);
  const msMoM = getMsAtDate(rows, produto, shiftMonth(latestDate, -1), big3, big3Members, groupBy, unitMode);
  const ms3M  = getMsAtDate(rows, produto, shiftMonth(latestDate, -3), big3, big3Members, groupBy, unitMode);
  const msYoY = getMsAtDate(rows, produto, shiftMonth(latestDate, -12), big3, big3Members, groupBy, unitMode);
  const msYtd = getMsAtDate(rows, produto, prevYearDec, big3, big3Members, groupBy, unitMode);
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

function buildTopPlayers(
  rows: MsSerieRow[],
  produto: string,
  latestDate: string,
  big3: boolean,
  big3Members: string[],
  groupBy: "classificacao" | "agente_regulado",
  chartColors: Record<string, string>,
  topN = 5,
  unitMode: UnitMode = "share",
): TopPlayerRow[] {
  const msNow = getMsAtDate(rows, produto, latestDate, big3, big3Members, groupBy, unitMode);
  const msMoM = getMsAtDate(rows, produto, shiftMonth(latestDate, -1), big3, big3Members, groupBy, unitMode);
  if (msNow.size === 0) return [];

  const entries = Array.from(msNow.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  const leader = entries[0]?.[1] ?? 1;

  return entries.map(([player, pct], idx) => {
    const prevPct = msMoM.get(player);
    const deltaMoM = prevPct !== undefined ? pct - prevPct : null;
    const color = chartColors[player] ?? MOBILE_PALETTE[idx % MOBILE_PALETTE.length];
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

export function useAnpGlpData(): UseAnpGlpData {
  const supabase = getSupabaseClient();

  // --- Options ---
  const [opcoes, setOpcoes] = useState<UseAnpGlpData["opcoes"]>(null);

  // Year list for the slider (ano_min..ano_max inclusive).
  const datas = useMemo<number[]>(() => {
    if (!opcoes || opcoes.ano_min == null || opcoes.ano_max == null) return [];
    const out: number[] = [];
    for (let y = opcoes.ano_min; y <= opcoes.ano_max; y++) out.push(y);
    return out;
  }, [opcoes]);

  // --- Unit mode (share | volume) ---
  const [unitMode, setUnitMode] = useState<UnitMode>("share");

  // --- UI filter state ---
  const [mode, setMode] = useState<Mode>("Individual");
  const [sliderRange, setSliderRange] = useState<[number, number]>([0, 0]);
  const [competidoresSelected, setCompetidoresSelected] = useState<string[]>([]);
  const [showToast, setShowToast] = useState(false);

  // --- Applied filters ---
  const [appliedFilters, setAppliedFilters] = useState<AppliedAnpGlpFilters>({});

  // --- Series data ---
  const [serieRows, setSerieRows] = useState<MsSerieRow[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<Error | null>(null);
  const fetchIdRef = useRef(0);

  // --- Ranked distributor list (drives dynamic Big-3 + Others players) ---
  const [rankedPlayers, setRankedPlayers] = useState<string[]>([]);

  // --- Others players (from Others-mode series) ---
  const [cachedOthersPlayers, setCachedOthersPlayers] = useState<string[]>([]);

  // --- Mobile chart selector state ---
  const [selectedProduct, setSelectedProduct] = useState<string>(TOTAL_KEY);

  // --- Mobile Compare set state ---
  const [compareSet, setCompareSet] = useState<string[]>([]);

  // --- Load filter options ---
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const data = await rpcGetAnpGlpMsFiltros(supabase);
      if (!cancelled) setOpcoes(data);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // Init slider to full range when datas loads
  useEffect(() => {
    if (!datas || datas.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot sync of slider to loaded option bounds (mirrors useMarketShareData)
    setSliderRange([0, datas.length - 1]);
  }, [datas.length]);

  // Reset competitors on mode change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset of dependent selection when the view mode changes
    setCompetidoresSelected([]);
  }, [mode]);

  // --- Pre-fetch ranked distributor list (Big-3 + Others source) ---
  useEffect(() => {
    if (!opcoes || !supabase || rankedPlayers.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const ranked = await rpcGetAnpGlpMsOthersPlayers(supabase);
        if (!cancelled) setRankedPlayers(ranked.map((r) => r.distribuidora));
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [opcoes, supabase, rankedPlayers.length]);

  // --- Dynamic Big-3 = top-3 distributors by LPG volume ---
  const big3Members = useMemo(() => rankedPlayers.slice(0, 3), [rankedPlayers]);

  // Individual mode default: cap to the top-N distributors by volume so charts
  // stay legible (LPG has 30+ distributors). Users can still pick any others
  // via the Competitors filter. Mirrors the bounded player set of /market-share.
  const INDIVIDUAL_TOP_N = 8;
  const individualDefaults = useMemo(
    () => rankedPlayers.slice(0, INDIVIDUAL_TOP_N),
    [rankedPlayers],
  );

  // --- Fetch series data when applied filters change ---
  useEffect(() => {
    if (!opcoes || !supabase) return;
    const id = ++fetchIdRef.current;
    /* eslint-disable react-hooks/set-state-in-effect -- loading flags toggled around an async RPC fetch (data-sync effect) */
    setSeriesLoading(true);
    setSeriesError(null);
    /* eslint-enable react-hooks/set-state-in-effect */

    const baseFilters: AnpGlpMsFilters = {
      distribuidoras: null,
      categorias: null,
      anoInicio: appliedFilters?.ano_inicio ?? null,
      anoFim: appliedFilters?.ano_fim ?? null,
    };

    const isOthers = (appliedFilters?.modo as string) === "Others";

    (async () => {
      try {
        const rows = isOthers
          ? await rpcGetAnpGlpMsSerieOthers(supabase, {
              ...baseFilters,
              // Others = distributors OUTSIDE the dynamic top-3 set.
              excluirDistribuidoras: big3Members,
            })
          : await rpcGetAnpGlpMsSerieFast(supabase, baseFilters);
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
  }, [appliedFilters, opcoes, supabase, big3Members]);

  // --- Derived: Others players ---
  const othersPlayers = useMemo(() => {
    const seen = new Set<string>();
    for (const r of serieRows) if (r.agente_regulado) seen.add(r.agente_regulado);
    const fromData = Array.from(seen).sort();
    return fromData.length > 0 ? fromData : cachedOthersPlayers;
  }, [serieRows, cachedOthersPlayers]);

  // Individual mode: offer ALL distributors as selectable options (ranked by
  // volume); the default applied set (when none chosen) is the top-N.
  const playersOptions =
    mode === "Big-3" ? [BIG3_LABEL, "Others"] :
    mode === "Others" ? othersPlayers :
    rankedPlayers;

  // --- Apply / clear ---
  const applyFilters = useCallback(() => {
    if (!datas || datas.length === 0) return;
    const [a, b] = sliderRange;
    const ano_inicio = datas[a] ?? null;
    const ano_fim = datas[b] ?? null;
    const playersFinal =
      competidoresSelected.length ? competidoresSelected : playersOptions;
    setAppliedFilters({
      ano_inicio,
      ano_fim,
      competidores: playersFinal,
      modo_big3: mode === "Big-3",
      modo: mode,
    });
    setShowToast(true);
    window.setTimeout(() => setShowToast(false), 2500);
  }, [datas, sliderRange, competidoresSelected, playersOptions, mode]);

  const clearFilters = useCallback(() => {
    setAppliedFilters({});
    setCompetidoresSelected([]);
  }, []);

  // --- Export filters + size estimate ---
  const exportFilters = useMemo<AnpGlpMsFilters>(() => {
    const [a, b] = sliderRange;
    return {
      distribuidoras: null,
      categorias: null,
      anoInicio: datas[a] ?? null,
      anoFim: datas[b] ?? null,
    };
  }, [sliderRange, datas]);

  const exportSizeEstimate = useExportSize(
    exportFilters,
    async (f) => {
      if (!supabase) return 0;
      return getAnpGlpMsExportCount(supabase, f);
    },
    "anp_glp",
  );

  // --- Derived values ---
  const big3 = appliedFilters?.modo_big3 ?? false;
  const appliedMode: Mode = appliedFilters?.modo ?? "Individual";
  const groupBy: "classificacao" | "agente_regulado" =
    appliedMode === "Others" ? "agente_regulado" : "classificacao";

  const appliedPlayersDefault =
    appliedMode === "Big-3" ? [BIG3_LABEL, "Others"] :
    appliedMode === "Others" ? othersPlayers :
    individualDefaults;

  const players =
    appliedFilters?.competidores && (appliedFilters.competidores as string[]).length > 0
      ? (appliedFilters.competidores as string[])
      : appliedPlayersDefault;

  const latestDate = useMemo(() => {
    if (serieRows.length === 0) return null;
    return serieRows.reduce(
      (max, r) => (r.date > max ? r.date : max),
      serieRows[0].date,
    );
  }, [serieRows]);

  const chartColors = useMemo(() => {
    if (big3) return COLORS_BIG3;
    // Colour each player by its rank position (stable across renders).
    const map: Record<string, string> = {};
    players.forEach((p, i) => { map[p] = dynColor(i); });
    return map;
  }, [big3, players]);

  const totalRows = useMemo(() => makeTotalRows(serieRows), [serieRows]);

  // Product (category) order: Total first, then known categories, then any extras.
  const productKeys = useMemo<string[]>(() => {
    const cats = new Set<string>();
    for (const r of serieRows) if (r.nome_produto) cats.add(r.nome_produto);
    const ordered = CATEGORY_ORDER.filter((c) => cats.has(c));
    const extras = Array.from(cats).filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return [TOTAL_KEY, ...ordered, ...extras];
  }, [serieRows]);

  const charts = useMemo<Record<string, ChartResult> | null>(() => {
    if (seriesLoading) return null;
    const common = { players, big3, big3Members, groupBy, colorsOverride: chartColors, unitMode };
    const out: Record<string, ChartResult> = {};
    for (const p of productKeys) {
      const src = p === TOTAL_KEY ? totalRows : serieRows;
      out[p] = buildAnpGlpLine({ serieRows: src, produto: p, ...common });
    }
    return out;
  }, [serieRows, totalRows, productKeys, players, big3, big3Members, groupBy, chartColors, seriesLoading, unitMode]);

  const compData = useMemo<Record<string, CompRow[]> | null>(() => {
    if (!latestDate || seriesLoading) return null;
    const out: Record<string, CompRow[]> = {};
    for (const p of productKeys) {
      const src = p === TOTAL_KEY ? totalRows : serieRows;
      out[p] = buildComparisonData(src, p, players, big3, big3Members, latestDate, groupBy, unitMode);
    }
    return out;
  }, [serieRows, totalRows, productKeys, players, big3, big3Members, latestDate, groupBy, seriesLoading, unitMode]);

  const topPlayers = useMemo<TopPlayerRow[]>(() => {
    if (!latestDate || serieRows.length === 0) return [];
    return buildTopPlayers(totalRows, TOTAL_KEY, latestDate, big3, big3Members, groupBy, chartColors, 5, unitMode);
  }, [serieRows, totalRows, latestDate, big3, big3Members, groupBy, chartColors, unitMode]);

  // ─── Mobile chart selector derivations ─────────────────────────────────────
  // Keep selectedProduct valid as productKeys changes.
  useEffect(() => {
    if (productKeys.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep selected product valid as the category list loads/changes
    if (!productKeys.includes(selectedProduct)) setSelectedProduct(productKeys[0]);
  }, [productKeys, selectedProduct]);

  const activeChart: ChartResult | null = useMemo(() => {
    if (!charts) return null;
    return charts[selectedProduct] ?? charts[TOTAL_KEY] ?? null;
  }, [charts, selectedProduct]);

  const activeCompRows: CompRow[] = useMemo(() => {
    if (!compData) return [];
    return compData[selectedProduct] ?? compData[TOTAL_KEY] ?? [];
  }, [compData, selectedProduct]);

  const topPlayersForSelected = useMemo<TopPlayerRow[]>(() => {
    if (!latestDate || serieRows.length === 0) return [];
    const sourceRows = selectedProduct === TOTAL_KEY ? totalRows : serieRows;
    return buildTopPlayers(sourceRows, selectedProduct, latestDate, big3, big3Members, groupBy, chartColors, 5, unitMode);
  }, [serieRows, totalRows, selectedProduct, latestDate, big3, big3Members, groupBy, chartColors, unitMode]);

  // ─── Mobile Compare toggle ────────────────────────────────────────────────
  const toggleCompareMember = useCallback((player: string) => {
    setCompareSet((prev) => {
      if (prev.includes(player)) return prev.filter((p) => p !== player);
      if (prev.length >= 3) return prev;
      return [...prev, player];
    });
  }, []);

  useEffect(() => {
    if (compareSet.length > 0) return;
    if (topPlayers.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot seed of the mobile compare set with the top-3 players
    setCompareSet(topPlayers.slice(0, 3).map((p) => p.player));
  }, [topPlayers, compareSet.length]);

  return {
    serieRows,
    seriesLoading,
    seriesError,
    opcoes,
    datas,
    unitMode,
    setUnitMode,
    mode,
    setMode,
    sliderRange,
    setSliderRange,
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
    big3Members,
    latestDate,
    chartColors,
    productKeys,
    charts,
    compData,
    topPlayers,
    selectedProduct,
    setSelectedProduct,
    activeChart,
    activeCompRows,
    topPlayersForSelected,
    compareSet,
    setCompareSet,
    toggleCompareMember,
    exportFilters,
    exportSizeEstimate,
  };
}
