-- ============================================================================
-- Stock Guide — drivers can bind to a market-data SOURCE (dynamic current value)
--
-- A driver in stock_guide_drivers is now one of:
--   * STATIC  — source IS NULL; admin types `current_value` by hand.
--   * DYNAMIC — source holds a catalog metric key (e.g. 'avg_brent_2026',
--               'avg_brent_2027', 'avg_fx_2026', 'avg_fx_2027'); the frontend
--               computes the value live from market data. `current_value` may
--               carry a last-known snapshot or stay NULL — NOT relied upon.
--
-- No CHECK constraint on `source` on purpose: the catalog of metric keys stays
-- open/extensible in frontend code (do not couple the DB to it).
--
-- Builds on supabase/migrations/20260606000000_stock_guide_sensitivity_model.sql.
-- is_admin() helper already exists.
-- All public/admin RPCs stay SECURITY DEFINER SET search_path = public, pg_temp.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ALTER TABLE: add the `source` column (NULL = static driver)
-- ----------------------------------------------------------------------------
ALTER TABLE public.stock_guide_drivers
  ADD COLUMN source text;

-- ----------------------------------------------------------------------------
-- 2) get_stock_guide_drivers() — DROP + CREATE (RETURNS TABLE signature changes:
--    `source` inserted after `current_value`).
--    DROP+CREATE drops grants → re-GRANT EXECUTE below.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_stock_guide_drivers();

CREATE FUNCTION public.get_stock_guide_drivers()
  RETURNS TABLE (
    id             bigint,
    name           text,
    unit           text,
    current_value  numeric,
    source         text,
    display_order  int
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT d.id, d.name, d.unit, d.current_value, d.source, d.display_order
      FROM public.stock_guide_drivers d
     ORDER BY d.display_order, d.id;
  $$;

GRANT EXECUTE ON FUNCTION public.get_stock_guide_drivers() TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) admin_upsert_stock_guide_driver(p_id, p_data) — CREATE OR REPLACE.
--    Additionally reads `source` from p_data:
--      source = NULLIF(p_data->>'source','')   (empty string → NULL = static)
--    Written on both INSERT and UPDATE. Everything else unchanged.
--    Return type (bigint) unchanged → CREATE OR REPLACE keeps grants/attrs.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_stock_guide_driver(
  p_id   bigint,
  p_data jsonb
) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_uid    uuid := auth.uid();
    v_id     bigint;
    v_name   text := NULLIF(trim(p_data->>'name'), '');
    v_source text := NULLIF(p_data->>'source', '');   -- empty → NULL = static
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF v_name IS NULL THEN
      RAISE EXCEPTION 'name_required' USING ERRCODE = '22023';
    END IF;

    IF p_id IS NULL THEN
      INSERT INTO public.stock_guide_drivers
        (name, unit, current_value, source, display_order, updated_by, updated_at)
      VALUES (
        v_name,
        COALESCE(p_data->>'unit', ''),
        (p_data->>'current_value')::numeric,
        v_source,
        COALESCE((p_data->>'display_order')::int, 0),
        v_uid,
        now()
      )
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.stock_guide_drivers
         SET name          = v_name,
             unit          = COALESCE(p_data->>'unit', ''),
             current_value = (p_data->>'current_value')::numeric,
             source        = v_source,
             display_order = COALESCE((p_data->>'display_order')::int, 0),
             updated_by    = v_uid,
             updated_at    = now()
       WHERE id = p_id
      RETURNING id INTO v_id;

      IF v_id IS NULL THEN
        RAISE EXCEPTION 'driver_not_found: %', p_id USING ERRCODE = '22023';
      END IF;
    END IF;

    RETURN v_id;
  END;
  $$;
