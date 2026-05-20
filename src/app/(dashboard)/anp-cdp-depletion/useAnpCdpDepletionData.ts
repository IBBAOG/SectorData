"use client";

/**
 * useAnpCdpDepletionData — single brain for the dual-view pattern.
 *
 * Both desktop/View.tsx and mobile/View.tsx consume THIS hook exclusively.
 * No View ever calls supabase.rpc() directly.
 *
 * Owns:
 *   - filter state (selected campos, view mode, X-axis mode, plot style,
 *     recent / prior window sizes)
 *   - debounced RPC fetches (per-well scatter + field-aggregate)
 *   - empty-state guard (resets cached points when selection is empty)
 *   - mode-aware setters (per-well = single-select, per-field = capped multi)
 *   - derived: rolling depletion, table model, period helper, row metrics
 *   - formatters: fmtNp (kbpd), fmtDelta (INVERSE color of BSW)
 *
 * Exposed types (re-exported so Views don't need to import from rpc.ts):
 *   - AnpCdpDepletionPoint, AnpCdpDepletionFieldPoint
 *   - ViewMode, XMode, LineStyle
 *
 * Binding sync rule (CLAUDE.md § Dual-view policy):
 *   Any meaningful change to one View must land in the OTHER View in the
 *   same commit, OR the commit must declare [desktop-only] / [mobile-only].
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseClient } from "../../../lib/supabaseClient";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { PALETTE } from "../../../lib/plotlyDefaults";
import {
  rpcGetAnpCdpDepletionCampos,
  rpcGetAnpCdpDepletionScatter,
  rpcGetAnpCdpDepletionFieldAggregate,
  type AnpCdpDepletionPoint,
  type AnpCdpDepletionFieldPoint,
} from "../../../lib/rpc";

// ── Re-export the row types so Views don't need to import from rpc.ts ────────
export type { AnpCdpDepletionPoint, AnpCdpDepletionFieldPoint };

// ── Toggle types ──────────────────────────────────────────────────────────────

export type ViewMode = "well" | "field";

export const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "well",  label: "Per well" },
  { value: "field", label: "Field average" },
];

// Calendar (default) plots depletion against calendar date. % VOIP recovered
// plots depletion against the share of the field's VOIP that has been
// recovered cumulatively. Both modes are supported in Per-well and
// Field-average views: in Per-well each point inherits its field's pct_voip
// for the corresponding month (`pct_voip_poco`), so all wells of a field
// share the same X scale as the Field-average view. Points with
// `pct_voip_poco = NULL` (no VOIP join) are dropped from the % VOIP plot but
// still rendered in Calendar mode.
export type XMode = "calendar" | "voip";

export const X_MODE_OPTIONS: { value: XMode; label: string }[] = [
  { value: "calendar", label: "Calendar" },
  { value: "voip",     label: "% VOIP recovered" },
];

// Trace mode toggle shared by both views. Default is "markers+lines" because
// for a depletion curve the line carries the trend visually.
export type LineStyle = "markers" | "markers+lines";

export const LINE_STYLE_OPTIONS: { value: LineStyle; label: string }[] = [
  { value: "markers",       label: "Markers" },
  { value: "markers+lines", label: "Markers + lines" },
];

// Maps the toggle value to Plotly's `mode` string.
export const plotlyMode = (style: LineStyle): "markers" | "lines+markers" =>
  style === "markers" ? "markers" : "lines+markers";

// Maximum number of fields plottable simultaneously in "Field average" mode.
export const MAX_FIELDS_IN_FIELD_MODE = 20;

// Sort key for `(ano, mes)` tuples → number (ano*12 + mes).
export const ymSort = (a: number, m: number) => a * 12 + m;

// ── Rolling depletion helper ──────────────────────────────────────────────────
//
// For each point t in a per-item time series, compute the depletion as
//   depletion_t = (avg(NP, recent window) − avg(NP, prior window)) / avg(NP, prior window)
// where:
//   - recent window  = the last N points up to and including t
//   - prior window   = the M points immediately before the recent window
// Points without a full N+M-point history (i.e. with insufficient back-history)
// are silently dropped.
//
// IMPORTANT: the windows are over the N most recent **available** points, not
// over N **calendar** months. ANP CDP can have gaps (well stopped for a month).
// Treating gaps as missing-data is acceptable for v1 — the alternative would be
// to fill missing months with zeros and skew the averages towards 0.
export type RollingDepletionInput = { ano: number; mes: number; np: number };
export type RollingDepletionOutput = { ano: number; mes: number; depletion: number };

export function rollingDepletion(
  items: RollingDepletionInput[],
  nRecent: number,
  nPrior: number,
): RollingDepletionOutput[] {
  if (nRecent < 1 || nPrior < 1) return [];
  if (items.length < nRecent + nPrior) return [];
  // Defensive: ensure ascending order by (ano, mes). The caller should already
  // sort, but the math is silent-broken if the assumption is violated.
  const sorted = items.slice().sort((a, b) => ymSort(a.ano, a.mes) - ymSort(b.ano, b.mes));
  const out: RollingDepletionOutput[] = [];
  for (let i = nRecent + nPrior - 1; i < sorted.length; i++) {
    const recent = sorted.slice(i - nRecent + 1, i + 1);
    const prior = sorted.slice(i - nRecent - nPrior + 1, i - nRecent + 1);
    if (recent.length !== nRecent || prior.length !== nPrior) continue;
    const sumR = recent.reduce((s, x) => s + x.np, 0);
    const sumP = prior.reduce((s, x) => s + x.np, 0);
    const avgR = sumR / recent.length;
    const avgP = sumP / prior.length;
    if (!Number.isFinite(avgR) || !Number.isFinite(avgP) || avgP === 0) continue;
    const dep = (avgR - avgP) / avgP;
    if (!Number.isFinite(dep)) continue;
    out.push({ ano: sorted[i].ano, mes: sorted[i].mes, depletion: dep });
  }
  return out;
}

// ── Number formatters ─────────────────────────────────────────────────────────

/**
 * Format NP values in kbpd (thousand barrels per day). Field-typical kbpd
 * ranges from 0.5 to ~500, so two decimals are sufficient.
 */
