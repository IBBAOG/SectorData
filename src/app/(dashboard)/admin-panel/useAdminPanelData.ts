"use client";

// Brain hook for /admin-panel (dual-view pattern).
//
// Owns ALL state, RPC calls, and handlers used by both desktop/View.tsx and
// mobile/View.tsx. Views are pure presentation layers — they MUST NOT call
// Supabase or `profileRpc` directly. If a View needs a value the other doesn't
// have yet, you add it here first.
//
// Sections covered:
//   • Members           — list all users; promote/demote Admin ↔ Client
//   • Permissions       — three-column visibility per module:
//                         Public (anon), Clients (logged-in), Home (gallery card)
//   • Alerts            — admin console for the logged-in Client Alerts product
//   • Default Keywords  — manage default News Hunter keywords for anonymous visitors
//   • Data Input        — edit reference tables (desktop-only editor)
//
// RPCs touched: get_module_visibility (via UserProfileContext), set_module_visibility,
// set_module_home_visibility, set_module_public_visibility, get_all_users_with_roles,
// set_user_role, admin_list_default_news_keywords, admin_add_default_news_keyword,
// admin_remove_default_news_keyword, admin_alerts_* (Client Alerts console).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRoleGuard } from "../../../hooks/useRoleGuard";
import {
  useMarketDrivers,
  resolveDriverValue,
  MARKET_DRIVER_CATALOG,
  MARKET_DRIVER_CATALOG_BY_KEY,
  isDynamicSource,
  type DriverCatalogEntry,
} from "../../../hooks/useMarketDrivers";
import { useUserProfile } from "../../../context/UserProfileContext";
import { useStockQuote } from "../../../hooks/useStockQuote";
import {
  computeSensitivityCellValue,
  formatSensitivityValue,
  unitForValueMode,
  baseInputMeta,
  type SensitivityValueMode,
  type BaseInputMeta,
} from "../../../lib/stockGuideSensitivity";
import {
  rpcSetModuleVisibility,
  rpcSetModuleHomeVisibility,
  rpcSetModulePublicVisibility,
  rpcGetAllUsersWithRoles,
  rpcSetUserRole,
} from "../../../lib/profileRpc";
import {
  rpcAdminListDefaultNewsKeywords,
  rpcAdminAddDefaultNewsKeyword,
  rpcAdminSetDefaultNewsKeywordMatchType,
  rpcAdminRemoveDefaultNewsKeyword,
  rpcGetFieldStakesOverview,
  rpcGetFieldStakes,
  rpcGetFieldStakesEmpresas,
  rpcAdminUpsertFieldStakes,
  rpcAdminDeleteFieldStakes,
  rpcAdminGetStockGuideCompanies,
  rpcAdminUpsertStockGuideCompany,
  rpcAdminSetStockGuideVisibility,
  rpcGetStockGuideConfig,
  rpcAdminUpsertStockGuideConfig,
  rpcAdminDeleteStockGuideCompany,
  rpcGetStockGuideDrivers,
  rpcAdminUpsertStockGuideDriver,
  rpcAdminDeleteStockGuideDriver,
  rpcAdminGetStockGuideSensitivityTables,
  rpcAdminUpsertStockGuideSensitivityTable,
  rpcAdminDeleteStockGuideSensitivityTable,
  rpcAdminReplaceStockGuideScenarioGrid,
  rpcAdminCountStockGuideScenarioGrid,
  rpcListSubscribableBases,
  rpcAdminAlertsStats,
  rpcAdminAlertsListSubscribers,
  rpcAdminAlertsEmailLogRecent,
  rpcAdminAlertsToggleSource,
  rpcAdminAlertsSendTest,
  type DefaultNewsKeyword,
} from "../../../lib/rpc";
import type {
  SubscribableBase,
  AdminAlertsStats,
  AdminAlertsSubscriber,
  AdminAlertsEmailLogRow,
} from "../../../types/alerts";
import type {
  FieldStakeOverview,
  FieldStakeEmpresa,
  FieldStakeInput,
} from "../../../types/fieldStakes";
import type {
  StockGuideAdminCompany,
  StockGuideConfig,
  StockGuideSector,
  StockGuideDriver,
  SensitivityAxis,
  SensitivityTableAdmin,
  SensitivityGridBlock,
  SensitivityPanelKey,
} from "../../../types/stockGuide";
import {
  parseScenarioGridWorkbook,
  chunkUploadRows,
  type GridUploadResult,
} from "../../../lib/stockGuideGridUpload";

/**
 * State machine for the in-admin filled-template upload widget (parse → report →
 * upload → done / error). Exported so the desktop View can type its editor props.
 */
export type SgUploadState =
  | { phase: "idle" }
  | { phase: "parsing"; fileName: string }
  | { phase: "report"; fileName: string; result: GridUploadResult }
  | {
      phase: "uploading";
      fileName: string;
      result: GridUploadResult;
      sent: number;
      total: number;
    }
  | {
      phase: "done";
      fileName: string;
      total: number;
      byMetric: Record<string, number>;
    }
  | {
      phase: "error";
      fileName: string;
      message: string;
      result: GridUploadResult | null;
    };

// ── Field Stakes — canonical grouping (Round 4) ───────────────────────────────
//
// Several variants of the same physical field (e.g. Búzios concession +
// AnC_Búzios coparticipação + Búzios_ECO cessão onerosa excedente) share the
// same `canonical` so they collapse under a single header in the left pane.
// The right-pane editor still acts on ONE variant at a time (stakes differ
// per contract).
export interface FieldStakeCanonicalGroup {
  canonical: string;
  variants: FieldStakeOverview[];
  n_variants: number;
  /** All variants have soma_pct = 100. */
  all_complete: boolean;
  /** At least one variant has stakes registered but soma_pct ≠ 100. */
  any_incomplete: boolean;
  /** Every variant has zero companies registered. */
  all_empty: boolean;
}
import { getSupabaseClient } from "../../../lib/supabaseClient";
import type { UserWithRole, UserProfile } from "../../../types/profile";
import { EDITABLE_TABLES } from "@/lib/dataInput/registry";

// ── Stock Guide — editable comps row ──────────────────────────────────────────
//
// The subset of `stock_guide_companies` an admin edits in the comps form. Every
// numeric field is held as a STRING while typing (so the input can be cleared /
// hold a partial value); they are coerced to number|null only when building the
// `p_data` payload at save time. `ticker` doubles as the upsert key — it is set
// when a row is loaded and stays read-only for existing companies. `is_visible`
// is NOT part of this shape (it is the separate toggle RPC).
//
// FUNDAMENTALS, not multiples: the admin enters net debt per forward year,
// EBITDA, net income, FCFE and dividends per forward year. The 4 price-sensitive
// multiples (EV/EBITDA, P/E, FCFE Yield, Div Yield) are derived LIVE in the
// /stock-guide dashboard from the Yahoo price + these inputs — never entered here.
export interface SgEditorRow {
  ticker: string;
  company_name: string;
  yahoo_symbol: string;
  sector: StockGuideSector;
  volume_unit: "kbpd" | "thousand_m3";
  shares_outstanding: string;
  /** Forward net debt per year (BRL mn); EV(year) = market cap + net debt(year). May be < 0. */
  net_debt_y1: string;
  net_debt_y2: string;
  last_update: string;
  target_price: string;
  recommendation: "" | "OP" | "MP" | "UP";
  ebitda_y1: string;
  ebitda_y2: string;
  net_income_y1: string;
  net_income_y2: string;
  /**
   * Optional ADJUSTED net income (BRL mn), PER FORWARD YEAR, used ONLY on the
   * ex-tax-credit companion row's P/E denominator + its displayed Net Income.
   * Empty = the companion row falls back to the reported net income.
   */
  net_income_ex_y1: string;
  net_income_ex_y2: string;
  /**
   * Optional NPV of recognized tax credits (BRL mn), PER FORWARD YEAR. When
   * EITHER is > 0, the comps table renders an extra "{Company} ex-tax credit"
   * companion row whose per-year market-cap basis is the live market cap MINUS
   * that year's NPV. Both empty = no companion row.
   */
  npv_tax_credit_y1: string;
  npv_tax_credit_y2: string;
  fcfe_y1: string;
  fcfe_y2: string;
  dividends_y1: string;
  dividends_y2: string;
  volumes_y1: string;
  volumes_y2: string;
  display_order: string;
}

/** Stringify a number|null for an `<input>`'s value (null → empty string). */
function numToStr(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

/** Parse an input string back to number|null (empty/blank/NaN → null). */
function strToNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Project a full admin company row into the editable string-based editor row. */
function adminCompanyToEditorRow(c: StockGuideAdminCompany): SgEditorRow {
  return {
    ticker: c.ticker,
    company_name: c.company_name,
    yahoo_symbol: c.yahoo_symbol ?? "",
    sector: (c.sector ?? "oil_gas") as StockGuideSector,
    volume_unit: (c.volume_unit ?? "kbpd") as "kbpd" | "thousand_m3",
    shares_outstanding: numToStr(c.shares_outstanding),
    net_debt_y1: numToStr(c.net_debt_y1),
    net_debt_y2: numToStr(c.net_debt_y2),
    last_update: c.last_update ?? "",
    target_price: numToStr(c.target_price),
    recommendation: c.recommendation ?? "",
    ebitda_y1: numToStr(c.ebitda_y1),
    ebitda_y2: numToStr(c.ebitda_y2),
    net_income_y1: numToStr(c.net_income_y1),
    net_income_y2: numToStr(c.net_income_y2),
    net_income_ex_y1: numToStr(c.net_income_ex_y1),
    net_income_ex_y2: numToStr(c.net_income_ex_y2),
    npv_tax_credit_y1: numToStr(c.npv_tax_credit_y1),
    npv_tax_credit_y2: numToStr(c.npv_tax_credit_y2),
    fcfe_y1: numToStr(c.fcfe_y1),
    fcfe_y2: numToStr(c.fcfe_y2),
    dividends_y1: numToStr(c.dividends_y1),
    dividends_y2: numToStr(c.dividends_y2),
    volumes_y1: numToStr(c.volumes_y1),
    volumes_y2: numToStr(c.volumes_y2),
    display_order: numToStr(c.display_order),
  };
}

// ── Stock Guide — redesigned sensitivity model (drivers + table builder) ──────
//
// The admin section now exposes three sub-tabs (Companies / Drivers /
// Sensitivities). The first keeps the existing comps editor + global config
// untouched; the latter two drive the new first-class model (drivers registry +
// cross-company sensitivity tables) backed by the `*_stock_guide_driver` /
// `*_stock_guide_sensitivity_table` admin RPCs.

/** Sub-navigation of the Stock Guide admin section. */
export type SgSubTab = "companies" | "drivers" | "sensitivities";

/** Value modes a sensitivity table can render in (mirrors `SensitivityTable`). */
export type SgValueMode =
  | "absolute"
  | "yield"
  | "pe"
  | "ev_ebitda"
  | "upside";

/**
 * A driver row in the inline registry editor. `id === null` for the unsaved
 * "Add driver" row; numeric fields are held as strings while typing.
 */
export interface SgDriverEditorRow {
  id: number | null;
  name: string;
  unit: string;
  current_value: string;
  /**
   * Dynamic-driver binding: '' = STATIC (admin types `current_value`); a
   * market-driver catalog key (e.g. 'avg_brent_2026') = DYNAMIC (value computed
   * live in the browser; `current_value` ignored / sent null).
   */
  source: string;
  display_order: string;
}

/**
 * Editable mirror of one `SensitivityAxis`. All shape fields are kept populated
 * (companies, scenarios as strings, driver id as a string) so the editor can
 * hold a partial/intermediate value regardless of the selected `kind`. The
 * unused fields are simply ignored when the draft is serialized to a real axis.
 */
export interface SgAxisDraft {
  kind: SensitivityAxis["kind"];
  /** Stringified driver id ("" = none) — used when kind === 'driver'. */
  driverId: string;
  /** Scenario values as strings (so partial typing is allowed) — kind 'driver'. */
  scenarios: string[];
  /** Tickers along this axis — used when kind === 'company'. */
  companies: string[];
  /** Forward-year keys (fixed ['y1','y2']) — used when kind === 'year'. */
  years: string[];
}

/**
 * Editable mirror of ONE axis of the SCENARIO-GRID `definition.grid` block — a
 * catalog driver + its slider label + unit. Picking a driver auto-fills both the
 * label and the unit from the catalog (still editable).
 */
export interface SgGridAxisDraft {
  /**
   * Registry driver id (`stock_guide_drivers.id`) this axis binds to, as a string
   * ("" = unset). Preferred over `driverKey`; picking a driver auto-fills the
   * label + unit from the registry row.
   */
  driverId: string;
  /**
   * LEGACY direct catalog key (e.g. 'avg_brent_2026'). Preserved only for reading
   * back legacy grids that were authored before the registry-driven axis; new
   * grids set `driverId`. "" when the axis uses a registry driver.
   */
  driverKey: string;
  /** Axis label for the slider (e.g. "Brent (avg 2026)"). */
  label: string;
  /** Axis unit (e.g. "USD/bbl"). */
  unit: string;
  /** Template range — minimum axis level for the downloadable Excel (string input). */
  tmin: string;
  /** Template range — maximum axis level for the downloadable Excel (string input). */
  tmax: string;
  /** Template range — step between axis levels for the downloadable Excel (string input). */
  tstep: string;
}

/**
 * One configured output (metric) of the scenario grid — a row in the output-list
 * editor. The effective storage / worksheet key is `${base}_${year}` when `year`
 * is set (e.g. `fcfe_2026`), else just `base`. `base` selects the metric from
 * `SG_GRID_BASE_CATALOG` (which fixes the value-mode); `year` is an optional 4-digit
 * forward-year qualifier. `mode` mirrors the base metric's value-mode and `label`
 * is the auto-generated display column header (e.g. "FCFE yield 2026").
 */
export interface SgGridOutputDraft {
  /** Base metric key (one of `SG_GRID_BASE_CATALOG`, e.g. 'target_price', 'fcfe'). */
  base: string;
  /** Optional 4-digit forward year ("" = none → key has no suffix). */
  year: string;
  /** How the interpolated value is displayed (value-mode math; derived from `base`). */
  mode: SgValueMode;
  /** Auto-generated display column label (e.g. "FCFE yield 2026"). */
  label: string;
}

/** One base metric the scenario grid can output (dropdown catalog in the editor). */
export interface SgGridBaseMetric {
  /** Base metric key (the un-yeared storage key, e.g. 'target_price'). */
  base: string;
  /** Value-mode math applied to the interpolated value. */
  mode: SgValueMode;
  /** Base display label (e.g. "FCFE yield"); the year is appended when set. */
  label: string;
}

/** The 4 base metrics a scenario-grid output can use (dropdown in the admin editor). */
export const SG_GRID_BASE_CATALOG: SgGridBaseMetric[] = [
  { base: "target_price", mode: "upside", label: "Target price" },
  { base: "fcfe", mode: "yield", label: "FCFE yield" },
  { base: "dividends", mode: "yield", label: "Div yield" },
  { base: "net_income", mode: "pe", label: "P/E" },
];

/** Effective storage / worksheet key for an output draft: `base_year` or `base`. */
export function sgGridOutputKey(o: { base: string; year: string }): string {
  const base = o.base.trim();
  const year = o.year.trim();
  return year ? `${base}_${year}` : base;
}

/** Auto-generated display label for an output draft: "<base label> <year>". */
export function sgGridOutputLabel(o: { base: string; year: string }): string {
  const meta = SG_GRID_BASE_CATALOG.find((m) => m.base === o.base.trim());
  const baseLabel = meta?.label ?? o.base.trim();
  const year = o.year.trim();
  return year ? `${baseLabel} ${year}` : baseLabel;
}

/** A pristine output row (defaults to the first base metric, no year). */
function blankGridOutput(): SgGridOutputDraft {
  const m = SG_GRID_BASE_CATALOG[0];
  return { base: m.base, year: "", mode: m.mode, label: m.label };
}

/**
 * Split an effective storage key into `(base, year)`. A trailing `_<4digits>`
 * suffix whose stem is a known base metric → that base + year; otherwise the whole
 * key is treated as the base and year is "" (legacy / un-yeared keys round-trip
 * unchanged).
 */
export function sgGridSplitKey(key: string): { base: string; year: string } {
  const k = (key ?? "").trim();
  const m = /^(.+)_(\d{4})$/.exec(k);
  if (m && SG_GRID_BASE_CATALOG.some((c) => c.base === m[1])) {
    return { base: m[1], year: m[2] };
  }
  return { base: k, year: "" };
}

/**
 * The legacy catalog name kept for callers that still want the un-yeared default
 * output rows. Mirrors `SG_GRID_BASE_CATALOG` as full output drafts (year="").
 */
export const SG_GRID_OUTPUT_CATALOG: SgGridOutputDraft[] = SG_GRID_BASE_CATALOG.map(
  (m) => ({ base: m.base, year: "", mode: m.mode, label: m.label }),
);

/**
 * Editable mirror of the SCENARIO-GRID `definition.grid` block — the CASE only
 * (1..3 driver axes + outputs). The per-company points are NOT typed here: they
 * arrive via the downloadable template Excel upload (Local Data). Serialized into
 * `definition.grid` as `{ axes: [{driver_id?,driver_key?,label,unit,tmin,tmax,
 * tstep}], outputs: [{key,mode,label}] }`.
 */
export interface SgGridDraft {
  /** 1..3 ordered driver axes (storage order maps to x/y/z coordinates). */
  axes: SgGridAxisDraft[];
  /** Configured outputs (≥1) — one mesh metric + display column each. */
  outputs: SgGridOutputDraft[];
}

/**
 * Full builder draft for one sensitivity table. `id === null` → new table.
 * `cells` / `cellsSecondary` are string matrices (one entry per axis item) so
 * inputs can hold partial values; they are coerced to `number | null` only at
 * save time.
 *
 * When `grid === true`, the static matrix/axes are ignored and the table is a
 * SCENARIO-GRID table built from `gridDef` (see `SgGridDraft`); its membership
 * companies come from a multi-select and the points are uploaded via Excel.
 */
export interface SgTableDraft {
  id: number | null;
  title: string;
  value_mode: SgValueMode;
  metric_label: string;
  unit: string;
  display_order: string;
  rowAxis: SgAxisDraft;
  colAxis: SgAxisDraft;
  /** Single-company membership when NEITHER axis is 'company' ("" = unset). */
  singleCompany: string;
  /** `cells[r][c]` as strings (rows = row-axis items, cols = col-axis items). */
  cells: string[][];
  /** ONLY for value_mode 'ev_ebitda' — the matching net-debt matrix. */
  cellsSecondary: string[][];
  /** SCENARIO-GRID mode flag — when true, `gridDef` drives the table (not the matrix). */
  grid: boolean;
  /** SCENARIO-GRID shell (x driver + labels + output). Points uploaded via Excel. */
  gridDef: SgGridDraft;
  /** Membership tickers for a grid table (multi-select; points uploaded per company). */
  gridCompanies: string[];
  /**
   * Optional CONSOLIDATED-PANEL tag for a single-row STATIC table ("" = standalone).
   * "brent"/"margin" merge this table as one row into the matching always-visible
   * block on /stock-guide. Round-tripped through `definition.panel`; NEVER written
   * for a grid table.
   */
  panel: "" | SensitivityPanelKey;
  /**
   * Optional short row label inside the consolidated panel (e.g. "FCFE yield 2026").
   * Falls back to the title when empty. Round-tripped through `definition.row_label`.
   */
  rowLabel: string;
}

/** A pristine driver "Add" row (id null). Defaults to STATIC (`source=''`). */
function blankDriverRow(): SgDriverEditorRow {
  return {
    id: null,
    name: "",
    unit: "",
    current_value: "",
    source: "",
    display_order: "",
  };
}

/** A pristine axis draft (defaults to a 'company' axis with no tickers). */
function blankAxisDraft(): SgAxisDraft {
  return { kind: "company", driverId: "", scenarios: [], companies: [], years: [] };
}

/** A pristine grid axis draft (unbound; default template range 40..150 step 10). */
function blankGridAxis(): SgGridAxisDraft {
  return {
    driverId: "",
    driverKey: "",
    label: "",
    unit: "",
    tmin: "40",
    tmax: "150",
    tstep: "10",
  };
}

/** A pristine SCENARIO-GRID draft (one unbound axis + Target price output on). */
function blankGridDraft(): SgGridDraft {
  return {
    axes: [blankGridAxis()],
    outputs: [blankGridOutput()],
  };
}

/** A pristine table builder draft (a brand-new, empty table). */
function blankTableDraft(): SgTableDraft {
  return {
    id: null,
    title: "",
    value_mode: "absolute",
    metric_label: "",
    unit: "",
    display_order: "",
    rowAxis: blankAxisDraft(),
    colAxis: { ...blankAxisDraft(), kind: "driver" },
    singleCompany: "",
    cells: [],
    cellsSecondary: [],
    grid: false,
    gridDef: blankGridDraft(),
    gridCompanies: [],
    panel: "",
    rowLabel: "",
  };
}

/** Project a real `SensitivityGridBlock` into an editable grid draft. */
function gridToDraft(
  g: NonNullable<SensitivityTableAdmin["definition"]["grid"]>,
): SgGridDraft {
  const axes: SgGridAxisDraft[] = (g.axes ?? [])
    .filter((a) => a.driver_id != null || (a.driver_key ?? "").trim())
    .slice(0, 3)
    .map((a) => ({
      driverId: a.driver_id != null ? String(a.driver_id) : "",
      driverKey: a.driver_key ?? "",
      label: a.label || "",
      unit: a.unit || "",
      tmin: a.tmin != null ? String(a.tmin) : "40",
      tmax: a.tmax != null ? String(a.tmax) : "150",
      tstep: a.tstep != null ? String(a.tstep) : "10",
    }));
  const outputs: SgGridOutputDraft[] = (g.outputs ?? [])
    .filter((o) => (o.key ?? "").trim())
    .map((o) => {
      const { base, year } = sgGridSplitKey(o.key);
      return {
        base,
        year,
        mode: o.mode as SgValueMode,
        label: o.label || sgGridOutputLabel({ base, year }),
      };
    });
  return {
    axes: axes.length > 0 ? axes : blankGridDraft().axes,
    outputs: outputs.length > 0 ? outputs : [blankGridOutput()],
  };
}

/**
 * Project the editable grid draft into a real `SensitivityGridBlock` (the shape
 * the upload parser validates against). Mirrors the on-save serialization: axes
 * read positionally in storage (x/y/z) order, outputs as configured. Used by the
 * in-admin filled-template upload to know the axis count + output (metric) keys.
 */
function sgDraftToGridBlock(g: SgGridDraft): SensitivityGridBlock {
  return {
    axes: g.axes.map((a) => {
      const did = strToNum(a.driverId);
      const block: SensitivityGridBlock["axes"][number] = {
        label: a.label.trim(),
        unit: a.unit.trim(),
      };
      if (did != null) block.driver_id = did;
      if (a.driverKey.trim()) block.driver_key = a.driverKey.trim();
      const tmin = strToNum(a.tmin);
      const tmax = strToNum(a.tmax);
      const tstep = strToNum(a.tstep);
      if (tmin != null) block.tmin = tmin;
      if (tmax != null) block.tmax = tmax;
      if (tstep != null) block.tstep = tstep;
      return block;
    }),
    outputs: g.outputs.map((o) => {
      const key = sgGridOutputKey(o);
      const base = o.base.trim();
      const year = o.year.trim();
      const out: SensitivityGridBlock["outputs"][number] & {
        base?: string;
        year?: string;
      } = {
        key,
        mode: o.mode,
        label: o.label.trim() || sgGridOutputLabel(o),
      };
      // Informative extras (parsers ignore unknown keys); helps a human reader.
      if (base) out.base = base;
      if (year) out.year = year;
      return out;
    }),
  };
}

/** Number of items an axis draft contributes (rows or columns of the matrix). */
function axisItemCount(a: SgAxisDraft): number {
  if (a.kind === "company") return a.companies.length;
  if (a.kind === "year") return a.years.length;
  return a.scenarios.length; // driver
}

/** Human-readable label for each item position of an axis (for matrix headers). */
function axisItemLabels(
  a: SgAxisDraft,
  cfg: StockGuideConfig,
  drivers: StockGuideDriver[],
): string[] {
  if (a.kind === "company") return a.companies;
  if (a.kind === "year") {
    return a.years.map((y) =>
      y === "y1" ? cfg.y1_label || "Y1" : y === "y2" ? cfg.y2_label || "Y2" : y,
    );
  }
  // driver — show the scenario value, prefixed with the driver name if known.
  const drv = drivers.find((d) => String(d.id) === a.driverId);
  const prefix = drv ? `${drv.name} ` : "";
  return a.scenarios.map((s) => `${prefix}${s}`.trim());
}

/**
 * Resize a string matrix to `rows × cols`, preserving existing values where the
 * indices still exist (pad new cells with "", truncate extras).
 */
function resizeStrMatrix(
  m: string[][],
  rows: number,
  cols: number,
): string[][] {
  const out: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const src = m[r] ?? [];
    const row: string[] = [];
    for (let c = 0; c < cols; c++) row.push(src[c] ?? "");
    out.push(row);
  }
  return out;
}

