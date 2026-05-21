"use client";

// ─── Sales Volumes — shared data hook ────────────────────────────────────────
//
// Single source of truth for /sales-volumes (dual-view pattern).
// Both desktop/View.tsx and mobile/View.tsx consume this hook exclusively.
// Neither View calls Supabase or imports rpc.ts directly.
//
// RPCs consumed (all wrappers are in src/lib/rpc.ts):
//   rpcGetSvOpcoesFiltros  — get_sv_opcoes_filtros  (own)
//   rpcGetSvSerieFast      — get_sv_serie_fast       (own)
//   rpcGetSvSerieOthers    — get_sv_serie_others     (own)
//   rpcGetSvOthersPlayers  — get_sv_others_players   (own)
//   getMsExportCount       — get_ms_export_count     (shared w/ /market-share)
//   fetchVendasFiltered    — SELECT vendas …         (shared w/ /market-share)
//
// Note (pegadinha #5): /sales-volumes uses get_sv_* for series; both
// /sales-volumes and /market-share share get_ms_export_count for the modal
// size estimate.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolverDatas } from "@/lib/filterUtils";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetSvOpcoesFiltros,
  rpcGetSvSerieFast,
  rpcGetSvSerieOthers,
  rpcGetSvOthersPlayers,
  getMsExportCount,
  fetchVendasFiltered,
  type MarketShareFilters,
  type MsSerieRow,
  type MsExportCountFilters,
} from "@/lib/rpc";
import { downloadSalesVolumesExcel } from "@/lib/exportExcel";
import { downloadCsv } from "@/lib/exportCsv";

// ─── Constants ────────────────────────────────────────────────────────────────

export const BIG3_MEMBERS = ["Vibra", "Ipiranga", "Raizen"] as const;

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

