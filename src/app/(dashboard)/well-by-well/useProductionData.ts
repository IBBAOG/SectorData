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
// Round 9 (2026-05-27): the legacy "empresa dropdown" was replaced by FIVE
// mutually-exclusive VIEW PILLS — `Brasil` (default), `Petrobras`, `PRIO`,
// `PetroReconcavo`, `Brava Energia`. The hook exposes a `view` state machine
// that toggles between Brasil (100% WI, no stake math) and one of four
// stake-weighted company views. The chart count dropped from 4 to 3:
//   - Chart 1: Oil production stacked by ambiente (Brazil OR company)
//   - Chart 2: Top fields (Brazil OR stake-weighted)
//   - Chart 3: Installations (Brazil OR stake-weighted)
// The duplicated "P1 Brazil + P2 Company" desktop layout is gone — when the
// user wants Brazil context, they tap the Brasil pill; when they want a
// company, they tap that company pill. No side-by-side compare.
//
// Data sources (5 base + 4 Brazil RPCs, all SECURITY DEFINER):
//   • get_production_brazil_aggregate(date_start, date_end, ambientes[]?)
//       → Brazil-wide stacked bars (no stake weighting)
//   • get_production_company_aggregate(empresa, date_start, date_end, ambientes[]?)
//       → Stake-weighted stacked bars for the selected company
//   • get_production_top_fields(empresa, date, top_n=10)
//       → Horizontal bar: top fields stake-weighted (company view)
//   • get_production_by_installation(empresa, date)
//       → Table: FPSO/UEP-level production stake-weighted (company view)
//   • get_production_yoy_table(empresa, date)
//       → YoY/MoM/YTD breakdown at the reference month (mobile drawer only)
//   • get_production_brazil_top_fields(date, top_n=10)            ← Round 9
//   • get_production_brazil_installation(date)                    ← Round 9
//   • get_production_brazil_field_timeseries(campo, ...)          ← Round 9
//   • get_production_brazil_installation_timeseries(instalacao,…) ← Round 9
//
// View list comes from `WELL_BY_WELL_VIEWS` (`src/data/wellByWellEmpresas.ts`).
// The empresa list from `get_field_stakes_empresas()` is no longer surfaced in
// the dashboard, but the wrapper is still called to drive the admin panel
// integration warmup and to silently snap `view` to `Brasil` if a stale
// session points outside the 5-view whitelist.
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes to one
// View must land in the OTHER View in the same commit, OR the commit message
// must declare [desktop-only] / [mobile-only] with an explicit reason.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  WELL_BY_WELL_VIEWS,
  isCompanyView,
  type WellByWellView,
} from "../../../data/wellByWellEmpresas";
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
  rpcGetProductionBrazilTopFields,
  rpcGetProductionBrazilInstallation,
  rpcGetProductionBrazilFieldTimeseries,
  rpcGetProductionBrazilInstallationTimeseries,
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

/**
 * Default pill on first paint. "Brasil" is the report-style opener: country-
 * wide totals first, drill into a company afterward. Replaces the previous
 * `DEFAULT_EMPRESA = "Petrobras"` default from Rounds 1-8.
 */
export const DEFAULT_VIEW: WellByWellView = "Brasil";

/**
 * Empresa default used by RPCs that REQUIRE a non-null empresa param even in
 * Brasil view (specifically `get_well_by_well_header` — the header table
 * always shows Brazil + a company section, so we still need a company name).
 * The HeaderTable component drops the company section when `view === "Brasil"`.
 */
export const HEADER_TABLE_FALLBACK_EMPRESA = "Petrobras";

