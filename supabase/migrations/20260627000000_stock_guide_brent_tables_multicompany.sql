-- Stock Guide — Brent sensitivity panels iteration 2 (multi-company layout)
-- Pure DML, idempotent. Transforms the 4 brent-tagged static tables (ids 10, 11, 12, 13)
-- in public.stock_guide_sensitivities into a one-row-per-company shape so each
-- per-driver table renders Petrobras / PRIO / PetroReconcavo / Brava as rows,
-- with scenarios 50..150 (step 10, 11 columns).
--
-- New shape per table:
--   row_axis.companies        -> ['PETR4','PRIO3','RECV3','BRAV3']
--   col_axis.scenarios        -> [50,60,70,80,90,100,110,120,130,140,150]
--   cells (4 rows x 11 cols)  -> row 0 = existing PETR4 row (definition->'cells'->0)
--                                padded with null at index 0 (50) and index 10 (150);
--                                rows 1-3 (PRIO3, RECV3, BRAV3) = all nulls (admin fills later)
--   companies (text[] column) -> {PETR4,PRIO3,RECV3,BRAV3}
--   row_label                 -> 'FCFE Yield' (ids 10,11) / 'Dividend Yield' (ids 12,13)
--
-- The per-driver table title now conveys the year, so the year is dropped from row_label.
-- panel tags, titles, value_mode, display_order are untouched. Table id 18 is untouched.

BEGIN;

-- 1-3 + 5: cells / scenarios / row_axis.companies / companies column.
-- Idempotency guard: only old-shape tables (9-column scenarios) are transformed.
-- After this runs scenarios length is 11, so re-execution is a no-op.
UPDATE public.stock_guide_sensitivities AS s
SET
  companies = ARRAY['PETR4','PRIO3','RECV3','BRAV3']::text[],
  definition = jsonb_set(
    jsonb_set(
      jsonb_set(
        s.definition,
        '{row_axis,companies}',
        '["PETR4","PRIO3","RECV3","BRAV3"]'::jsonb,
        true
      ),
      '{col_axis,scenarios}',
      '[50,60,70,80,90,100,110,120,130,140,150]'::jsonb,
      true
    ),
    '{cells}',
    jsonb_build_array(
      -- row 0 (PETR4): existing 9 values padded with null on each side -> 11 cols
      ('[null]'::jsonb || COALESCE(s.definition->'cells'->0, '[]'::jsonb) || '[null]'::jsonb),
      -- rows 1-3 (PRIO3, RECV3, BRAV3): full-null 11-col rows
      '[null,null,null,null,null,null,null,null,null,null,null]'::jsonb,
      '[null,null,null,null,null,null,null,null,null,null,null]'::jsonb,
      '[null,null,null,null,null,null,null,null,null,null,null]'::jsonb
    ),
    true
  )
WHERE s.id IN (10, 11, 12, 13)
  AND jsonb_array_length(s.definition->'col_axis'->'scenarios') = 9
  AND s.definition->'row_axis'->'kind' = '"company"'::jsonb;

-- 4: row_label overwrite (plain idempotent — drops the year, conveyed by the title now).
UPDATE public.stock_guide_sensitivities
SET definition = jsonb_set(definition, '{row_label}', '"FCFE Yield"'::jsonb, true)
WHERE id IN (10, 11);

UPDATE public.stock_guide_sensitivities
SET definition = jsonb_set(definition, '{row_label}', '"Dividend Yield"'::jsonb, true)
WHERE id IN (12, 13);

COMMIT;