/** Coerce a string matrix into a `(number | null)[][]` for the RPC payload. */
function strMatrixToNum(m: string[][]): (number | null)[][] {
  return m.map((row) => row.map((c) => strToNum(c)));
}

/** Coerce a `(number | null)[][]` matrix into the string matrix the editor uses. */
function numMatrixToStr(m: (number | null)[][] | undefined): string[][] {
  if (!Array.isArray(m)) return [];
  return m.map((row) =>
    Array.isArray(row) ? row.map((c) => (c == null ? "" : String(c))) : [],
  );
}

/** Project a real `SensitivityAxis` into an editable draft (all fields filled). */
function axisToDraft(a: SensitivityAxis): SgAxisDraft {
  return {
    kind: a.kind,
    driverId: a.driver_id != null ? String(a.driver_id) : "",
    scenarios: Array.isArray(a.scenarios) ? a.scenarios.map((n) => String(n)) : [],
    companies: Array.isArray(a.companies) ? [...a.companies] : [],
    years: Array.isArray(a.years) ? [...a.years] : [],
  };
}

/** Serialize an axis draft into a real `SensitivityAxis` (only the meaningful keys). */
function draftToAxis(a: SgAxisDraft): SensitivityAxis {
  if (a.kind === "company") return { kind: "company", companies: [...a.companies] };
  if (a.kind === "year") return { kind: "year", years: [...a.years] };
  // driver
  const axis: SensitivityAxis = {
    kind: "driver",
    scenarios: a.scenarios.map((s) => strToNum(s)).filter((n): n is number => n != null),
  };
  const did = strToNum(a.driverId);
  if (did != null) axis.driver_id = did;
  return axis;
}

/** Project a full admin sensitivity table into the editable builder draft. */
function tableAdminToDraft(t: SensitivityTableAdmin): SgTableDraft {
  const rowAxis = axisToDraft(t.definition.row_axis);
  const colAxis = axisToDraft(t.definition.col_axis);
  const rows = axisItemCount(rowAxis);
  const cols = axisItemCount(colAxis);
  // When neither axis is company, the membership is a single ticker.
  const singleCompany =
    rowAxis.kind !== "company" && colAxis.kind !== "company"
      ? t.companies[0] ?? ""
      : "";
  const gridBlock = t.definition.grid;
  return {
    id: t.id,
    title: t.title,
    value_mode: t.value_mode,
    metric_label: t.metric_label,
    unit: t.unit,
    display_order: numToStr(t.display_order),
    rowAxis,
    colAxis,
    singleCompany,
    cells: resizeStrMatrix(numMatrixToStr(t.definition.cells), rows, cols),
    cellsSecondary:
      t.value_mode === "ev_ebitda"
        ? resizeStrMatrix(numMatrixToStr(t.definition.cells_secondary), rows, cols)
        : [],
    grid: gridBlock != null,
    gridDef: gridBlock != null ? gridToDraft(gridBlock) : blankGridDraft(),
    gridCompanies: gridBlock != null ? [...t.companies] : [],
    panel:
      t.definition.panel === "brent" || t.definition.panel === "margin"
        ? t.definition.panel
        : "",
    rowLabel: t.definition.row_label ?? "",
  };
}

/**
 * Derive the table-membership `companies[]` from the draft. For a SCENARIO-GRID
 * table it is the multi-selected tickers (whose points are uploaded per company);
 * for a static table it is the company axis's tickers (or the single-company
 * select).
 */
function deriveTableCompanies(d: SgTableDraft): string[] {
  if (d.grid) return [...d.gridCompanies];
  if (d.rowAxis.kind === "company") return [...d.rowAxis.companies];
  if (d.colAxis.kind === "company") return [...d.colAxis.companies];
  return d.singleCompany ? [d.singleCompany] : [];
}

// ── Section metadata ──────────────────────────────────────────────────────────

export type SectionId =
  | "members"
  | "permissions"
  | "client-alerts"
  | "default-news"
  | "data-input"
  | "field-stakes"
  | "stock-guide";

export interface SectionMeta {
  id: SectionId;
  label: string;
  shortLabel: string;
  description: string;
}

export const SECTIONS: SectionMeta[] = [
  { id: "members",          label: "Members",               shortLabel: "Members",      description: "User roles & access" },
  { id: "permissions",      label: "Permissions",           shortLabel: "Access",       description: "Module visibility — Public, Clients, and Home" },
  { id: "client-alerts",    label: "Alerts",                shortLabel: "Alerts",       description: "Client email alerts — subscribers, sources, and delivery log" },
  { id: "default-news",     label: "Default News Keywords", shortLabel: "News Defaults", description: "Keywords used by anonymous News Hunter visitors" },
  { id: "data-input",       label: "Data Input",            shortLabel: "Tables",       description: "Edit reference tables" },
  { id: "field-stakes",     label: "Field Stakes",          shortLabel: "Stakes",       description: "Working-interest per oil field (company × stake %)" },
  { id: "stock-guide",      label: "Stock Guide",           shortLabel: "Stocks",       description: "Comps, drivers registry, and sensitivity tables" },
];

// ── Module catalog ─────────────────────────────────────────────────────────────
// Each slug must match the corresponding entry in src/data/moduleIcons.tsx and have a
// matching row in the module_visibility DB. Both views render toggles from this list.

export interface ModuleLabel {
  slug: string;
  label: string;
  description: string;
}

export const MODULE_LABELS: ModuleLabel[] = [
  // Fuel Distribution
  { slug: "market-share",            label: "Market Share",                 description: "Market share evolution over time broken down by distributor" },
  { slug: "navios-diesel",           label: "Diesel Imports Line-Up",       description: "Scheduled vessel arrivals and diesel import line-up by port" },
  { slug: "diesel-gasoline-margins", label: "Diesel and Gasoline Margins",  description: "Diesel and gasoline margin tracking across regions and time" },
  { slug: "price-bands",             label: "Price Bands",                  description: "Price band distribution and competitive positioning by fuel type" },
  { slug: "subsidy-tracker",         label: "Subsidy Tracker",              description: "ANP diesel subsidy tracking vs IPP and Petrobras" },
  // Statistics
  { slug: "anp-prices",              label: "ANP Prices",                   description: "Producer, distribution and retail prices for fuels — Brazilian supply chain" },
  { slug: "anp-glp",                 label: "ANP LPG",                      description: "LPG production and distribution data from ANP" },
  { slug: "imports-exports",         label: "Imports & Exports",            description: "Brazil fuel imports and exports — origins, importers, and volumes" },
  { slug: "well-by-well",            label: "Brazil Production Summary",    description: "Executive monthly oil & gas production summary (stake-weighted, 4 panels + YoY)" },
  { slug: "anp-cdp",                 label: "Monthly Production",           description: "Monthly oil and gas production by well and field (ANP CDP)" },
  { slug: "anp-cdp-diaria",          label: "Daily Production",             description: "Daily oil and gas production by field from ANP Power BI" },
  { slug: "anp-cdp-bsw",             label: "BSW by Well",                  description: "Water cut vs months since first production, by well" },
  { slug: "anp-cdp-depletion",       label: "Depletion",                    description: "Uptime-normalized oil production and decline analysis by field" },
  // Equities
  { slug: "stock-guide",             label: "Stock Guide",                  description: "Equities-research comps table with live market cap/upside and per-company sensitivity drill-down" },
  // Other
  { slug: "stocks",                  label: "Market Watch",                 description: "Real-time stock quotes, historical charts, and market overview" },
  { slug: "news-hunter",             label: "News Hunter",                  description: "Live oil & gas news feed with incremental polling across ~60 sources" },
  // Tools
  { slug: "alerts",                  label: "Alerts",                       description: "Email notifications for new data publications — opt-in subscriber list" },
];

// ── Hook return shape ──────────────────────────────────────────────────────────

export interface UseAdminPanelData {
  // Role guard
  allowed: boolean;
  roleLoading: boolean;

  // Current user profile (for "You" badge and self-demote confirm)
  myProfile: UserProfile | null;

  // Section state
  activeSection: SectionId;
  setActiveSection: (id: SectionId) => void;
  activeDataInputSlug: string;
  setActiveDataInputSlug: (slug: string) => void;

  // Module visibility (Client access toggle)
  localVis: Record<string, boolean>;
  saving: string | null;
  savedSlug: string | null;
  handleToggle: (slug: string, newValue: boolean) => Promise<void>;

  // Home visibility (Show-on-Home toggle)
  localHomeVis: Record<string, boolean>;
  savingHome: string | null;
  savedHomeSlug: string | null;
  homeToggleError: { slug: string; message: string } | null;
  handleHomeToggle: (slug: string, newValue: boolean) => Promise<void>;

  // Public visibility (anonymous-visitor access toggle).
  // DB-level invariant: public=true ⇒ clients=true. The handler enforces the
  // same coercion client-side so the Clients toggle visually flips on as soon
  // as Public is enabled, without waiting for the round-trip refresh.
  localPublicVis: Record<string, boolean>;
  savingPublic: string | null;
  savedPublicSlug: string | null;
  publicToggleError: { slug: string; message: string } | null;
  handlePublicToggle: (slug: string, newValue: boolean) => Promise<void>;

  // Users / roles
  users: UserWithRole[];
  usersLoading: boolean;
  localRoles: Record<string, string>;
  savingUser: string | null;
  savedUser: string | null;
  handleRoleChange: (userId: string, newRole: "Admin" | "Client") => Promise<void>;

