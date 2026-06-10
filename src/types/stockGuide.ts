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
   * Forward net debt in BRL million, PER YEAR — `net_debt_y1` drives the year-1
   * EV, `net_debt_y2` the year-2 EV (EV(year) = market cap + net debt(year)).
   * Either may be negative (net cash → lowers EV). NULL for hidden→non-admin.
   */
  net_debt_y1: number | null;
  net_debt_y2: number | null;
  /** Forward EBITDA in BRL million. Denominator of the live EV/EBITDA. */
  ebitda_y1: number | null;
  ebitda_y2: number | null;
  /** Forward net income in BRL million (REPORTED). Shown in the Net Income column. */
  net_income_y1: number | null;
  net_income_y2: number | null;
  /**
   * Optional NPV (BRL million) of recognized tax credits for this company, PER
   * FORWARD YEAR (`npv_tax_credit_y1` → year 1, `npv_tax_credit_y2` → year 2).
   * When EITHER is > 0, the comps table renders an EXTRA "{Company} ex-tax credit"
   * companion row right below the company, whose equity-value basis is the LIVE
   * market cap MINUS that year's NPV (`basisY1 = marketCapBrlMn − (npv_y1 ?? 0)`,
   * `basisY2 = marketCapBrlMn − (npv_y2 ?? 0)`); every mcap-derived figure
   * (EV/EBITDA, P/E, FCFE Yield, Div Yield) is recomputed per year on that
   * ex-credit basis (26E columns on `basisY1`, 27E on `basisY2`). NULL/undefined
   * (and both ≤ 0) → no companion row. Analyst-locked formula — this is the SOLE
   * tax-credit mechanism (the per-year in-place `mcap_adj_y1/y2` market-cap
   * adjustment was retired 2026-06-21; the scalar `npv_tax_credit` was split into
   * per-year y1/y2 on 2026-06-22). Persisted via `admin_upsert_stock_guide_company`.
   */
  npv_tax_credit_y1: number | null;
  npv_tax_credit_y2: number | null;
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
  /**
   * True when this is the synthetic "ex-tax credit" COMPANION row (rendered right
   * below its parent company when `npv_tax_credit_y1 > 0` OR `npv_tax_credit_y2 > 0`).
   * The companion's per-year equity basis is the parent's LIVE market cap minus
   * that year's NPV (`basisY1 = marketCapBrlMn − (npv_y1 ?? 0)`, `basisY2` likewise);
   * every mcap-derived multiple is recomputed per year on that basis, while TP /
   * recommendation / upside / current
   * price / fundamentals (EBITDA, Net income, Volumes) REPEAT the parent's values.
   * `false`/undefined on every normal company row.
   */
  isExTaxCredit?: boolean;
  /**
   * The label shown in the Company column. For a normal row this is the
   * `company_name`; for the companion row it is `"{company_name} ex-tax credit"`.
   */
  displayName: string;
  /** `quote.regularMarketPrice` matched on `yahoo_symbol` (fallback `ticker`). */
  livePrice: number | null;
  /** `shares_outstanding × livePrice / 1e6` (BRL million). Null if either input missing. */
  marketCapBrlMn: number | null;
  /**
   * The equity-value basis that feeds the four multiples for THIS row, year 1.
   * For a normal company row it equals the RAW `marketCapBrlMn`; for the
   * ex-tax-credit companion row it is `marketCapBrlMn − (npv_tax_credit_y1 ?? 0)`.
   * Null when `marketCapBrlMn` is null.
   */
  adjMcapY1: number | null;
  /**
   * Year-2 equity-value basis. For a normal company row it equals the RAW
   * `marketCapBrlMn`; for the ex-tax-credit companion row it is
   * `marketCapBrlMn − (npv_tax_credit_y2 ?? 0)` — so the two years may now differ
   * on the companion row (per-year NPV, 2026-06-22).
   */
  adjMcapY2: number | null;
  /** `target_price / livePrice − 1`. Null unless `livePrice > 0` and TP present. */
  upsidePct: number | null;
  /** `adjMcapY1 + net_debt_y1` (BRL million). Null if either input is null. */
  evBrlMnY1: number | null;
  /** `adjMcapY2 + net_debt_y2` (BRL million). Null if either input is null. */
  evBrlMnY2: number | null;
  /** `evBrlMnY1 / ebitda_y1` — null unless `ebitda_y1 > 0` (same for Y2). */
  evEbitdaY1: number | null;
  /** `evBrlMnY2 / ebitda_y2` — null unless `ebitda_y2 > 0`. */
  evEbitdaY2: number | null;
  /** `adjMcapY1 / net_income_y1` (REPORTED earnings) — null unless `net_income_y1 > 0` (same for Y2). */
  peY1: number | null;
  peY2: number | null;
  /** `(fcfe_y1 / adjMcapY1) × 100` percent points — may be negative (same for Y2). */
  fcfeYieldY1: number | null;
  fcfeYieldY2: number | null;
  /** `(dividends_y1 / adjMcapY1) × 100` percent points (same for Y2). */
  divYieldY1: number | null;
  divYieldY2: number | null;
}

