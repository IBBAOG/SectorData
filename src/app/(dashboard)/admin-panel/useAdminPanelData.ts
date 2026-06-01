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
//   • Alert Emails      — manage automatic notification recipients
//   • Default Keywords  — manage default News Hunter keywords for anonymous visitors
//   • Data Input        — edit reference tables (desktop-only editor)
//
// RPCs touched: get_module_visibility (via UserProfileContext), set_module_visibility,
// set_module_home_visibility, set_module_public_visibility, get_all_users_with_roles,
// set_user_role, admin_list_default_news_keywords, admin_add_default_news_keyword,
// admin_remove_default_news_keyword.
// Plus direct PostgREST on alert_recipients.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRoleGuard } from "../../../hooks/useRoleGuard";
import {
  useMarketDrivers,
  resolveDriverValue,
  MARKET_DRIVER_CATALOG_BY_KEY,
  isDynamicSource,
  type DriverCatalogEntry,
} from "../../../hooks/useMarketDrivers";
import { useUserProfile } from "../../../context/UserProfileContext";
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
  type DefaultNewsKeyword,
} from "../../../lib/rpc";
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
} from "../../../types/stockGuide";

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
import {
  rpcAdminListSubscribers,
  rpcAdminForceUnsubscribe,
  rpcAdminRequeueOutbox,
  rpcAdminSendTestEvent,
  rpcAdminEmailLogRecent,
  rpcAdminSubscriberStats,
  rpcAdminToggleSourceActive,
  fetchAlertSources,
  fetchFailedOutboxRows,
  type AlertSubscriber,
  type AlertSubscriberStats,
  type AlertSource,
  type AlertEmailLogEntry,
  type AlertOutboxRow,
} from "../../../lib/alertsAdminRpc";

// Re-export Alerts types so both Views can import from a single location
export type {
  AlertSubscriber,
  AlertSubscriberStats,
  AlertSource,
  AlertEmailLogEntry,
  AlertOutboxRow,
};

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
 * Full builder draft for one sensitivity table. `id === null` → new table.
 * `cells` / `cellsSecondary` are string matrices (one entry per axis item) so
 * inputs can hold partial values; they are coerced to `number | null` only at
 * save time.
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
  };
}

/**
 * Derive the table-membership `companies[]` from the draft: the company axis's
 * tickers if either axis is 'company', else the single-company select.
 */
function deriveTableCompanies(d: SgTableDraft): string[] {
  if (d.rowAxis.kind === "company") return [...d.rowAxis.companies];
  if (d.colAxis.kind === "company") return [...d.colAxis.companies];
  return d.singleCompany ? [d.singleCompany] : [];
}

// ── Section metadata ──────────────────────────────────────────────────────────

export type SectionId =
  | "members"
  | "permissions"
  | "alert-recipients"
  | "alerts-product"
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
  { id: "alert-recipients", label: "Alert Emails",          shortLabel: "Alert Emails", description: "Notification recipients" },
  { id: "alerts-product",   label: "Alerts",                shortLabel: "Alerts",       description: "Alerts product management" },
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

// ── Alert recipient row shape ──────────────────────────────────────────────────