  // Client Alerts (the rebuilt client-alerts product — "Alerts" tab).
  // A read-mostly admin console: stats overview, the source catalog with an
  // is_active toggle + a "queue test event" action, the subscribers table
  // (optionally filtered by source), and the recent email-delivery log.
  caStats: AdminAlertsStats | null;
  caBases: SubscribableBase[];
  caSubscribers: AdminAlertsSubscriber[];
  caEmailLog: AdminAlertsEmailLogRow[];
  /** Loading flags per data block (overview/sources share one fetch). */
  caOverviewLoading: boolean;
  caSubscribersLoading: boolean;
  caEmailLogLoading: boolean;
  /** Friendly inline error for the whole tab (overview/sources fetch). */
  caError: string | null;
  caSubscribersError: string | null;
  caEmailLogError: string | null;
  /** Per-source `is_active` map, mirrored locally for optimistic toggles. */
  caSourceActive: Record<string, boolean>;
  /** Source slug whose toggle is currently in-flight (spinner/disable). */
  caTogglingSource: string | null;
  /** Subscribers-table source filter (slug, or "" = all sources). */
  caSubscriberFilter: string;
  setCaSubscriberFilter: (slug: string) => void;
  /** Optional recipient email for the "Queue test" action, per source slug. */
  caTestEmail: Record<string, string>;
  setCaTestEmail: (slug: string, email: string) => void;
  /** Source slug whose test event is currently being queued. */
  caSendingTest: string | null;
  /** Last "Queue test" result (the returned event id + source), for the inline
   *  confirmation note. Cleared after a few seconds. */
  caTestResult: { slug: string; eventId: string } | null;
  caTestError: { slug: string; message: string } | null;
  /** Per-source subscriber counts (active/total), keyed by source slug, derived
   *  from caStats.per_source for the Sources table. */
  caCountsBySource: Record<string, { total: number; active: number }>;
  handleToggleCaSource: (sourceSlug: string, isActive: boolean) => Promise<void>;
  handleQueueCaTest: (sourceSlug: string) => Promise<void>;
  handleRefreshCaSubscribers: () => Promise<void>;

  // Default News Keywords
  defaultKeywords: DefaultNewsKeyword[];
  defaultKeywordsLoading: boolean;
  defaultKeywordsError: string | null;
  newKeyword: string;
  setNewKeyword: (v: string) => void;
  newKeywordMatchType: "substring" | "exact";
  setNewKeywordMatchType: (v: "substring" | "exact") => void;
  addingKeyword: boolean;
  addKeywordError: string | null;
  addKeywordSuccess: boolean;
  removingKeyword: string | null;
  confirmRemoveKeyword: string | null;
  setConfirmRemoveKeyword: (kw: string | null) => void;
  togglingMatchType: Set<string>;
  handleAddKeyword: () => Promise<void>;
  handleRemoveKeyword: (keyword: string) => Promise<void>;
  handleToggleMatchType: (keyword: string, currentMatchType: "substring" | "exact") => Promise<void>;

  // Field Stakes
  fieldStakesOverview: FieldStakeOverview[];
  fieldStakesEmpresas: FieldStakeEmpresa[];
  fieldStakesLoading: boolean;
  selectedCampo: string | null;
  editorStakes: FieldStakeInput[];
  editorLoading: boolean;
  newEmpresaInput: string;
  setNewEmpresaInput: (v: string) => void;
  newEmpresaPctInput: string;
  setNewEmpresaPctInput: (v: string) => void;
  savingStakes: boolean;
  deleteCampoConfirm: string | null;
  stakesError: string | null;
  stakesSearchQuery: string;
  setStakesSearchQuery: (v: string) => void;
  stakesStatusFilter: "all" | "complete" | "incomplete" | "empty";
  setStakesStatusFilter: (v: "all" | "complete" | "incomplete" | "empty") => void;
  /** Sum of stake_pct across editorStakes — refreshed on every edit. */
  currentSum: number;
  /** True when |currentSum - 100| < 0.001. */
  isValidSum: boolean;
  /** True when editorStakes differs from the last server snapshot. */
  pendingChanges: boolean;
  /** Overview filtered by stakesSearchQuery + stakesStatusFilter. */
  filteredOverview: FieldStakeOverview[];
  /**
   * Filtered overview re-grouped by `canonical`. Drives the collapsible
   * left-pane list. Groups are sorted alphabetically by canonical; inside
   * each group the variant whose name matches the canonical comes first,
   * followed by other variants sorted alphabetically.
   */
  groupedOverview: FieldStakeCanonicalGroup[];
  /**
   * Which canonical groups are currently expanded in the left pane. Default
   * seed: every multi-variant group is auto-expanded the first time it is
   * encountered (so admins immediately see all variants of Búzios etc.);
   * single-variant groups have no chevron and never appear in this set.
   */
  expandedCanonicals: Set<string>;
  /** Toggle membership of a canonical name in `expandedCanonicals`. */
  handleToggleCanonical: (canonical: string) => void;
  /** Last_updated timestamp of the currently selected campo (or null). */
  selectedCampoLastUpdated: string | null;
  handleSelectCampo: (campo: string) => Promise<void>;
  handleAddEmpresaRow: () => void;
  handleRemoveEmpresaRow: (idx: number) => void;
  handleChangeStake: (
    idx: number,
    field: "empresa" | "stake_pct",
    value: string,
  ) => void;
  handleSaveStakes: () => Promise<void>;
  handleDeleteCampo: (campo: string) => void;
  handleConfirmDeleteCampo: () => Promise<void>;
  handleCancelDeleteCampo: () => void;

  // Stock Guide
  /** Active sub-tab of the Stock Guide section. */
  sgSubTab: SgSubTab;
  setSgSubTab: (t: SgSubTab) => void;
  /** All companies incl. hidden (use `is_visible` for the Restricted badge). */
  sgCompanies: StockGuideAdminCompany[];
  sgLoading: boolean;
  /** Global singleton config (forward-year labels + assumptions note). */
  sgConfig: StockGuideConfig;
  /** Editable mirror of `sgConfig` (saved via handleSaveSgConfig). */
  sgConfigDraft: StockGuideConfig;
  setSgConfigDraft: (c: StockGuideConfig) => void;
  sgConfigSaving: boolean;
  sgConfigSaved: boolean;
  sgConfigError: string | null;
  /** Ticker of the currently selected company (or null). */
  sgSelectedTicker: string | null;
  /** Editable comps fields for the selected company (string-typed). */
  sgEditorRow: SgEditorRow | null;
  sgEditorLoading: boolean;
  sgSaving: boolean;
  sgError: string | null;
  sgDeleteConfirm: string | null;
  /** Visibility toggle currently in-flight (ticker), for spinner/disable. */
  sgTogglingVisibility: string | null;
  // Left-pane filters
  sgSearchQuery: string;
  setSgSearchQuery: (v: string) => void;
  /** Companies filtered by sgSearchQuery. */
  sgFilteredCompanies: StockGuideAdminCompany[];
  /** Visible-only tickers (for the company multi-selects in the table builder). */
  sgCompanyTickers: string[];
  /** True when sgEditorRow differs from the last server snapshot. */
  sgPendingChanges: boolean;
  // Comps handlers (Companies sub-tab — unchanged)
  handleSelectStockGuideCompany: (ticker: string) => Promise<void>;
  handleChangeSgField: (field: keyof SgEditorRow, value: string) => void;
  handleSaveSgCompany: () => Promise<void>;
  handleToggleSgVisibility: (ticker: string, isVisible: boolean) => Promise<void>;
  handleSaveSgConfig: () => Promise<void>;
  handleDeleteSgCompany: (ticker: string) => void;
  handleConfirmDeleteSgCompany: () => Promise<void>;
  handleCancelDeleteSgCompany: () => void;

  // ── Drivers registry (Drivers sub-tab) ──────────────────────────────────────
  /** Saved drivers (rows in display_order) + one trailing "Add" row. */
  sgDrivers: StockGuideDriver[];
  sgDriverRows: SgDriverEditorRow[];
  sgDriversLoading: boolean;
  sgDriversError: string | null;
  /** Market-driver catalog (Source picker options for DYNAMIC drivers). */
  sgMarketCatalog: DriverCatalogEntry[];
  /** Live computed values for the catalog metrics (key → number | null). */
  sgMarketValues: Record<string, number | null>;
  /** True while the live market-data fetch backing the catalog is in flight. */
  sgMarketLoading: boolean;
  /**
   * Resolve a driver-editor row's effective today value: the live computed
   * catalog value for a DYNAMIC row, else its typed `current_value`. Used by the
   * editor to show "Computed: …" and the dynamic-row badge value.
   */
  sgResolveDriverRowValue: (row: SgDriverEditorRow) => number | null;
  /** Driver row id (or "new") currently saving, for spinner/disable. */
  sgDriverSavingKey: string | null;
  sgDriverDeleteConfirm: number | null;
  handleChangeSgDriverField: (
    index: number,
    field: keyof Omit<SgDriverEditorRow, "id">,
    value: string,
  ) => void;
  handleSaveSgDriver: (index: number) => Promise<void>;
  handleDeleteSgDriver: (id: number) => void;
  handleConfirmDeleteSgDriver: () => Promise<void>;
  handleCancelDeleteSgDriver: () => void;

  // ── Sensitivity-table builder (Sensitivities sub-tab) ───────────────────────
  /** All tables (unfiltered, incl. hidden companies) for the left list. */
  sgTables: SensitivityTableAdmin[];
  sgTablesLoading: boolean;
  sgTablesError: string | null;
  /** The selected/new table builder draft (null = nothing selected). */
  sgTableDraft: SgTableDraft | null;
  sgTableSaving: boolean;
  sgTableSaveError: string | null;
  sgTablePendingChanges: boolean;
  sgTableDeleteConfirm: number | null;
  /** Client-side validation message blocking save (null = valid). */
  sgTableValidationError: string | null;
  /** Item labels for the row/col axes (drives the matrix headers). */
  sgTableRowLabels: string[];
  sgTableColLabels: string[];
  /**
   * Per-mode base-input metadata for the builder: the hint banner copy + the
   * matrix labels that make the derived value_mode transform obvious at input
   * time. Null when no draft is open.
   */
  sgTableBaseInputMeta: BaseInputMeta | null;
  /**
   * Live "Dashboard preview" cell: the exact DISPLAY value /stock-guide would
   * render for (rowIdx, colIdx) of the draft, using the SAME shared compute +
   * format helpers. "—" when the quote / shares_outstanding are missing.
   */
  sgPreviewCell: (rowIdx: number, colIdx: number) => string;
  /** True while the preview's live quotes are loading. */
  sgPreviewQuotesLoading: boolean;
  handleSelectSgTable: (id: number) => void;
  handleNewSgTable: () => void;
  handleCancelSgTableEdit: () => void;
  handleChangeSgTableField: (
    field: "title" | "metric_label" | "unit" | "display_order",
    value: string,
  ) => void;
  handleChangeSgTableValueMode: (mode: SgValueMode) => void;
  /** Set the consolidated-panel tag of a static table ("" = standalone). */
  handleChangeSgTablePanel: (panel: "" | SensitivityPanelKey) => void;
  /** Set the short row label shown inside the consolidated panel. */
  handleChangeSgTableRowLabel: (rowLabel: string) => void;

  // ── Scenario-grid table builder ─────────────────────────────────────────────
  /** The market-driver catalog (Brent/FX 2026-2028) — kept for legacy axis pickers. */
  sgGridDriverCatalog: DriverCatalogEntry[];
  /** The full drivers registry (any driver can be an axis). */
  sgGridDrivers: StockGuideDriver[];
  /** The 4 base metrics an output row can use (dropdown catalog). */
  sgGridBaseCatalog: SgGridBaseMetric[];
  /** Toggle SCENARIO-GRID mode for the current draft. */
  handleToggleSgGrid: (on: boolean) => void;
  /** Append a new output row (capped at 12). */
  handleAddSgGridOutput: () => void;
  /** Remove one output row by index (≥1 must stay). */
  handleRemoveSgGridOutput: (idx: number) => void;
  /** Change the base metric of one output row (re-syncs mode + label). */
  handleChangeSgGridOutputBase: (idx: number, base: string) => void;
  /** Change the optional 4-digit year of one output row (re-syncs label). */
  handleChangeSgGridOutputYear: (idx: number, year: string) => void;
  /** Add a new axis to the grid (capped at 3). */
  handleAddSgGridAxis: () => void;
  /** Remove an axis from the grid (floor 1). */
  handleRemoveSgGridAxis: (axisIdx: number) => void;
  /** Set one field of one axis (driver auto-fills label + unit; template range fields). */
  handleChangeSgGridAxisField: (
    axisIdx: number,
    field: "driverId" | "label" | "unit" | "tmin" | "tmax" | "tstep",
    value: string,
  ) => void;
  /** Add/remove a ticker from the grid table's membership (points uploaded per company). */
  handleToggleSgGridCompany: (ticker: string) => void;
  /** Generate + download the scenario-grid template Excel in the browser (ExcelJS). */
  handleDownloadGridTemplate: () => Promise<void>;
  /** Warning copy when the template would be very large (>60k cells), else null. */
  sgGridTemplateWarning: string | null;
  /**
   * Read-only count of scenario-grid points already uploaded for the current
   * draft table (null while loading / for a non-grid or unsaved table). Gives the
   * admin confidence the Excel upload landed.
   */
  sgGridPointCount: number | null;
  /** True while the grid point count is being fetched. */
  sgGridPointCountLoading: boolean;
  /**
   * In-admin filled-template upload widget state (parse → report → upload → done
   * / error). `idle` until the admin picks a file.
   */
  sgUpload: SgUploadState;
  /** Parse + validate a chosen .xlsx against the saved grid shell (no network). */
  handleSelectSgGridUploadFile: (file: File) => Promise<void>;
  /** Confirm the validated upload — chunked replace-total of the mesh. */
  handleConfirmSgGridUpload: () => Promise<void>;
  /** Dismiss the upload widget (back to idle). */
  handleResetSgGridUpload: () => void;
  handleChangeSgTableSingleCompany: (ticker: string) => void;
  handleChangeSgAxisKind: (axis: "row" | "col", kind: SensitivityAxis["kind"]) => void;
  handleChangeSgAxisDriver: (axis: "row" | "col", driverId: string) => void;
  handleToggleSgAxisCompany: (axis: "row" | "col", ticker: string) => void;
  handleAddSgAxisScenario: (axis: "row" | "col") => void;
  handleChangeSgAxisScenario: (axis: "row" | "col", i: number, value: string) => void;
  handleRemoveSgAxisScenario: (axis: "row" | "col", i: number) => void;
  handleChangeSgTableCell: (r: number, c: number, value: string) => void;
  handleChangeSgTableCellSecondary: (r: number, c: number, value: string) => void;
  handleSaveSgTable: () => Promise<void>;
  handleDeleteSgTable: (id: number) => void;
  handleConfirmDeleteSgTable: () => Promise<void>;
  handleCancelDeleteSgTable: () => void;

  // Pure helpers (re-exported for both views)
  isValidEmail: (email: string) => boolean;
  formatDateBR: (dateStr: string) => string;
}