/**
 * DORMANT (kept for the cleanup pass): the OLD freeform 2D sensitivity grid for
 * one company, returned by `get_stock_guide_sensitivity(p_ticker)`. Superseded
 * by the first-class `SensitivityTable` model above; the rpc wrappers remain
 * defined but UNUSED by the hook/views. `cells[r][c]` is indexed by
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

// ─── Redesigned sensitivity model (drivers registry + first-class tables) ─────
//
// REPLACES the old per-company single grid (`SensitivityGrid` above +
// `get_stock_guide_sensitivity`). Source of truth:
//   supabase/migrations/20260606000000_stock_guide_sensitivity_model.sql
//   (commit 0e1947c6, owner: worker_supabase).
//
// Two new tables, read via SECURITY DEFINER RPCs:
//   • stock_guide_drivers       — central macro registry (Brent, USD/BRL, …).
//   • stock_guide_sensitivities — first-class, cross-company sensitivity tables
//     with live-derived value modes + a self-describing jsonb `definition`.
//
// get_stock_guide_sensitivity_tables() is already HIDE-AWARE: restricted
// companies' axis entries + their matching cell rows/cols are stripped
// server-side, and tables with no surviving visible company are omitted. The
// frontend consumes the result as-is.

/**
 * A central macro/assumption driver (Brent average, USD/BRL, etc.) — NOT
 * company-sensitive, so returned in full to everyone.
 *
 * A driver is either:
 *   • STATIC  — `source` is null/'' and the admin types `current_value`; the
 *     "today" value is `current_value`.
 *   • DYNAMIC — `source` is a key in the market-driver catalog
 *     (`MARKET_DRIVER_CATALOG` in `src/hooks/useMarketDrivers.ts`); the "today"
 *     value is computed LIVE in the browser from the Yahoo proxy and `current_value`
 *     may be null. Resolve the effective value with `resolveDriverValue(driver,
 *     marketValues)` — never read `current_value` directly when `source` is set.
 *
 * The effective "today" value highlights / interpolates the matching scenario
 * column/row in a sensitivity table whose axis references this driver.
 *
 * Returned by `get_stock_guide_drivers()`; numeric `current_value` already
 * coerced to `number | null` by the rpc.ts wrapper.
 */
export interface StockGuideDriver {
  id: number;
  name: string;
  unit: string;
  /**
   * Static "today" value of the driver (e.g. 80 for Brent USD/bbl). Null when
   * unset OR when the driver is DYNAMIC (value comes from `source` instead).
   */
  current_value: number | null;
  /**
   * Binding to a live market metric. `null`/`''` → STATIC (use `current_value`);
   * a catalog key (e.g. `'avg_brent_2026'`) → DYNAMIC (computed live, see
   * `resolveDriverValue` / `useMarketDrivers`).
   */
  source: string | null;
  display_order: number;
}

/**
 * One axis of a sensitivity table's `definition`. The `kind` selects which of
 * the optional shape fields is meaningful:
 *   • `company` → `companies` holds the tickers along this axis.
 *   • `driver`  → `driver_id` references a `StockGuideDriver`; `scenarios` holds
 *     the per-table scenario values along this axis (e.g. [70,80,90]).
 *   • `year`    → `years` holds the forward-year keys (e.g. ["y1","y2"]).
 */
