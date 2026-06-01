// ─── Stock Guide (equities-research comps + sensitivity) ─────────────────────
//
// Shapes returned by the `stock_guide_*` RPCs. Consumed by:
//   • /stock-guide dashboard (public reads — comps table + per-company
//     sensitivity drill-down + live market-cap / upside)
//   • /admin-panel "Stock Guide" section (admin CRUD — comps editor, freeform
//     2D sensitivity grid, global config, hide/show toggle)
//
// Source of truth: tables `stock_guide_companies`, `stock_guide_sensitivity`,
// `stock_guide_config` — see `supabase/migrations/20260603200000_stock_guide.sql`
// (owner: worker_supabase). All reads flow through SECURITY DEFINER RPCs; the
// tables have RLS on with no SELECT policy, so a non-admin browser cannot read
// hidden companies' financials directly.
//
// HIDE-AWARE CONTRACT: `get_stock_guide_comps()` returns one row per company
// in `display_order`. For visible rows (or any row when caller is_admin), every
// field is populated. For HIDDEN rows seen by a non-admin, ONLY
// `ticker` / `company_name` / `is_visible` / `display_order` carry values —
// every financial field, `shares_outstanding`, `sector`, `volume_unit` and
// `yahoo_symbol` come back NULL. The frontend therefore cannot even fetch a
// restricted company's live price (no yahoo_symbol leaves the server).

/** Sector enum — drives the optional sector filter + the volume-unit footnote. */
export type StockGuideSector = "oil_gas" | "fuel_distribution";

/** Volume unit enum — `kbpd` for oil & gas, `thousand_m3` for fuel distribution. */
export type StockGuideVolumeUnit = "kbpd" | "thousand_m3";

/** Recommendation enum. OP = Outperform, MP = Marketperform, UP = Underperform. */
export type StockGuideRecommendation = "OP" | "MP" | "UP";

/**
 * Raw comps row as returned by `get_stock_guide_comps()`, with every numeric
 * field already coerced to a JS `number | null` by the rpc.ts wrapper (Postgres
 * `numeric` arrives as a string over PostgREST).
 *
 * For hidden rows seen by a non-admin, all nullable fields below are `null`.
 */
export interface StockGuideCompany {
  ticker: string;
  company_name: string;
  is_visible: boolean;
  display_order: number;
  sector: StockGuideSector | null;
  volume_unit: StockGuideVolumeUnit | null;
  /** Yahoo quote symbol (usually = ticker, no `.SA`). NULL for hidden→non-admin. */
  yahoo_symbol: string | null;
  /** Absolute share count from the valuation model. shares × price = BRL. */
  shares_outstanding: number | null;
  /** Date the comps row was last refreshed (ISO `YYYY-MM-DD`). */
  last_update: string | null;
  target_price: number | null;
  recommendation: StockGuideRecommendation | null;
  /**
   * Current net debt in BRL million — a SINGLE value used for BOTH forward years
   * (EV = market cap + net debt). May be negative (net cash). NULL for
   * hidden→non-admin.
   */
  net_debt: number | null;
  /** Forward EBITDA in BRL million. Denominator of the live EV/EBITDA. */
  ebitda_y1: number | null;
  ebitda_y2: number | null;
  /** Forward net income in BRL million. Denominator of the live P/E. */
  net_income_y1: number | null;
  net_income_y2: number | null;
  /** Forward FCFE in BRL million (the VALUE, not a yield). Drives FCFE yield. */
  fcfe_y1: number | null;
  fcfe_y2: number | null;
  /** Forward total dividends in BRL million. Drives the dividend yield. */
  dividends_y1: number | null;
  dividends_y2: number | null;
  /** Forward volumes in `volume_unit` (kbpd or thousand m³). */
  volumes_y1: number | null;
  volumes_y2: number | null;
}

/**
 * A visible comps row augmented with the LIVE-derived fields. Computed in the
 * hook from the batched Yahoo price + the admin-input fundamentals — never
 * stored server-side. All monetary inputs are BRL million, so EV/EBITDA and P/E
 * are dimensionless and the yields are ×100 for percent points.
 */
export interface StockGuideComputedRow extends StockGuideCompany {
  /** `quote.regularMarketPrice` matched on `yahoo_symbol` (fallback `ticker`). */
  livePrice: number | null;
  /** `shares_outstanding × livePrice / 1e6` (BRL million). Null if either input missing. */
  marketCapBrlMn: number | null;
  /** `target_price / livePrice − 1`. Null unless `livePrice > 0` and TP present. */
  upsidePct: number | null;
  /** `marketCapBrlMn + net_debt` (BRL million). Null if either input is null. */
  evBrlMn: number | null;
  /** `evBrlMn / ebitda_y1` — null unless `ebitda_y1 > 0` (same for Y2). */
  evEbitdaY1: number | null;
  evEbitdaY2: number | null;
  /** `marketCapBrlMn / net_income_y1` — null unless `net_income_y1 > 0` (same for Y2). */
  peY1: number | null;
  peY2: number | null;
  /** `(fcfe_y1 / marketCapBrlMn) × 100` percent points — may be negative (same for Y2). */
  fcfeYieldY1: number | null;
  fcfeYieldY2: number | null;
  /** `(dividends_y1 / marketCapBrlMn) × 100` percent points (same for Y2). */
  divYieldY1: number | null;
  divYieldY2: number | null;
}

/**
 * Freeform 2D sensitivity grid for one company, returned by
 * `get_stock_guide_sensitivity(p_ticker)`. `cells[r][c]` is indexed by
 * `row_labels[r]` × `col_labels[c]`. Returns `{}` (→ all-empty after the wrapper
 * normalizes) when the company is hidden and the caller is not an admin.
 */
export interface SensitivityGrid {
  row_axis_title: string;
  col_axis_title: string;
  value_label: string;
  row_labels: string[];
  col_labels: string[];
  /** `cells[r][c]` — outer index follows row_labels, inner follows col_labels. */
  cells: (number | null)[][];
}

/** Global Stock Guide settings (singleton row from `get_stock_guide_config()`). */
export interface StockGuideConfig {
  /** Header label for the first forward year (e.g. "2026E"). */
  y1_label: string;
  /** Header label for the second forward year (e.g. "2027E"). */
  y2_label: string;
  /** Free text shown in the assumptions footnote (e.g. "Brent USD 80/bbl 2026"). */
  assumptions_note: string;
}

/**
 * Admin-only company row from `admin_get_stock_guide_companies()` — the full
 * record INCLUDING hidden companies' financials plus audit columns. Imported by
 * the /admin-panel "Stock Guide" editor pass; numeric fields already coerced.
 */
export interface StockGuideAdminCompany extends StockGuideCompany {
  updated_at: string | null;
  /** auth.users id of the last editor (uuid string) or null. */
  updated_by: string | null;
}