// ── Helpers (pure) ─────────────────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function formatDateBR(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAdminPanelData(): UseAdminPanelData {
  const { allowed, loading: roleLoading } = useRoleGuard("Admin");
  const {
    moduleVisibility,
    homeVisibility,
    publicVisibility,
    refreshVisibility,
    profile: myProfile,
  } = useUserProfile();
  const supabase = getSupabaseClient();

  // ── Section state ──────────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<SectionId>("members");
  const [activeDataInputSlug, setActiveDataInputSlug] = useState<string>(
    EDITABLE_TABLES[0]?.slug ?? "",
  );

  // ── Visibility state (all three axes declared together so handlers below
  //    can reference any of them without forward-reference issues) ─────────────

  // Client access (is_visible_for_clients)
  const [localVis, setLocalVis] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);

  // Home gallery card (is_visible_on_home)
  const [localHomeVis, setLocalHomeVis] = useState<Record<string, boolean>>({});
  const [savingHome, setSavingHome] = useState<string | null>(null);
  const [savedHomeSlug, setSavedHomeSlug] = useState<string | null>(null);
  const [homeToggleError, setHomeToggleError] = useState<{ slug: string; message: string } | null>(null);

  // Anonymous-visitor access (is_visible_for_public)
  // Source of truth is `publicVisibility` on UserProfileContext (Phase B), which
  // is loaded once per page alongside moduleVisibility/homeVisibility from a
  // single rpcGetModuleVisibility call. We mirror it locally only to support
  // optimistic updates — same pattern as `localVis` and `localHomeVis` above.
  // After a mutation, `refreshVisibility()` re-fetches the shared map; the
  // useEffect below re-seeds the local mirror from the refreshed context value.
  const [localPublicVis, setLocalPublicVis] = useState<Record<string, boolean>>({});
  const [savingPublic, setSavingPublic] = useState<string | null>(null);
  const [savedPublicSlug, setSavedPublicSlug] = useState<string | null>(null);
  const [publicToggleError, setPublicToggleError] = useState<{ slug: string; message: string } | null>(null);

  // Seed all three local mirrors whenever context visibility maps refresh
  useEffect(() => {
    setLocalVis({ ...moduleVisibility });
  }, [moduleVisibility]);

  useEffect(() => {
    setLocalHomeVis({ ...homeVisibility });
  }, [homeVisibility]);

  useEffect(() => {
    setLocalPublicVis({ ...publicVisibility });
  }, [publicVisibility]);

  // ── Visibility handlers ────────────────────────────────────────────────────

  const handleToggle = useCallback(
    async (slug: string, newValue: boolean) => {
      if (!supabase || saving) return;
      setLocalVis((prev) => ({ ...prev, [slug]: newValue }));
      // Home-invariant coercion: if both Public and Clients become false,
      // the DB trigger will force is_visible_on_home=false. Mirror that
      // optimistically so the Home toggle goes grey immediately.
      if (!newValue) {
        const isPublic = localPublicVis[slug] ?? true;
        if (!isPublic) {
          setLocalHomeVis((prev) => ({ ...prev, [slug]: false }));
        }
      }
      setSaving(slug);
      await rpcSetModuleVisibility(supabase, slug, newValue);
      await refreshVisibility();
      setSaving(null);
      setSavedSlug(slug);
      setTimeout(() => setSavedSlug((s) => (s === slug ? null : s)), 1500);
    },
    [supabase, saving, localPublicVis, refreshVisibility],
  );

  const handleHomeToggle = useCallback(
    async (slug: string, newValue: boolean) => {
      if (!supabase || savingHome) return;
      const prevValue = localHomeVis[slug] ?? true;
      // Optimistic update
      setLocalHomeVis((prev) => ({ ...prev, [slug]: newValue }));
      setSavingHome(slug);
      setHomeToggleError(null);
      const result = await rpcSetModuleHomeVisibility(supabase, slug, newValue);
      if (!result) {
        // Rollback on error
        setLocalHomeVis((prev) => ({ ...prev, [slug]: prevValue }));
        setHomeToggleError({ slug, message: "Failed to save. Please try again." });
        setTimeout(() => setHomeToggleError((e) => (e?.slug === slug ? null : e)), 4000);
      } else {
        await refreshVisibility();
        setSavedHomeSlug(slug);
        setTimeout(() => setSavedHomeSlug((s) => (s === slug ? null : s)), 1500);
      }
      setSavingHome(null);
    },
    [supabase, savingHome, localHomeVis, refreshVisibility],
  );

  // ── Public Visibility handler ──────────────────────────────────────────────

  const handlePublicToggle = useCallback(
    async (slug: string, newValue: boolean) => {
      if (!supabase || savingPublic) return;
      const prevPublic = localPublicVis[slug] ?? true;
      const prevClient = localVis[slug] ?? true;

      // Optimistic update — also flip Clients on when Public is turned on,
      // because the DB trigger enforces the invariant (public=true ⇒
      // clients=true). Reflecting this in the UI before the round-trip avoids
      // a confusing "Public on, Clients off" intermediate state.
      setLocalPublicVis((prev) => ({ ...prev, [slug]: newValue }));
      if (newValue && !prevClient) {
        setLocalVis((prev) => ({ ...prev, [slug]: true }));
      }
      // Home-invariant coercion: if Public goes false and Clients was already
      // false, both visibility flags become false — the DB trigger will force
      // is_visible_on_home=false. Mirror that optimistically.
      if (!newValue && !prevClient) {
        setLocalHomeVis((prev) => ({ ...prev, [slug]: false }));
      }
      setSavingPublic(slug);
      setPublicToggleError(null);

      const result = await rpcSetModulePublicVisibility(supabase, slug, newValue);
      if (!result) {
        // Rollback both toggles on error.
        setLocalPublicVis((prev) => ({ ...prev, [slug]: prevPublic }));
        if (newValue && !prevClient) {
          setLocalVis((prev) => ({ ...prev, [slug]: prevClient }));
        }
        setPublicToggleError({ slug, message: "Failed to save. Please try again." });
        setTimeout(() => setPublicToggleError((e) => (e?.slug === slug ? null : e)), 4000);
      } else {
        // If Public was turned on while Clients was off, the DB trigger has
        // already coerced is_visible_for_clients=TRUE — sync it explicitly so
        // the global UserProfileContext map (used by NavBar / guards) updates
        // too. Without this call, NavBar would only see the change after the
        // user reloads the page.
        if (newValue && !prevClient) {
          await rpcSetModuleVisibility(supabase, slug, true);
        }
        // Single refresh repopulates moduleVisibility, homeVisibility AND
        // publicVisibility in the context (one rpcGetModuleVisibility call
        // hydrates all three maps). The useEffect above syncs localPublicVis
        // from the updated context value.
        await refreshVisibility();
        setSavedPublicSlug(slug);
        setTimeout(() => setSavedPublicSlug((s) => (s === slug ? null : s)), 1500);
      }
      setSavingPublic(null);
    },
    [supabase, savingPublic, localPublicVis, localVis, localHomeVis, refreshVisibility],
  );

  // ── Members ────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [savedUser, setSavedUser] = useState<string | null>(null);
  const [localRoles, setLocalRoles] = useState<Record<string, string>>({});

  const loadUsers = useCallback(async () => {
    if (!supabase) return;
    setUsersLoading(true);
    const data = await rpcGetAllUsersWithRoles(supabase);
    setUsers(data);
    const roles: Record<string, string> = {};
    for (const u of data) roles[u.id] = u.role;
    setLocalRoles(roles);
    setUsersLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (allowed) loadUsers();
  }, [allowed, loadUsers]);

  const handleRoleChange = useCallback(
    async (userId: string, newRole: "Admin" | "Client") => {
      if (!supabase || savingUser) return;
      if (userId === myProfile?.id && newRole !== "Admin") {
        if (
          !confirm(
            "Are you sure you want to remove your own Admin role? You will lose access to this page.",
          )
        )
          return;
      }
      setLocalRoles((prev) => ({ ...prev, [userId]: newRole }));
      setSavingUser(userId);
      const ok = await rpcSetUserRole(supabase, userId, newRole);
      if (!ok)
        setLocalRoles((prev) => ({
          ...prev,
          [userId]: users.find((u) => u.id === userId)?.role ?? "Client",
        }));
      setSavingUser(null);
      setSavedUser(userId);
      setTimeout(() => setSavedUser((s) => (s === userId ? null : s)), 1500);
    },
    [supabase, savingUser, myProfile?.id, users],
  );

  // ── Client Alerts (the rebuilt client-alerts product — "Alerts" tab) ────────
  //
  // A read-mostly admin console over the new `admin_alerts_*` SECURITY DEFINER
  // RPCs (the logged-in self-service product). Two fetch groups:
  //   • Overview  — stats + the source catalog (admin_alerts_stats +
  //                 list_subscribable_bases), loaded together on first open.
  //   • Subscribers / Email log — loaded alongside, refreshable on demand.
  const [caStats, setCaStats] = useState<AdminAlertsStats | null>(null);
  const [caBases, setCaBases] = useState<SubscribableBase[]>([]);
  const [caSubscribers, setCaSubscribers] = useState<AdminAlertsSubscriber[]>([]);
  const [caEmailLog, setCaEmailLog] = useState<AdminAlertsEmailLogRow[]>([]);
  const [caOverviewLoading, setCaOverviewLoading] = useState(false);
  const [caSubscribersLoading, setCaSubscribersLoading] = useState(false);
  const [caEmailLogLoading, setCaEmailLogLoading] = useState(false);
  const [caError, setCaError] = useState<string | null>(null);
  const [caSubscribersError, setCaSubscribersError] = useState<string | null>(null);
  const [caEmailLogError, setCaEmailLogError] = useState<string | null>(null);
  const [caSourceActive, setCaSourceActive] = useState<Record<string, boolean>>({});
  const [caTogglingSource, setCaTogglingSource] = useState<string | null>(null);
  const [caSubscriberFilter, setCaSubscriberFilter] = useState<string>("");
  const [caTestEmail, setCaTestEmailState] = useState<Record<string, string>>({});
  const [caSendingTest, setCaSendingTest] = useState<string | null>(null);
  const [caTestResult, setCaTestResult] = useState<{ slug: string; eventId: string } | null>(null);
  const [caTestError, setCaTestError] = useState<{ slug: string; message: string } | null>(null);

  const setCaTestEmail = useCallback((slug: string, email: string) => {
    setCaTestEmailState((prev) => ({ ...prev, [slug]: email }));
  }, []);

  // Per-source subscriber counts (active/total) derived from caStats.per_source.
  const caCountsBySource = useMemo(() => {
    const m: Record<string, { total: number; active: number }> = {};
    for (const ps of caStats?.per_source ?? []) {
      m[ps.source_slug] = {
        total: ps.subscriptions_total,
        active: ps.subscriptions_active,
      };
    }
    return m;
  }, [caStats]);

  // Overview = stats + the source catalog (names/categories/cadence + the
  // source-level is_active mirror for the Sources toggle).
  const loadCaOverview = useCallback(async () => {
    if (!supabase) return;
    setCaOverviewLoading(true);
    setCaError(null);
    try {
      const [stats, bases] = await Promise.all([
        rpcAdminAlertsStats(supabase),
        rpcListSubscribableBases(supabase),
      ]);
      setCaStats(stats);
      setCaBases(bases);
      // Seed the local is_active mirror from the catalog. `sub_is_active` on a
      // SubscribableBase is per-user; the source-level enabled flag is what the
      // toggle writes, so we mirror it from the catalog's source state. The
      // catalog list_subscribable_bases only returns ENABLED sources, so any
      // base present here is active; disabled ones are surfaced via the toggle
      // round-trip. Seed true for every returned base.
      setCaSourceActive((prev) => {
        const next: Record<string, boolean> = { ...prev };
        for (const b of bases) {
          if (next[b.source_slug] === undefined) next[b.source_slug] = true;
        }
        return next;
      });
    } catch {
      setCaError("Could not load alert stats and sources. Please try again.");
    }
    setCaOverviewLoading(false);
  }, [supabase]);

  const loadCaSubscribers = useCallback(async () => {
    if (!supabase) return;
    setCaSubscribersLoading(true);
    setCaSubscribersError(null);
    try {
      const rows = await rpcAdminAlertsListSubscribers(
        supabase,
        caSubscriberFilter || null,
        200,
      );
      setCaSubscribers(rows);
    } catch {
      setCaSubscribersError("Could not load subscribers. Please try again.");
    }
    setCaSubscribersLoading(false);
  }, [supabase, caSubscriberFilter]);

  const loadCaEmailLog = useCallback(async () => {
    if (!supabase) return;
    setCaEmailLogLoading(true);
    setCaEmailLogError(null);
    try {
      const rows = await rpcAdminAlertsEmailLogRecent(supabase, 100);
      setCaEmailLog(rows);
    } catch {
      setCaEmailLogError("Could not load the email log. Please try again.");
    }
    setCaEmailLogLoading(false);
  }, [supabase]);

  // Lazy-load: fetch the three blocks the first time the section becomes active.
  useEffect(() => {
    if (allowed && activeSection === "client-alerts") {
      loadCaOverview();
      loadCaEmailLog();
    }
  }, [allowed, activeSection, loadCaOverview, loadCaEmailLog]);

  // Re-fetch subscribers whenever the section is active and the source filter
  // changes (also covers the initial load when the tab opens).
  useEffect(() => {
    if (allowed && activeSection === "client-alerts") loadCaSubscribers();
  }, [allowed, activeSection, loadCaSubscribers]);

  const handleToggleCaSource = useCallback(
    async (sourceSlug: string, isActive: boolean) => {
      if (!supabase || caTogglingSource) return;
      const prev = caSourceActive[sourceSlug] ?? true;
      // Optimistic flip.
      setCaSourceActive((m) => ({ ...m, [sourceSlug]: isActive }));
      setCaTogglingSource(sourceSlug);
      try {
        const result = await rpcAdminAlertsToggleSource(supabase, sourceSlug, isActive);
        setCaSourceActive((m) => ({ ...m, [sourceSlug]: result }));
      } catch {
        // Rollback on error.
        setCaSourceActive((m) => ({ ...m, [sourceSlug]: prev }));
        setCaError("Could not update the source. Please try again.");
        setTimeout(() => setCaError((e) => (e?.startsWith("Could not update the source") ? null : e)), 4000);
      }
      setCaTogglingSource(null);
    },
    [supabase, caTogglingSource, caSourceActive],
  );

  const handleQueueCaTest = useCallback(
    async (sourceSlug: string) => {
      if (!supabase || caSendingTest) return;
      setCaSendingTest(sourceSlug);
      setCaTestError(null);
      setCaTestResult(null);
      try {
        const email = (caTestEmail[sourceSlug] ?? "").trim();
        // Validate the optional email (empty = broadcast to all subscribers).
        if (email && !isValidEmail(email)) {
          setCaTestError({ slug: sourceSlug, message: "Enter a valid email or leave it blank." });
          setTimeout(() => setCaTestError((e) => (e?.slug === sourceSlug ? null : e)), 4000);
          setCaSendingTest(null);
          return;
        }
        const eventId = await rpcAdminAlertsSendTest(supabase, sourceSlug, email || null);
        setCaTestResult({ slug: sourceSlug, eventId });
        setTimeout(() => setCaTestResult((r) => (r?.slug === sourceSlug ? null : r)), 8000);
      } catch {
        setCaTestError({ slug: sourceSlug, message: "Could not queue the test event. Please try again." });
        setTimeout(() => setCaTestError((e) => (e?.slug === sourceSlug ? null : e)), 4000);
      }
      setCaSendingTest(null);
    },
    [supabase, caSendingTest, caTestEmail],
  );

  const handleRefreshCaSubscribers = useCallback(async () => {
    await loadCaSubscribers();
  }, [loadCaSubscribers]);

  // ── Default News Keywords ──────────────────────────────────────────────────
  const [defaultKeywords, setDefaultKeywords] = useState<DefaultNewsKeyword[]>([]);
  const [defaultKeywordsLoading, setDefaultKeywordsLoading] = useState(false);
  const [defaultKeywordsError, setDefaultKeywordsError] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState("");
  const [newKeywordMatchType, setNewKeywordMatchType] = useState<"substring" | "exact">("substring");
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [addKeywordError, setAddKeywordError] = useState<string | null>(null);
  const [addKeywordSuccess, setAddKeywordSuccess] = useState(false);
  const [removingKeyword, setRemovingKeyword] = useState<string | null>(null);
  const [confirmRemoveKeyword, setConfirmRemoveKeyword] = useState<string | null>(null);
  const [togglingMatchType, setTogglingMatchType] = useState<Set<string>>(new Set());

  const loadDefaultKeywords = useCallback(async () => {
    if (!supabase) return;
    setDefaultKeywordsLoading(true);
    setDefaultKeywordsError(null);
    try {
      const data = await rpcAdminListDefaultNewsKeywords(supabase);
      setDefaultKeywords(data);
    } catch {
      setDefaultKeywordsError(
        "Could not load default News Hunter keywords. Try refreshing the page.",
      );
    }
    setDefaultKeywordsLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (allowed && activeSection === "default-news") loadDefaultKeywords();
  }, [allowed, activeSection, loadDefaultKeywords]);

  const handleAddKeyword = useCallback(async () => {
    const trimmed = newKeyword.trim();
    if (!supabase || addingKeyword || !trimmed) return;

    // Client-side duplicate check (warn-only; RPC is idempotent)
    if (defaultKeywords.some((k) => k.keyword.toLowerCase() === trimmed.toLowerCase())) {
      setAddKeywordError(`"${trimmed}" is already in the default keyword list.`);
      setTimeout(() => setAddKeywordError(null), 4000);
      return;
    }

    setAddingKeyword(true);
    setAddKeywordError(null);
    const ok = await rpcAdminAddDefaultNewsKeyword(supabase, trimmed, newKeywordMatchType);
    if (!ok) {
      setAddKeywordError("Could not add keyword. Please try again.");
      setTimeout(() => setAddKeywordError(null), 4000);
    } else {
      setNewKeyword("");
      setNewKeywordMatchType("substring");
      setAddKeywordSuccess(true);
      setTimeout(() => setAddKeywordSuccess(false), 2000);
      await loadDefaultKeywords();
    }
    setAddingKeyword(false);
  }, [supabase, addingKeyword, newKeyword, newKeywordMatchType, defaultKeywords, loadDefaultKeywords]);

  const handleRemoveKeyword = useCallback(
    async (keyword: string) => {
      if (!supabase || removingKeyword) return;
      setRemovingKeyword(keyword);
      const ok = await rpcAdminRemoveDefaultNewsKeyword(supabase, keyword);
      if (!ok) {
        setDefaultKeywordsError("Could not remove keyword. Please try again.");
        setTimeout(() => setDefaultKeywordsError(null), 4000);
      } else {
        setConfirmRemoveKeyword(null);
        await loadDefaultKeywords();
      }
      setRemovingKeyword(null);
    },
    [supabase, removingKeyword, loadDefaultKeywords],
  );

  const handleToggleMatchType = useCallback(
    async (keyword: string, currentMatchType: "substring" | "exact") => {
      if (!supabase || togglingMatchType.has(keyword)) return;
      const newType = currentMatchType === "exact" ? "substring" : "exact";
      setTogglingMatchType((prev) => new Set(prev).add(keyword));
      const ok = await rpcAdminSetDefaultNewsKeywordMatchType(supabase, keyword, newType);
      if (ok) {
        setDefaultKeywords((prev) =>
          prev.map((k) => (k.keyword === keyword ? { ...k, match_type: newType } : k)),
        );
      } else {
        setDefaultKeywordsError("Could not update match type. Please try again.");
        setTimeout(() => setDefaultKeywordsError(null), 4000);
      }
      setTogglingMatchType((prev) => {
        const next = new Set(prev);
        next.delete(keyword);
        return next;
      });
    },
    [supabase, togglingMatchType],
  );

  // ── Field Stakes ───────────────────────────────────────────────────────────
  const [fieldStakesOverview, setFieldStakesOverview] = useState<FieldStakeOverview[]>([]);
  const [fieldStakesEmpresas, setFieldStakesEmpresas] = useState<FieldStakeEmpresa[]>([]);
  const [fieldStakesLoading, setFieldStakesLoading] = useState(false);
  const [selectedCampo, setSelectedCampo] = useState<string | null>(null);
  const [editorStakes, setEditorStakes] = useState<FieldStakeInput[]>([]);
  const [editorLoading, setEditorLoading] = useState(false);
  const [newEmpresaInput, setNewEmpresaInput] = useState("");
  const [newEmpresaPctInput, setNewEmpresaPctInput] = useState("");
  const [savingStakes, setSavingStakes] = useState(false);
  const [deleteCampoConfirm, setDeleteCampoConfirm] = useState<string | null>(null);
  const [stakesError, setStakesError] = useState<string | null>(null);
  const [stakesSearchQuery, setStakesSearchQuery] = useState("");
  const [stakesStatusFilter, setStakesStatusFilter] = useState<
    "all" | "complete" | "incomplete" | "empty"
  >("all");
  const [selectedCampoLastUpdated, setSelectedCampoLastUpdated] = useState<string | null>(null);

  // Last-saved JSON snapshot for change-detection. A ref (not state) because
  // changing it should NOT trigger a re-render — it's compared inside the
  // pendingChanges useMemo below.
  const editorSavedSnapshotRef = useRef<string>("[]");

  const loadFieldStakesOverview = useCallback(async () => {
    if (!supabase) return;
    setFieldStakesLoading(true);
    try {
      const [overview, empresas] = await Promise.all([
        rpcGetFieldStakesOverview(supabase),
        rpcGetFieldStakesEmpresas(supabase),
      ]);
      setFieldStakesOverview(overview);
      setFieldStakesEmpresas(empresas);
    } catch (e) {
      console.error("Failed to load field stakes overview", e);
      setStakesError("Could not load field stakes. Please try again.");
      setTimeout(() => setStakesError((err) => (err?.startsWith("Could not load") ? null : err)), 4000);
    }
    setFieldStakesLoading(false);
  }, [supabase]);

  // Lazy-load: only fetch when the section becomes active for the first time.
  useEffect(() => {
    if (allowed && activeSection === "field-stakes") loadFieldStakesOverview();
  }, [allowed, activeSection, loadFieldStakesOverview]);

  const handleSelectCampo = useCallback(
    async (campo: string) => {
      if (!supabase) return;
      setSelectedCampo(campo);
      setStakesError(null);
      setNewEmpresaInput("");
      setNewEmpresaPctInput("");
      setEditorLoading(true);
      try {
        const rows = await rpcGetFieldStakes(supabase, campo);
        const editorRows: FieldStakeInput[] = rows.map((r) => ({
          empresa: r.empresa,
          stake_pct: r.stake_pct,
        }));
        setEditorStakes(editorRows);
        editorSavedSnapshotRef.current = JSON.stringify(editorRows);
        // last_updated comes from the overview row (computed as MAX(updated_at))
        const overviewRow = fieldStakesOverview.find((o) => o.campo === campo);
        setSelectedCampoLastUpdated(overviewRow?.last_updated ?? null);
      } catch (e) {
        console.error("Failed to load field stakes", e);
        setStakesError("Could not load stakes for this field. Please try again.");
        setEditorStakes([]);
        editorSavedSnapshotRef.current = "[]";
        setSelectedCampoLastUpdated(null);
      }
      setEditorLoading(false);
    },
    [supabase, fieldStakesOverview],
  );

  const handleAddEmpresaRow = useCallback(() => {
    const empresa = newEmpresaInput.trim();
    const pct = Number(newEmpresaPctInput);
    if (!empresa) {
      setStakesError("Company name is required.");
      setTimeout(() => setStakesError((e) => (e === "Company name is required." ? null : e)), 3000);
      return;
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setStakesError("Stake % must be a number between 0 and 100.");
      setTimeout(
        () => setStakesError((e) => (e === "Stake % must be a number between 0 and 100." ? null : e)),
        3000,
      );
      return;
    }
    setEditorStakes((prev) => [...prev, { empresa, stake_pct: pct }]);
    setNewEmpresaInput("");
    setNewEmpresaPctInput("");
    setStakesError(null);
  }, [newEmpresaInput, newEmpresaPctInput]);

  const handleRemoveEmpresaRow = useCallback((idx: number) => {
    setEditorStakes((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleChangeStake = useCallback(
    (idx: number, field: "empresa" | "stake_pct", value: string) => {
      setEditorStakes((prev) =>
        prev.map((row, i) => {
          if (i !== idx) return row;
          if (field === "empresa") return { ...row, empresa: value };
          // stake_pct: keep as Number (NaN allowed temporarily mid-typing)
          const parsed = value === "" ? 0 : Number(value);
          return { ...row, stake_pct: Number.isFinite(parsed) ? parsed : 0 };
        }),
      );
    },
    [],
  );

  const handleSaveStakes = useCallback(async () => {
    if (!supabase || !selectedCampo || savingStakes) return;
    setSavingStakes(true);
    setStakesError(null);
    try {
      // Normalize: trim empresa, coerce stake_pct to Number. Drop rows with
      // empty empresa (defensive — the UI also blocks adding them).
      const payload: FieldStakeInput[] = editorStakes
        .map((s) => ({ empresa: s.empresa.trim(), stake_pct: Number(s.stake_pct) || 0 }))
        .filter((s) => s.empresa.length > 0);
      await rpcAdminUpsertFieldStakes(supabase, selectedCampo, payload);
      editorSavedSnapshotRef.current = JSON.stringify(payload);
      setEditorStakes(payload);
      await loadFieldStakesOverview();
      // Refresh last_updated from the new overview snapshot
      // (loadFieldStakesOverview will set fieldStakesOverview; pick the row).
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message ?? "Save failed.")
          : "Save failed.";
      setStakesError(msg);
    }
    setSavingStakes(false);
  }, [supabase, selectedCampo, savingStakes, editorStakes, loadFieldStakesOverview]);

  // Refresh selectedCampoLastUpdated whenever the overview refreshes after a save
  useEffect(() => {
    if (!selectedCampo) return;
    const row = fieldStakesOverview.find((o) => o.campo === selectedCampo);
    if (row) setSelectedCampoLastUpdated(row.last_updated);
  }, [fieldStakesOverview, selectedCampo]);

  const handleDeleteCampo = useCallback((campo: string) => {
    setDeleteCampoConfirm(campo);
  }, []);

  const handleConfirmDeleteCampo = useCallback(async () => {
    if (!supabase || !deleteCampoConfirm) return;
    const campo = deleteCampoConfirm;
    setSavingStakes(true);
    setStakesError(null);
    try {
      await rpcAdminDeleteFieldStakes(supabase, campo);
      await loadFieldStakesOverview();
      if (selectedCampo === campo) {
        setSelectedCampo(null);
        setEditorStakes([]);
        editorSavedSnapshotRef.current = "[]";
        setSelectedCampoLastUpdated(null);
      }
      setDeleteCampoConfirm(null);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message ?? "Delete failed.")
          : "Delete failed.";
      setStakesError(msg);
    }
    setSavingStakes(false);
  }, [supabase, deleteCampoConfirm, selectedCampo, loadFieldStakesOverview]);

  const handleCancelDeleteCampo = useCallback(() => {
    setDeleteCampoConfirm(null);
  }, []);

  // Derived values
  const currentSum = useMemo(
    () => editorStakes.reduce((acc, s) => acc + (Number(s.stake_pct) || 0), 0),
    [editorStakes],
  );

  const isValidSum = useMemo(
    () => Math.abs(currentSum - 100) < 0.001,
    [currentSum],
  );

  const pendingChanges = useMemo(() => {
    // Compare current editor state against the last server-saved snapshot.
    // JSON.stringify is stable here because we always set state through the
    // same shape (no key reordering).
    return JSON.stringify(editorStakes) !== editorSavedSnapshotRef.current;
  }, [editorStakes]);

  const filteredOverview = useMemo(() => {
    const q = stakesSearchQuery.trim().toLowerCase();
    return fieldStakesOverview.filter((row) => {
      // Search matches if EITHER the variant name OR the canonical (family)
      // name contains the query — so typing "buzios" surfaces all 3 variants
      // (Búzios, AnC_Búzios, Búzios_ECO) at once.
      if (q) {
        const inVariant = row.campo.toLowerCase().includes(q);
        const inCanonical = (row.canonical ?? "").toLowerCase().includes(q);
        if (!inVariant && !inCanonical) return false;
      }
      switch (stakesStatusFilter) {
        case "complete":
          return row.is_complete;
        case "incomplete":
          return !row.is_complete && row.n_empresas > 0;
        case "empty":
          return row.n_empresas === 0;
        default:
          return true;
      }
    });
  }, [fieldStakesOverview, stakesSearchQuery, stakesStatusFilter]);

  // ── Canonical grouping (Round 4) ───────────────────────────────────────────
  // Drives the collapsible left-pane list. We keep BOTH the flat filtered
  // overview (used by counts/status filter buttons) and the grouped projection
  // (used to render the list itself).

  const [expandedCanonicals, setExpandedCanonicals] = useState<Set<string>>(
    () => new Set<string>(),
  );

  // Auto-expand multi-variant groups the first time they show up in the data.
  // Single-variant canonicals are rendered inline (no chevron), so they don't
  // need to live in the expanded set. We track the canonical names already
  // seen so admins can still manually collapse a group without it getting
  // re-expanded on every render.
  const seedSeenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (fieldStakesOverview.length === 0) return;
    // Build canonical -> variant count from raw overview (NOT filtered) so
    // seeding behaviour is stable across search/filter changes.
    const variantCount = new Map<string, number>();
    for (const row of fieldStakesOverview) {
      const c = row.canonical ?? row.campo;
      variantCount.set(c, (variantCount.get(c) ?? 0) + 1);
    }
    const newlySeenMulti: string[] = [];
    for (const [canonical, count] of variantCount) {
      if (count > 1 && !seedSeenRef.current.has(canonical)) {
        seedSeenRef.current.add(canonical);
        newlySeenMulti.push(canonical);
      }
    }
    if (newlySeenMulti.length > 0) {
      setExpandedCanonicals((prev) => {
        const next = new Set(prev);
        for (const c of newlySeenMulti) next.add(c);
        return next;
      });
    }
  }, [fieldStakesOverview]);

  const handleToggleCanonical = useCallback((canonical: string) => {
    setExpandedCanonicals((prev) => {
      const next = new Set(prev);
      if (next.has(canonical)) next.delete(canonical);
      else next.add(canonical);
      return next;
    });
  }, []);

  const groupedOverview = useMemo<FieldStakeCanonicalGroup[]>(() => {
    // Group filtered rows by canonical. Falls back to the variant name when
    // canonical is missing (defensive — pre-Round-4 RPC payloads).
    const byCanonical = new Map<string, FieldStakeOverview[]>();
    for (const row of filteredOverview) {
      const c = row.canonical ?? row.campo;
      const bucket = byCanonical.get(c);
      if (bucket) bucket.push(row);
      else byCanonical.set(c, [row]);
    }
    const groups: FieldStakeCanonicalGroup[] = [];
    for (const [canonical, variants] of byCanonical) {
      // Variant order: the "base" variant whose name equals the canonical
      // comes first; remaining variants sorted alphabetically (AnC_Búzios,
      // Búzios_ECO, EX_Búzios, …).
      const sorted = [...variants].sort((a, b) => {
        const aBase = a.campo === canonical ? 0 : 1;
        const bBase = b.campo === canonical ? 0 : 1;
        if (aBase !== bBase) return aBase - bBase;
        return a.campo.localeCompare(b.campo);
      });
      const all_complete = sorted.every((v) => v.is_complete);
      const all_empty = sorted.every((v) => v.n_empresas === 0);
      const any_incomplete = sorted.some(
        (v) => v.n_empresas > 0 && !v.is_complete,
      );
      groups.push({
        canonical,
        variants: sorted,
        n_variants: sorted.length,
        all_complete,
        any_incomplete,
        all_empty,
      });
    }
    // Canonical groups sorted alphabetically (case-insensitive).
    groups.sort((a, b) =>
      a.canonical.localeCompare(b.canonical, undefined, { sensitivity: "base" }),
    );
    return groups;
  }, [filteredOverview]);

  // ── Stock Guide ────────────────────────────────────────────────────────────
  const [sgSubTab, setSgSubTab] = useState<SgSubTab>("companies");
  const [sgCompanies, setSgCompanies] = useState<StockGuideAdminCompany[]>([]);
  const [sgLoading, setSgLoading] = useState(false);
  const [sgConfig, setSgConfig] = useState<StockGuideConfig>({
    y1_label: "",
    y2_label: "",
    assumptions_note: "",
  });
  const [sgConfigDraft, setSgConfigDraft] = useState<StockGuideConfig>({
    y1_label: "",
    y2_label: "",
    assumptions_note: "",
  });
  const [sgConfigSaving, setSgConfigSaving] = useState(false);
  const [sgConfigSaved, setSgConfigSaved] = useState(false);
  const [sgConfigError, setSgConfigError] = useState<string | null>(null);
  const [sgSelectedTicker, setSgSelectedTicker] = useState<string | null>(null);
  const [sgEditorRow, setSgEditorRow] = useState<SgEditorRow | null>(null);
  const [sgEditorLoading, setSgEditorLoading] = useState(false);
  const [sgSaving, setSgSaving] = useState(false);
  const [sgError, setSgError] = useState<string | null>(null);
  const [sgDeleteConfirm, setSgDeleteConfirm] = useState<string | null>(null);
  const [sgTogglingVisibility, setSgTogglingVisibility] = useState<string | null>(null);
  const [sgSearchQuery, setSgSearchQuery] = useState("");

  // Last-saved JSON snapshot for the comps editor (ref — no re-render needed;
  // compared inside the pendingChanges useMemo below). Mirrors Field Stakes.
  const sgEditorSnapshotRef = useRef<string>("null");

  const loadStockGuide = useCallback(async () => {
    if (!supabase) return;
    setSgLoading(true);
    setSgError(null);
    try {
      const [companies, config] = await Promise.all([
        rpcAdminGetStockGuideCompanies(supabase),
        rpcGetStockGuideConfig(supabase),
      ]);
      setSgCompanies(companies);
      setSgConfig(config);
      setSgConfigDraft(config);
    } catch (e) {
      console.error("Failed to load Stock Guide admin data", e);
      setSgError("Could not load Stock Guide data. Please try again.");
      setTimeout(
        () => setSgError((err) => (err?.startsWith("Could not load") ? null : err)),
        4000,
      );
    }
    setSgLoading(false);
  }, [supabase]);

  // Lazy-load: only fetch when the section becomes active for the first time.
  useEffect(() => {
    if (allowed && activeSection === "stock-guide") loadStockGuide();
  }, [allowed, activeSection, loadStockGuide]);

  const handleSelectStockGuideCompany = useCallback(
    async (ticker: string) => {
      if (!supabase) return;
      setSgSelectedTicker(ticker);
      setSgError(null);
      setSgEditorLoading(true);
      // Project the already-loaded company row into the editable form.
      const company = sgCompanies.find((c) => c.ticker === ticker);
      if (company) {
        const editorRow = adminCompanyToEditorRow(company);
        setSgEditorRow(editorRow);
        sgEditorSnapshotRef.current = JSON.stringify(editorRow);
      } else {
        setSgEditorRow(null);
        sgEditorSnapshotRef.current = "null";
      }
      setSgEditorLoading(false);
    },
    [supabase, sgCompanies],
  );

  const handleChangeSgField = useCallback(
    (field: keyof SgEditorRow, value: string) => {
      setSgEditorRow((prev) => (prev ? { ...prev, [field]: value } : prev));
    },
    [],
  );

  const handleSaveSgCompany = useCallback(async () => {
    if (!supabase || !sgSelectedTicker || !sgEditorRow || sgSaving) return;
    setSgSaving(true);
    setSgError(null);
    try {
      // Build the `p_data` object — keys MUST match the migration's
      // admin_upsert_stock_guide_company p_data reads. `is_visible` is
      // deliberately omitted (separate toggle RPC). Numerics → number|null;
      // text fields trimmed; recommendation "" → null.
      const r = sgEditorRow;
      const data: Record<string, unknown> = {
        company_name: r.company_name.trim(),
        yahoo_symbol: r.yahoo_symbol.trim(),
        sector: r.sector,
        volume_unit: r.volume_unit,
        shares_outstanding: strToNum(r.shares_outstanding),
        net_debt_y1: strToNum(r.net_debt_y1),
        net_debt_y2: strToNum(r.net_debt_y2),
        last_update: r.last_update.trim() === "" ? null : r.last_update,
        target_price: strToNum(r.target_price),
        recommendation: r.recommendation === "" ? null : r.recommendation,
        ebitda_y1: strToNum(r.ebitda_y1),
        ebitda_y2: strToNum(r.ebitda_y2),
        net_income_y1: strToNum(r.net_income_y1),
        net_income_y2: strToNum(r.net_income_y2),
        net_income_ex_y1: strToNum(r.net_income_ex_y1),
        net_income_ex_y2: strToNum(r.net_income_ex_y2),
        npv_tax_credit_y1: strToNum(r.npv_tax_credit_y1),
        npv_tax_credit_y2: strToNum(r.npv_tax_credit_y2),
        fcfe_y1: strToNum(r.fcfe_y1),
        fcfe_y2: strToNum(r.fcfe_y2),
        dividends_y1: strToNum(r.dividends_y1),
        dividends_y2: strToNum(r.dividends_y2),
        volumes_y1: strToNum(r.volumes_y1),
        volumes_y2: strToNum(r.volumes_y2),
        display_order: strToNum(r.display_order) ?? 0,
      };
      await rpcAdminUpsertStockGuideCompany(supabase, sgSelectedTicker, data);
      // Snapshot the saved editor state so pendingChanges resets to false.
      sgEditorSnapshotRef.current = JSON.stringify(sgEditorRow);
      await loadStockGuide();
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message ?? "Save failed.")
          : "Save failed.";
      setSgError(msg);
    }
    setSgSaving(false);
  }, [supabase, sgSelectedTicker, sgEditorRow, sgSaving, loadStockGuide]);

  const handleToggleSgVisibility = useCallback(
    async (ticker: string, isVisible: boolean) => {
      if (!supabase || sgTogglingVisibility) return;
      const prev = sgCompanies.find((c) => c.ticker === ticker)?.is_visible ?? true;
      // Optimistic flip in the list.
      setSgCompanies((list) =>
        list.map((c) => (c.ticker === ticker ? { ...c, is_visible: isVisible } : c)),
      );
      setSgTogglingVisibility(ticker);
      setSgError(null);
      try {
        await rpcAdminSetStockGuideVisibility(supabase, ticker, isVisible);
      } catch (e: unknown) {
        // Rollback on throw.
        setSgCompanies((list) =>
          list.map((c) => (c.ticker === ticker ? { ...c, is_visible: prev } : c)),
        );
        const msg =
          e && typeof e === "object" && "message" in e
            ? String((e as { message?: unknown }).message ?? "Could not update visibility.")
            : "Could not update visibility.";
        setSgError(msg);
        setTimeout(() => setSgError((err) => (err === msg ? null : err)), 4000);
      }
      setSgTogglingVisibility(null);
    },
    [supabase, sgTogglingVisibility, sgCompanies],
  );

  const handleSaveSgConfig = useCallback(async () => {
    if (!supabase || sgConfigSaving) return;
    setSgConfigSaving(true);
    setSgConfigError(null);
    try {
      await rpcAdminUpsertStockGuideConfig(
        supabase,
        sgConfigDraft.y1_label.trim(),
        sgConfigDraft.y2_label.trim(),
        sgConfigDraft.assumptions_note,
      );
      setSgConfig(sgConfigDraft);
      setSgConfigSaved(true);
      setTimeout(() => setSgConfigSaved(false), 2000);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message ?? "Could not save config.")
          : "Could not save config.";
      setSgConfigError(msg);
      setTimeout(() => setSgConfigError((err) => (err === msg ? null : err)), 4000);
    }
    setSgConfigSaving(false);
  }, [supabase, sgConfigSaving, sgConfigDraft]);

  const handleDeleteSgCompany = useCallback((ticker: string) => {
    setSgDeleteConfirm(ticker);
  }, []);

  const handleConfirmDeleteSgCompany = useCallback(async () => {
    if (!supabase || !sgDeleteConfirm) return;
    const ticker = sgDeleteConfirm;
    setSgSaving(true);
    setSgError(null);
    try {
      await rpcAdminDeleteStockGuideCompany(supabase, ticker);
      await loadStockGuide();
      if (sgSelectedTicker === ticker) {
        setSgSelectedTicker(null);
        setSgEditorRow(null);
        sgEditorSnapshotRef.current = "null";
      }
      setSgDeleteConfirm(null);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message ?? "Delete failed.")
          : "Delete failed.";
      setSgError(msg);
    }
    setSgSaving(false);
  }, [supabase, sgDeleteConfirm, sgSelectedTicker, loadStockGuide]);

  const handleCancelDeleteSgCompany = useCallback(() => {
    setSgDeleteConfirm(null);
  }, []);

  // Derived: filtered company list + pending-change flag for the comps editor.
  const sgFilteredCompanies = useMemo(() => {
    const q = sgSearchQuery.trim().toLowerCase();
    return sgCompanies.filter((c) => {
      if (q) {
        const inTicker = c.ticker.toLowerCase().includes(q);
        const inName = c.company_name.toLowerCase().includes(q);
        if (!inTicker && !inName) return false;
      }
      return true;
    });
  }, [sgCompanies, sgSearchQuery]);

  const sgPendingChanges = useMemo(
    () => JSON.stringify(sgEditorRow) !== sgEditorSnapshotRef.current,
    [sgEditorRow],
  );

  // Visible-only tickers for the company multi-selects in the table builder
  // (display_order, ascending — same order as the dashboard).
  const sgCompanyTickers = useMemo(
    () =>
      [...sgCompanies]
        .sort((a, b) => a.display_order - b.display_order)
        .map((c) => c.ticker),
    [sgCompanies],
  );

  // ── Drivers registry (Drivers sub-tab) ──────────────────────────────────────
  // Live market-data catalog backing the DYNAMIC drivers (same hook the
  // dashboard uses) — lets the editor show the live "Computed: …" value.
  const {
    values: sgMarketValues,
    loading: sgMarketLoading,
    catalog: sgMarketCatalog,
  } = useMarketDrivers();

  // Resolve a driver-editor row's effective today value (live catalog value for
  // a dynamic row, else its typed current_value).
  const sgResolveDriverRowValue = useCallback(
    (row: SgDriverEditorRow): number | null =>
      resolveDriverValue(
        { current_value: strToNum(row.current_value), source: row.source },
        sgMarketValues,
      ),
    [sgMarketValues],
  );

  const [sgDrivers, setSgDrivers] = useState<StockGuideDriver[]>([]);
  const [sgDriverRows, setSgDriverRows] = useState<SgDriverEditorRow[]>([
    blankDriverRow(),
  ]);
  const [sgDriversLoading, setSgDriversLoading] = useState(false);
  const [sgDriversError, setSgDriversError] = useState<string | null>(null);
  const [sgDriverSavingKey, setSgDriverSavingKey] = useState<string | null>(null);
  const [sgDriverDeleteConfirm, setSgDriverDeleteConfirm] = useState<number | null>(
    null,
  );
  const sgDriversLoadedRef = useRef(false);

  // Project saved drivers into editable rows + a trailing blank "Add" row.
  const driversToRows = useCallback(
    (list: StockGuideDriver[]): SgDriverEditorRow[] => [
      ...list.map((d) => ({
        id: d.id,
        name: d.name,
        unit: d.unit,
        current_value: numToStr(d.current_value),
        source: d.source ?? "",
        display_order: numToStr(d.display_order),
      })),
      blankDriverRow(),
    ],
    [],
  );

  const loadSgDrivers = useCallback(async () => {
    if (!supabase) return;
    setSgDriversLoading(true);
    setSgDriversError(null);
    try {
      const list = await rpcGetStockGuideDrivers(supabase);
      setSgDrivers(list);
      setSgDriverRows(driversToRows(list));
    } catch (e) {
      console.error("Failed to load Stock Guide drivers", e);
      setSgDriversError("Could not load drivers. Please try again.");
    }
    setSgDriversLoading(false);
  }, [supabase, driversToRows]);

  // Lazy-load drivers when the Drivers OR Sensitivities sub-tab opens (the
  // builder's driver axis needs the registry too). Reloads at most once.
  useEffect(() => {
    if (
      allowed &&
      activeSection === "stock-guide" &&
      (sgSubTab === "drivers" || sgSubTab === "sensitivities") &&
      !sgDriversLoadedRef.current
    ) {
      sgDriversLoadedRef.current = true;
      loadSgDrivers();
    }
  }, [allowed, activeSection, sgSubTab, loadSgDrivers]);

  const handleChangeSgDriverField = useCallback(
    (index: number, field: keyof Omit<SgDriverEditorRow, "id">, value: string) => {
      setSgDriverRows((rows) =>
        rows.map((r, i) => {
          if (i !== index) return r;
          // Switching to a DYNAMIC source auto-fills the unit from the catalog
          // (the unit input is disabled for dynamic drivers).
          if (field === "source") {
            const cat = MARKET_DRIVER_CATALOG_BY_KEY[value];
            return { ...r, source: value, unit: cat ? cat.unit : r.unit };
          }
          return { ...r, [field]: value };
        }),
      );
    },
    [],
  );

  const handleSaveSgDriver = useCallback(
    async (index: number) => {
      if (!supabase) return;
      const row = sgDriverRows[index];
      if (!row || !row.name.trim()) {
        setSgDriversError("Driver name is required.");
        setTimeout(
          () => setSgDriversError((e) => (e === "Driver name is required." ? null : e)),
          3000,
        );
        return;
      }
      const key = row.id == null ? "new" : String(row.id);
      setSgDriverSavingKey(key);
      setSgDriversError(null);
      try {
        // DYNAMIC driver (source bound to a catalog metric): unit is the
        // catalog's unit and current_value is null (computed live in the
        // browser). STATIC driver: admin-typed unit + current_value.
        const dynamic = isDynamicSource(row.source);
        const catalogUnit = dynamic
          ? (MARKET_DRIVER_CATALOG_BY_KEY[row.source]?.unit ?? row.unit.trim())
          : null;
        await rpcAdminUpsertStockGuideDriver(supabase, row.id, {
          name: row.name.trim(),
          unit: dynamic ? catalogUnit : row.unit.trim(),
          current_value: dynamic ? null : strToNum(row.current_value),
          source: dynamic ? row.source : "",
          display_order: strToNum(row.display_order) ?? 0,
        });
        await loadSgDrivers();
      } catch (e: unknown) {
        const msg =
          e && typeof e === "object" && "message" in e
            ? String((e as { message?: unknown }).message ?? "Could not save driver.")
            : "Could not save driver.";
        setSgDriversError(msg);
      }
      setSgDriverSavingKey(null);
    },
    [supabase, sgDriverRows, loadSgDrivers],
  );

  const handleDeleteSgDriver = useCallback((id: number) => {
    setSgDriverDeleteConfirm(id);
  }, []);

  const handleConfirmDeleteSgDriver = useCallback(async () => {
    if (!supabase || sgDriverDeleteConfirm == null) return;
    const id = sgDriverDeleteConfirm;
    setSgDriverSavingKey(String(id));
    setSgDriversError(null);
    try {
      await rpcAdminDeleteStockGuideDriver(supabase, id);
      await loadSgDrivers();
      setSgDriverDeleteConfirm(null);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message ?? "Could not delete driver.")
          : "Could not delete driver.";
      setSgDriversError(msg);
    }
    setSgDriverSavingKey(null);
  }, [supabase, sgDriverDeleteConfirm, loadSgDrivers]);

  const handleCancelDeleteSgDriver = useCallback(() => {
    setSgDriverDeleteConfirm(null);
  }, []);

  // ── Sensitivity-table builder (Sensitivities sub-tab) ───────────────────────
  const [sgTables, setSgTables] = useState<SensitivityTableAdmin[]>([]);
  const [sgTablesLoading, setSgTablesLoading] = useState(false);
  const [sgTablesError, setSgTablesError] = useState<string | null>(null);
  const [sgTableDraft, setSgTableDraft] = useState<SgTableDraft | null>(null);
  const [sgTableSaving, setSgTableSaving] = useState(false);
  const [sgTableSaveError, setSgTableSaveError] = useState<string | null>(null);
  const [sgTableDeleteConfirm, setSgTableDeleteConfirm] = useState<number | null>(
    null,
  );
  const sgTableSnapshotRef = useRef<string>("null");
  const sgTablesLoadedRef = useRef(false);

  const loadSgTables = useCallback(async () => {
    if (!supabase) return;
    setSgTablesLoading(true);
    setSgTablesError(null);
    try {
      const list = await rpcAdminGetStockGuideSensitivityTables(supabase);
      setSgTables(list);
    } catch (e) {
      console.error("Failed to load Stock Guide sensitivity tables", e);
      setSgTablesError("Could not load sensitivity tables. Please try again.");
    }
    setSgTablesLoading(false);
  }, [supabase]);

  // Lazy-load tables when the Sensitivities sub-tab opens (once).
  useEffect(() => {
    if (
      allowed &&
      activeSection === "stock-guide" &&
      sgSubTab === "sensitivities" &&
      !sgTablesLoadedRef.current
    ) {
      sgTablesLoadedRef.current = true;
      loadSgTables();
    }
  }, [allowed, activeSection, sgSubTab, loadSgTables]);

  // Whenever the axes change item count, keep the cell matrices sized to match
  // (preserving existing values). Centralized so every axis mutation is correct.
  const syncDraftMatrices = useCallback((d: SgTableDraft): SgTableDraft => {
    const rows = axisItemCount(d.rowAxis);
    const cols = axisItemCount(d.colAxis);
    return {
      ...d,
      cells: resizeStrMatrix(d.cells, rows, cols),
      cellsSecondary:
        d.value_mode === "ev_ebitda" ? resizeStrMatrix(d.cellsSecondary, rows, cols) : [],
    };
  }, []);

  const handleSelectSgTable = useCallback(
    (id: number) => {
      const t = sgTables.find((x) => x.id === id);
      if (!t) return;
      const draft = tableAdminToDraft(t);
      setSgTableDraft(draft);
      sgTableSnapshotRef.current = JSON.stringify(draft);
      setSgTableSaveError(null);
    },
    [sgTables],
  );

  const handleNewSgTable = useCallback(() => {
    const draft = blankTableDraft();
    setSgTableDraft(draft);
    sgTableSnapshotRef.current = JSON.stringify(draft);
    setSgTableSaveError(null);
  }, []);

  const handleCancelSgTableEdit = useCallback(() => {
    setSgTableDraft(null);
    sgTableSnapshotRef.current = "null";
    setSgTableSaveError(null);
  }, []);

  const handleChangeSgTableField = useCallback(
    (field: "title" | "metric_label" | "unit" | "display_order", value: string) => {
      setSgTableDraft((d) => (d ? { ...d, [field]: value } : d));
    },
    [],
  );

  const handleChangeSgTableValueMode = useCallback(
    (mode: SgValueMode) => {
      setSgTableDraft((d) => (d ? syncDraftMatrices({ ...d, value_mode: mode }) : d));
    },
    [syncDraftMatrices],
  );

  /** Set the consolidated-panel tag of a static table ("" / "brent" / "margin"). */
  const handleChangeSgTablePanel = useCallback(
    (panel: "" | SensitivityPanelKey) => {
      setSgTableDraft((d) => (d ? { ...d, panel } : d));
    },
    [],
  );

  /** Set the short row label shown inside the consolidated panel. */
  const handleChangeSgTableRowLabel = useCallback((rowLabel: string) => {
    setSgTableDraft((d) => (d ? { ...d, rowLabel } : d));
  }, []);

  // ── Scenario-grid table handlers ────────────────────────────────────────────
  const handleToggleSgGrid = useCallback((on: boolean) => {
    setSgTableDraft((d) => {
      if (!d) return d;
      // Grid tables interpolate the target price → default value_mode 'upside' so
      // the Upside column derives from the live price; the admin may pick 'absolute'.
      return {
        ...d,
        grid: on,
        value_mode: on && d.value_mode !== "absolute" ? "upside" : d.value_mode,
      };
    });
  }, []);

  /** Append a new output row (capped at 12) — defaults to the first base metric. */
  const handleAddSgGridOutput = useCallback(() => {
    setSgTableDraft((d) => {
      if (!d || d.gridDef.outputs.length >= 12) return d;
      return {
        ...d,
        gridDef: { ...d.gridDef, outputs: [...d.gridDef.outputs, blankGridOutput()] },
      };
    });
  }, []);

  /** Remove one output row by index (≥1 must stay). */
  const handleRemoveSgGridOutput = useCallback((idx: number) => {
    setSgTableDraft((d) => {
      if (!d || d.gridDef.outputs.length <= 1) return d;
      const outputs = d.gridDef.outputs.filter((_, i) => i !== idx);
      return { ...d, gridDef: { ...d.gridDef, outputs } };
    });
  }, []);

  /** Change the base metric of one output row (re-syncs mode + auto-label). */
  const handleChangeSgGridOutputBase = useCallback((idx: number, base: string) => {
    setSgTableDraft((d) => {
      if (!d) return d;
      const meta = SG_GRID_BASE_CATALOG.find((m) => m.base === base);
      if (!meta) return d;
      const outputs = d.gridDef.outputs.map((o, i) =>
        i === idx
          ? { ...o, base: meta.base, mode: meta.mode, label: sgGridOutputLabel({ base: meta.base, year: o.year }) }
          : o,
      );
      return { ...d, gridDef: { ...d.gridDef, outputs } };
    });
  }, []);

  /** Change the optional 4-digit year of one output row (re-syncs auto-label). */
  const handleChangeSgGridOutputYear = useCallback((idx: number, year: string) => {
    setSgTableDraft((d) => {
      if (!d) return d;
      // Keep only digits, max 4 — the field is a year qualifier.
      const clean = year.replace(/\D/g, "").slice(0, 4);
      const outputs = d.gridDef.outputs.map((o, i) =>
        i === idx ? { ...o, year: clean, label: sgGridOutputLabel({ base: o.base, year: clean }) } : o,
      );
      return { ...d, gridDef: { ...d.gridDef, outputs } };
    });
  }, []);

  /** Add a new axis (capped at 3) — a fresh UNBOUND axis (admin picks a driver). */
  const handleAddSgGridAxis = useCallback(() => {
    setSgTableDraft((d) => {
      if (!d || d.gridDef.axes.length >= 3) return d;
      return {
        ...d,
        gridDef: { ...d.gridDef, axes: [...d.gridDef.axes, blankGridAxis()] },
      };
    });
  }, []);

  /** Remove an axis (floor 1). */
  const handleRemoveSgGridAxis = useCallback((axisIdx: number) => {
    setSgTableDraft((d) => {
      if (!d || d.gridDef.axes.length <= 1) return d;
      const axes = d.gridDef.axes.filter((_, i) => i !== axisIdx);
      return { ...d, gridDef: { ...d.gridDef, axes } };
    });
  }, []);

  /** Change one field of one axis. Picking a registry driver auto-fills label +
   *  unit from the driver row (still editable afterward) and clears the legacy
   *  catalog key. */
  const handleChangeSgGridAxisField = useCallback(
    (
      axisIdx: number,
      field: "driverId" | "label" | "unit" | "tmin" | "tmax" | "tstep",
      value: string,
    ) => {
      setSgTableDraft((d) => {
        if (!d) return d;
        const axes = d.gridDef.axes.map((a, i) => {
          if (i !== axisIdx) return a;
          const next = { ...a, [field]: value };
          if (field === "driverId") {
            next.driverKey = ""; // registry-driven axis no longer uses a raw key
            const drv = sgDrivers.find((x) => String(x.id) === value);
            if (drv) {
              next.label = drv.name || next.label;
              // Auto-fill unit from a dynamic driver's catalog, else the driver row.
              const catUnit = drv.source
                ? MARKET_DRIVER_CATALOG_BY_KEY[drv.source]?.unit
                : undefined;
              next.unit = catUnit || drv.unit || next.unit;
            }
          }
          return next;
        });
        return { ...d, gridDef: { ...d.gridDef, axes } };
      });
    },
    [sgDrivers],
  );

  const handleToggleSgGridCompany = useCallback((ticker: string) => {
    setSgTableDraft((d) => {
      if (!d) return d;
      const has = d.gridCompanies.includes(ticker);
      const gridCompanies = has
        ? d.gridCompanies.filter((t) => t !== ticker)
        : [...d.gridCompanies, ticker];
      return { ...d, gridCompanies };
    });
  }, []);

  // Estimated cell count of the template Excel (combos × tickers × outputs) — a
  // warning surfaces in the UI above ~60k so the analyst doesn't generate a
  // pathological workbook. Null when there's no valid grid draft.
  const sgGridTemplateWarning = useMemo<string | null>(() => {
    const d = sgTableDraft;
    if (!d || !d.grid) return null;
    let combos = 1;
    for (const a of d.gridDef.axes) {
      const lo = strToNum(a.tmin);
      const hi = strToNum(a.tmax);
      const st = strToNum(a.tstep);
      if (lo == null || hi == null || st == null || st <= 0 || lo >= hi) return null;
      combos *= Math.floor((hi - lo) / st + 1e-9) + 1;
    }
    const total = combos * Math.max(d.gridCompanies.length, 1) * Math.max(d.gridDef.outputs.length, 1);
    if (total > 60000) {
      return `Large template: ~${total.toLocaleString("en-US")} cells (combos × companies × outputs). Consider coarser steps.`;
    }
    return null;
  }, [sgTableDraft]);

  // Generate + download the scenario-grid template Excel in the browser (ExcelJS).
  // ONE sheet per output (sheet name = output key). Each sheet's first d columns
  // are the axis coordinates (header = axis label, axis order = column order),
  // followed by one empty column per membership company. Rows enumerate the full
  // Cartesian product of tmin..tmax step tstep per axis (first axis varies
  // SLOWEST). Header row is bold + frozen. The analyst fills the per-company
  // columns and re-uploads via the Local Data Brent-grid pipeline.
  const handleDownloadGridTemplate = useCallback(async () => {
    const d = sgTableDraft;
    if (!d || !d.grid) return;
    const axes = d.gridDef.axes;
    const outputs = d.gridDef.outputs;
    const tickers = [...d.gridCompanies];
    if (axes.length === 0 || outputs.length === 0 || tickers.length === 0) return;

    // Per-axis level vectors from the template range.
    const levelsPerAxis: number[][] = [];
    for (const a of axes) {
      const lo = strToNum(a.tmin);
      const hi = strToNum(a.tmax);
      const st = strToNum(a.tstep);
      if (lo == null || hi == null || st == null || st <= 0 || lo >= hi) return;
      const vals: number[] = [];
      // Round to 6 decimals to match the upload script's coordinate identity.
      for (let v = lo; v <= hi + 1e-9; v += st) {
        vals.push(Math.round(v * 1e6) / 1e6);
      }
      levelsPerAxis.push(vals);
    }

    // Cartesian product (first axis varies SLOWEST → it's the outer loop).
    const combos: number[][] = [[]];
    for (const levels of levelsPerAxis) {
      const next: number[][] = [];
      for (const prefix of combos) {
        for (const v of levels) next.push([...prefix, v]);
      }
      combos.length = 0;
      combos.push(...next);
    }

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "SectorData — Stock Guide";
    wb.created = new Date();

    for (const o of outputs) {
      // Sheet name = EFFECTIVE output key (`base_year` or `base`); Excel caps at
      // 31 chars / forbids some symbols.
      const safe = sgGridOutputKey(o).replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "output";
      const ws = wb.addWorksheet(safe);
      const headers = [
        ...axes.map((a, i) => a.label.trim() || a.driverKey.trim() || `axis_${i + 1}`),
        ...tickers,
      ];
      ws.addRow(headers);
      for (const combo of combos) {
        // Coordinate columns first, then one empty cell per ticker.
        ws.addRow([...combo, ...tickers.map(() => null)]);
      }
      // Header style: bold + frozen first row.
      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      // Reasonable column widths.
      ws.columns.forEach((col, i) => {
        col.width = i < axes.length ? 16 : 14;
      });
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const base = (d.title.trim() || "scenario_grid").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    a.download = `${base}_template.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [sgTableDraft]);

  // Read-only count of uploaded scenario-grid points for the current saved grid
  // table (confidence the Brent-grid Excel upload landed). Re-fetched whenever the
  // selected grid table changes; null for a non-grid / unsaved table.
  // Uses the dedicated `is_admin()`-guarded count RPC (cheap aggregate) rather
  // than re-paging the entire mesh just to read `.length` — a dense mesh can be
  // ~200k points, and counting via the read RPC would page the whole thing.
  const [sgGridPointCount, setSgGridPointCount] = useState<number | null>(null);
  const [sgGridPointCountLoading, setSgGridPointCountLoading] = useState(false);
  // Bumped after a successful upload to force the read-only count to re-fetch.
  const [sgGridCountNonce, setSgGridCountNonce] = useState(0);
  const sgGridDraftId = sgTableDraft?.grid ? sgTableDraft.id : null;
  useEffect(() => {
    if (!supabase || sgGridDraftId == null) {
      setSgGridPointCount(null);
      setSgGridPointCountLoading(false);
      return;
    }
    let cancelled = false;
    setSgGridPointCountLoading(true);
    rpcAdminCountStockGuideScenarioGrid(supabase, sgGridDraftId)
      .then((count) => {
        if (!cancelled) setSgGridPointCount(count.total);
      })
      .catch(() => {
        if (!cancelled) setSgGridPointCount(null);
      })
      .finally(() => {
        if (!cancelled) setSgGridPointCountLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, sgGridDraftId, sgGridCountNonce]);

  // ── In-admin filled-template upload (browser parse → validate → chunked replace) ─
  //
  // Closes the loop: configure shell → Download template → fill → Upload (no
  // terminal). Flow states: idle → parsing → report (errors block; warnings allow)
  // → uploading (chunked, replace-total) → done (confirmed via the count RPC) /
  // error (retry re-runs the whole replace — idempotent). The service-role Python
  // uploader (`scripts/manual/stock_guide_brent_grid_upload.py`) stays as the
  // automation fallback.
  const [sgUpload, setSgUpload] = useState<SgUploadState>({ phase: "idle" });

  /** Reset the upload widget back to idle (e.g. after closing the report). */
  const handleResetSgGridUpload = useCallback(() => {
    setSgUpload({ phase: "idle" });
  }, []);

  /** Parse + validate a chosen .xlsx against the saved grid shell (no network). */
  const handleSelectSgGridUploadFile = useCallback(
    async (file: File) => {
      const d = sgTableDraft;
      if (!d || !d.grid) return;
      setSgUpload({ phase: "parsing", fileName: file.name });
      try {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        const buf = await file.arrayBuffer();
        await wb.xlsx.load(buf);
        const block = sgDraftToGridBlock(d.gridDef);
        const result = parseScenarioGridWorkbook(wb, block);
        setSgUpload({ phase: "report", fileName: file.name, result });
      } catch (e: unknown) {
        const message =
          e && typeof e === "object" && "message" in e
            ? String((e as { message?: unknown }).message ?? "Could not read the workbook.")
            : "Could not read the workbook.";
        setSgUpload({ phase: "error", fileName: file.name, message, result: null });
      }
    },
    [sgTableDraft],
  );

  /** Confirm the upload: chunked replace-total against the saved sensitivity id. */
  const handleConfirmSgGridUpload = useCallback(async () => {
    const sb = supabase;
    const id = sgTableDraft?.grid ? sgTableDraft.id : null;
    // Snapshot the report (works for the initial confirm AND a retry from error).
    const cur = sgUpload;
    if (cur.phase !== "report" && cur.phase !== "error") return;
    const result = cur.result;
    if (!sb || id == null || !result || result.rows.length === 0) return;
    if (result.errors.length > 0) return; // blocked

    const chunks = chunkUploadRows(result.rows, 2000);
    const total = result.rows.length;
    const fileName = cur.fileName;
    setSgUpload({ phase: "uploading", fileName, result, sent: 0, total });
    let sent = 0;
    try {
      for (const chunk of chunks) {
        await rpcAdminReplaceStockGuideScenarioGrid(sb, id, chunk.rows, chunk.firstChunk);
        sent += chunk.rows.length;
        setSgUpload({ phase: "uploading", fileName, result, sent, total });
      }
      // Confirm via the count RPC.
      const count = await rpcAdminCountStockGuideScenarioGrid(sb, id);
      setSgUpload({
        phase: "done",
        fileName,
        total: count.total,
        byMetric: count.byMetric,
      });
      setSgGridCountNonce((n) => n + 1); // refresh the read-only point count
    } catch (e: unknown) {
      const base =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message ?? "Upload failed.")
          : "Upload failed.";
      setSgUpload({
        phase: "error",
        fileName,
        message: `${base} (${sent.toLocaleString()} / ${total.toLocaleString()} sent before the error — retry re-runs the whole replace, which is idempotent.)`,
        result,
      });
    }
  }, [supabase, sgTableDraft, sgUpload]);

  const handleChangeSgTableSingleCompany = useCallback((ticker: string) => {
    setSgTableDraft((d) => (d ? { ...d, singleCompany: ticker } : d));
  }, []);

  const handleChangeSgAxisKind = useCallback(
    (axis: "row" | "col", kind: SensitivityAxis["kind"]) => {
      setSgTableDraft((d) => {
        if (!d) return d;
        const key = axis === "row" ? "rowAxis" : "colAxis";
        // Reset the axis to a clean draft of the new kind; preselect both
        // forward years for a 'year' axis.
        const next: SgAxisDraft = { ...blankAxisDraft(), kind };
        if (kind === "year") next.years = ["y1", "y2"];
        return syncDraftMatrices({ ...d, [key]: next });
      });
    },
    [syncDraftMatrices],
  );

  const handleChangeSgAxisDriver = useCallback((axis: "row" | "col", driverId: string) => {
    setSgTableDraft((d) => {
      if (!d) return d;
      const key = axis === "row" ? "rowAxis" : "colAxis";
      return { ...d, [key]: { ...d[key], driverId } };
    });
  }, []);

  const handleToggleSgAxisCompany = useCallback(
    (axis: "row" | "col", ticker: string) => {
      setSgTableDraft((d) => {
        if (!d) return d;
        const key = axis === "row" ? "rowAxis" : "colAxis";
        const cur = d[key].companies;
        const companies = cur.includes(ticker)
          ? cur.filter((t) => t !== ticker)
          : [...cur, ticker];
        return syncDraftMatrices({ ...d, [key]: { ...d[key], companies } });
      });
    },
    [syncDraftMatrices],
  );

  const handleAddSgAxisScenario = useCallback(
    (axis: "row" | "col") => {
      setSgTableDraft((d) => {
        if (!d) return d;
        const key = axis === "row" ? "rowAxis" : "colAxis";
        return syncDraftMatrices({
          ...d,
          [key]: { ...d[key], scenarios: [...d[key].scenarios, ""] },
        });
      });
    },
    [syncDraftMatrices],
  );

  const handleChangeSgAxisScenario = useCallback(
    (axis: "row" | "col", i: number, value: string) => {
      setSgTableDraft((d) => {
        if (!d) return d;
        const key = axis === "row" ? "rowAxis" : "colAxis";
        return {
          ...d,
          [key]: {
            ...d[key],
            scenarios: d[key].scenarios.map((s, idx) => (idx === i ? value : s)),
          },
        };
      });
    },
    [],
  );

  const handleRemoveSgAxisScenario = useCallback(
    (axis: "row" | "col", i: number) => {
      setSgTableDraft((d) => {
        if (!d) return d;
        const key = axis === "row" ? "rowAxis" : "colAxis";
        return syncDraftMatrices({
          ...d,
          [key]: {
            ...d[key],
            scenarios: d[key].scenarios.filter((_, idx) => idx !== i),
          },
        });
      });
    },
    [syncDraftMatrices],
  );

  const handleChangeSgTableCell = useCallback((r: number, c: number, value: string) => {
    setSgTableDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        cells: d.cells.map((row, ri) =>
          ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row,
        ),
      };
    });
  }, []);

  const handleChangeSgTableCellSecondary = useCallback(
    (r: number, c: number, value: string) => {
      setSgTableDraft((d) => {
        if (!d) return d;
        return {
          ...d,
          cellsSecondary: d.cellsSecondary.map((row, ri) =>
            ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row,
          ),
        };
      });
    },
    [],
  );

  // Client-side validation (mirrors the server guards): not both-company, axes
  // non-empty, matrix dims match. Returns a user-facing message or null.
  const sgTableValidationError = useMemo(() => {
    const d = sgTableDraft;
    if (!d) return null;
    if (!d.title.trim()) return "Title is required.";

    // ── SCENARIO-GRID validation ──────────────────────────────────────────────
    if (d.grid) {
      const g = d.gridDef;
      if (g.axes.length < 1) return "The scenario grid needs at least one axis.";
      if (g.axes.some((a) => !a.driverId.trim() && !a.driverKey.trim()))
        return "Every axis must select a driver.";
      // Distinct driver bindings (by id, falling back to legacy key).
      const bindings = g.axes.map((a) => a.driverId.trim() || a.driverKey.trim());
      if (new Set(bindings).size !== bindings.length)
        return "Each axis must use a different driver.";
      // Template range sanity (used by the downloadable Excel).
      for (const a of g.axes) {
        const lo = strToNum(a.tmin);
        const hi = strToNum(a.tmax);
        const st = strToNum(a.tstep);
        if (lo == null || hi == null || st == null)
          return "Every axis needs numeric template min / max / step.";
        if (lo >= hi) return "Each axis template min must be below its max.";
        if (st <= 0) return "Each axis template step must be greater than zero.";
      }
      if (g.outputs.length === 0)
        return "Add at least one output (e.g. Target price).";
      // Every output needs a known base metric; an optional year must be 4 digits;
      // effective storage keys (`base_year` / `base`) must be unique.
      const seenKeys = new Set<string>();
      for (const o of g.outputs) {
        if (!SG_GRID_BASE_CATALOG.some((m) => m.base === o.base.trim()))
          return "Every output must select a metric.";
        const yr = o.year.trim();
        if (yr && !/^\d{4}$/.test(yr))
          return "An output year must be a 4-digit year (e.g. 2026).";
        const key = sgGridOutputKey(o);
        if (seenKeys.has(key)) return `Duplicate output: ${key}`;
        seenKeys.add(key);
      }
      if (d.gridCompanies.length === 0)
        return "Select at least one company for the scenario grid.";
      return null;
    }

    if (d.rowAxis.kind === "company" && d.colAxis.kind === "company")
      return "Both axes cannot be Company — at least one axis must be a Driver or Year.";
    const rows = axisItemCount(d.rowAxis);
    const cols = axisItemCount(d.colAxis);
    if (rows < 1) return "The row axis must have at least one item.";
    if (cols < 1) return "The column axis must have at least one item.";
    if (d.rowAxis.kind === "driver" && !d.rowAxis.driverId)
      return "Select a driver for the row axis.";
    if (d.colAxis.kind === "driver" && !d.colAxis.driverId)
      return "Select a driver for the column axis.";
    // Every driver scenario must parse to a number; blank/garbage entries are
    // dropped by draftToAxis (.filter), which would desync the saved
    // scenarios.length from the matrix dims sized by axisItemCount.
    if (d.rowAxis.kind === "driver" && !d.rowAxis.scenarios.every((s) => strToNum(s) != null))
      return "Every driver scenario must be a number (no blank cells).";
    if (d.colAxis.kind === "driver" && !d.colAxis.scenarios.every((s) => strToNum(s) != null))
      return "Every driver scenario must be a number (no blank cells).";
    if (deriveTableCompanies(d).length === 0)
      return "Select the company this table belongs to.";
    return null;
  }, [sgTableDraft]);

  const sgTablePendingChanges = useMemo(
    () => JSON.stringify(sgTableDraft) !== sgTableSnapshotRef.current,
    [sgTableDraft],
  );

  // Item labels for the matrix headers (depend on config + drivers).
  const sgTableRowLabels = useMemo(
    () => (sgTableDraft ? axisItemLabels(sgTableDraft.rowAxis, sgConfig, sgDrivers) : []),
    [sgTableDraft, sgConfig, sgDrivers],
  );
  const sgTableColLabels = useMemo(
    () => (sgTableDraft ? axisItemLabels(sgTableDraft.colAxis, sgConfig, sgDrivers) : []),
    [sgTableDraft, sgConfig, sgDrivers],
  );

  // ── Live "Dashboard preview" for the builder ───────────────────────────────
  // Mirror, byte-for-byte, what the /stock-guide dashboard renders for the draft
  // table — using the SAME shared compute + format helpers — so the admin sees,
  // at input time, exactly what a derived value_mode will produce from the typed
  // BASE values. (For 'absolute' there is no transform; the View may echo or hide.)
  //
  // The cell's company is resolved with the dashboard's rule: row-company axis →
  // companies[rowIdx]; else col-company axis → companies[colIdx]; else the table's
  // single membership company (companies[0]).

  // Index admin companies by ticker — gives shares_outstanding + yahoo_symbol.
  const sgCompaniesByTicker = useMemo(() => {
    const m = new Map<string, StockGuideAdminCompany>();
    for (const c of sgCompanies) m.set(c.ticker, c);
    return m;
  }, [sgCompanies]);

  // The companies involved in the current draft (company axis tickers, else the
  // single-company membership). Drives which quotes we fetch for the preview.
  const sgPreviewCompanies = useMemo(
    () => (sgTableDraft ? deriveTableCompanies(sgTableDraft) : []),
    [sgTableDraft],
  );

  // Quote symbols = yahoo_symbol (fallback ticker), de-duplicated. Same convention
  // as the dashboard's `quoteSymbols`.
  const sgPreviewQuoteSymbols = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const ticker of sgPreviewCompanies) {
      const c = sgCompaniesByTicker.get(ticker);
      const sym = (c?.yahoo_symbol ?? ticker) || "";
      if (sym && !seen.has(sym)) {
        seen.add(sym);
        out.push(sym);
      }
    }
    return out;
  }, [sgPreviewCompanies, sgCompaniesByTicker]);

  const {
    data: sgPreviewQuotes,
    isLoading: sgPreviewQuotesLoading,
  } = useStockQuote(sgPreviewQuoteSymbols);

  // Index quotes by stripped symbol — proxy returns `symbol` with `.SA` removed.
  // Match identically to the dashboard's `priceByKey` lookup.
  const sgPreviewPriceByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of sgPreviewQuotes) {
      if (q?.symbol != null && Number.isFinite(q.regularMarketPrice)) {
        m.set(q.symbol.toUpperCase(), q.regularMarketPrice);
      }
    }
    return m;
  }, [sgPreviewQuotes]);

  // Live { livePrice, marketCapBrlMn } per draft ticker — marketCap = shares ×
  // livePrice / 1e6, exactly like the dashboard. Null when the quote or
  // shares_outstanding is missing.
  const sgPreviewLiveByTicker = useMemo(() => {
    const m = new Map<
      string,
      { livePrice: number | null; marketCapBrlMn: number | null }
    >();
    for (const ticker of sgPreviewCompanies) {
      const c = sgCompaniesByTicker.get(ticker);
      const sym = (c?.yahoo_symbol ?? ticker).toUpperCase();
      const stripped = sym.replace(/\.SA$/, "");
      const p = sgPreviewPriceByKey.get(stripped) ?? sgPreviewPriceByKey.get(sym);
      const livePrice = p != null && Number.isFinite(p) ? p : null;
      const shares = c?.shares_outstanding ?? null;
      const marketCapBrlMn =
        shares != null && livePrice != null ? (shares * livePrice) / 1e6 : null;
      m.set(ticker, { livePrice, marketCapBrlMn });
    }
    return m;
  }, [sgPreviewCompanies, sgCompaniesByTicker, sgPreviewPriceByKey]);

  // Pure helper: the live DISPLAY value the dashboard would show for cell
  // (rowIdx, colIdx) of the draft. Reuses the SAME shared compute + format
  // helpers as /stock-guide, so the preview is exact. Returns "—" when the
  // quote / shares are missing or a guard fails.
  const sgPreviewCell = useCallback(
    (rowIdx: number, colIdx: number): string => {
      const d = sgTableDraft;
      if (!d) return "—";
      const mode = d.value_mode as SensitivityValueMode;

      // Resolve the cell's company (dashboard rule).
      let company: string | null = null;
      if (d.rowAxis.kind === "company") {
        company = d.rowAxis.companies[rowIdx] ?? null;
      } else if (d.colAxis.kind === "company") {
        company = d.colAxis.companies[colIdx] ?? null;
      } else {
        company = deriveTableCompanies(d)[0] ?? null;
      }

      const live = company != null ? sgPreviewLiveByTicker.get(company) : undefined;
      const livePrice = live?.livePrice ?? null;
      const marketCapBrlMn = live?.marketCapBrlMn ?? null;

      const primary = strToNum(d.cells[rowIdx]?.[colIdx] ?? "");
      const secondary = strToNum(d.cellsSecondary[rowIdx]?.[colIdx] ?? "");

      const value = computeSensitivityCellValue({
        valueMode: mode,
        primary,
        secondary,
        marketCapBrlMn,
        livePrice,
      });
      return formatSensitivityValue(value, unitForValueMode(mode, d.unit));
    },
    [sgTableDraft, sgPreviewLiveByTicker],
  );

  // Per-mode base-input metadata (hint banner + matrix labels) for the builder.
  const sgTableBaseInputMeta = useMemo(
    () =>
      sgTableDraft
        ? baseInputMeta(
            sgTableDraft.value_mode as SensitivityValueMode,
            sgTableDraft.metric_label,
          )
        : null,
    [sgTableDraft],
  );

  const handleSaveSgTable = useCallback(async () => {
    if (!supabase || !sgTableDraft || sgTableSaving) return;
    if (sgTableValidationError) {
      setSgTableSaveError(sgTableValidationError);
      return;
    }
    setSgTableSaving(true);
    setSgTableSaveError(null);
    try {
      const d = sgTableDraft;
      let definition: Record<string, unknown>;
      if (d.grid) {
        // SCENARIO GRID: serialize the (non-sensitive) grid shell. The per-company
        // points live in stock_guide_scenario_grid (uploaded via Excel), NOT here.
        // The row/col axes + cells are irrelevant; we emit minimal placeholders so
        // the row is structurally a valid sensitivity def.
        const g = d.gridDef;
        const grid: Record<string, unknown> = {
          axes: g.axes.map((a) => {
            const axis: Record<string, unknown> = {
              label: a.label.trim(),
              unit: a.unit.trim(),
              tmin: strToNum(a.tmin),
              tmax: strToNum(a.tmax),
              tstep: strToNum(a.tstep),
            };
            const did = strToNum(a.driverId);
            if (did != null) axis.driver_id = did;
            if (a.driverKey.trim()) axis.driver_key = a.driverKey.trim();
            return axis;
          }),
          outputs: g.outputs.map((o) => {
            const out: Record<string, unknown> = {
              key: sgGridOutputKey(o),
              mode: o.mode,
              label: o.label.trim() || sgGridOutputLabel(o),
            };
            // Informative extras (parsers ignore unknown keys) for human readers.
            if (o.base.trim()) out.base = o.base.trim();
            if (o.year.trim()) out.year = o.year.trim();
            return out;
          }),
        };
        definition = {
          row_axis: { kind: "company", companies: [...d.gridCompanies] },
          col_axis: { kind: "year", years: ["y1"] },
          cells: [],
          grid,
        };
      } else {
        definition = {
          row_axis: draftToAxis(d.rowAxis),
          col_axis: draftToAxis(d.colAxis),
          cells: strMatrixToNum(d.cells),
        };
        if (d.value_mode === "ev_ebitda") {
          definition.cells_secondary = strMatrixToNum(d.cellsSecondary);
        }
        // Consolidated-panel tag (single-row static tables only). Round-trip the two
        // keys so editing+saving never silently UNTAGS a panel-tagged table. Only
        // emit a valid panel + a non-empty trimmed row label.
        if (d.panel === "brent" || d.panel === "margin") {
          definition.panel = d.panel;
        }
        const rowLabel = d.rowLabel.trim();
        if (rowLabel) definition.row_label = rowLabel;
      }
      const newId = await rpcAdminUpsertStockGuideSensitivityTable(supabase, d.id, {
        title: d.title.trim(),
        value_mode: d.value_mode,
        metric_label: d.metric_label.trim(),
        unit: d.unit.trim(),
        companies: deriveTableCompanies(d),
        definition,
        display_order: strToNum(d.display_order) ?? 0,
      });
      await loadSgTables();
      // Re-snapshot from the saved draft (with the resolved id) so pending resets.
      const saved: SgTableDraft = { ...d, id: newId };
      setSgTableDraft(saved);
      sgTableSnapshotRef.current = JSON.stringify(saved);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message ?? "Could not save the table.")
          : "Could not save the table.";
      setSgTableSaveError(msg);
    }
    setSgTableSaving(false);
  }, [supabase, sgTableDraft, sgTableSaving, sgTableValidationError, loadSgTables]);

  const handleDeleteSgTable = useCallback((id: number) => {
    setSgTableDeleteConfirm(id);
  }, []);

  const handleConfirmDeleteSgTable = useCallback(async () => {
    if (!supabase || sgTableDeleteConfirm == null) return;
    const id = sgTableDeleteConfirm;
    setSgTableSaving(true);
    setSgTableSaveError(null);
    try {
      await rpcAdminDeleteStockGuideSensitivityTable(supabase, id);
      await loadSgTables();
      if (sgTableDraft?.id === id) {
        setSgTableDraft(null);
        sgTableSnapshotRef.current = "null";
      }
      setSgTableDeleteConfirm(null);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message ?? "Could not delete the table.")
          : "Could not delete the table.";
      setSgTableSaveError(msg);
    }
    setSgTableSaving(false);
  }, [supabase, sgTableDeleteConfirm, sgTableDraft, loadSgTables]);

  const handleCancelDeleteSgTable = useCallback(() => {
    setSgTableDeleteConfirm(null);
  }, []);

  return {
    allowed,
    roleLoading,
    myProfile,

    activeSection,
    setActiveSection,
    activeDataInputSlug,
    setActiveDataInputSlug,

    localVis,
    saving,
    savedSlug,
    handleToggle,

    localHomeVis,
    savingHome,
    savedHomeSlug,
    homeToggleError,
    handleHomeToggle,

    localPublicVis,
    savingPublic,
    savedPublicSlug,
    publicToggleError,
    handlePublicToggle,

    users,
    usersLoading,
    localRoles,
    savingUser,
    savedUser,
    handleRoleChange,

    caStats,
    caBases,
    caSubscribers,
    caEmailLog,
    caOverviewLoading,
    caSubscribersLoading,
    caEmailLogLoading,
    caError,
    caSubscribersError,
    caEmailLogError,
    caSourceActive,
    caTogglingSource,
    caSubscriberFilter,
    setCaSubscriberFilter,
    caTestEmail,
    setCaTestEmail,
    caSendingTest,
    caTestResult,
    caTestError,
    caCountsBySource,
    handleToggleCaSource,
    handleQueueCaTest,
    handleRefreshCaSubscribers,

    defaultKeywords,
    defaultKeywordsLoading,
    defaultKeywordsError,
    newKeyword,
    setNewKeyword,
    newKeywordMatchType,
    setNewKeywordMatchType,
    addingKeyword,
    addKeywordError,
    addKeywordSuccess,
    removingKeyword,
    confirmRemoveKeyword,
    setConfirmRemoveKeyword,
    togglingMatchType,
    handleAddKeyword,
    handleRemoveKeyword,
    handleToggleMatchType,

    fieldStakesOverview,
    fieldStakesEmpresas,
    fieldStakesLoading,
    selectedCampo,
    editorStakes,
    editorLoading,
    newEmpresaInput,
    setNewEmpresaInput,
    newEmpresaPctInput,
    setNewEmpresaPctInput,
    savingStakes,
    deleteCampoConfirm,
    stakesError,
    stakesSearchQuery,
    setStakesSearchQuery,
    stakesStatusFilter,
    setStakesStatusFilter,
    currentSum,
    isValidSum,
    pendingChanges,
    filteredOverview,
    groupedOverview,
    expandedCanonicals,
    handleToggleCanonical,
    selectedCampoLastUpdated,
    handleSelectCampo,
    handleAddEmpresaRow,
    handleRemoveEmpresaRow,
    handleChangeStake,
    handleSaveStakes,
    handleDeleteCampo,
    handleConfirmDeleteCampo,
    handleCancelDeleteCampo,

    sgSubTab,
    setSgSubTab,
    sgCompanies,
    sgLoading,
    sgConfig,
    sgConfigDraft,
    setSgConfigDraft,
    sgConfigSaving,
    sgConfigSaved,
    sgConfigError,
    sgSelectedTicker,
    sgEditorRow,
    sgEditorLoading,
    sgSaving,
    sgError,
    sgDeleteConfirm,
    sgTogglingVisibility,
    sgSearchQuery,
    setSgSearchQuery,
    sgFilteredCompanies,
    sgCompanyTickers,
    sgPendingChanges,
    handleSelectStockGuideCompany,
    handleChangeSgField,
    handleSaveSgCompany,
    handleToggleSgVisibility,
    handleSaveSgConfig,
    handleDeleteSgCompany,
    handleConfirmDeleteSgCompany,
    handleCancelDeleteSgCompany,

    sgDrivers,
    sgDriverRows,
    sgDriversLoading,
    sgDriversError,
    sgMarketCatalog,
    sgMarketValues,
    sgMarketLoading,
    sgResolveDriverRowValue,
    sgDriverSavingKey,
    sgDriverDeleteConfirm,
    handleChangeSgDriverField,
    handleSaveSgDriver,
    handleDeleteSgDriver,
    handleConfirmDeleteSgDriver,
    handleCancelDeleteSgDriver,

    sgTables,
    sgTablesLoading,
    sgTablesError,
    sgTableDraft,
    sgTableSaving,
    sgTableSaveError,
    sgTablePendingChanges,
    sgTableDeleteConfirm,
    sgTableValidationError,
    sgTableRowLabels,
    sgTableColLabels,
    sgTableBaseInputMeta,
    sgPreviewCell,
    sgPreviewQuotesLoading,
    handleSelectSgTable,
    handleNewSgTable,
    handleCancelSgTableEdit,
    handleChangeSgTableField,
    handleChangeSgTableValueMode,
    handleChangeSgTablePanel,
    handleChangeSgTableRowLabel,
    handleChangeSgTableSingleCompany,
    handleChangeSgAxisKind,
    handleChangeSgAxisDriver,
    handleToggleSgAxisCompany,
    handleAddSgAxisScenario,
    handleChangeSgAxisScenario,
    handleRemoveSgAxisScenario,
    handleChangeSgTableCell,
    handleChangeSgTableCellSecondary,
    // scenario grid
    sgGridDriverCatalog: MARKET_DRIVER_CATALOG,
    sgGridDrivers: sgDrivers,
    sgGridBaseCatalog: SG_GRID_BASE_CATALOG,
    handleToggleSgGrid,
    handleAddSgGridOutput,
    handleRemoveSgGridOutput,
    handleChangeSgGridOutputBase,
    handleChangeSgGridOutputYear,
    handleAddSgGridAxis,
    handleRemoveSgGridAxis,
    handleChangeSgGridAxisField,
    handleToggleSgGridCompany,
    handleDownloadGridTemplate,
    sgGridTemplateWarning,
    sgGridPointCount,
    sgGridPointCountLoading,
    sgUpload,
    handleSelectSgGridUploadFile,
    handleConfirmSgGridUpload,
    handleResetSgGridUpload,
    handleSaveSgTable,
    handleDeleteSgTable,
    handleConfirmDeleteSgTable,
    handleCancelDeleteSgTable,

    isValidEmail,
    formatDateBR,
  };
}