export interface SensitivityAxis {
  kind: "company" | "driver" | "year";
  /** Present when kind === 'driver' — references stock_guide_drivers.id. */
  driver_id?: number;
  /** Present when kind === 'driver' — the scenario values along this axis. */
  scenarios?: number[];
  /** Present when kind === 'company' — tickers along this axis. */
  companies?: string[];
  /** Present when kind === 'year' — forward-year keys/labels along this axis. */
  years?: string[];
}

/**
 * One axis of a SCENARIO-GRID mesh — a catalog driver whose LIVE value drives one
 * slider. A grid has 1..3 of these (the storage order maps to the
 * `x_value` / `y_value` / `z_value` coordinate columns). Pure axis METADATA — it
 * names no company, so it carries no hide-strip.
 */
export interface SensitivityGridAxis {
  /**
   * Registry driver this axis binds to (`stock_guide_drivers.id`). Preferred over
   * `driver_key`: the live value resolves through `resolveDriverValue(driver,
   * marketValues)` — static (`current_value`) or dynamic (live market metric).
   * At least one of `driver_id` / `driver_key` must be set.
   */
  driver_id?: number;
  /**
   * Catalog driver key whose LIVE value is this axis position (e.g.
   * `avg_brent_2026`). LEGACY direct-catalog binding — still honored; resolves
   * from `marketValues[driver_key]`. At least one of `driver_id`/`driver_key` set.
   */
  driver_key?: string;
  /** Axis label for the slider (e.g. "Brent (avg 2026)"). */
  label: string;
  /** Axis unit (e.g. "USD/bbl"). */
  unit: string;
  /** Template range — minimum axis level for the downloadable Excel grid. */
  tmin?: number;
  /** Template range — maximum axis level for the downloadable Excel grid. */
  tmax?: number;
  /** Template range — step between axis levels for the downloadable Excel grid. */
  tstep?: number;
}

/**
 * One configured OUTPUT (metric) of a SCENARIO-GRID table. Each output maps to a
 * distinct `metric` in `stock_guide_scenario_grid` and renders as one column in
 * the panel. `mode` reuses the static-sensitivity value-mode math
 * (`computeSensitivityCellValue`):
 *   • `upside`   — `primary_value` is a target price (BRL/share); the panel shows
 *     the interpolated TP **and** the live upside vs the share price.
 *   • `yield`    — `primary_value` is a BRL-mn flow (FCFE / dividends); shown as
 *     value ÷ live market cap × 100 (%).
 *   • `pe`       — `primary_value` is net income (BRL mn); shown as market cap ÷
 *     value (×).
 *   • `ev_ebitda`— (market cap + net debt) ÷ value (×) — rarely used in a grid.
 *   • `absolute` — raw interpolated value in the output's own units.
 */
export interface SensitivityGridOutput {
  /** The `metric` key in `stock_guide_scenario_grid` (e.g. `target_price`, `fcfe`). */
  key: string;
  /** How the interpolated value is turned into the displayed number. */
  mode: SensitivityTable["value_mode"];
  /** Column label (e.g. "Target price", "FCFE yield"). */
  label: string;
}

/**
 * SCENARIO-GRID block — the optional `definition.grid` that marks a sensitivity
 * table as a multilinear interpolation mesh. The analyst runs the model over the
 * FULL Cartesian product of 1..3 driver levels (e.g. Avg Brent 2026 × 2027 ×
 * 2028+) and uploads, PER COMPANY, the target price at every mesh node. The
 * dashboard reads that mesh (`stock_guide_scenario_grid` →
 * `get_stock_guide_scenario_grid`, 5 columns: x/y/z coords + primary_value) and
 * INTERPOLATES it MULTILINEARLY (2^d corner blend) as the analyst drags one
 * slider PER AXIS — see `buildGridMesh` / `interpolateMesh` in
 * `src/lib/stockGuideSensitivity.ts`.
 *
 * This block is METADATA only (the per-axis driver/label/unit + what the output
 * is) — it names NO company, so it is NOT sensitive and carries no hide-strip.
 * The SENSITIVE per-company points live in the relational
 * `stock_guide_scenario_grid` table, read through the hide-aware
 * `get_stock_guide_scenario_grid` RPC.
 *
 * `axes` is ordered: `axes[0]` → the `x_value` coordinate, `axes[1]` → `y_value`,
 * `axes[2]` → `z_value`. An unused axis means that coordinate column is always 0.
 *
 * The upsert RPC (`admin_upsert_stock_guide_sensitivity_table`) stores this
 * object VERBATIM inside `definition.grid`. Points are NOT typed in the admin —
 * they arrive via the Brent-grid Excel upload (Local Data).
 *
 * REPLACES the 1-D single-axis shape (`x_driver_key`/`x_label`/`x_unit`, removed
 * 2026-06-18) which itself replaced the linear `compose` elastic layer.
 */
