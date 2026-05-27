"use client";

// ─── Single "brain" hook for /well-by-well (dual-view pattern) ──────────────
//
// Both desktop/View.tsx and mobile/View.tsx consume this hook. Neither View
// ever calls Supabase or derives metrics on its own. All filter state, fetch
// orchestration, stake-weighted aggregations (delegated to server-side RPCs),
// KPI math and export plumbing live here.
//
// Scope: executive monthly oil & gas production summary, replicating the
// Well-by-Well PDF structure.
//
// Data sources (5 RPCs, all SECURITY DEFINER in
// `supabase/migrations/20260528000000_production_rpcs.sql`):
//   • get_production_brazil_aggregate(date_start, date_end, ambientes[]?)
//       → Brazil-wide stacked bars (no stake weighting)
//   • get_production_company_aggregate(empresa, date_start, date_end, ambientes[]?)
//       → Stake-weighted stacked bars for the selected company
//   • get_production_top_fields(empresa, date, top_n=10)
//       → Horizontal bar: top fields in the reference month
//   • get_production_by_installation(empresa, date)
//       → Table: FPSO/UEP-level production in the reference month
//   • get_production_yoy_table(empresa, date)
//       → YoY/MoM/YTD breakdown at the reference month (1 TOTAL + 3 ambiente rows)
//
// Empresa list comes from `get_field_stakes_empresas()` (Fase 1 RPC). Never
// hardcode company names — new ones in `field_stakes` appear automatically.
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes to one
// View must land in the OTHER View in the same commit, OR the commit message
// must declare [desktop-only] / [mobile-only] with an explicit reason.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WELL_BY_WELL_EMPRESAS } from "../../../data/wellByWellEmpresas";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { bblDiaToKbpd } from "../../../lib/units";
import {
  rpcGetFieldStakesEmpresas,
  rpcGetProductionBrazilAggregate,
  rpcGetProductionCompanyAggregate,
  rpcGetProductionTopFields,
  rpcGetProductionByInstallation,
  rpcGetProductionYoyTable,
  rpcGetProductionFieldTimeseries,
  rpcGetProductionInstallationTimeseries,
  rpcGetWellByWellHeader,
} from "../../../lib/rpc";
import type { FieldStakeEmpresa } from "../../../types/fieldStakes";
import type {
  ProductionBrazilRow,
  ProductionCompanyRow,
  ProductionTopField,
  ProductionInstallation,
  ProductionYoYRow,
  ProductionFieldTimeseriesRow,
  ProductionInstallationTimeseriesRow,
  WellByWellHeaderRow,
} from "../../../types/production";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default company. Petrobras is the primary investment-bank-research case. */
export const DEFAULT_EMPRESA = "Petrobras";

/** All three ambiente buckets carried verbatim from `anp_cdp_producao.local`. */
export const AMBIENTES: readonly string[] = ["PreSal", "PosSal", "Terra"];

/** Default lookback window when initialising the period slider (13 months). */
export const DEFAULT_LOOKBACK_MONTHS = 13;

/** Colour palette for the ambiente stack — PreSal darkest → Terra lightest. */
export const AMBIENTE_COLOR: Record<string, string> = {
  PreSal: "#1a1a1a",
  PosSal: "#6b6b73",
  Terra:  "#c5c5cb",
};

/** Brand orange for the Company-side accents. */
export const BRAND_ORANGE = "#ff5000";

/** Top fields stack: oil dark, water light blue (mirrors the PDF). */
export const TOP_FIELDS_OIL_COLOR   = "#1a1a1a";
export const TOP_FIELDS_WATER_COLOR = "#7BB6DD";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert "YYYY-MM" or "YYYY-MM-DD" to a normalised "YYYY-MM-01" anchor. */
export function monthAnchor(d: string): string {
  return `${d.slice(0, 7)}-01`;
}