export interface AlertRecipient {
  id: string;
  email: string;
  is_active: boolean;
  created_at: string;
  added_by: string | null;
}

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

  // Alert recipients
  recipients: AlertRecipient[];
  recipientsLoading: boolean;
  recipientsError: string | null;
  newEmail: string;
  setNewEmail: (v: string) => void;
  addingEmail: boolean;
  addEmailError: string | null;
  addEmailSuccess: boolean;
  togglingId: string | null;
  removingId: string | null;
  confirmRemoveId: string | null;
  setConfirmRemoveId: (id: string | null) => void;
  handleAddRecipient: () => Promise<void>;
  handleToggleRecipient: (id: string, currentActive: boolean) => Promise<void>;
  handleRemoveRecipient: (id: string) => Promise<void>;

  // Alerts product management (alerts-product section)
  alertsStats: AlertSubscriberStats | null;
  alertsStatsLoading: boolean;
  alertsSubscribers: AlertSubscriber[];
  alertsSubscribersLoading: boolean;
  alertsSubscriberSourceFilter: string;
  setAlertsSubscriberSourceFilter: (v: string) => void;
  alertsSources: AlertSource[];
  alertsSourcesLoading: boolean;
  alertsEmailLog: AlertEmailLogEntry[];
  alertsEmailLogLoading: boolean;
  alertsEmailLogStatusFilter: string;
  setAlertsEmailLogStatusFilter: (v: string) => void;
  alertsOutbox: AlertOutboxRow[];
  alertsOutboxLoading: boolean;
  requeueingOutboxId: string | null;
  sendingTestSlug: string | null;
  togglingSourceSlug: string | null;
  unsubscribingId: string | null;
  handleAlertsForceUnsubscribe: (id: string) => Promise<void>;
  handleAlertsRequeueOutbox: (id: string) => Promise<void>;
  handleAlertsSendTestEvent: (sourceSlug: string) => Promise<void>;
  handleAlertsToggleSource: (sourceSlug: string, isActive: boolean) => Promise<void>;

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
  sgSectorFilter: "all" | StockGuideSector;
  setSgSectorFilter: (v: "all" | StockGuideSector) => void;
  /** Companies filtered by sgSearchQuery + sgSectorFilter. */
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
  handleSelectSgTable: (id: number) => void;
  handleNewSgTable: () => void;
  handleCancelSgTableEdit: () => void;
  handleChangeSgTableField: (
    field: "title" | "metric_label" | "unit" | "display_order",
    value: string,
  ) => void;
  handleChangeSgTableValueMode: (mode: SgValueMode) => void;
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

  // ── Alert Recipients ───────────────────────────────────────────────────────
  const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [addingEmail, setAddingEmail] = useState(false);
  const [addEmailError, setAddEmailError] = useState<string | null>(null);
  const [addEmailSuccess, setAddEmailSuccess] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const loadRecipients = useCallback(async () => {
    if (!supabase) return;
    setRecipientsLoading(true);
    setRecipientsError(null);
    const { data, error } = await supabase
      .from("alert_recipients")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setRecipientsError("Could not load recipients. Please try again.");
    else setRecipients((data as AlertRecipient[]) ?? []);
    setRecipientsLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (allowed && activeSection === "alert-recipients") loadRecipients();
  }, [allowed, activeSection, loadRecipients]);

  const handleAddRecipient = useCallback(async () => {
    if (!supabase || addingEmail || !isValidEmail(newEmail)) return;
    setAddingEmail(true);
    setAddEmailError(null);
    const { error } = await supabase.from("alert_recipients").insert({
      email: newEmail.trim().toLowerCase(),
      is_active: true,
      added_by: myProfile?.id ?? null,
    });
    if (error) {
      // Generic message — do NOT differentiate 23505 (email-enumeration fix F2.3)
      setAddEmailError("Could not add recipient. Please verify the email and try again.");
    } else {
      setNewEmail("");
      setAddEmailSuccess(true);
      setTimeout(() => setAddEmailSuccess(false), 2000);
      await loadRecipients();
    }
    setAddingEmail(false);
  }, [supabase, addingEmail, newEmail, myProfile?.id, loadRecipients]);

  const handleToggleRecipient = useCallback(
    async (id: string, currentActive: boolean) => {
      if (!supabase || togglingId) return;
      setTogglingId(id);
      await supabase.from("alert_recipients").update({ is_active: !currentActive }).eq("id", id);
      await loadRecipients();
      setTogglingId(null);
    },
    [supabase, togglingId, loadRecipients],
  );

  const handleRemoveRecipient = useCallback(
    async (id: string) => {
      if (!supabase || removingId) return;
      setRemovingId(id);
      await supabase.from("alert_recipients").delete().eq("id", id);
      setConfirmRemoveId(null);
      await loadRecipients();
      setRemovingId(null);
    },
    [supabase, removingId, loadRecipients],
  );

  // ── Alerts Product Management ──────────────────────────────────────────────
  const [alertsStats, setAlertsStats] = useState<AlertSubscriberStats | null>(null);
  const [alertsStatsLoading, setAlertsStatsLoading] = useState(false);
  const [alertsSubscribers, setAlertsSubscribers] = useState<AlertSubscriber[]>([]);
  const [alertsSubscribersLoading, setAlertsSubscribersLoading] = useState(false);
  const [alertsSubscriberSourceFilter, setAlertsSubscriberSourceFilter] = useState("");
  const [alertsSources, setAlertsSources] = useState<AlertSource[]>([]);
  const [alertsSourcesLoading, setAlertsSourcesLoading] = useState(false);
  const [alertsEmailLog, setAlertsEmailLog] = useState<AlertEmailLogEntry[]>([]);
  const [alertsEmailLogLoading, setAlertsEmailLogLoading] = useState(false);
  const [alertsEmailLogStatusFilter, setAlertsEmailLogStatusFilter] = useState("");
  const [alertsOutbox, setAlertsOutbox] = useState<AlertOutboxRow[]>([]);
  const [alertsOutboxLoading, setAlertsOutboxLoading] = useState(false);
  const [requeueingOutboxId, setRequeuingOutboxId] = useState<string | null>(null);
  const [sendingTestSlug, setSendingTestSlug] = useState<string | null>(null);
  const [togglingSourceSlug, setTogglingSourceSlug] = useState<string | null>(null);
  const [unsubscribingId, setUnsubscribingId] = useState<string | null>(null);

  const loadAlertsData = useCallback(async () => {
    if (!supabase) return;
    // Load all 5 sub-sections in parallel
    setAlertsStatsLoading(true);
    setAlertsSubscribersLoading(true);
    setAlertsSourcesLoading(true);
    setAlertsEmailLogLoading(true);
    setAlertsOutboxLoading(true);
    const [stats, subs, sources, log, outbox] = await Promise.all([
      rpcAdminSubscriberStats(),
      rpcAdminListSubscribers(),
      fetchAlertSources(),
      rpcAdminEmailLogRecent(200),
      fetchFailedOutboxRows(),
    ]);
    setAlertsStats(stats);
    setAlertsStatsLoading(false);
    setAlertsSubscribers(subs);
    setAlertsSubscribersLoading(false);
    setAlertsSources(sources);
    setAlertsSourcesLoading(false);
    setAlertsEmailLog(log);
    setAlertsEmailLogLoading(false);
    setAlertsOutbox(outbox);
    setAlertsOutboxLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (allowed && activeSection === "alerts-product") loadAlertsData();
  }, [allowed, activeSection, loadAlertsData]);

  const handleAlertsForceUnsubscribe = useCallback(
    async (id: string) => {
      if (unsubscribingId) return;
      setUnsubscribingId(id);
      await rpcAdminForceUnsubscribe(id);
      setUnsubscribingId(null);
      // Refresh subscribers and stats
      const [subs, stats] = await Promise.all([
        rpcAdminListSubscribers(alertsSubscriberSourceFilter || undefined),
        rpcAdminSubscriberStats(),
      ]);
      setAlertsSubscribers(subs);
      setAlertsStats(stats);
    },
    [unsubscribingId, alertsSubscriberSourceFilter],
  );

  const handleAlertsRequeueOutbox = useCallback(
    async (id: string) => {
      if (requeueingOutboxId) return;
      setRequeuingOutboxId(id);
      await rpcAdminRequeueOutbox(id);
      setRequeuingOutboxId(null);
      // Refresh outbox list
      const outbox = await fetchFailedOutboxRows();
      setAlertsOutbox(outbox);
    },
    [requeueingOutboxId],
  );

  const handleAlertsSendTestEvent = useCallback(
    async (sourceSlug: string) => {
      if (sendingTestSlug) return;
      setSendingTestSlug(sourceSlug);
      await rpcAdminSendTestEvent(sourceSlug);
      setSendingTestSlug(null);
    },
    [sendingTestSlug],
  );

  const handleAlertsToggleSource = useCallback(
    async (sourceSlug: string, isActive: boolean) => {
      if (togglingSourceSlug) return;
      setTogglingSourceSlug(sourceSlug);
      // Optimistic update
      setAlertsSources((prev) =>
        prev.map((s) =>
          s.source_slug === sourceSlug ? { ...s, is_active: isActive } : s,
        ),
      );
      const ok = await rpcAdminToggleSourceActive(sourceSlug, isActive);
      if (!ok) {
        // Rollback on failure
        setAlertsSources((prev) =>
          prev.map((s) =>
            s.source_slug === sourceSlug ? { ...s, is_active: !isActive } : s,
          ),
        );
      }
      setTogglingSourceSlug(null);
    },
    [togglingSourceSlug],
  );

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
  const [sgSectorFilter, setSgSectorFilter] = useState<"all" | StockGuideSector>("all");

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
      if (sgSectorFilter !== "all" && c.sector !== sgSectorFilter) return false;
      if (q) {
        const inTicker = c.ticker.toLowerCase().includes(q);
        const inName = c.company_name.toLowerCase().includes(q);
        if (!inTicker && !inName) return false;
      }
      return true;
    });
  }, [sgCompanies, sgSearchQuery, sgSectorFilter]);

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
      const definition: Record<string, unknown> = {
        row_axis: draftToAxis(d.rowAxis),
        col_axis: draftToAxis(d.colAxis),
        cells: strMatrixToNum(d.cells),
      };
      if (d.value_mode === "ev_ebitda") {
        definition.cells_secondary = strMatrixToNum(d.cellsSecondary);
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

    recipients,
    recipientsLoading,
    recipientsError,
    newEmail,
    setNewEmail,
    addingEmail,
    addEmailError,
    addEmailSuccess,
    togglingId,
    removingId,
    confirmRemoveId,
    setConfirmRemoveId,
    handleAddRecipient,
    handleToggleRecipient,
    handleRemoveRecipient,

    alertsStats,
    alertsStatsLoading,
    alertsSubscribers,
    alertsSubscribersLoading,
    alertsSubscriberSourceFilter,
    setAlertsSubscriberSourceFilter,
    alertsSources,
    alertsSourcesLoading,
    alertsEmailLog,
    alertsEmailLogLoading,
    alertsEmailLogStatusFilter,
    setAlertsEmailLogStatusFilter,
    alertsOutbox,
    alertsOutboxLoading,
    requeueingOutboxId,
    sendingTestSlug,
    togglingSourceSlug,
    unsubscribingId,
    handleAlertsForceUnsubscribe,
    handleAlertsRequeueOutbox,
    handleAlertsSendTestEvent,
    handleAlertsToggleSource,

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
    sgSectorFilter,
    setSgSectorFilter,
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
    handleSelectSgTable,
    handleNewSgTable,
    handleCancelSgTableEdit,
    handleChangeSgTableField,
    handleChangeSgTableValueMode,
    handleChangeSgTableSingleCompany,
    handleChangeSgAxisKind,
    handleChangeSgAxisDriver,
    handleToggleSgAxisCompany,
    handleAddSgAxisScenario,
    handleChangeSgAxisScenario,
    handleRemoveSgAxisScenario,
    handleChangeSgTableCell,
    handleChangeSgTableCellSecondary,
    handleSaveSgTable,
    handleDeleteSgTable,
    handleConfirmDeleteSgTable,
    handleCancelDeleteSgTable,

    isValidEmail,
    formatDateBR,
  };
}
