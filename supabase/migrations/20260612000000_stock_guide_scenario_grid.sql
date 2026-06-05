-- ============================================================================
-- Stock Guide — scenario-grid table (1-D interpolation mesh) + hide-aware read RPC
--
-- NEW SENSITIVITY APPROACH ("scenario grid"): the analyst produces, in their own
-- model, a dense 1-D mesh of (x_value → output) points PER COMPANY along a single
-- driver axis (e.g. Brent). The frontend INTERPOLATES this mesh live against the
-- current driver level. This SUPERSEDES the linear "compose" elastic layer on the
-- dashboard side (the dash worker removes the `compose` rendering separately).
--
-- A "scenario grid" sensitivity table is a row in `stock_guide_sensitivities`
-- marked by a NON-sensitive `definition.grid` block (axis metadata only):
--   definition.grid = {
--     "x_driver_key": "avg_brent_2026",  // which catalog driver is the live X
--     "x_label":      "Brent (avg 2026)",// axis label
--     "x_unit":       "USD/bbl",         // axis unit
--     "output":       "target_price"     // what primary_value represents (BRL/share)
--   }
-- That block names NO company → it is NOT sensitive and needs NO hide-strip; it is
-- stored verbatim by the existing admin_upsert_stock_guide_sensitivity_table RPC.
--
-- The actual per-company VALUES (the SENSITIVE part) live in a NEW relational
-- table `stock_guide_scenario_grid`, NOT in the jsonb. Reads go through a NEW
-- hide-aware SECURITY DEFINER RPC; writes are service-role only (the upload
-- pipeline bypasses RLS).
--
-- Canonical hide criterion (matches get_stock_guide_comps /
-- get_stock_guide_sensitivity_tables): a ticker is visible to a non-admin iff
-- stock_guide_companies.is_visible; admins (public.is_admin()) see everything.
--
-- NOT touched by this migration (left dormant, per task scope):
--   * the linear `compose` elastic layer + _sg_strip_compose helper — the dash
--     worker decides their cleanup. We do not remove or alter them.
--   * stock_guide_sensitivities / its RPCs — unchanged.
--
-- Pegadinha #18: DROP+CREATE wipes grants/attributes. This migration only uses
-- CREATE TABLE / CREATE OR REPLACE FUNCTION (no DROP), and re-asserts
-- SECURITY DEFINER + SET search_path + GRANT explicitly anyway (defense in depth).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: stock_guide_scenario_grid
--   One row per (sensitivity table, ticker, x level) carrying the analyst's
--   pre-computed output (target price) for that Brent level. The frontend reads
--   the per-ticker series ordered by x_value and interpolates the live level.
--
--   RLS ENABLED, NO policies — same posture as every stock_guide_* table:
--   direct PostgREST returns 0 rows for anon/authenticated; reads flow only
--   through the hide-aware SECURITY DEFINER RPC below. The service role used by
--   the upload pipeline BYPASSES RLS, so it can upsert directly with no policy.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_guide_scenario_grid (
  sensitivity_id  bigint  NOT NULL
                    REFERENCES public.stock_guide_sensitivities(id) ON DELETE CASCADE,
  ticker          text    NOT NULL,
  x_value         numeric NOT NULL,   -- Brent (or other driver) level on the X axis
  primary_value   numeric NOT NULL,   -- output at that level — target price (BRL/share)
  CONSTRAINT stock_guide_scenario_grid_pkey
    PRIMARY KEY (sensitivity_id, ticker, x_value)
);

-- The PK (sensitivity_id, ticker, x_value) already provides an ordered btree
-- index that covers the canonical read pattern: filter by sensitivity_id,
-- then per-ticker series ordered by x_value (the planner uses the PK index for
-- both the sensitivity_id equality and the ticker, x_value ordering). No extra
-- index is needed — a separate (sensitivity_id, ticker, x_value) index would be
-- redundant with the PK.

ALTER TABLE public.stock_guide_scenario_grid ENABLE ROW LEVEL SECURITY;
-- No policies: direct PostgREST returns 0 rows. Reads via SECURITY DEFINER RPC
-- only; writes via service role (bypasses RLS).

-- ============================================================================
-- RPC (public read, hide-aware): get_stock_guide_scenario_grid(p_sensitivity_id)
--   Returns the full mesh for one sensitivity table: (ticker, x_value,
--   primary_value) ordered by ticker, x_value. For a NON-admin caller, only
--   tickers flagged is_visible in stock_guide_companies are returned (a hidden
--   company's per-level target prices NEVER reach a non-admin browser). Admins
--   receive every ticker.
--
--   SECURITY DEFINER + restricted search_path; GRANT EXECUTE to anon,
--   authenticated. The is_visible OR is_admin() filter mirrors exactly the
--   visible-ticker criterion used by get_stock_guide_sensitivity_tables().
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_stock_guide_scenario_grid(
  p_sensitivity_id bigint
)
  RETURNS TABLE (
    ticker        text,
    x_value       numeric,
    primary_value numeric
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT g.ticker, g.x_value, g.primary_value
      FROM public.stock_guide_scenario_grid g
     WHERE g.sensitivity_id = p_sensitivity_id
       AND (
            public.is_admin()
         OR EXISTS (
              SELECT 1
                FROM public.stock_guide_companies c
               WHERE c.ticker = g.ticker
                 AND c.is_visible
            )
       )
     ORDER BY g.ticker, g.x_value;
  $$;

-- ============================================================================
-- Grants
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.get_stock_guide_scenario_grid(bigint) TO anon, authenticated;
