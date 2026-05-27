// ─── Production (executive monthly summary) ──────────────────────────────────
//
// Shapes returned by the 5 `get_production_*` RPCs. Used by the /production
// dashboard (Fase 2 of the field_stakes & production project — PRD in
// `C:/Users/eduar/.claude/plans/production-fase-2.md`).
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
