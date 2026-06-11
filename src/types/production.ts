// ─── Production (executive monthly summary) ──────────────────────────────────
//
// Shapes returned by the 5 `get_production_*` RPCs. Used by the /well-by-well
// dashboard (Fase 2 of the field_stakes & production project — PRD in
// `C:/Users/eduar/.claude/plans/production-fase-2.md`; route renamed from
// /production in Round 4, 2026-05-28). The file is named `production.ts`
// because it backs the `get_production_*` RPC family (DB-level naming
// preserved); the URL route is `/well-by-well`.
//
// The RPCs all do the heavy work server-side: join `anp_cdp_producao` with
// `field_stakes` (filtered to campos whose stakes SUM to 100), apply
// stake-weighting, and aggregate by ambiente (PreSal / PosSal / Terra) or
// installation. The browser never re-derives company production — it only
// renders.
//
// Source of truth: migration `supabase/migrations/20260528000000_production_rpcs.sql`
// (owned by worker_supabase, Frente A of Fase 2).
//
// Convention:
//   • All bbl/day and Mm³/day metrics are returned in raw base units; the
//     hook converts to kbpd / kboed at display time via `bblDiaToKbpd`.
//   • `ambiente` is one of 'PreSal' | 'PosSal' | 'Terra' (carried verbatim
//     from `anp_cdp_producao.local`).
//   • `hours_rate` is dimensionless (0..1), uptime fraction during the
//     calendar month — multiply by 100 for "%".

/**
 * One row per (year, month, ambiente) — Brazil-wide totals (no stake weighting).
 * Returned by `get_production_brazil_aggregate`.
 */
export interface ProductionBrazilRow {
  ano: number;
  mes: number;
  ambiente: string;          // 'PreSal' | 'PosSal' | 'Terra'
  oil_bbl_dia: number;
  gas_mm3_dia: number;
  water_bbl_dia: number;
  hours_rate: number;        // 0..1 average uptime fraction across wells in the month
}

/**
 * One row per (year, month, ambiente) — stake-weighted totals for one company.
 * Returned by `get_production_company_aggregate`.
 */
export interface ProductionCompanyRow {
  ano: number;
  mes: number;
  ambiente: string;
  oil_bbl_dia: number;       // SUM(petroleo * stake/100)
  gas_mm3_dia: number;       // SUM(gas_total * stake/100)
  water_bbl_dia: number;     // SUM(agua * stake/100)
}

/**
 * One row per field — top-N producing fields for one company in one calendar
 * month. Returned by `get_production_top_fields`.
 */
export interface ProductionTopField {
  campo: string;
  oil_bbl_dia: number;       // stake-weighted oil for the company in that month
  water_bbl_dia: number;     // stake-weighted water (for "oil+water" stacked bar)
  hours_rate: number;        // 0..1 uptime fraction
  stake_pct: number;         // company's stake in the field (0..100)
}

/**
 * One row per installation (FPSO / UEP / land plant) — production routed
 * through the installation in one calendar month, stake-weighted for the
 * selected company. Returned by `get_production_by_installation`.
 */
export interface ProductionInstallation {
  instalacao: string;
  oil_bbl_dia: number;
  gas_mm3_dia: number;
  hours_rate: number;        // 0..1
}

/**
 * One row per scope (TOTAL + per-ambiente breakdown) — YoY/MoM/YTD comparison
 * for the selected company at a reference month. Returned by
 * `get_production_yoy_table`.
 *
 * `scope` is 'TOTAL' for the company aggregate, or the ambiente name
 * ('PreSal' / 'PosSal' / 'Terra') for the per-ambiente rows.
 */
export interface ProductionYoYRow {
  scope: string;                       // 'TOTAL' | ambiente name
  current_kbpd: number;                // already in kbpd (server-side / 1000)
  prev_month_kbpd: number | null;
  prev_year_kbpd: number | null;
  ytd_avg_kbpd: number | null;
  mom_pct: number | null;              // (current - prev_month) / prev_month
  yoy_pct: number | null;              // (current - prev_year) / prev_year
}

/**
 * One row per (year, month) for one campo × empresa — stake-weighted monthly
 * timeseries used by the Field drill-down (Round 2, 2026-05-27). Returned by
 * `get_production_field_timeseries`.
 *
 * All bbl/day and Mm³/day metrics are returned in raw base units; the UI
 * converts oil/water to kbpd at display time. `hours_rate` is the uptime
 * fraction (0..1) for that field-month.
 */
export interface ProductionFieldTimeseriesRow {
  ano: number;
  mes: number;
  oil_bbl_dia: number;
  gas_mm3_dia: number;
  water_bbl_dia: number;
  hours_rate: number;
}

/**
 * One row per (year, month) for one installation × empresa — stake-weighted
 * monthly timeseries used by the Installation (FPSO/UEP) drill-down (Round 3,
 * 2026-05-27). Returned by `get_production_installation_timeseries`.
 *
 * The RPC returns the SAME row shape as `get_production_field_timeseries`
 * (`(ano, mes, oil_bbl_dia, gas_mm3_dia, water_bbl_dia, hours_rate)`), so this
 * is intentionally a type alias rather than a structural duplicate — keeps the
 * two drills wire-compatible while preserving the semantic distinction at the
 * call site (`ProductionFieldTimeseriesRow` for the field drill,
 * `ProductionInstallationTimeseriesRow` for the FPSO drill).
 *
 * Source-of-truth migration:
 *   `supabase/migrations/20260528200000_production_installation_timeseries.sql`
 *   (owned by worker_supabase, Round 3 of Fase 2).
 */
