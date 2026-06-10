-- ============================================================================
-- Stock Guide — scenario grid: 1-D → multi-axis (1..3 axes) generalization
--
-- Plan: "Malha multi-eixo de Brent" (redesign of the 2026-06-07 1-D scenario
-- grid). The v1 mesh had a single axis (`x_value`, ambiguous "Brent of which
-- year?"). The new model sensitizes Avg Brent 2026 / 2027 / 2028+ simultaneously
-- with a full Cartesian mesh (1..3 axes; 1-D is the degenerate case).
--
-- This migration is a SINGLE TRANSACTION (apply_migration wraps it) and does, in
-- order:
--   1) ALTER the scenario-grid table: add y_value/z_value coords + swap the PK to
--      5 columns. ALTER (NOT DROP) — preserves RLS posture / ownership / grants.
--   2) DROP + CREATE the read RPC: its RETURNS TABLE shape changes (3 → 5 cols),
--      so CREATE OR REPLACE is impossible. Re-assert SECURITY DEFINER +
--      SET search_path + GRANT anon/authenticated explicitly (pegadinha #18:
--      DROP FUNCTION wipes grants AND attributes).
--   3) Clean up the legacy 1-D placeholder + defensively migrate any other legacy
--      `definition.grid` shape ({x_driver_key,...}) to the new {axes:[...],output}.
--
-- CONVENTION: y_value / z_value default to 0 permanently. "Axis not used = 0".
--   - 1-D table stores (sid, ticker, x, 0, 0)
--   - 2-D table stores (sid, ticker, x, y, 0)
--   - 3-D table stores (sid, ticker, x, y, z)
-- The DEFAULT 0 backfills the 69 existing placeholder rows. The 5-col PK is safe
-- because (sid, ticker, x, 0, 0) inherits uniqueness from the old 3-col PK.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ALTER + PK swap (NOT drop/recreate — preserves RLS / ownership / grants)
-- ----------------------------------------------------------------------------
ALTER TABLE public.stock_guide_scenario_grid
  ADD COLUMN IF NOT EXISTS y_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS z_value numeric NOT NULL DEFAULT 0;

ALTER TABLE public.stock_guide_scenario_grid
  DROP CONSTRAINT stock_guide_scenario_grid_pkey,
  ADD CONSTRAINT stock_guide_scenario_grid_pkey
    PRIMARY KEY (sensitivity_id, ticker, x_value, y_value, z_value);

-- The 5-col PK provides an ordered btree index covering the canonical read
-- pattern (filter by sensitivity_id, then per-ticker series ordered by the
-- coordinate axes). No extra index needed.

-- ----------------------------------------------------------------------------
-- 2) Read RPC — RETURNS TABLE changes (3 → 5 cols), so DROP + CREATE.
--    Hide-aware predicate replicates EXACTLY 20260612000000:
--      public.is_admin() OR EXISTS (... stock_guide_companies c
--        WHERE c.ticker = g.ticker AND c.is_visible)
--    Re-assert SECURITY DEFINER + SET search_path + GRANT (pegadinha #18).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_stock_guide_scenario_grid(bigint);

CREATE FUNCTION public.get_stock_guide_scenario_grid(
  p_sensitivity_id bigint
)
  RETURNS TABLE (
    ticker        text,
    x_value       numeric,
    y_value       numeric,
    z_value       numeric,
    primary_value numeric
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT g.ticker, g.x_value, g.y_value, g.z_value, g.primary_value
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
     ORDER BY g.ticker, g.x_value, g.y_value, g.z_value;
  $$;

GRANT EXECUTE ON FUNCTION public.get_stock_guide_scenario_grid(bigint) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) Cleanup of the 1-D placeholder + defensive data-fix (idempotent/replayable)
--
--   a) DELETE the 1-D example sensitivity (id=16 in prod). FK ON DELETE CASCADE
--      removes its 69 scenario-grid rows automatically. Guarded by both the
--      legacy grid shape AND the explicit "placeholder, safe to delete" title so
--      it never removes a real table.
--   b) UPDATE any OTHER row still carrying the legacy {x_driver_key,...} shape:
--      convert it to the new {axes:[{driver_key,label,unit}], output} shape so
--      no legacy 1-D grid block survives.
-- ----------------------------------------------------------------------------
DELETE FROM public.stock_guide_sensitivities
 WHERE definition->'grid' ? 'x_driver_key'
   AND title LIKE '%placeholder, safe to delete%';

UPDATE public.stock_guide_sensitivities
   SET definition = jsonb_set(
         definition,
         '{grid}',
         jsonb_build_object(
           'axes', jsonb_build_array(
             jsonb_build_object(
               'driver_key', definition->'grid'->>'x_driver_key',
               'label',      COALESCE(definition->'grid'->>'x_label', ''),
               'unit',       COALESCE(definition->'grid'->>'x_unit',  '')
             )
           ),
           'output', COALESCE(definition->'grid'->>'output', 'target_price')
         )
       )
 WHERE definition->'grid' ? 'x_driver_key';
