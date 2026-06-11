-- 20260625000000_stock_guide_sensitivity_panels.sql
--
-- Pure DML data migration for the /stock-guide sensitivity panel redesign.
--
-- The frontend gains a "consolidated panel" concept driven by two NEW optional
-- keys inside the existing `definition` jsonb of stock_guide_sensitivities:
--   * panel      ("brent" | "margin")  -- which consolidated panel a table belongs to
--   * row_label  (string)              -- the label shown for the table's row in that panel
-- The DB RPCs already pass `definition` through verbatim, so no DDL is needed --
-- this is a pure-data, idempotent, re-runnable migration.
--
-- Contents:
--   1. Tag the 4 existing PETR4 Brent-driven tables (ids 10/12/11/13) with
--      panel='brent' + a row_label, preserving everything else in definition.
--   2. Seed 6 NEW static EBITDA-margin drivers (Vibra/Ultrapar, unit BRL/m3).
--   3. Clean up the junk driver id 4 ('EBITDA Margin 2027', BRL/bbl) iff unreferenced.

-- ---------------------------------------------------------------------------
-- 1. Tag the 4 existing Brent-panel sensitivity tables.
--    jsonb || jsonb concat is naturally idempotent (re-running just re-sets the
--    same two keys). Each UPDATE is guarded by a case-insensitive title check so
--    a wrong-id environment is left untouched (no-op) instead of mis-tagged.
-- ---------------------------------------------------------------------------

UPDATE public.stock_guide_sensitivities
SET definition = definition || jsonb_build_object('panel', 'brent', 'row_label', 'FCFE yield 2026')
WHERE id = 10
  AND title ILIKE 'FCFE yield%2026%';

UPDATE public.stock_guide_sensitivities
SET definition = definition || jsonb_build_object('panel', 'brent', 'row_label', 'Dividend yield 2026')
WHERE id = 12
  AND title ILIKE 'Dividend%Yield%2026%';

UPDATE public.stock_guide_sensitivities
SET definition = definition || jsonb_build_object('panel', 'brent', 'row_label', 'FCFE yield 2027')
WHERE id = 11
  AND title ILIKE 'FCFE yield%2027%';

UPDATE public.stock_guide_sensitivities
SET definition = definition || jsonb_build_object('panel', 'brent', 'row_label', 'Dividend yield 2027')
WHERE id = 13
  AND title ILIKE 'Dividend%Yield%2027%';

-- ---------------------------------------------------------------------------
-- 2. Seed 6 NEW static EBITDA-margin drivers for the future "margin" panel.
--    INSERT ... WHERE NOT EXISTS by exact name => idempotent.
--    current_value and source stay NULL (static, value to be typed by an admin).
--    Columns: name (NOT NULL), unit (NOT NULL), current_value (NULL),
--             source (NULL), display_order. updated_at defaults to now().
-- ---------------------------------------------------------------------------

INSERT INTO public.stock_guide_drivers (name, unit, current_value, source, display_order)
SELECT v.name, v.unit, NULL::numeric, NULL::text, v.display_order
FROM (VALUES
    ('Vibra EBITDA margin 2Q26',    'BRL/m³', 10),
    ('Vibra EBITDA margin 2026E',   'BRL/m³', 11),
    ('Vibra EBITDA margin 2027E',   'BRL/m³', 12),
    ('Ultrapar EBITDA margin 2Q26', 'BRL/m³', 13),
    ('Ultrapar EBITDA margin 2026E','BRL/m³', 14),
    ('Ultrapar EBITDA margin 2027E','BRL/m³', 15)
) AS v(name, unit, display_order)
WHERE NOT EXISTS (
    SELECT 1 FROM public.stock_guide_drivers d WHERE d.name = v.name
);

-- ---------------------------------------------------------------------------
-- 3. Clean up the junk driver id 4 ('EBITDA Margin 2027', unit 'BRL/bbl').
--    Only delete if it is NOT referenced by any sensitivity table:
--      - row_axis.driver_id / col_axis.driver_id
--      - any grid axis driver_id (definition -> grid -> axes[].driver_id)
--    If referenced, the DELETE matches nothing and is a safe no-op (the
--    NOT EXISTS guards below make this self-protecting and re-runnable).
-- ---------------------------------------------------------------------------

DELETE FROM public.stock_guide_drivers d
WHERE d.id = 4
  AND d.name = 'EBITDA Margin 2027'
  AND d.unit = 'BRL/bbl'
  AND NOT EXISTS (
        SELECT 1 FROM public.stock_guide_sensitivities s
        WHERE (s.definition #>> '{row_axis,driver_id}') = '4'
           OR (s.definition #>> '{col_axis,driver_id}') = '4'
  )
  AND NOT EXISTS (
        SELECT 1
        FROM public.stock_guide_sensitivities s,
             jsonb_array_elements(COALESCE(s.definition #> '{grid,axes}', '[]'::jsonb)) ax
        WHERE (ax ->> 'driver_id') = '4'
  );