export type ProductionInstallationTimeseriesRow = ProductionFieldTimeseriesRow;

/**
 * One row of the PDF-style Well-by-Well header table (Round 8, 2026-05-27).
 *
 * Returned by `get_well_by_well_header(p_empresa text, p_year int, p_month int)`
 * — server-side aggregation that replicates page 2 of the monthly PDF report:
 *   - "Brazil" section: oil (kbpd) & gas (kboed) totals split by environment
 *     (Pre-Salt / Post-Salt / Onshore) plus category totals.
 *   - "{Empresa}" section: stake-weighted oil (kbpd) by environment + main
 *     producing fields list, all aligned to the same reference (year, month).
 *
 * Row semantics:
 *   - `display_order` is the canonical PDF row order — render rows sorted ASC
 *     by this column.
 *   - `section` distinguishes the two top-level groups ('BRAZIL' or the
 *     upper-cased empresa name). Section-header rows have NULL category and
 *     subcategory (rendered as a wide dark-navy banner).
 *   - `category` is one of 'Oil (kbpd)' | 'Gas (kboed)' | 'Main fields (kbpd)'.
 *     Category-header rows carry the category name with NULL subcategory and
 *     are styled with a light-gray band (no indent, bold).
 *   - `subcategory` is the ambiente bucket ('Pre-Salt' / 'Post-Salt' /
 *     'Onshore' / 'Total') or a field name. Indented sub-rows.
 *   - `is_total` flags totals/grand-totals for bold rendering.
 *   - Numeric cells: `current_val` / `prev_month_val` / `prev_year_val` /
 *     `ytd_avg` are already in the row's native unit (kbpd or kboed) — the UI
 *     does not re-convert. `mom_pct` / `yoy_pct` are already in percent units
 *     (server computed as `(current/prev - 1) * 100`), e.g. `2.4` means +2.4%
 *     — do NOT multiply by 100 again. The UI rounds to integer percent.
 *
 * Source-of-truth migration (slot 20260528500000):
 *   `supabase/migrations/20260528500000_well_by_well_header.sql`
 *   (owned by worker_supabase, Round 8 of Fase 2).
 */
export interface WellByWellHeaderRow {
  display_order: number;
  section: string;                       // 'BRAZIL' or upper-cased empresa name
  category: string;                      // 'Oil (kbpd)' | 'Gas (kboed)' | 'Main fields (kbpd)'
  subcategory: string | null;            // NULL = category-total row; else ambiente or campo name
  is_total: boolean;                     // bold styling cue
  current_val: number | null;
  prev_month_val: number | null;
  mom_pct: number | null;                // percent units (already × 100 server-side); 2.4 = +2.4%
  prev_year_val: number | null;
  yoy_pct: number | null;                // percent units (already × 100 server-side); 2.4 = +2.4%
  ytd_avg: number | null;
}

/**
 * Single-row completeness probe for the latest month in `anp_cdp_producao`.
 * Returned by `get_production_month_status()` (zero-arg, SECURITY DEFINER;
 * migration `supabase/migrations/20260628000000_production_month_status.sql`).
 *
 * The ANP publishes the monthly CDP incrementally, so the most recent month is
 * frequently still partial (e.g. May 2026 shows ~1,447 producing wells vs
 * ~6,460 in April 2026 while ANP is still loading fields). `/well-by-well`
 * keeps the partial month visible (charts + default reference month) and only
 * flags it with a "Partial data" banner.
 *
 * Heuristic mirrors `scripts/cdp_roster_canary.py`: a month is "complete" when
 * its producing-well count (petroleo_bbl_dia > 0) is >= 70% of the previous
 * month's count; `prev_producing_wells = 0` counts as complete (fail open).
 *
 * Field semantics (raw wire shape):
 *   - `latest_ano` / `latest_mes`             — the most recent (ano, mes) in the base table.
 *   - `latest_producing_wells`                — wells with petroleo_bbl_dia > 0 in the latest month.
 *   - `prev_producing_wells`                  — same count for the immediately-preceding month.
 *   - `completeness_ratio`                    — latest / prev, rounded to 4 dp; NULL when prev = 0.
 *   - `is_complete`                           — ratio >= 0.70, or prev = 0 (fail open).
 *   - `last_complete_ano` / `last_complete_mes` — most recent complete month (canary walk-back).
 *
 * The RPC returns ZERO rows when the table is empty — callers treat that (and
 * any error) as "assume complete, no banner" (fail open). See
 * `rpcGetProductionMonthStatus` in `src/lib/rpc.ts`.
 */
export interface ProductionMonthStatus {
  latest_ano: number;
  latest_mes: number;
  latest_producing_wells: number;
  prev_producing_wells: number;
  completeness_ratio: number | null;     // NULL when prev month has 0 producing wells
  is_complete: boolean;                  // ratio >= 0.70, or prev = 0 (fail open)
  last_complete_ano: number;
  last_complete_mes: number;
}