/**
 * Back-compat default for callers that still want a company name (none on
 * mainline as of Round 9 — every Brasil-aware caller switches on `view`).
 */
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

  // View pill state machine (Round 9, 2026-05-27).
  // `view` is one of `WELL_BY_WELL_VIEWS` and drives which RPC family fires:
  //   - "Brasil"        → Brazil-wide RPCs (no stake weighting)
  //   - company name    → stake-weighted RPCs for that company
  // `viewEmpresa` is a convenience derived value: `null` for Brasil, else the
  // company name. Use it at the call site instead of branching on `view !==
  // "Brasil"` everywhere.
  view: WellByWellView;
  setView: (v: WellByWellView) => void;
  /** True when the active view is a company (everything except Brasil). */
  isCompanyView: boolean;
  /** Company name when `view !== "Brasil"`; null in Brasil view. */
  viewEmpresa: string | null;

  // Back-compat: existing call sites still read `empresa` (e.g. drill modal
  // header labels). It now mirrors `viewEmpresa ?? "Brasil"` so labels read
  // sensibly in both modes ("BÚZIOS — Brasil" / "BÚZIOS — Petrobras").
  empresasList: FieldStakeEmpresa[];
  empresa: string;
  /** @deprecated since Round 9. Use `setView` instead. Kept as a noop alias
   *  so legacy call sites compile during the transition. */
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

  // Reference month (used by top fields + installations + YoY + Header table)
  referenceDate: string;                          // YYYY-MM-01
  setReferenceDate: (d: string) => void;

  // Data states. In Brasil view, `companyData` is always [] (chart 1 reads
  // brazilData); in company view, brazilData stays populated but is not
  // rendered by chart 1 — only by the HeaderTable's Brazil section.
  brazilData: ProductionBrazilRow[];
  companyData: ProductionCompanyRow[];
  topFields: ProductionTopField[];
  installations: ProductionInstallation[];
  yoyTable: ProductionYoYRow[];
  /** PDF page-2 header table (Brazil + Empresa rollup). */
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

  // Export (Tier 1 — direct download, multi-sheet Excel + zip CSV)
  excelLoading: boolean;
  csvLoading: boolean;
  handleExportExcel: () => Promise<void>;
  handleExportCsv: () => Promise<void>;

  // Field drill-down. In Brasil view the drill calls the Brazil-wide
  // timeseries RPC; in company view the stake-weighted one. UI is identical.
  drillCampo: string | null;
  drillTimeseries: ProductionFieldTimeseriesRow[];
  drillLoading: boolean;
  drillError: string | null;
  drillKpis: {
    currentOil: number;
    prevOil: number | null;
    momPct: number | null;
    yoyPct: number | null;
    ytdAvg: number | null;
  };
  openFieldDrill: (campo: string) => void;
  closeFieldDrill: () => void;

  // Installation drill-down. Same Brasil-vs-company branching as the field
  // drill. Mutually exclusive with the field drill.
  drillInstalacao: string | null;
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

  // Round 9: view replaces empresa as the active toggle state. Default is
  // "Brasil" — first thing the user sees on page load.
  const [view, setViewState] = useState<WellByWellView>(DEFAULT_VIEW);
  const [ambientes, setAmbientesState] = useState<string[]>([...AMBIENTES]);

  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [monthIdxRange, setMonthIdxRangeState] = useState<[number, number]>([0, 0]);

  const [referenceDate, setReferenceDateState] = useState<string>("");

  const [brazilData, setBrazilData] = useState<ProductionBrazilRow[]>([]);
  const [companyData, setCompanyData] = useState<ProductionCompanyRow[]>([]);
  const [topFields, setTopFields] = useState<ProductionTopField[]>([]);
  const [installations, setInstallations] = useState<ProductionInstallation[]>([]);
  const [yoyTable, setYoyTable] = useState<ProductionYoYRow[]>([]);
  // PDF page-2 header table backing state (Round 8, kept).
  const [headerData, setHeaderData] = useState<WellByWellHeaderRow[]>([]);

  const [error, setError] = useState<Error | null>(null);

  const [excelLoading, setExcelLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  // Field drill-down state (Round 2; canonical-aware since Round 4;
  // Brasil-aware since Round 9). `drillCampo` doubles as the visibility flag
  // for the modal/sheet — null when closed, the canonical name when open.
  const [drillCampo, setDrillCampo] = useState<string | null>(null);
  const [drillTimeseries, setDrillTimeseries] = useState<ProductionFieldTimeseriesRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  // Installation drill-down state (Round 3; Brasil-aware since Round 9).
  const [drillInstalacao, setDrillInstalacao] = useState<string | null>(null);
  const [drillInstalacaoTimeseries, setDrillInstalacaoTimeseries] = useState<ProductionInstallationTimeseriesRow[]>([]);
  const [drillInstalacaoLoading, setDrillInstalacaoLoading] = useState(false);
  const [drillInstalacaoError, setDrillInstalacaoError] = useState<string | null>(null);

  // ── Derived: view ↔ empresa convenience ───────────────────────────────────
  const viewIsCompany = isCompanyView(view);
  const viewEmpresa: string | null = viewIsCompany ? view : null;
  // Back-compat alias for legacy call sites that still read `empresa`.
  const empresa = viewEmpresa ?? "Brasil";

  // ── Derived: dateRange from monthIdxRange ─────────────────────────────────
  const dateRange = useMemo<[string, string]>(() => {
    if (allMonths.length === 0) return ["", ""];
    const a = allMonths[monthIdxRange[0]] ?? allMonths[0];
    const b = allMonths[monthIdxRange[1]] ?? allMonths[allMonths.length - 1];
    return [a, b];
  }, [allMonths, monthIdxRange]);

  // ── Setters ────────────────────────────────────────────────────────────────
  const setView = useCallback((v: WellByWellView) => setViewState(v), []);
  // `setEmpresa` kept as a back-compat alias — translates a company name back
  // into the corresponding view pill. Setting it to a non-whitelisted name is
  // a noop (defensive). Brand-new code should call `setView` directly.
  const setEmpresa = useCallback((name: string) => {
    if ((WELL_BY_WELL_VIEWS as readonly string[]).includes(name)) {
      setViewState(name as WellByWellView);
    }
  }, []);
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
  // Round 9: the bootstrap still calls `rpcGetFieldStakesEmpresas` because the
  // admin panel relies on the warm cache (and the snap-to-Brasil logic needs
  // to know whether `view` is in the 5-view whitelist). Brazil aggregate probe
  // still seeds `brazilData` for the default window — same Round 5 perf trick.
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
        // Restrict the dashboard's empresa list to the IR-relevant whitelist
        // (4 companies). The admin panel's Field Stakes editor still consumes
        // the full list via the same RPC wrapper — this filter only narrows
        // what the dashboard sees. Round 9: the list is no longer rendered
        // (pills replaced the dropdown), but we still expose it on
        // `empresasList` for back-compat with anything that may consume it.
        const companyViews = WELL_BY_WELL_VIEWS.filter(isCompanyView);
        const allowed = new Set<string>(companyViews);
        const orderIdx = new Map<string, number>(
          companyViews.map((name, i) => [name, i]),
        );
        empresas = empresas
          .filter((e) => allowed.has(e.empresa))
          .sort(
            (a, b) =>
              (orderIdx.get(a.empresa) ?? Number.MAX_SAFE_INTEGER) -
              (orderIdx.get(b.empresa) ?? Number.MAX_SAFE_INTEGER),
          );
        setEmpresasList(empresas);

        // Safety: snap `view` back to `Brasil` if a stale session points
        // outside the 5-view whitelist (e.g. URL param or restored state).
        setViewState((cur) =>
          (WELL_BY_WELL_VIEWS as readonly string[]).includes(cur) ? cur : DEFAULT_VIEW,
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

        // Seed Brazil data from the probe (Round 5 perf win) — even though
        // chart 1 only renders Brazil when `view === "Brasil"`, the
        // HeaderTable in company view still needs Brazil values, and the
        // bootstrap probe is already in flight regardless.
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

  // ── Reactive fetch: Brazil aggregate ──────────────────────────────────────
  //
  // Brazil aggregate is consumed by:
  //   - Chart 1 when `view === "Brasil"`
  // It's NOT needed by the HeaderTable (the table has its own server-side
  // header RPC). Therefore we can SKIP this fetch entirely when the view is
  // a company — chart 1 in company view reads companyData, not brazilData.
  //
  // Note: deps INTENTIONALLY include `view` so when the user toggles back to
  // Brasil from a company, we re-fetch to ensure freshness for the period/
  // ambientes that may have changed while the company tab was active.
  const { data: brazilFetched, loading: brazilLoading } = useDebouncedFetch<
    ProductionBrazilRow[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !dateRange[0] || !dateRange[1]) return null;
      if (view !== "Brasil") return null; // skip when company is active
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
    [supabase, bootstrapping, view, dateRange[0], dateRange[1], ambientes.join("|")],
    { ms: 150, skipInitial: true },
  );
  useEffect(() => {
    if (brazilFetched) setBrazilData(brazilFetched);
  }, [brazilFetched]);

  // ── Reactive fetch: Company aggregate ─────────────────────────────────────
  //
  // Only fires when a company pill is active. In Brasil view we clear the
  // companyData state on view-change so a stale company chart doesn't
  // flash if the user re-enters a company tab.
  const { data: companyFetched, loading: companyLoading } = useDebouncedFetch<
    ProductionCompanyRow[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !dateRange[0] || !dateRange[1]) return null;
      if (!viewIsCompany || !viewEmpresa) return null;
      const ambientesParam = ambientes.length > 0 && ambientes.length < AMBIENTES.length
        ? ambientes
        : null;
      try {
        return await rpcGetProductionCompanyAggregate(
          supabase,
          viewEmpresa,
          dateRange[0],
          dateRange[1],
          ambientesParam,
        );
      } catch (e) {
        console.error("Company aggregate refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, view, dateRange[0], dateRange[1], ambientes.join("|")],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (companyFetched) setCompanyData(companyFetched);
  }, [companyFetched]);

  // Clear stale data when switching views so we don't render a flash of the
  // previous mode's data while the new fetch is in flight.
  useEffect(() => {
    if (view === "Brasil") {
      setCompanyData([]);
    }
  }, [view]);

  // ── Reactive fetch: Top fields ────────────────────────────────────────────
  //
  // Brasil view → get_production_brazil_top_fields(date, top_n)
  // Company view → get_production_top_fields(empresa, date, top_n) (existing)
  //
  // Deps deliberately exclude dateRange & ambientes — Top Fields is a single-
  // month snapshot anchored to referenceDate.
  const { data: topFetched, loading: topFieldsLoading } = useDebouncedFetch<
    ProductionTopField[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !referenceDate) return null;
      try {
        if (view === "Brasil") {
          return await rpcGetProductionBrazilTopFields(supabase, referenceDate, 10);
        }
        if (!viewEmpresa) return null;
        return await rpcGetProductionTopFields(supabase, viewEmpresa, referenceDate, 10);
      } catch (e) {
        console.error("Top fields refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, view, referenceDate],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (topFetched) setTopFields(topFetched);
  }, [topFetched]);

  // ── Reactive fetch: Installations ─────────────────────────────────────────
  const { data: instFetched, loading: installationsLoading } = useDebouncedFetch<
    ProductionInstallation[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !referenceDate) return null;
      try {
        if (view === "Brasil") {
          return await rpcGetProductionBrazilInstallation(supabase, referenceDate);
        }
        if (!viewEmpresa) return null;
        return await rpcGetProductionByInstallation(supabase, viewEmpresa, referenceDate);
      } catch (e) {
        console.error("Installations refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, view, referenceDate],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (instFetched) setInstallations(instFetched);
  }, [instFetched]);

  // ── Reactive fetch: YoY table (mobile drawer only, still company-only) ────
  //
  // The YoY/MoM/YTD table is consumed only by the mobile collapsible drawer
  // (desktop dropped it in Round 8). In Brasil view the drawer is hidden, so
  // we skip the fetch entirely.
  const { data: yoyFetched, loading: yoyLoading } = useDebouncedFetch<
    ProductionYoYRow[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !referenceDate) return null;
      if (!viewIsCompany || !viewEmpresa) return null;
      try {
        return await rpcGetProductionYoyTable(supabase, viewEmpresa, referenceDate);
      } catch (e) {
        console.error("YoY table refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, view, referenceDate],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (yoyFetched) setYoyTable(yoyFetched);
  }, [yoyFetched]);

  // ── Reactive fetch: Header table ──────────────────────────────────────────
  //
  // `get_well_by_well_header(p_empresa, p_year, p_month)` always returns
  // Brazil + a company section together. In Brasil view we still call it but
  // pass the fallback empresa (Petrobras) — the HeaderTable component filters
  // to `section === 'BRAZIL'` when the view is Brasil, dropping the company
  // section client-side. This is intentionally one extra unused RPC slice in
  // exchange for not needing a separate Brazil-only header RPC.
  //
  // Empresa decision is derived from `view` INSIDE the closure (not from the
  // outer-scope `viewEmpresa`) so it's obvious-by-inspection that this fetch
  // reacts to view-pill clicks. Listed explicitly in the deps array too.
  // Switching Brasil ↔ Petrobras sends the same empresa string ("Petrobras")
  // — the user-visible change in that case is driven by HeaderTable's
  // `viewMode` prop filter, not by new data. Switching to PRIO /
  // PetroReconcavo / Brava Energia DOES change the empresa string and yields
  // a fresh RPC payload.
  const { data: headerFetched, loading: headerLoading } = useDebouncedFetch<
    WellByWellHeaderRow[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !referenceDate) return null;
      const year = parseInt(referenceDate.slice(0, 4), 10);
      const month = parseInt(referenceDate.slice(5, 7), 10);
      if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
      // Explicit branch on `view` (matches the deps array entry below). For
      // Brasil view we send the non-null fallback empresa because the RPC
      // requires a non-null `p_empresa` — the HeaderTable component then
      // hides the company-section rows client-side via its `viewMode` prop.
      const empresaForHeader: string =
        view === "Brasil" ? HEADER_TABLE_FALLBACK_EMPRESA : view;
      try {
        return await rpcGetWellByWellHeader(supabase, empresaForHeader, year, month);
      } catch (e) {
        console.error("Header table refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, view, referenceDate],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (headerFetched) setHeaderData(headerFetched);
  }, [headerFetched]);

  // Round 12 (2026-05-27): the Round 10 defensive clear effect that pruned
  // headerData to Brazil-only rows on view change has been REMOVED. The
  // HeaderTable component now filters by `section === UPPER(viewMode)`
  // client-side (Brasil → BRAZIL rows; empresa pill → that empresa's rows;
  // see HeaderTable.tsx), which handles stale-data flashes on view change for
  // free: when the user toggles Petrobras → PRIO, the previously fetched
  // PETROBRAS rows no longer match the new filter and disappear immediately,
  // even before the new RPC payload lands. The filter is a strict superset of
  // what the clear effect did, so keeping both was redundant.
  //
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

  // ── Field drill-down: open / close handlers + reactive fetch ──────────────
  //
  // Brasil view → get_production_brazil_field_timeseries(campo, dateStart, dateEnd)
  // Company view → get_production_field_timeseries(campo, empresa, dateStart, dateEnd)
  //
  // Open is intent-driven (user clicked a row) — no debounce. Fetch reuses
  // the dashboard's current dateRange so the drilled-in timeseries matches
  // the period the user is looking at. Closing clears the timeseries to
  // avoid stale flicker if a different field is reopened later.
  //
  // Mutual exclusivity: opening the field drill auto-closes any open
  // installation drill, and vice versa.
  //
  // Round 4 (canonical grouping): `campo` is a CANONICAL field name. Both
  // RPC variants interpret it as canonical and expand server-side.
  //
  // Round 9: drill is also Brasil-aware — the company-vs-Brasil branch is
  // decided inside the fetch effect using current `view` state.
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
    if (!supabase || !drillCampo || !dateRange[0] || !dateRange[1]) return;
    // Brazil drill needs only campo+dates; company drill also needs empresa.
    if (viewIsCompany && !viewEmpresa) return;

    let cancelled = false;
    setDrillLoading(true);
    setDrillError(null);
    (async () => {
      try {
        const rows = view === "Brasil"
          ? await rpcGetProductionBrazilFieldTimeseries(
              supabase,
              drillCampo,
              dateRange[0],
              dateRange[1],
            )
          : await rpcGetProductionFieldTimeseries(
              supabase,
              drillCampo,
              viewEmpresa as string,
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
  }, [supabase, drillCampo, view, viewIsCompany, viewEmpresa, dateRange]);

  // ── Installation drill-down: open / close handlers + reactive fetch ───────
  //
  // Brasil view → get_production_brazil_installation_timeseries(instalacao, ...)
  // Company view → get_production_installation_timeseries(instalacao, empresa, ...)
  //
  // Mirrors the field drill exactly.
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
    if (!supabase || !drillInstalacao || !dateRange[0] || !dateRange[1]) return;
    if (viewIsCompany && !viewEmpresa) return;

    let cancelled = false;
    setDrillInstalacaoLoading(true);
    setDrillInstalacaoError(null);
    (async () => {
      try {
        const rows = view === "Brasil"
          ? await rpcGetProductionBrazilInstallationTimeseries(
              supabase,
              drillInstalacao,
              dateRange[0],
              dateRange[1],
            )
          : await rpcGetProductionInstallationTimeseries(
              supabase,
              drillInstalacao,
              viewEmpresa as string,
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
  }, [supabase, drillInstalacao, view, viewIsCompany, viewEmpresa, dateRange]);

  // ── Drill close on view change (avoid mismatched header label) ────────────
  //
  // If a drill modal is open and the user switches the pill, the title
  // currently shown ("BÚZIOS — Petrobras") would not match the new fetched
  // data (Brasil-wide). Auto-close on view change to force re-entry.
  useEffect(() => {
    setDrillCampo(null);
    setDrillTimeseries([]);
    setDrillError(null);
    setDrillInstalacao(null);
    setDrillInstalacaoTimeseries([]);
    setDrillInstalacaoError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Derived KPIs for the drill (client-side from the 13mo series).
  const drillKpis = useMemo(() => {
    if (drillTimeseries.length === 0) {
      return { currentOil: 0, prevOil: null, momPct: null, yoyPct: null, ytdAvg: null };
    }
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
  }, [drillTimeseries]);

  // Installation drill-down KPIs — identical math, sourced from the
  // installation timeseries. Kept separate so the two states stay obviously
  // independent in DevTools.
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
  // Excel: in Brasil view → 3 sheets (Brazil aggregate / Top Fields / FPSOs).
  //        In company view → 4 sheets (Brazil + Company aggregate + Top
  //        Fields + FPSOs) for context.
  //
  // CSV: same datasets, one CSV per dataset, bundled in a zip.

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

      if (viewIsCompany && viewEmpresa) {
        writeSheet(viewEmpresa.slice(0, 28), companyData, [
          { key: "ano",           header: "Year" },
          { key: "mes",           header: "Month" },
          { key: "ambiente",      header: "Environment" },
          { key: "oil_bbl_dia",   header: "Oil (bbl/day, stake-weighted)",   format: "#,##0.0" },
          { key: "gas_mm3_dia",   header: "Gas (Mm³/day, stake-weighted)",   format: "#,##0.000" },
          { key: "water_bbl_dia", header: "Water (bbl/day, stake-weighted)", format: "#,##0.0" },
        ]);
      }

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
      a.download = `Production ${view} ${dd}-${mm}-${yy}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("/well-by-well Excel export failed", e);
    } finally {
      setExcelLoading(false);
    }
  }, [brazilData, companyData, topFields, installations, view, viewIsCompany, viewEmpresa]);

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
      if (viewIsCompany && viewEmpresa) {
        zip.file(
          `${viewEmpresa.replace(/\s+/g, "_").toLowerCase()}_aggregate.csv`,
          rowsToCsv(companyData, [
            "ano", "mes", "ambiente", "oil_bbl_dia", "gas_mm3_dia", "water_bbl_dia",
          ]),
        );
      }
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
      a.download = `Production ${view} ${dd}-${mm}-${yy}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("/well-by-well CSV export failed", e);
    } finally {
      setCsvLoading(false);
    }
  }, [brazilData, companyData, topFields, installations, view, viewIsCompany, viewEmpresa]);

  // ── Anything loading? ─────────────────────────────────────────────────────
  const anyLoading =
    brazilLoading || companyLoading || topFieldsLoading || installationsLoading || yoyLoading || headerLoading;

  return {
    visible,
    visLoading,

    bootstrapping,
    latestMonth,

    view,
    setView,
    isCompanyView: viewIsCompany,
    viewEmpresa,

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