/** First-of-month ISO date `n` months before/after the given anchor. */
export function shiftMonth(anchor: string, deltaMonths: number): string {
  const y = parseInt(anchor.slice(0, 4), 10);
  const m = parseInt(anchor.slice(5, 7), 10) - 1; // JS Date months 0..11
  const total = y * 12 + m + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12;
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}-01`;
}

/** Build the inclusive list of `YYYY-MM-01` anchors between two dates. */
export function buildMonthList(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = monthAnchor(start);
  const stop = monthAnchor(end);
  let guard = 0;
  while (cur <= stop && guard < 600) {
    out.push(cur);
    cur = shiftMonth(cur, 1);
    guard++;
  }
  return out;
}

/** Number formatter with thousand separators and configurable decimals. */
export function fmtNumber(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** Format a percentage with sign and one decimal. */
export function fmtPct(p: number | null | undefined, digits = 1): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const v = p * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

/** Format a month anchor as "Apr 2026". */
export function fmtMonthLabel(anchor: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = parseInt(anchor.slice(5, 7), 10);
  const y = anchor.slice(0, 4);
  return `${months[m - 1]} ${y}`;
}

// `sumOil` / `sumGas` helpers were removed in Round 6 alongside the top KPI
// strip. The remaining derived metrics (drill-down KPIs, YoY/MoM/YTD table)
// are computed either client-side from a sorted timeseries or server-side by
// `get_production_yoy_table`, neither of which needs an at-reference-month
// fold over `companyData`/`brazilData`.

// ─── Hook return type ─────────────────────────────────────────────────────────

export interface UseProductionData {
  // Visibility
  visible: boolean;
  visLoading: boolean;

  // Initial bootstrap (filters universe + most-recent month discovery)
  bootstrapping: boolean;
  /** Most recent `YYYY-MM-01` available in `anp_cdp_producao`. */
  latestMonth: string | null;

  // Empresa
  empresasList: FieldStakeEmpresa[];
  empresa: string;
  setEmpresa: (e: string) => void;

  // Period (months, inclusive)
  allMonths: string[];                            // every month anchor between absolute min/max
  dateRange: [string, string];                    // [startMonth, endMonth]
  setDateRange: (range: [string, string]) => void;
  monthIdxRange: [number, number];                // indices into `allMonths` for the slider
  setMonthIdxRange: (idx: [number, number]) => void;

  // Ambientes (multi-select)
  ambientes: string[];
  setAmbientes: (a: string[]) => void;
  toggleAmbiente: (a: string) => void;

  // Reference month (used by top fields + installations + YoY)
  referenceDate: string;                          // YYYY-MM-01
  setReferenceDate: (d: string) => void;

  // Data states
  brazilData: ProductionBrazilRow[];
  companyData: ProductionCompanyRow[];
  topFields: ProductionTopField[];
  installations: ProductionInstallation[];
  yoyTable: ProductionYoYRow[];
  /** Round 8 (2026-05-27) — PDF page-2 header table (Brazil + Empresa rollup). */
  headerData: WellByWellHeaderRow[];

  // Loading flags (per data state)
  brazilLoading: boolean;
  companyLoading: boolean;
  topFieldsLoading: boolean;
  installationsLoading: boolean;
  yoyLoading: boolean;
  headerLoading: boolean;
  /** Any of the data fetches is in-flight. Useful for "updating…" hints. */
  anyLoading: boolean;

  // Error (single bubble; per-RPC errors are logged at the wrapper level)
  error: Error | null;

  // (Round 6, 2026-05-27) The top KPI strip — `brazilOilKbpd`, `companyOilKbpd`,
  // `companyGasMm3d`, `companyYtdAvgKbpd`, `companyMomPct`, `companyYoyPct` —
  // was removed entirely because the at-reference-month Δ MoM / Δ YoY math is
  // unreliable when the current month is partial (divides a full prior month
  // by ~0). The PDF reference report uses tables exclusively (YoY table is
  // already rendered at the bottom of both Views). Drill-down KPIs still
  // exist and remain valid because they sum full historical months.

  // Export (Tier 1 — direct download, multi-sheet Excel + zip CSV)
  excelLoading: boolean;
  csvLoading: boolean;
  handleExportExcel: () => Promise<void>;
  handleExportCsv: () => Promise<void>;

  // Field drill-down (Round 2, 2026-05-27; canonical-aware since Round 4,
  // 2026-05-28).
  // Click a row in the Top Fields panel to open this. The modal/sheet shows a
  // 13mo timeseries (oil + water stacked + hours-rate line) plus 4 KPIs
  // derived client-side from the timeseries.
  //
  // Round 4 semantics: `drillCampo` now carries a **canonical field name** (the
  // value returned by `get_production_top_fields`, which groups by
  // `canonical_field_name(p.campo)` server-side). When passed back to
  // `get_production_field_timeseries`, the server expands the WHERE clause to
  // every variant that maps to that canonical (so clicking "Búzios" returns
  // Búzios + AnC_Búzios + Búzios_ECO summed by stake). The field-stake variants
  // remain individually editable from /admin-panel.
  drillCampo: string | null;            // null = closed; non-null = open (canonical name)
  drillTimeseries: ProductionFieldTimeseriesRow[];
  drillLoading: boolean;
  drillError: string | null;
  drillKpis: {
    currentOil: number;                 // kbpd at most-recent month in series
    prevOil: number | null;             // kbpd at prior month
    momPct: number | null;              // (current - prev) / prev
    yoyPct: number | null;              // vs same calendar month one year prior
    ytdAvg: number | null;              // kbpd YTD average (year of most-recent month)
  };
  openFieldDrill: (campo: string) => void;
  closeFieldDrill: () => void;

  // Installation (FPSO/UEP) drill-down (Round 3, 2026-05-27).
  // Click a row in the P4 Installations table (desktop) or tap an FPSO card
  // (mobile) to open this. Same shape as the field drill — a 13mo timeseries
  // plus 4 client-side KPIs. The two drills are MUTUALLY EXCLUSIVE: opening
  // one closes the other, so only ever one modal/BottomSheet is on-screen.
  drillInstalacao: string | null;       // null = closed; non-null = open
  drillInstalacaoTimeseries: ProductionInstallationTimeseriesRow[];
  drillInstalacaoLoading: boolean;
  drillInstalacaoError: string | null;
  drillInstalacaoKpis: {
    currentOil: number;
    prevOil: number | null;
    momPct: number | null;
    yoyPct: number | null;
    ytdAvg: number | null;
  };
  openInstallationDrill: (instalacao: string) => void;
  closeInstallationDrill: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useProductionData(): UseProductionData {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("well-by-well");
  const supabase = getSupabaseClient();

  // ── State ──────────────────────────────────────────────────────────────────
  const [bootstrapping, setBootstrapping] = useState(true);
  const [latestMonth, setLatestMonth] = useState<string | null>(null);
  const [empresasList, setEmpresasList] = useState<FieldStakeEmpresa[]>([]);

  const [empresa, setEmpresaState] = useState<string>(DEFAULT_EMPRESA);
  const [ambientes, setAmbientesState] = useState<string[]>([...AMBIENTES]);

  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [monthIdxRange, setMonthIdxRangeState] = useState<[number, number]>([0, 0]);

  const [referenceDate, setReferenceDateState] = useState<string>("");

  const [brazilData, setBrazilData] = useState<ProductionBrazilRow[]>([]);
  const [companyData, setCompanyData] = useState<ProductionCompanyRow[]>([]);
  const [topFields, setTopFields] = useState<ProductionTopField[]>([]);
  const [installations, setInstallations] = useState<ProductionInstallation[]>([]);
  const [yoyTable, setYoyTable] = useState<ProductionYoYRow[]>([]);
  // Round 8 (2026-05-27) — PDF page-2 header table backing state.
  const [headerData, setHeaderData] = useState<WellByWellHeaderRow[]>([]);

  const [error, setError] = useState<Error | null>(null);

  const [excelLoading, setExcelLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  // Field drill-down state (Round 2). `drillCampo` doubles as visibility flag
  // for the modal/sheet — null when closed, the field name when open.
  const [drillCampo, setDrillCampo] = useState<string | null>(null);
  const [drillTimeseries, setDrillTimeseries] = useState<ProductionFieldTimeseriesRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  // Installation drill-down state (Round 3). `drillInstalacao` doubles as
  // visibility flag for the modal/sheet — null when closed, the installation
  // name when open. Field and installation drills are mutually exclusive.
  const [drillInstalacao, setDrillInstalacao] = useState<string | null>(null);
  const [drillInstalacaoTimeseries, setDrillInstalacaoTimeseries] = useState<ProductionInstallationTimeseriesRow[]>([]);
  const [drillInstalacaoLoading, setDrillInstalacaoLoading] = useState(false);
  const [drillInstalacaoError, setDrillInstalacaoError] = useState<string | null>(null);

  // ── Derived: dateRange from monthIdxRange ─────────────────────────────────
  const dateRange = useMemo<[string, string]>(() => {
    if (allMonths.length === 0) return ["", ""];
    const a = allMonths[monthIdxRange[0]] ?? allMonths[0];
    const b = allMonths[monthIdxRange[1]] ?? allMonths[allMonths.length - 1];
    return [a, b];
  }, [allMonths, monthIdxRange]);

  // ── Setters ────────────────────────────────────────────────────────────────
  const setEmpresa = useCallback((e: string) => setEmpresaState(e), []);
  const setAmbientes = useCallback((a: string[]) => setAmbientesState(a), []);
  const toggleAmbiente = useCallback((a: string) => {
    setAmbientesState((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a],
    );
  }, []);
  const setMonthIdxRange = useCallback((idx: [number, number]) => {
    setMonthIdxRangeState(idx);
  }, []);
  const setReferenceDate = useCallback((d: string) => {
    setReferenceDateState(monthAnchor(d));
  }, []);
  const setDateRange = useCallback((range: [string, string]) => {
    // Translate explicit anchors back to indices, snapping to bounds.
    setMonthIdxRangeState((prev) => {
      if (allMonths.length === 0) return prev;
      const i0 = Math.max(0, allMonths.indexOf(monthAnchor(range[0])));
      const i1 = Math.max(i0, allMonths.indexOf(monthAnchor(range[1])));
      return [i0, i1 < 0 ? allMonths.length - 1 : i1];
    });
  }, [allMonths]);

  // ── Bootstrap: empresa list + latest month discovery ──────────────────────
  //
  // Round 5 (perf): the bootstrap fires `rpcGetFieldStakesEmpresas` and the
  // wide-range Brazil aggregate probe IN PARALLEL (Promise.allSettled), and
  // SEEDS `brazilData` with the slice of the probe that falls in the default
  // 13mo window — eliminating one round-trip the user would otherwise wait
  // for (the reactive Brazil refetch immediately after bootstrap).
  //
  // The "wide range" call below probes the entire 2018→present window for the
  // Brazil aggregate, then takes max(ano, mes) to discover the most-recent
  // month with data. We deliberately reuse the same RPC the dashboard already
  // consumes (no extra surface area) and key the slider min on 2018 (older
  // than any data Eduardo currently exports).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setBootstrapping(true);
    setError(null);

    (async () => {
      try {
        // Fire both bootstrap RPCs IN PARALLEL — empresa list is independent
        // of the Brazil probe, no reason to chain them.
        const [empresasRes, probeRes] = await Promise.allSettled([
          rpcGetFieldStakesEmpresas(supabase),
          rpcGetProductionBrazilAggregate(supabase, "2018-01-01", "2099-12-31", null),
        ]);
        if (cancelled) return;

        // Empresa list — graceful: if anon doesn't have GRANT, list is empty
        // and the dropdown shows the default. Once auth lands, it populates.
        let empresas: FieldStakeEmpresa[] = [];
        if (empresasRes.status === "fulfilled") {
          empresas = empresasRes.value;
        } else {
          console.warn(
            "rpcGetFieldStakesEmpresas failed (admin-only? continuing with default)",
            empresasRes.reason,
          );
        }
        // Restrict the dashboard dropdown to the IR-relevant whitelist
        // (`src/data/wellByWellEmpresas.ts`). The admin panel's Field Stakes
        // editor still consumes the full list via the same RPC wrapper — this
        // filter only narrows what the dashboard renders. Sort follows the
        // whitelist order (Petrobras → PRIO → PetroReconcavo → Brava Energia),
        // which is the most-coverage-first IR view, not `n_campos DESC`.
        const allowed = new Set<string>(WELL_BY_WELL_EMPRESAS);
        const orderIdx = new Map<string, number>(
          WELL_BY_WELL_EMPRESAS.map((name, i) => [name, i]),
        );
        empresas = empresas
          .filter((e) => allowed.has(e.empresa))
          .sort(
            (a, b) =>
              (orderIdx.get(a.empresa) ?? Number.MAX_SAFE_INTEGER) -
              (orderIdx.get(b.empresa) ?? Number.MAX_SAFE_INTEGER),
          );
        setEmpresasList(empresas);

        // Safety: if the user landed here with state (e.g. query param,
        // stale URL, restored session) pointing to an empresa outside the
        // whitelist, snap back to the default (Petrobras). Read state
        // imperatively to avoid adding the setter to the bootstrap deps.
        setEmpresaState((cur) =>
          allowed.has(cur) ? cur : DEFAULT_EMPRESA,
        );

        // Brazil probe — required to know latestMonth; if it failed, bubble up.
        if (probeRes.status === "rejected") {
          throw probeRes.reason instanceof Error
            ? probeRes.reason
            : new Error(String(probeRes.reason));
        }
        const probe = probeRes.value;

        let maxAnchor: string | null = null;
        for (const r of probe) {
          const a = `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`;
          if (!maxAnchor || a > maxAnchor) maxAnchor = a;
        }
        if (!maxAnchor) {
          // No data at all — fall back to "today" so the UI doesn't crash.
          const now = new Date();
          maxAnchor = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        }

        const minAnchor = "2018-01-01";
        const months = buildMonthList(minAnchor, maxAnchor);
        setAllMonths(months);
        setLatestMonth(maxAnchor);

        // Default slider window: last DEFAULT_LOOKBACK_MONTHS months ending
        // at maxAnchor. Snap to bounds.
        const endIdx = months.length - 1;
        const startIdx = Math.max(0, endIdx - (DEFAULT_LOOKBACK_MONTHS - 1));
        setMonthIdxRangeState([startIdx, endIdx]);
        setReferenceDateState(maxAnchor);

        // ── SEED Brazil data from the probe (Round 5 perf win) ───────────
        // The probe already returned every month in 2018→present for Brazil.
        // Slice it to the default window and seed `brazilData` so the Brazil
        // chart renders IMMEDIATELY on first paint instead of waiting for the
        // reactive `rpcGetProductionBrazilAggregate` debounce to fire again.
        // The reactive fetch will still re-fire if the user changes period or
        // ambientes — but on initial load, we skip an entire round-trip.
        const startAnchor = months[startIdx];
        const endAnchor   = months[endIdx];
        const windowed = probe.filter((r) => {
          const a = `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`;
          return a >= startAnchor && a <= endAnchor;
        });
        if (windowed.length > 0) setBrazilData(windowed);
      } catch (e) {
        if (!cancelled) {
          console.error("/well-by-well bootstrap failed", e);
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive fetch: Brazil aggregate (period + ambientes) ─────────────────
  //
  // Round 5 perf notes:
  //   • Deps INTENTIONALLY exclude `empresa` — Brazil aggregate is country-
  //     wide, so switching companies should NOT re-fetch this. The user's "Δ
  //     empresa only triggers 4 RPCs" expectation is satisfied here.
  //   • `skipInitial: true` because the bootstrap probe already seeded
  //     `brazilData` for the default window; the first mount of this effect
  //     would otherwise re-fetch the same data redundantly.
  //   • Debounce dropped from 300ms → 150ms — these inputs (period slider,
  //     ambientes checkboxes) are click-driven not type-driven, so a smaller
  //     window still coalesces accidental double-clicks without lag.
  const { data: brazilFetched, loading: brazilLoading } = useDebouncedFetch<
    ProductionBrazilRow[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !dateRange[0] || !dateRange[1]) return null;
      const ambientesParam = ambientes.length > 0 && ambientes.length < AMBIENTES.length
        ? ambientes
        : null;
      try {
        return await rpcGetProductionBrazilAggregate(
          supabase,
          dateRange[0],
          dateRange[1],
          ambientesParam,
        );
      } catch (e) {
        console.error("Brazil aggregate refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, dateRange[0], dateRange[1], ambientes.join("|")],
    { ms: 150, skipInitial: true },
  );
  useEffect(() => {
    if (brazilFetched) setBrazilData(brazilFetched);
  }, [brazilFetched]);

  // ── Reactive fetch: Company aggregate (empresa + period + ambientes) ──────
  const { data: companyFetched, loading: companyLoading } = useDebouncedFetch<
    ProductionCompanyRow[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !dateRange[0] || !dateRange[1] || !empresa) {
        return null;
      }
      const ambientesParam = ambientes.length > 0 && ambientes.length < AMBIENTES.length
        ? ambientes
        : null;
      try {
        return await rpcGetProductionCompanyAggregate(
          supabase,
          empresa,
          dateRange[0],
          dateRange[1],
          ambientesParam,
        );
      } catch (e) {
        console.error("Company aggregate refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, empresa, dateRange[0], dateRange[1], ambientes.join("|")],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (companyFetched) setCompanyData(companyFetched);
  }, [companyFetched]);

  // ── Reactive fetch: Top fields (empresa + referenceDate) ──────────────────
  //
  // Deps deliberately exclude dateRange & ambientes — Top Fields is a single-
  // month snapshot anchored to referenceDate; sliding the period window or
  // toggling ambientes filters does NOT need to re-fetch this panel.
  const { data: topFetched, loading: topFieldsLoading } = useDebouncedFetch<
    ProductionTopField[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !empresa || !referenceDate) return null;
      try {
        return await rpcGetProductionTopFields(supabase, empresa, referenceDate, 10);
      } catch (e) {
        console.error("Top fields refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, empresa, referenceDate],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (topFetched) setTopFields(topFetched);
  }, [topFetched]);

  // ── Reactive fetch: Installations (empresa + referenceDate) ───────────────
  // Same dep semantics as Top Fields — single-month snapshot.
  const { data: instFetched, loading: installationsLoading } = useDebouncedFetch<
    ProductionInstallation[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !empresa || !referenceDate) return null;
      try {
        return await rpcGetProductionByInstallation(supabase, empresa, referenceDate);
      } catch (e) {
        console.error("Installations refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, empresa, referenceDate],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (instFetched) setInstallations(instFetched);
  }, [instFetched]);

  // ── Reactive fetch: YoY table (empresa + referenceDate) ───────────────────
  // Same dep semantics as Top Fields / Installations — RPC computes its own
  // MoM/YoY/YTD references off the reference month internally.
  const { data: yoyFetched, loading: yoyLoading } = useDebouncedFetch<
    ProductionYoYRow[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !empresa || !referenceDate) return null;
      try {
        return await rpcGetProductionYoyTable(supabase, empresa, referenceDate);
      } catch (e) {
        console.error("YoY table refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, empresa, referenceDate],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (yoyFetched) setYoyTable(yoyFetched);
  }, [yoyFetched]);

  // ── Reactive fetch: Header table (empresa + referenceDate) ────────────────
  //
  // Round 8 (2026-05-27). Same dep semantics as YoY / Top Fields /
  // Installations — single reference-month snapshot, server computes MoM/YoY/
  // YTD internally. Fires in parallel with the other reference-month-anchored
  // panels (each panel has its own useDebouncedFetch instance).
  const { data: headerFetched, loading: headerLoading } = useDebouncedFetch<
    WellByWellHeaderRow[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !empresa || !referenceDate) return null;
      const year = parseInt(referenceDate.slice(0, 4), 10);
      const month = parseInt(referenceDate.slice(5, 7), 10);
      if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
      try {
        return await rpcGetWellByWellHeader(supabase, empresa, year, month);
      } catch (e) {
        console.error("Header table refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, empresa, referenceDate],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (headerFetched) setHeaderData(headerFetched);
  }, [headerFetched]);

  // ── If the dateRange changes such that referenceDate falls outside it, ────
  //    snap referenceDate to dateRange[1] (most recent month in window).
  const lastSnapRef = useRef<string>("");
  useEffect(() => {
    if (!dateRange[1] || !referenceDate) return;
    if (referenceDate > dateRange[1] || referenceDate < dateRange[0]) {
      if (lastSnapRef.current !== dateRange[1]) {
        lastSnapRef.current = dateRange[1];
        setReferenceDateState(dateRange[1]);
      }
    }
  }, [dateRange, referenceDate]);

  // (Round 6, 2026-05-27) The `kpi` useMemo was removed. See the matching
  // comment on the hook return type — top-strip KPIs delivered unreliable Δ
  // MoM / Δ YoY against partial months. The YoY table (rendered at the bottom
  // of both Views) replaces it; drill-down KPIs are unaffected.

  // ── Field drill-down: open / close handlers + reactive fetch ──────────────
  //
  // Open is intent-driven (user clicked a row) — feedback should be fast, so
  // no debounce here. The fetch reuses the dashboard's current dateRange +
  // empresa so the drilled-in timeseries matches the period the user is
  // looking at. Closing clears the timeseries to avoid stale flicker if a
  // different field is reopened later.
  //
  // Mutual exclusivity (Round 3): opening the field drill auto-closes any
  // open installation drill, and vice versa — only one modal/BottomSheet on
  // screen at a time.
  //
  // Round 4 (canonical grouping, 2026-05-28): `campo` is a CANONICAL field
  // name — `get_production_top_fields` already groups by
  // `canonical_field_name(p.campo)`, so the value handed in from the Top
  // Fields chart click / mobile card tap is canonical. The server-side
  // `get_production_field_timeseries` interprets `p_campo` as canonical and
  // expands the WHERE clause to all variants under it (so the drill timeseries
  // sums Búzios + AnC_Búzios + Búzios_ECO etc.).
  const openFieldDrill = useCallback((campo: string) => {
    // Close installation drill first (mutual exclusivity)
    setDrillInstalacao(null);
    setDrillInstalacaoTimeseries([]);
    setDrillInstalacaoError(null);
    setDrillCampo(campo);
  }, []);
  const closeFieldDrill = useCallback(() => {
    setDrillCampo(null);
    setDrillTimeseries([]);
    setDrillError(null);
  }, []);

  useEffect(() => {
    if (!supabase || !drillCampo || !empresa || !dateRange[0] || !dateRange[1]) {
      return;
    }
    let cancelled = false;
    setDrillLoading(true);
    setDrillError(null);
    (async () => {
      try {
        const rows = await rpcGetProductionFieldTimeseries(
          supabase,
          drillCampo,
          empresa,
          dateRange[0],
          dateRange[1],
        );
        if (!cancelled) setDrillTimeseries(rows);
      } catch (e) {
        if (!cancelled) {
          console.error("Field drill timeseries refetch failed", e);
          setDrillError(e instanceof Error ? e.message : String(e));
          setDrillTimeseries([]);
        }
      } finally {
        if (!cancelled) setDrillLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, drillCampo, empresa, dateRange]);

  // ── Installation drill-down: open / close handlers + reactive fetch ───────
  //
  // Mirrors the field drill exactly (intent-driven open, no debounce, reuses
  // dateRange + empresa, clears state on close). Mutually exclusive with the
  // field drill — opening this auto-closes any open field drill.
  const openInstallationDrill = useCallback((instalacao: string) => {
    // Close field drill first (mutual exclusivity)
    setDrillCampo(null);
    setDrillTimeseries([]);
    setDrillError(null);
    setDrillInstalacao(instalacao);
  }, []);
  const closeInstallationDrill = useCallback(() => {
    setDrillInstalacao(null);
    setDrillInstalacaoTimeseries([]);
    setDrillInstalacaoError(null);
  }, []);

  useEffect(() => {
    if (!supabase || !drillInstalacao || !empresa || !dateRange[0] || !dateRange[1]) {
      return;
    }
    let cancelled = false;
    setDrillInstalacaoLoading(true);
    setDrillInstalacaoError(null);
    (async () => {
      try {
        const rows = await rpcGetProductionInstallationTimeseries(
          supabase,
          drillInstalacao,
          empresa,
          dateRange[0],
          dateRange[1],
        );
        if (!cancelled) setDrillInstalacaoTimeseries(rows);
      } catch (e) {
        if (!cancelled) {
          console.error("Installation drill timeseries refetch failed", e);
          setDrillInstalacaoError(e instanceof Error ? e.message : String(e));
          setDrillInstalacaoTimeseries([]);
        }
      } finally {
        if (!cancelled) setDrillInstalacaoLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, drillInstalacao, empresa, dateRange]);

  // Derived KPIs for the drill (client-side from the 13mo series).
  //   currentOil = last month's stake-weighted oil, kbpd
  //   prevOil    = month-before-last
  //   momPct     = (currentOil - prevOil) / prevOil
  //   yoyPct     = vs same calendar month one year prior (if present in series)
  //   ytdAvg     = average of all months in the same calendar year as the
  //                most-recent month (so for "Apr 2026" it averages Jan..Apr 2026)
  const drillKpis = useMemo(() => {
    if (drillTimeseries.length === 0) {
      return { currentOil: 0, prevOil: null, momPct: null, yoyPct: null, ytdAvg: null };
    }
    // Sort ascending so the last entry is the most-recent month.
    const sorted = [...drillTimeseries].sort((a, b) => {
      if (a.ano !== b.ano) return a.ano - b.ano;
      return a.mes - b.mes;
    });
    const last = sorted[sorted.length - 1];
    const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
    const currentOil = bblDiaToKbpd(last.oil_bbl_dia);
    const prevOil = prev ? bblDiaToKbpd(prev.oil_bbl_dia) : null;
    const momPct = prev && prevOil && prevOil !== 0
      ? (currentOil - prevOil) / prevOil
      : null;

    // YoY: find the row at (last.ano - 1, last.mes), if it exists in the
    // visible window. If the window is shorter than 13 months it may not.
    const yoyMatch = sorted.find((r) => r.ano === last.ano - 1 && r.mes === last.mes);
    const yoyOil = yoyMatch ? bblDiaToKbpd(yoyMatch.oil_bbl_dia) : null;
    const yoyPct = yoyOil != null && yoyOil !== 0
      ? (currentOil - yoyOil) / yoyOil
      : null;

    // YTD average — months in same calendar year as `last`, up to and
    // including `last.mes`.
    const ytdRows = sorted.filter((r) => r.ano === last.ano && r.mes <= last.mes);
    const ytdAvg = ytdRows.length > 0
      ? bblDiaToKbpd(ytdRows.reduce((s, r) => s + r.oil_bbl_dia, 0) / ytdRows.length)
      : null;

    return { currentOil, prevOil, momPct, yoyPct, ytdAvg };
  }, [drillTimeseries]);

  // Installation drill-down KPIs — identical math to drillKpis, sourced from
  // the installation timeseries. Kept as a separate memo (rather than a shared
  // helper) so the two states stay obviously independent in DevTools.
  const drillInstalacaoKpis = useMemo(() => {
    if (drillInstalacaoTimeseries.length === 0) {
      return { currentOil: 0, prevOil: null, momPct: null, yoyPct: null, ytdAvg: null };
    }
    const sorted = [...drillInstalacaoTimeseries].sort((a, b) => {
      if (a.ano !== b.ano) return a.ano - b.ano;
      return a.mes - b.mes;
    });
    const last = sorted[sorted.length - 1];
    const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
    const currentOil = bblDiaToKbpd(last.oil_bbl_dia);
    const prevOil = prev ? bblDiaToKbpd(prev.oil_bbl_dia) : null;
    const momPct = prev && prevOil && prevOil !== 0
      ? (currentOil - prevOil) / prevOil
      : null;

    const yoyMatch = sorted.find((r) => r.ano === last.ano - 1 && r.mes === last.mes);
    const yoyOil = yoyMatch ? bblDiaToKbpd(yoyMatch.oil_bbl_dia) : null;
    const yoyPct = yoyOil != null && yoyOil !== 0
      ? (currentOil - yoyOil) / yoyOil
      : null;

    const ytdRows = sorted.filter((r) => r.ano === last.ano && r.mes <= last.mes);
    const ytdAvg = ytdRows.length > 0
      ? bblDiaToKbpd(ytdRows.reduce((s, r) => s + r.oil_bbl_dia, 0) / ytdRows.length)
      : null;

    return { currentOil, prevOil, momPct, yoyPct, ytdAvg };
  }, [drillInstalacaoTimeseries]);

  // ── Export (Tier 1, multi-sheet XLSX + zip-of-CSVs) ───────────────────────
  //
  // Excel: 4 sheets (Brazil aggregate, Company aggregate, Top Fields,
  //        Installations). Reuses the active filter scope — does NOT refetch
  //        unfiltered data.
  // CSV: same 4 datasets, each as one CSV, bundled in a zip.

  const handleExportExcel = useCallback(async () => {
    setExcelLoading(true);
    try {
      // Defer ExcelJS to keep the initial bundle slim. Import as both runtime
      // value (default) and type-only namespace (for CellValue) — Next.js
      // bundler handles the split.
      const ExcelJSModule = await import("exceljs");
      type CellValue = import("exceljs").CellValue;
      const ExcelJS = ExcelJSModule.default;
      const wb = new ExcelJS.Workbook();

      const writeSheet = <T>(
        name: string,
        rows: T[],
        columns: { key: keyof T; header: string; format?: string }[],
      ) => {
        const ws = wb.addWorksheet(name);
        ws.views = [{ showGridLines: false }];

        // Header row
        const hRow = ws.getRow(1);
        columns.forEach((c, i) => {
          const cell = ws.getCell(1, i + 1);
          cell.value = c.header;
          cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF000512" },
          };
          cell.alignment = { horizontal: i === 0 ? "left" : "center" };
          ws.getColumn(i + 1).width = Math.max(c.header.length + 2, 14);
        });
        hRow.height = 16;

        // Data rows
        rows.forEach((r, ri) => {
          const dRow = ws.getRow(ri + 2);
          dRow.height = 14;
          columns.forEach((c, ci) => {
            const cell = ws.getCell(ri + 2, ci + 1);
            const v = r[c.key];
            cell.value = (v === undefined ? null : (v as unknown)) as CellValue;
            cell.font = { name: "Arial", size: 10, color: { argb: "FF1A1A1A" } };
            if (c.format) cell.numFmt = c.format;
            cell.alignment = { horizontal: ci === 0 ? "left" : "center" };
          });
        });
      };

      writeSheet("Brazil", brazilData, [
        { key: "ano",           header: "Year" },
        { key: "mes",           header: "Month" },
        { key: "ambiente",      header: "Environment" },
        { key: "oil_bbl_dia",   header: "Oil (bbl/day)",   format: "#,##0.0" },
        { key: "gas_mm3_dia",   header: "Gas (Mm³/day)",   format: "#,##0.000" },
        { key: "water_bbl_dia", header: "Water (bbl/day)", format: "#,##0.0" },
        { key: "hours_rate",    header: "Hours rate",      format: "0.000" },
      ]);

      writeSheet(empresa.slice(0, 28), companyData, [
        { key: "ano",           header: "Year" },
        { key: "mes",           header: "Month" },
        { key: "ambiente",      header: "Environment" },
        { key: "oil_bbl_dia",   header: "Oil (bbl/day, stake-weighted)",   format: "#,##0.0" },
        { key: "gas_mm3_dia",   header: "Gas (Mm³/day, stake-weighted)",   format: "#,##0.000" },
        { key: "water_bbl_dia", header: "Water (bbl/day, stake-weighted)", format: "#,##0.0" },
      ]);

      writeSheet("Top Fields", topFields, [
        { key: "campo",         header: "Field" },
        { key: "oil_bbl_dia",   header: "Oil (bbl/day)",   format: "#,##0.0" },
        { key: "water_bbl_dia", header: "Water (bbl/day)", format: "#,##0.0" },
        { key: "hours_rate",    header: "Hours rate",      format: "0.000" },
        { key: "stake_pct",     header: "Stake (%)",       format: "0.00" },
      ]);

      writeSheet("Installations", installations, [
        { key: "instalacao",  header: "Installation" },
        { key: "oil_bbl_dia", header: "Oil (bbl/day)",   format: "#,##0.0" },
        { key: "gas_mm3_dia", header: "Gas (Mm³/day)",   format: "#,##0.000" },
        { key: "hours_rate",  header: "Hours rate",      format: "0.000" },
      ]);

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const yy = String(now.getFullYear()).slice(-2);
      a.href = url;
      a.download = `Production ${empresa} ${dd}-${mm}-${yy}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("/well-by-well Excel export failed", e);
    } finally {
      setExcelLoading(false);
    }
  }, [brazilData, companyData, topFields, installations, empresa]);

  const handleExportCsv = useCallback(async () => {
    setCsvLoading(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      const rowsToCsv = <T>(
        rows: T[],
        columns: (keyof T)[],
      ): string => {
        const escape = (v: unknown): string => {
          const s = v == null ? "" : String(v);
          return `"${s.replaceAll('"', '""')}"`;
        };
        const lines = [columns.map((c) => escape(String(c))).join(",")];
        for (const r of rows) {
          lines.push(columns.map((c) => escape(r[c])).join(","));
        }
        return lines.join("\n");
      };

      zip.file(
        "brazil_aggregate.csv",
        rowsToCsv(brazilData, [
          "ano", "mes", "ambiente", "oil_bbl_dia", "gas_mm3_dia", "water_bbl_dia", "hours_rate",
        ]),
      );
      zip.file(
        `${empresa.replace(/\s+/g, "_").toLowerCase()}_aggregate.csv`,
        rowsToCsv(companyData, [
          "ano", "mes", "ambiente", "oil_bbl_dia", "gas_mm3_dia", "water_bbl_dia",
        ]),
      );
      zip.file(
        "top_fields.csv",
        rowsToCsv(topFields, ["campo", "oil_bbl_dia", "water_bbl_dia", "hours_rate", "stake_pct"]),
      );
      zip.file(
        "installations.csv",
        rowsToCsv(installations, ["instalacao", "oil_bbl_dia", "gas_mm3_dia", "hours_rate"]),
      );

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const yy = String(now.getFullYear()).slice(-2);
      a.href = url;
      a.download = `Production ${empresa} ${dd}-${mm}-${yy}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("/well-by-well CSV export failed", e);
    } finally {
      setCsvLoading(false);
    }
  }, [brazilData, companyData, topFields, installations, empresa]);

  // ── Anything loading? ─────────────────────────────────────────────────────
  const anyLoading =
    brazilLoading || companyLoading || topFieldsLoading || installationsLoading || yoyLoading || headerLoading;

  return {
    visible,
    visLoading,

    bootstrapping,
    latestMonth,

    empresasList,
    empresa,
    setEmpresa,

    allMonths,
    dateRange,
    setDateRange,
    monthIdxRange,
    setMonthIdxRange,

    ambientes,
    setAmbientes,
    toggleAmbiente,

    referenceDate,
    setReferenceDate,

    brazilData,
    companyData,
    topFields,
    installations,
    yoyTable,
    headerData,

    brazilLoading,
    companyLoading,
    topFieldsLoading,
    installationsLoading,
    yoyLoading,
    headerLoading,
    anyLoading,

    error,

    excelLoading,
    csvLoading,
    handleExportExcel,
    handleExportCsv,

    drillCampo,
    drillTimeseries,
    drillLoading,
    drillError,
    drillKpis,
    openFieldDrill,
    closeFieldDrill,

    drillInstalacao,
    drillInstalacaoTimeseries,
    drillInstalacaoLoading,
    drillInstalacaoError,
    drillInstalacaoKpis,
    openInstallationDrill,
    closeInstallationDrill,
  };
}