export interface SensitivityGridBlock {
  /** 1..3 driver axes, ordered (x, y, z). One live slider per axis. */
  axes: SensitivityGridAxis[];
  /**
   * Configured outputs (metrics) for this table — one column per output. Each
   * maps to a `metric` in `stock_guide_scenario_grid` and is interpolated against
   * the SAME axis coordinates. LEGACY single-output tables (only `output:"…"`)
   * map to a single `upside` Target-price output (see `mapGridBlock`).
   */
  outputs: SensitivityGridOutput[];
}

/**
 * A first-class sensitivity table. `value_mode` tells the browser how to turn a
 * typed cell into a DISPLAY value (most modes are live-derived from the Yahoo
 * price + the company's live market cap):
 *   • `absolute`  — raw typed value in `unit`.
 *   • `yield`     — typed ÷ live market cap × 100 (%).
 *   • `pe`        — live market cap ÷ typed (×).
 *   • `ev_ebitda` — (market cap + net debt) ÷ EBITDA (×). Here the PRIMARY
 *     `cells` carry EBITDA and `cells_secondary` carry the matching net debt.
 *   • `upside`    — typed (target price) ÷ live price − 1 (%, ×100 on format).
 *
 * `companies` is the visible-subset ticker set this table involves (drives the
 * drill-down filter). `cells[rowIndex][colIndex]`.
 *
 * Returned (hide-aware) by `get_stock_guide_sensitivity_tables()`; every numeric
 * cell already coerced to `number | null` by the rpc.ts wrapper.
 */
export interface SensitivityTable {
  id: number;
  title: string;
  value_mode: "absolute" | "yield" | "pe" | "ev_ebitda" | "upside";
  metric_label: string;
  unit: string;
  companies: string[];
  definition: {
    row_axis: SensitivityAxis;
    col_axis: SensitivityAxis;
    /** `cells[rowIndex][colIndex]` — primary typed value. */
    cells: (number | null)[][];
    /** ONLY for value_mode 'ev_ebitda' — the matching net debt per cell. */
    cells_secondary?: (number | null)[][];
    /**
     * Present ONLY for SCENARIO-GRID tables. Its presence marks the table as a
     * multilinear interpolation mesh: the dashboard renders ONE slider PER AXIS
     * (1..3) and a Target price / Upside table that interpolates the uploaded
     * per-company points live (the row/col axes + cells are ignored for a grid
     * table). See `SensitivityGridBlock` + `buildGridMesh` / `interpolateMesh` +
     * `get_stock_guide_scenario_grid`.
     */
    grid?: SensitivityGridBlock;
  };
  display_order: number;
}

/**
 * One point of a scenario-grid mesh — `(ticker, x_value, y_value, z_value,
 * primary_value)` from `get_stock_guide_scenario_grid(p_sensitivity_id)`, ordered
 * by ticker then by the coordinate axes. `x/y/z_value` are the driver levels
 * (one per `definition.grid.axes` entry; an unused axis is always 0);
 * `primary_value` is the target price (BRL/share) at that mesh node. Hide-aware:
 * a non-admin only receives visible tickers. Numerics already coerced to `number`
 * by the rpc.ts wrapper (rows with any non-finite coordinate/value dropped).
 */
export interface ScenarioGridPoint {
  ticker: string;
  /** Which output this point belongs to — matches a `definition.grid.outputs[].key`. */
  metric: string;
  x_value: number;
  y_value: number;
  z_value: number;
  primary_value: number;
}

/**
 * Admin variant of `SensitivityTable` from
 * `admin_get_stock_guide_sensitivity_tables()` — UNFILTERED (full definition
 * including hidden companies) + audit columns. Consumed by the future
 * admin-panel builder pass.
 */
export interface SensitivityTableAdmin extends SensitivityTable {
  updated_at: string | null;
  /** auth.users id of the last editor (uuid string) or null. */
  updated_by: string | null;
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
