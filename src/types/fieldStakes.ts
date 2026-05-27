// ─── Field Stakes (working-interest per oil field) ───────────────────────────
//
// Shapes returned by the `field_stakes` admin RPCs. Used by /admin-panel
// "Field Stakes" section (CRUD) and by the /well-by-well dashboard (route
// renamed from /production in Round 4, 2026-05-28) which joins
// `anp_cdp_producao` × `field_stakes` to derive company-attributable oil
// production.
//
// Source of truth: `field_stakes` table — see
// `supabase/migrations/20260527600000_field_stakes.sql` (owner:
// worker_supabase). Sum per `campo` must equal 100 (enforced by the
// admin_upsert_field_stakes RPC).

/** One row per oil field in the overview list. */
export interface FieldStakeOverview {
  campo: string;
  /**
   * Canonical (family) name for grouping in the admin UI. Several variants of
   * the same physical field (e.g. `Búzios`, `AnC_Búzios`, `Búzios_ECO`) share
   * the same `canonical` so they collapse under a single header in the left
   * pane. The editor on the right still operates on ONE variant at a time
   * because stakes legitimately differ between contract types.
   *
   * Derived server-side by `public.canonical_field_name(p_variant text)` —
   * see Round 4 migration `20260528300000_well_by_well_round4.sql` (Frente A).
   */
  canonical: string;
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