export const fmtNp = (v: number | undefined | null): string => {
  if (v === undefined || v === null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)} kbpd`;
};

/**
 * Format signed delta percentage with 2 decimals.
 *
 * Color semantics (INVERSE of /anp-cdp-bsw):
 *   For NP, rising = good (green); falling = depletion (red).
 *   BSW is the opposite — falling water-cut is good.
 */
export const fmtDelta = (
  v: number | null,
): { text: string; color: string } => {
  if (v === null || !Number.isFinite(v)) return { text: "—", color: "#888" };
  const sign = v > 0 ? "+" : v < 0 ? "" : "";
  const color = v > 0 ? "#28a745" : v < 0 ? "#dc3545" : "#666";
  return { text: `${sign}${v.toFixed(2)}%`, color };
};

// ── Row metrics for the Depletion comparison table ────────────────────────────

export interface RowMetrics {
  last: number | null;
  avgRecent: number | null;
  avgPrior: number | null;
  depletion: number | null;
  yoy: number | null;
}

/** Compute table row metrics from a sorted-ascending NP series + recent/prior. */
export function computeRowMetrics(
  series: { ym: string; np: number }[],
  nRecent: number,
  nPrior: number,
): RowMetrics {
  if (!series.length) {
    return { last: null, avgRecent: null, avgPrior: null, depletion: null, yoy: null };
  }
  const last = series[series.length - 1].np;

  // Recent window = last nRecent points (chronological tail).
  const recentSlice = series.slice(-nRecent);
  const avgRecent =
    recentSlice.length > 0
      ? recentSlice.reduce((s, x) => s + x.np, 0) / recentSlice.length
      : null;

  // Prior window = the nPrior points immediately preceding the recent slice.
  const priorEnd = series.length - recentSlice.length;
  const priorStart = Math.max(0, priorEnd - nPrior);
  const priorSlice = series.slice(priorStart, priorEnd);
  const avgPrior =
    priorSlice.length > 0
      ? priorSlice.reduce((s, x) => s + x.np, 0) / priorSlice.length
      : null;

  const depletion =
    avgRecent !== null && avgPrior !== null && avgPrior !== 0
      ? ((avgRecent - avgPrior) / avgPrior) * 100
      : null;

  // YoY: last NP vs NP from exactly 12 calendar months earlier.
  let yoy: number | null = null;
  const lastYm = series[series.length - 1].ym;
  const [ly, lm] = lastYm.split("-").map(Number);
  const yoyKey = `${ly - 1}-${String(lm).padStart(2, "0")}`;
  const match = series.find((s) => s.ym === yoyKey);
  if (match && match.np !== 0) {
    yoy = (last / match.np - 1) * 100;
  }
  return { last, avgRecent, avgPrior, depletion, yoy };
}

// ── Table model types ─────────────────────────────────────────────────────────

export interface TableRow {
  item: string;
  color: string;
  /** Series of (ymKey, np) sorted ascending by year/month, ymKey = YYYY-MM. */
  series: { ym: string; np: number }[];
}

export interface TableModel {
  rows: TableRow[];
}

// ── Period helper types ───────────────────────────────────────────────────────

export interface PeriodHelper {
  recentLabel: string;
  priorLabel: string;
  warning: string | null;
}

// ── Hook interface ────────────────────────────────────────────────────────────

export interface UseAnpCdpDepletionData {
  // Campos list (filter source)
  campos: string[];
  filtrosLoading: boolean;

  // Filter state
  selectedCampos: string[];
  viewMode: ViewMode;
  xMode: XMode;
  lineStyle: LineStyle;
  recentMonths: number;
  priorMonths: number;

  // Effective X mode — both views now support Calendar and % VOIP recovered.
  effectiveXMode: XMode;

  // Filter setters (mode-aware)
  setSelectedCampos: (next: string[]) => void;
  setViewMode: (next: ViewMode) => void;
  setXMode: (next: XMode) => void;
  setLineStyle: (next: LineStyle) => void;
  setRecentMonths: (n: number) => void;
  setPriorMonths: (n: number) => void;

  // Cached data
  wellPoints: AnpCdpDepletionPoint[];
  fieldPoints: AnpCdpDepletionFieldPoint[];

  // Loading states
  chartLoading: boolean;

  // Derived helpers
  uniqueWellCount: number;
  tableModel: TableModel;
  periodHelper: PeriodHelper | null;

  // Per-campo color (chart trace + chip swatch)
  fieldColor: (c: string) => string;

  // Window clamping (1..60)
  clampWindow: (raw: number) => number;
}

// ── Helpers (private) ─────────────────────────────────────────────────────────

const DEFAULT_RECENT = 12;
const DEFAULT_PRIOR  = 12;

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAnpCdpDepletionData(): UseAnpCdpDepletionData {
  const supabase = getSupabaseClient();

  const [campos, setCampos] = useState<string[]>([]);
  const [filtrosLoading, setFiltrosLoading] = useState(true);

  const [selectedCampos, setSelectedCamposState] = useState<string[]>([]);
  const [viewMode, setViewModeState] = useState<ViewMode>("well");
  const [xMode, setXMode] = useState<XMode>("calendar");
  const [lineStyle, setLineStyle] = useState<LineStyle>("markers+lines");
  const [recentMonths, setRecentMonths] = useState<number>(DEFAULT_RECENT);
  const [priorMonths, setPriorMonths] = useState<number>(DEFAULT_PRIOR);

  const [wellPoints,  setWellPoints]  = useState<AnpCdpDepletionPoint[]>([]);
  const [fieldPoints, setFieldPoints] = useState<AnpCdpDepletionFieldPoint[]>([]);

  // Both views support Calendar and % VOIP — no per-view forcing required.
  const effectiveXMode: XMode = xMode;

  // ── Initial load: only the campos list ───────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const list = await rpcGetAnpCdpDepletionCampos(supabase);
      if (cancelled) return;
      setCampos(list);
      setFiltrosLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive per-well fetch (debounced 400ms) ─────────────────────────────
  const { data: wellRefetched, loading: wellLoading } = useDebouncedFetch(
    async () => {
      if (!supabase) return [] as AnpCdpDepletionPoint[];
      if (viewMode !== "well") return [] as AnpCdpDepletionPoint[];
      if (selectedCampos.length === 0) return [] as AnpCdpDepletionPoint[];
      return rpcGetAnpCdpDepletionScatter(supabase, selectedCampos);
    },
    [supabase, selectedCampos, viewMode],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (wellRefetched !== null) setWellPoints(wellRefetched);
  }, [wellRefetched]);

  // ── Reactive field-average fetch (debounced 400ms) ────────────────────────
  const { data: fieldRefetched, loading: fieldLoading } = useDebouncedFetch(
    async () => {
      if (!supabase) return [] as AnpCdpDepletionFieldPoint[];
      if (viewMode !== "field") return [] as AnpCdpDepletionFieldPoint[];
      if (selectedCampos.length === 0) return [] as AnpCdpDepletionFieldPoint[];
      return rpcGetAnpCdpDepletionFieldAggregate(supabase, selectedCampos);
    },
    [supabase, selectedCampos, viewMode],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (fieldRefetched !== null) setFieldPoints(fieldRefetched);
  }, [fieldRefetched]);

  // Reset cached points when selection is empty so the empty state renders cleanly.
  useEffect(() => {
    if (selectedCampos.length === 0) {
      setWellPoints([]);
      setFieldPoints([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampos.length]);

  const chartLoading = viewMode === "well" ? wellLoading : fieldLoading;

  const fieldColor = useCallback(
    (c: string): string => {
      const i = selectedCampos.indexOf(c);
      return i >= 0 ? PALETTE[i % PALETTE.length] : "#dcdcdc";
    },
    [selectedCampos],
  );

  // Per-well mode: count unique wells in the currently fetched points.
  const uniqueWellCount = useMemo(() => {
    if (viewMode !== "well") return 0;
    if (!wellPoints.length) return 0;
    const set = new Set<string>();
    for (const p of wellPoints) set.add(p.poco);
    return set.size;
  }, [viewMode, wellPoints]);

  // ── Period comparison helper text ─────────────────────────────────────────
  const periodHelper = useMemo<PeriodHelper | null>(() => {
    const fmt = (ano: number, mes: number) =>
      `${ano}-${String(mes).padStart(2, "0")}`;

    // Pull the active points list based on viewMode.
    const activePoints =
      viewMode === "well"
        ? wellPoints.map((p) => ({ key: p.poco, ano: p.ano, mes: p.mes }))
        : fieldPoints.map((p) => ({ key: p.campo, ano: p.ano, mes: p.mes }));

    if (selectedCampos.length === 0 || activePoints.length === 0) {
      return null;
    }

    // Latest (ano, mes) across all selected items.
    let maxYm = -Infinity;
    let maxAno = 0;
    let maxMes = 0;
    for (const p of activePoints) {
      const ym = ymSort(p.ano, p.mes);
      if (ym > maxYm) {
        maxYm = ym;
        maxAno = p.ano;
        maxMes = p.mes;
      }
    }
    if (!Number.isFinite(maxYm)) return null;

    // Recent window: [recent_start ... recent_end == max].
    // Prior window:  [prior_start ... prior_end == recent_start - 1 month].
    const recentEndYm = maxYm;
    const recentStartYm = recentEndYm - (recentMonths - 1);
    const priorEndYm = recentStartYm - 1;
    const priorStartYm = priorEndYm - (priorMonths - 1);

    const ymToDate = (ym: number): { ano: number; mes: number } => {
      // ym = ano*12 + mes, with mes in 1..12.
      const ano = Math.floor((ym - 1) / 12);
      const mes = ((ym - 1) % 12) + 1;
      return { ano, mes };
    };

    const recentEnd = { ano: maxAno, mes: maxMes };
    const recentStart = ymToDate(recentStartYm);
    const priorEnd = ymToDate(priorEndYm);
    const priorStart = ymToDate(priorStartYm);

    const recentLabel = `${fmt(recentStart.ano, recentStart.mes)} → ${fmt(recentEnd.ano, recentEnd.mes)}`;
    const priorLabel = `${fmt(priorStart.ano, priorStart.mes)} → ${fmt(priorEnd.ano, priorEnd.mes)}`;

    // Warning detection: find the earliest (ano, mes) per selected item and
    // check whether either the recent or prior window extends earlier than
    // that item's history.
    const earliestByKey = new Map<string, number>();
    for (const p of activePoints) {
      const ym = ymSort(p.ano, p.mes);
      const cur = earliestByKey.get(p.key);
      if (cur === undefined || ym < cur) {
        earliestByKey.set(p.key, ym);
      }
    }

    type ClipInfo = {
      key: string;
      earliestYm: number;
      recentClippedTo: number | null;
      priorClippedTo: number | null;
    };
    const clipped: ClipInfo[] = [];
    for (const [key, earliestYm] of earliestByKey) {
      const recentClipped = earliestYm > recentStartYm && earliestYm <= recentEndYm;
      const recentAvailable = recentClipped
        ? Math.max(0, recentEndYm - earliestYm + 1)
        : null;

      const priorClipped = earliestYm > priorStartYm;
      const priorAvailable = priorClipped
        ? Math.max(0, priorEndYm - earliestYm + 1)
        : null;

      if (recentClipped || priorClipped) {
        clipped.push({
          key,
          earliestYm,
          recentClippedTo: recentAvailable,
          priorClippedTo: priorAvailable,
        });
      }
    }

    let warning: string | null = null;
    if (clipped.length > 0) {
      const ordered = clipped.slice().sort((a, b) => {
        if (a.earliestYm !== b.earliestYm) return b.earliestYm - a.earliestYm;
        return a.key.localeCompare(b.key);
      });

      const MAX_ITEMS = 4;
      const shown = ordered.slice(0, MAX_ITEMS);

      const lines = shown.map((c) => {
        const earliest = ymToDate(c.earliestYm);
        const parts: string[] = [];
        if (c.recentClippedTo !== null) {
          parts.push(`recent ${c.recentClippedTo} months`);
        }
        if (c.priorClippedTo !== null) {
          parts.push(`prior ${c.priorClippedTo} months`);
        }
        return (
          `Windows clipped for "${c.key}" ` +
          `(data starts ${fmt(earliest.ano, earliest.mes)}): ` +
          parts.join(", ") +
          "."
        );
      });

      if (ordered.length > shown.length) {
        const remaining = ordered.length - shown.length;
        lines.push(`...and ${remaining} more clipped item${remaining === 1 ? "" : "s"}.`);
      }

      warning = lines.join("\n");
    }

    return { recentLabel, priorLabel, warning };
  }, [viewMode, wellPoints, fieldPoints, selectedCampos, recentMonths, priorMonths]);

  // ── Depletion comparison table model ──────────────────────────────────────
  const tableModel = useMemo<TableModel>(() => {
    const empty: TableModel = { rows: [] };
    const ymKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

    if (viewMode === "well") {
      if (!selectedCampos.length || !wellPoints.length) return empty;
      // Preserve first-appearance order of wells (matches chart legend).
      const seen: string[] = [];
      const byPoco = new Map<string, { ym: string; np: number }[]>();
      for (const p of wellPoints) {
        if (!seen.includes(p.poco)) {
          seen.push(p.poco);
          byPoco.set(p.poco, []);
        }
        byPoco.get(p.poco)!.push({ ym: ymKey(p.ano, p.mes), np: p.np_kbpd });
      }
      const rows: TableRow[] = seen.map((poco, i) => ({
        item: poco,
        color: PALETTE[i % PALETTE.length],
        series: (byPoco.get(poco) ?? []).slice().sort((a, b) => a.ym.localeCompare(b.ym)),
      }));
      return { rows };
    }

    // Field-average mode
    if (!selectedCampos.length || !fieldPoints.length) return empty;
    const rows: TableRow[] = selectedCampos.map((campo, i) => {
      const series = fieldPoints
        .filter((p) => p.campo === campo)
        .map((p) => ({ ym: ymKey(p.ano, p.mes), np: p.np_kbpd }))
        .sort((a, b) => a.ym.localeCompare(b.ym));
      return { item: campo, color: PALETTE[i % PALETTE.length], series };
    });
    return { rows };
  }, [viewMode, wellPoints, fieldPoints, selectedCampos]);

  // ── Mode-aware setters ────────────────────────────────────────────────────
  // In Per-well mode the field filter behaves as a single-select; in
  // Field-average mode it caps at MAX_FIELDS_IN_FIELD_MODE.
  const setSelectedCampos = useCallback(
    (next: string[]) => {
      if (viewMode === "well") {
        if (next.length === 0) {
          setSelectedCamposState([]);
          return;
        }
        const added = next.find((c) => !selectedCampos.includes(c));
        setSelectedCamposState([added ?? next[next.length - 1]]);
        return;
      }
      if (next.length > MAX_FIELDS_IN_FIELD_MODE) {
        setSelectedCamposState(next.slice(0, MAX_FIELDS_IN_FIELD_MODE));
        return;
      }
      setSelectedCamposState(next);
    },
    [viewMode, selectedCampos],
  );

  const setViewMode = useCallback(
    (next: ViewMode) => {
      setViewModeState(next);
      if (next === "well" && selectedCampos.length > 1) {
        setSelectedCamposState(selectedCampos.slice(0, 1));
      }
    },
    [selectedCampos],
  );

  const clampWindow = useCallback((raw: number): number => {
    if (!Number.isFinite(raw)) return DEFAULT_RECENT;
    const n = Math.round(raw);
    if (n < 1) return 1;
    if (n > 60) return 60;
    return n;
  }, []);

  return {
    campos,
    filtrosLoading,
    selectedCampos,
    viewMode,
    xMode,
    lineStyle,
    recentMonths,
    priorMonths,
    effectiveXMode,
    setSelectedCampos,
    setViewMode,
    setXMode,
    setLineStyle,
    setRecentMonths,
    setPriorMonths,
    wellPoints,
    fieldPoints,
    chartLoading,
    uniqueWellCount,
    tableModel,
    periodHelper,
    fieldColor,
    clampWindow,
  };
}
