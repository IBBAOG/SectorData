-- 20260629000000_stock_guide_margin_scenario_grid.sql
-- DML-only, idempotent. Registers a NEW scenario-grid sensitivity table for /stock-guide:
-- an EBITDA-margin interpolation mesh for the two fuel distributors (UGPA3, VBBR3),
-- and tags the existing Brent grid (id 18) with definition.panel = 'brent'.
--
-- No schema/DDL changes, no RPC changes:
--   * get_stock_guide_sensitivity_tables returns `definition` verbatim (already covers the new row)
--   * get_stock_guide_scenario_grid is sensitivity_id-scoped (already covers the new row)
-- Mesh points (stock_guide_scenario_grid) start EMPTY — the analyst uploads them later via the
-- Admin Panel. Do NOT seed mesh points here.
--
-- stock_guide_drivers.id and stock_guide_sensitivities.id are GENERATED ALWAYS AS IDENTITY
-- => never supply id; let it auto-generate. Driver_ids in the jsonb are resolved by NAME via
-- scalar subqueries, never hardcoded serials.

-- 1) Three NEW SHARED static margin drivers (one slider applies to BOTH companies).
--    Deliberately distinct from the per-company drivers ids 6-11.
--    Idempotent: skip if a driver with the same name already exists.
INSERT INTO public.stock_guide_drivers (name, unit, current_value, source)
SELECT v.name, v.unit, NULL::numeric, NULL::text
FROM (VALUES
  ('EBITDA margin 2Q26',  'BRL/m³'),
  ('EBITDA margin 2H26',  'BRL/m³'),
  ('EBITDA margin 2027+', 'BRL/m³')
) AS v(name, unit)
WHERE NOT EXISTS (
  SELECT 1 FROM public.stock_guide_drivers d WHERE d.name = v.name
);

-- 2) ONE new scenario-grid sensitivity table mirroring id 18's shape exactly.
--    Idempotent: skip if a row with the same title already exists.
--    The 3 axis driver_ids are resolved live by name (subqueries), never hardcoded.
INSERT INTO public.stock_guide_sensitivities (title, value_mode, companies, display_order, definition)
SELECT
  'Target Price - EBITDA Margin Sensitivity',
  'absolute',
  ARRAY['UGPA3','VBBR3']::text[],
  100,
  jsonb_build_object(
    'panel', 'margin',
    'grid', jsonb_build_object(
      'axes', jsonb_build_array(
        jsonb_build_object(
          'driver_id', (SELECT id FROM public.stock_guide_drivers WHERE name = 'EBITDA margin 2Q26'),
          'label',     'EBITDA margin 2Q26',
          'unit',      'BRL/m³',
          'tmin',      50,
          'tmax',      250,
          'tstep',     10
        ),
        jsonb_build_object(
          'driver_id', (SELECT id FROM public.stock_guide_drivers WHERE name = 'EBITDA margin 2H26'),
          'label',     'EBITDA margin 2H26',
          'unit',      'BRL/m³',
          'tmin',      50,
          'tmax',      250,
          'tstep',     10
        ),
        jsonb_build_object(
          'driver_id', (SELECT id FROM public.stock_guide_drivers WHERE name = 'EBITDA margin 2027+'),
          'label',     'EBITDA margin 2027+',
          'unit',      'BRL/m³',
          'tmin',      50,
          'tmax',      250,
          'tstep',     10
        )
      ),
      -- 7 outputs copied VERBATIM from id 18 (same keys / base / mode / year / labels).
      'outputs', jsonb_build_array(
        jsonb_build_object('key','target_price','base','target_price','mode','upside','label','Target price'),
        jsonb_build_object('key','fcfe_2026','base','fcfe','mode','yield','year','2026','label','FCFE yield 2026'),
        jsonb_build_object('key','fcfe_2027','base','fcfe','mode','yield','year','2027','label','FCFE yield 2027'),
        jsonb_build_object('key','dividends_2026','base','dividends','mode','yield','year','2026','label','Div yield 2026'),
        jsonb_build_object('key','dividends_2027','base','dividends','mode','yield','year','2027','label','Div yield 2027'),
        jsonb_build_object('key','net_income_2026','base','net_income','mode','pe','year','2026','label','P/E 2026'),
        jsonb_build_object('key','net_income_2027','base','net_income','mode','pe','year','2027','label','P/E 2027')
      )
    ),
    'col_axis', jsonb_build_object('kind','year','years', jsonb_build_array('y1')),
    'row_axis', jsonb_build_object('kind','company','companies', jsonb_build_array('UGPA3','VBBR3'))
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.stock_guide_sensitivities s
  WHERE s.title = 'Target Price - EBITDA Margin Sensitivity'
);

-- 3) Tag the existing Brent scenario-grid table with panel = 'brent' (idempotent).
UPDATE public.stock_guide_sensitivities
SET definition = definition || '{"panel":"brent"}'::jsonb
WHERE title = 'Target Price - Brent Sensitivity'
  AND definition ? 'grid'
  AND NOT (definition ? 'panel');
