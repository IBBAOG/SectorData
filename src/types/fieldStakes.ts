// ─── Field Stakes (working-interest per oil field) ───────────────────────────
//
// Shapes returned by the `field_stakes` admin RPCs. Used by /admin-panel
// "Field Stakes" section (CRUD) and, in Fase 2 (separate PRD), by the future
// /production dashboard which joins `anp_cdp_producao` × `field_stakes` to
// derive company-attributable oil production.
//
// Source of truth: `field_stakes` table — see
// `supabase/migrations/20260527500000_field_stakes.sql` (owner:
// worker_supabase). Sum per `campo` must equal 100 (enforced by the
// admin_upsert_field_stakes RPC).

/** One row per oil field in the overview list. */
export interface FieldStakeOverview {
  campo: string;
  n_empresas: number;
  /** Sum of stake_pct across all companies registered for this field. 0 if none. */
  soma_pct: number;
  /** Convenience flag: `Math.abs(soma_pct - 100) < 0.001`. */
  is_complete: boolean;
  /** True if `anp_cdp_producao` has at least one row matching this field. */
  has_data_in_producao: boolean;
  last_updated: string | null;
}

/** One row per company registered as a stakeholder of a given field. */
export interface FieldStake {
  empresa: string;
  stake_pct: number;
  updated_at: string;
}

/** Distinct company list across all fields — used as autocomplete pool. */
export interface FieldStakeEmpresa {
  empresa: string;
  n_campos: number;
}

/** Payload row for `admin_upsert_field_stakes` (replace-all per campo). */
export interface FieldStakeInput {
  empresa: string;
  stake_pct: number;
}
