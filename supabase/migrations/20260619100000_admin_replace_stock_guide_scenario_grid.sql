-- Admin browser-upload path for the /stock-guide multi-axis Brent scenario mesh.
--
-- Background: stock_guide_scenario_grid (RLS ENABLED, NO policies) only accepted
-- writes via the service role (scripts/manual/stock_guide_brent_grid_upload.py).
-- This migration adds an admin-only browser write path so Admins can replace a
-- sensitivity table's mesh straight from the Admin Panel, mirroring the Python
-- LONG-format Cartesian-complete replace-total snapshot per sensitivity_id.
--
-- Pattern copied from the existing admin_* RPCs (admin_upsert_stock_guide_sensitivity_table,
-- 20260606000000): SECURITY DEFINER + SET search_path = public, pg_temp, guard with
-- `IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'`,
-- GRANT EXECUTE TO authenticated (the internal is_admin() guard rejects non-admins).
-- We additionally REVOKE ALL FROM PUBLIC for defense in depth.

-- ============================================================================
-- RPC 1 (admin write): admin_replace_stock_guide_scenario_grid
--
-- Replace-total, CHUNKED upload of a sensitivity's whole scenario mesh.
--
--   p_sensitivity_id : the sensitivity table whose grid is being replaced.
--   p_rows           : a jsonb ARRAY of rows. Each element uses SHORT keys to
--                      keep the payload small:
--                        { "ticker": text,
--                          "metric": text,
--                          "x":      numeric,
--                          "y":      numeric,
--                          "z":      numeric,
--                          "v":      numeric }   -- v = primary_value (target price etc.)
--   p_first_chunk    : TRUE on the first chunk of a replace operation — it DELETEs
--                      every existing row of p_sensitivity_id before inserting
--                      (this is where "replace-total" begins). FALSE on every
--                      subsequent chunk (append only).
--
-- The client uploads in batches (~2000 rows/call): the first call passes
-- p_first_chunk=true, the rest false.
--
-- NON-ATOMIC across chunks (by design): each chunk is its own transaction, so a
-- failure mid-upload can leave a partial mesh. This is accepted because the client
-- validates the full Cartesian payload BEFORE uploading, and any retry simply
-- re-runs the whole replace (first_chunk=true wipes again). The ON CONFLICT
-- DO UPDATE on the 6-col PK makes a re-sent chunk idempotent.
--
-- Returns: number of rows inserted/updated in THIS chunk.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_replace_stock_guide_scenario_grid(
  p_sensitivity_id bigint,
  p_rows           jsonb,
  p_first_chunk    boolean
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  DECLARE
    v_count   integer := 0;
    v_elem    jsonb;
    v_ticker  text;
    v_metric  text;
    v_x       numeric;
    v_y       numeric;
    v_z       numeric;
    v_v       numeric;
  BEGIN
    -- Guard (same error contract as the other admin_* RPCs).
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- Sensitivity must exist (FK would catch it on INSERT, but fail fast & clearly).
    IF NOT EXISTS (
      SELECT 1 FROM public.stock_guide_sensitivities WHERE id = p_sensitivity_id
    ) THEN
      RAISE EXCEPTION 'sensitivity_not_found: %', p_sensitivity_id USING ERRCODE = '22023';
    END IF;

    -- Payload must be a JSON array.
    IF jsonb_typeof(p_rows) <> 'array' THEN
      RAISE EXCEPTION 'rows_must_be_array' USING ERRCODE = '22023';
    END IF;

    -- First chunk starts the replace-total: wipe the existing mesh.
    IF p_first_chunk THEN
      DELETE FROM public.stock_guide_scenario_grid
       WHERE sensitivity_id = p_sensitivity_id;
    END IF;

    -- Insert each element with explicit coercion + validation.
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
      v_ticker := NULLIF(trim(v_elem->>'ticker'), '');
      v_metric := NULLIF(trim(v_elem->>'metric'), '');

      IF v_ticker IS NULL THEN
        RAISE EXCEPTION 'ticker_required in row %', v_elem USING ERRCODE = '22023';
      END IF;
      IF v_metric IS NULL THEN
        RAISE EXCEPTION 'metric_required in row %', v_elem USING ERRCODE = '22023';
      END IF;

      -- Numeric casts. ->> returns text; cast to numeric. A missing key yields
      -- NULL (caught below). NaN must be rejected explicitly: 'NaN'::numeric is a
      -- VALID numeric value in PG, AND (unlike IEEE floats) PG defines NaN = NaN as
      -- TRUE so it can be indexed — therefore a `num = num` test does NOT catch NaN.
      -- We compare against 'NaN'::numeric directly.
      v_x := (v_elem->>'x')::numeric;
      v_y := (v_elem->>'y')::numeric;
      v_z := (v_elem->>'z')::numeric;
      v_v := (v_elem->>'v')::numeric;

      IF v_x IS NULL OR v_y IS NULL OR v_z IS NULL OR v_v IS NULL THEN
        RAISE EXCEPTION 'numeric_field_required (x,y,z,v) in row %', v_elem USING ERRCODE = '22023';
      END IF;

      -- Reject NaN on each numeric (PG: NaN = NaN is TRUE, so test equality to NaN).
      IF v_x = 'NaN'::numeric OR v_y = 'NaN'::numeric
         OR v_z = 'NaN'::numeric OR v_v = 'NaN'::numeric THEN
        RAISE EXCEPTION 'nan_not_allowed in row %', v_elem USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.stock_guide_scenario_grid
        (sensitivity_id, ticker, metric, x_value, y_value, z_value, primary_value)
      VALUES
        (p_sensitivity_id, v_ticker, v_metric, v_x, v_y, v_z, v_v)
      ON CONFLICT (sensitivity_id, ticker, metric, x_value, y_value, z_value)
      DO UPDATE SET primary_value = EXCLUDED.primary_value;

      v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
  END;
$$;

-- ============================================================================
-- RPC 2 (admin read): admin_count_stock_guide_scenario_grid
--   Post-upload confirmation: total rows + per-metric breakdown for a sensitivity.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_count_stock_guide_scenario_grid(
  p_sensitivity_id bigint
) RETURNS TABLE(total bigint, by_metric jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH counts AS (
      SELECT g.metric, count(*) AS n
        FROM public.stock_guide_scenario_grid g
       WHERE g.sensitivity_id = p_sensitivity_id
       GROUP BY g.metric
    )
    SELECT
      COALESCE(sum(c.n), 0)::bigint AS total,
      COALESCE(
        jsonb_object_agg(c.metric, c.n) FILTER (WHERE c.metric IS NOT NULL),
        '{}'::jsonb
      ) AS by_metric
    FROM counts c;
  END;
$$;

-- ============================================================================
-- Grants: authenticated only (internal is_admin() guard rejects non-admins).
-- Defense in depth: revoke the implicit PUBLIC grant first.
-- ============================================================================
REVOKE ALL ON FUNCTION public.admin_replace_stock_guide_scenario_grid(bigint, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_count_stock_guide_scenario_grid(bigint)                    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_replace_stock_guide_scenario_grid(bigint, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_count_stock_guide_scenario_grid(bigint)                    TO authenticated;