// Plotly discrete colour sequence for dynamic "Others" mode.
export const PLOTLY_COLORS = [
  "#636EFA","#EF553B","#00CC96","#AB63FA","#FFA15A",
  "#19D3F3","#FF6692","#B6E880","#FF97FF","#FECB52",
];
export function dynColor(i: number): string {
  return PLOTLY_COLORS[i % PLOTLY_COLORS.length];
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type SvMode = "Individual" | "Big-3" | "Others";
export const SV_MODE_OPTIONS: SvMode[] = ["Individual", "Big-3", "Others"];

/** Segment filter applied to a product (used by mobile segment selector and
 *  desktop's per-segment chart grid). "Total" means all segments combined. */
export type SvSegment = "Total" | "Retail" | "B2B" | "TRR";
export const SV_SEGMENT_OPTIONS: SvSegment[] = ["Total", "Retail", "B2B", "TRR"];

/** Comparison row shared between desktop ComparisonTable and mobile Trends tab.
 *  Values are absolute deltas in thousand m³ (not percentages). */
export interface SvCompRow {
  player: string;
  /** Month-over-Month delta (latest − prior month). */
  mom: number | null;
  /** Quarter-to-date delta (latest − 3 months ago). */
  q3m: number | null;
  /** Year-over-Year delta (latest − 12 months ago). */
  yoy: number | null;
  /** Year-to-Date delta (latest − December of previous year). */
  ytd: number | null;
}

export interface SalesVolumesFilters {
  /** ISO date string (YYYY-MM-DD) or null */
  dataInicio: string | null;
  dataFim: string | null;
  regioes: string[];
  ufs: string[];
  mercados: string[];
  competidores: string[];
  mode: SvMode;
  modoBig3: boolean;
}

// Filters used in the export modal (separate from the chart filters so the
// user can tweak them independently inside the modal).
export interface SalesVolumesExportFilters {
  dataInicio: string | null;
  dataFim: string | null;
  regioes: string[];
  ufs: string[];
  mercados: string[];
}

export interface UseSalesVolumesData {
  // ── Data ────────────────────────────────────────────────────────────────────
  serieRows: MsSerieRow[];
  opcoes: Record<string, unknown> | null;
  datas: string[];
  /** Date strings (ISO) available for the period slider. */
  seriesLoading: boolean;
  error: Error | null;

  // ── Derived state (hook computes, Views just read) ──────────────────────────
  ottoCycleRows: MsSerieRow[];
  othersPlayers: string[];
  /** Players array for the current mode (computed from filters). */
  players: string[];
  /** Chart color map for current mode + players. */
  chartColors: Record<string, string>;
  groupBy: "classificacao" | "agente_regulado";
  big3: boolean;
  latestDate: string | null;

  // ── Filter options (from opcoes) ────────────────────────────────────────────
  regioesAll: string[];
  ufsAll: string[];
  mercadosAll: string[];

  // ── UI-facing filter state (staged, not applied) ─────────────────────────────
  /** Staged (not yet applied) filter state. Views control the slider/lists. */
  sliderRange: [number, number];
  setSliderRange: (r: [number, number]) => void;
  mode: SvMode;
  setMode: (m: SvMode) => void;
  competidoresSelected: string[];
  setCompetidoresSelected: (v: string[]) => void;
  regioesSelected: string[];
  setRegioesSelected: (v: string[]) => void;
  ufsSelected: string[];
  setUfsSelected: (v: string[]) => void;

  // ── Segment selector (consumed by mobile segment tab bar) ───────────────────
  /** Active segment (Total / Retail / B2B / TRR). Default "Total". */
  selectedSegment: SvSegment;
  setSelectedSegment: (s: SvSegment) => void;
  /** Helper exposed for callers that need segment-aware filtering on a row set.
   *  Returns null when segment === "Total" (no filter), else the segment string
   *  to filter on (matches `MsSerieRow.segmento`). */
  segmentFilter: string | null;

  // ── Applied filters (after "Apply" is clicked) ───────────────────────────────
  appliedFilters: Partial<SalesVolumesFilters>;

  // ── Actions ─────────────────────────────────────────────────────────────────
  applyFilters: () => void;
  clearFilters: () => void;

  // ── Export modal ──────────────────────────────────────────────────────────────
  exportOpen: boolean;
  openExportModal: () => void;
  closeExportModal: () => void;
  exportRange: [number, number];
  setExportRange: (r: [number, number]) => void;
  exportRegioes: string[];
  setExportRegioes: (v: string[]) => void;
  exportUfs: string[];
  setExportUfs: (v: string[]) => void;
  exportMercados: string[];
  setExportMercados: (v: string[]) => void;
  exportFilters: MsExportCountFilters;
  /** Fetches the count for the ExportModal size calculator. */
  fetchExportCount: () => Promise<number>;
  excelLoading: boolean;
  csvLoading: boolean;
  onExportExcel: () => Promise<void>;
  onExportCsv: () => Promise<void>;

  // ── Toast ────────────────────────────────────────────────────────────────────
  showToast: boolean;

  // ── Comparison rows (shared between desktop ComparisonTable & mobile Trends)
  /** Builds MoM/QTD/YoY/YTD delta rows for the given product/segment using the
   *  hook's currently applied state (players, big3, latestDate, groupBy). */
  buildComparisonRows: (
    rowsOverride: MsSerieRow[] | undefined,
    produto: string,
    segmento: string | null,
  ) => SvCompRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Constructs Otto-Cycle rows by combining Gasolina C + Etanol Hidratado * 0.7. */
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

/** Shift an ISO date `YYYY-MM-01` by n months (handles year wrap). */
export function shiftMonth(dateStr: string, n: number): string {
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(5, 7), 10) - 1 + n;
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, "0")}-01`;
}

/** Returns a Map<classificacao, volume> for the given product/segment/date,
 *  honouring the Big-3 grouping and the active groupBy. Used by both the
 *  desktop ComparisonTable and the mobile Trends tab. */
export function getSvAtDate(
  rows: MsSerieRow[],
  produto: string,
  segmento: string | null,
  date: string,
  big3: boolean,
  groupBy: "classificacao" | "agente_regulado" = "classificacao",
): Map<string, number> {
  let filtered = rows.filter(
    (r) => r.nome_produto === produto && r.date === date,
  );
  if (segmento) filtered = filtered.filter((r) => r.segmento === segmento);
  const grp = new Map<string, number>();
  for (const r of filtered) {
    let cls =
      groupBy === "agente_regulado"
        ? (r.agente_regulado ?? r.classificacao)
        : r.classificacao;
    if (big3 && groupBy !== "agente_regulado")
      cls = (BIG3_MEMBERS as readonly string[]).includes(cls) ? "Big-3" : cls;
    grp.set(cls, (grp.get(cls) ?? 0) + Number(r.quantidade ?? 0));
  }
  return grp;
}

/** Build comparison delta rows (MoM / QTD / YoY / YTD) for a given product +
 *  segment. Pure function — used by both desktop ComparisonTable and mobile
 *  Trends tab so the analysis is identical. */
export function buildSvComparisonData(
  rows: MsSerieRow[],
  produto: string,
  segmento: string | null,
  players: string[],
  big3: boolean,
  latestDate: string,
  groupBy: "classificacao" | "agente_regulado" = "classificacao",
): SvCompRow[] {
  const prevYearDec = `${parseInt(latestDate.slice(0, 4), 10) - 1}-12-01`;
  const volNow = getSvAtDate(rows, produto, segmento, latestDate, big3, groupBy);
  const volMoM = getSvAtDate(rows, produto, segmento, shiftMonth(latestDate, -1), big3, groupBy);
  const vol3M  = getSvAtDate(rows, produto, segmento, shiftMonth(latestDate, -3), big3, groupBy);
  const volYoY = getSvAtDate(rows, produto, segmento, shiftMonth(latestDate, -12), big3, groupBy);
  const volYtd = getSvAtDate(rows, produto, segmento, prevYearDec, big3, groupBy);
  const delta = (a: Map<string, number>, b: Map<string, number>, p: string): number | null => {
    const va = a.get(p);
    const vb = b.get(p);
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

/** Returns a Map<player, totalVolume> for the given product/segment using the
 *  latest available date. Used by the mobile ranking cards. */
export function computeTopPlayers(
  rows: MsSerieRow[],
  produto: string,
  segmento: string | null,
  latestDate: string,
  big3: boolean,
  groupBy: "classificacao" | "agente_regulado",
): Array<{ player: string; volume: number }> {
  let filtered = rows.filter(
    (r) => r.nome_produto === produto && r.date === latestDate,
  );
  if (segmento) filtered = filtered.filter((r) => r.segmento === segmento);

  const grp = new Map<string, number>();
  for (const r of filtered) {
    let cls =
      groupBy === "agente_regulado"
        ? (r.agente_regulado ?? r.classificacao)
        : r.classificacao;
    if (big3 && groupBy !== "agente_regulado")
      cls = (BIG3_MEMBERS as readonly string[]).includes(cls) ? "Big-3" : cls;
    grp.set(cls, (grp.get(cls) ?? 0) + Number(r.quantidade ?? 0));
  }

  return Array.from(grp.entries())
    .map(([player, volume]) => ({ player, volume }))
    .sort((a, b) => b.volume - a.volume);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSalesVolumesData(): UseSalesVolumesData {
  const supabase = getSupabaseClient();

  // ── Filter options (from RPC) ──────────────────────────────────────────────
  const [opcoes, setOpcoes] = useState<Record<string, unknown> | null>(null);
  const datas = useMemo(() => resolverDatas(opcoes ?? {}), [opcoes]);

  // ── Staged filter UI state ──────────────────────────────────────────────────
  const [mode, setModeState] = useState<SvMode>("Individual");
  const [competidoresSelected, setCompetidoresSelected] = useState<string[]>([]);
  const [regioesSelected, setRegioesSelected] = useState<string[]>([]);
  const [ufsSelected, setUfsSelected] = useState<string[]>([]);
  const [sliderRange, setSliderRange] = useState<[number, number]>([0, 0]);

  // ── Segment selector (used by mobile View; defaults to Total which
  //    matches the desktop "all segments combined" behaviour) ───────────────
  const [selectedSegment, setSelectedSegment] = useState<SvSegment>("Total");
  const segmentFilter: string | null =
    selectedSegment === "Total" ? null : selectedSegment;

  // ── Applied filters (what the data hooks actually use) ─────────────────────
  const [appliedFilters, setAppliedFilters] = useState<Partial<SalesVolumesFilters>>({});

  // ── Series data ────────────────────────────────────────────────────────────
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [serieRows, setSerieRows] = useState<MsSerieRow[]>([]);
  const [cachedOthersPlayers, setCachedOthersPlayers] = useState<string[]>([]);
  const fetchIdRef = useRef(0);

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [showToast, setShowToast] = useState(false);

  // ── Export modal ───────────────────────────────────────────────────────────
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<[number, number]>([0, 0]);
  const [exportRegioes, setExportRegioes] = useState<string[]>([]);
  const [exportUfs, setExportUfs] = useState<string[]>([]);
  const [exportMercados, setExportMercados] = useState<string[]>([]);
  const [excelLoading, setExcelLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  // ── Load filter options once ───────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    void (async () => {
      const data = await rpcGetSvOpcoesFiltros(supabase);
      if (!cancelled) setOpcoes(data);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // Initialise slider when datas loads.
  useEffect(() => {
    if (!datas || datas.length === 0) return;
    setSliderRange([0, datas.length - 1]);
  }, [datas.length]);

  // Reset competitors when mode changes.
  const setMode = useCallback((m: SvMode) => {
    setModeState(m);
    setCompetidoresSelected([]);
  }, []);

  // ── Load series on appliedFilters change ──────────────────────────────────
  useEffect(() => {
    if (!opcoes || !supabase) return;
    const id = ++fetchIdRef.current;
    setSeriesLoading(true);
    setError(null);

    const seriesFilters: MarketShareFilters = {
      data_inicio: appliedFilters?.dataInicio ?? null,
      data_fim: appliedFilters?.dataFim ?? null,
      regioes: appliedFilters?.regioes ?? [],
      ufs: appliedFilters?.ufs ?? [],
      mercados: appliedFilters?.mercados ?? [],
    };

    const isOthers = appliedFilters?.mode === "Others";
    void (async () => {
      try {
        const rows = isOthers
          ? await rpcGetSvSerieOthers(supabase, seriesFilters)
          : await rpcGetSvSerieFast(supabase, seriesFilters);
        if (id !== fetchIdRef.current) return;
        setSerieRows(rows ?? []);
        if (isOthers) {
          const seen = new Set<string>();
          for (const r of rows ?? []) if (r.agente_regulado) seen.add(r.agente_regulado);
          setCachedOthersPlayers(Array.from(seen).sort());
        }
      } catch (err: unknown) {
        if (id !== fetchIdRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (id === fetchIdRef.current) setSeriesLoading(false);
      }
    })();

    return () => { fetchIdRef.current = id; };
  }, [appliedFilters, opcoes, supabase]);

  // Pre-fetch Others player list on first load.
  useEffect(() => {
    if (!opcoes || !supabase || cachedOthersPlayers.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const players = await rpcGetSvOthersPlayers(supabase);
        if (!cancelled) setCachedOthersPlayers(players);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [opcoes, supabase, cachedOthersPlayers.length]);

  // ── Derived values ────────────────────────────────────────────────────────
  const othersPlayers = useMemo(() => {
    const seen = new Set<string>();
    for (const r of serieRows) if (r.agente_regulado) seen.add(r.agente_regulado);
    const fromData = Array.from(seen).sort();
    return fromData.length > 0 ? fromData : cachedOthersPlayers;
  }, [serieRows, cachedOthersPlayers]);

  const big3 = appliedFilters?.modoBig3 ?? false;
  const appliedMode: SvMode = appliedFilters?.mode ?? "Individual";
  const groupBy: "classificacao" | "agente_regulado" =
    appliedMode === "Others" ? "agente_regulado" : "classificacao";

  const appliedPlayersDefault = useMemo(() =>
    appliedMode === "Big-3" ? ALL_PLAYERS_BIG3 :
    appliedMode === "Others" ? othersPlayers :
    ALL_PLAYERS_IND,
    [appliedMode, othersPlayers],
  );

  const players = useMemo(() =>
    appliedFilters?.competidores && appliedFilters.competidores.length > 0
      ? appliedFilters.competidores
      : appliedPlayersDefault,
    [appliedFilters?.competidores, appliedPlayersDefault],
  );

  const chartColors = useMemo<Record<string, string>>(() => {
    if (big3) return COLORS_BIG3;
    if (appliedMode === "Others") {
      return Object.fromEntries(players.map((p, i) => [p, dynColor(i)]));
    }
    return COLORS_IND;
  }, [big3, appliedMode, players]);

  const ottoCycleRows = useMemo(() => makeOttoCycleRows(serieRows), [serieRows]);

  const latestDate = useMemo(() => {
    if (appliedFilters.dataFim) return appliedFilters.dataFim;
    if (serieRows.length === 0) return null;
    return serieRows.reduce((max, r) => (r.date > max ? r.date : max), serieRows[0].date);
  }, [appliedFilters.dataFim, serieRows]);

  const regioesAll = (opcoes?.regioes ?? []) as string[];
  const ufsAll = (opcoes?.ufs ?? []) as string[];
  const mercadosAll = (opcoes?.mercados ?? []) as string[];

  // ── Actions ───────────────────────────────────────────────────────────────
  const playersOptions: string[] =
    mode === "Big-3" ? ALL_PLAYERS_BIG3 :
    mode === "Others" ? othersPlayers :
    ALL_PLAYERS_IND;
  const playersDefault = playersOptions;

  const applyFilters = useCallback(() => {
    if (!datas || datas.length === 0) return;
    const [a, b] = sliderRange;
    const d_inicio = datas[a] ?? null;
    const d_fim = datas[b] ?? null;
    const playersFinal =
      competidoresSelected.length ? competidoresSelected : playersDefault;
    setAppliedFilters({
      dataInicio: d_inicio,
      dataFim: d_fim,
      competidores: playersFinal,
      regioes: regioesSelected ?? [],
      ufs: ufsSelected ?? [],
      mercados: [],
      modoBig3: mode === "Big-3",
      mode,
    });
    setShowToast(true);
    window.setTimeout(() => setShowToast(false), 2500);
  }, [datas, sliderRange, competidoresSelected, playersDefault, regioesSelected, ufsSelected, mode]);

  const clearFilters = useCallback(() => {
    setAppliedFilters({});
    setCompetidoresSelected([]);
    setRegioesSelected([]);
    setUfsSelected([]);
  }, []);

  // ── Export modal ───────────────────────────────────────────────────────────
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
    const dataFim = datas[b] ?? null;
    return {
      dataInicio,
      dataFim,
      regioes: exportRegioes.length ? exportRegioes : null,
      ufs: exportUfs.length ? exportUfs : null,
      mercados: exportMercados.length ? exportMercados : null,
    };
  }, [exportRange, exportRegioes, exportUfs, exportMercados, datas]);

  const fetchExportCount = useCallback(async (): Promise<number> => {
    if (!supabase) return 0;
    return getMsExportCount(supabase, exportFilters);
  }, [supabase, exportFilters]);

  const onExportExcel = useCallback(async () => {
    setExcelLoading(true);
    try {
      await downloadSalesVolumesExcel(serieRows, players, big3);
      setExportOpen(false);
    } catch (e) {
      console.error("Excel export failed", e);
    } finally {
      setExcelLoading(false);
    }
  }, [serieRows, players, big3]);

  const onExportCsv = useCallback(async () => {
    if (!supabase) return;
    setCsvLoading(true);
    try {
      const rows = await fetchVendasFiltered(supabase, exportFilters);
      downloadCsv({ rows, filename: "SalesVolumes" });
      setExportOpen(false);
    } catch (e) {
      console.error("CSV export failed", e);
    } finally {
      setCsvLoading(false);
    }
  }, [supabase, exportFilters]);

  // ── Comparison rows builder (used by desktop ComparisonTable & mobile
  //    Trends tab so both render the exact same analysis) ───────────────────
  const buildComparisonRows = useCallback(
    (
      rowsOverride: MsSerieRow[] | undefined,
      produto: string,
      segmento: string | null,
    ): SvCompRow[] => {
      if (!latestDate) return [];
      const sourceRows = rowsOverride ?? serieRows;
      return buildSvComparisonData(
        sourceRows,
        produto,
        segmento,
        players,
        big3,
        latestDate,
        groupBy,
      );
    },
    [serieRows, players, big3, latestDate, groupBy],
  );

  return {
    serieRows,
    opcoes,
    datas,
    seriesLoading,
    error,
    ottoCycleRows,
    othersPlayers,
    players,
    chartColors,
    groupBy,
    big3,
    latestDate,
    regioesAll,
    ufsAll,
    mercadosAll,
    sliderRange,
    setSliderRange,
    mode,
    setMode,
    competidoresSelected,
    setCompetidoresSelected,
    regioesSelected,
    setRegioesSelected,
    ufsSelected,
    setUfsSelected,
    selectedSegment,
    setSelectedSegment,
    segmentFilter,
    appliedFilters,
    applyFilters,
    clearFilters,
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
    fetchExportCount,
    excelLoading,
    csvLoading,
    onExportExcel,
    onExportCsv,
    showToast,
    buildComparisonRows,
  };
}
