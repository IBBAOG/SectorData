-- ============================================================================
-- Stock Guide — redesigned sensitivity model
--   * stock_guide_drivers       : central registry of macro/assumption variables
--                                 (Brent, FX, etc.) — NOT company-sensitive.
--   * stock_guide_sensitivities : first-class, cross-company sensitivity tables
--                                 with live-derived value modes + jsonb axes/cells.
--
-- Builds ALONGSIDE the existing (now DORMANT) 1:1 stock_guide_sensitivity table
-- and its RPCs (get_stock_guide_sensitivity, admin_get_stock_guide_sensitivity,
-- admin_upsert_stock_guide_sensitivity). Those are LEFT UNTOUCHED so the
-- currently-deployed frontend keeps working until it migrates; a later cleanup
-- migration drops them.
--
-- is_admin() helper already exists:
--   EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND role='Admin')
-- Precedent style: supabase/migrations/20260603200000_stock_guide.sql
--                  supabase/migrations/20260603400000_stock_guide_net_debt_per_year.sql
--
-- All new RPCs are SECURITY DEFINER SET search_path = public, pg_temp.
-- Admin RPCs guard with: IF NOT public.is_admin() THEN RAISE 42501.
-- ============================================================================

-- ============================================================================
-- Table 1: stock_guide_drivers (central registry of macro assumption variables)
--   Macro assumptions (Brent average, USD/BRL, etc.) — NOT company-sensitive,
--   so no hide concern. RLS ENABLED, NO policies; reads flow through the public
--   SECURITY DEFINER RPC get_stock_guide_drivers().
-- ============================================================================
CREATE TABLE public.stock_guide_drivers (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           text NOT NULL,                 -- e.g. 'Brent average 2026E'
  unit           text NOT NULL DEFAULT '',      -- e.g. 'USD/bbl'
  current_value  numeric,                       -- e.g. 80
  display_order  int NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES auth.users(id)
);

ALTER TABLE public.stock_guide_drivers ENABLE ROW LEVEL SECURITY;
-- No policies: direct PostgREST returns 0 rows. Access via SECURITY DEFINER RPC only.

CREATE INDEX stock_guide_drivers_order_idx
  ON public.stock_guide_drivers (display_order, id);

-- ============================================================================
-- Table 2: stock_guide_sensitivities (first-class, cross-company sensitivity tables)
--
--   value_mode drives how the browser interprets/derives each cell:
--     'absolute'  — raw typed value in `unit` (e.g. FCFE in BRL mn)
--     'yield'     — typed value ÷ live market cap (FCFE yield, div yield)
--     'pe'        — live market cap ÷ typed value (P/E)
--     'ev_ebitda' — EV(year) ÷ typed value; EV = mkt cap + net debt. For this
--                   mode the PRIMARY `cells` carry EBITDA and the SECONDARY
--                   `cells_secondary` carry the matching net debt.
--     'upside'    — typed value vs live price (target/price − 1)
--
--   `companies` = the set of tickers this table involves. It drives both the
--   drill-down filter AND the hide gating in get_stock_guide_sensitivity_tables().
--
--   `definition` jsonb shape (per-table, self-describing axes + cell matrix):
--   {
--     "row_axis": { "kind":"company"|"driver"|"year",
--                   "driver_id": <bigint, if driver>,
--                   "scenarios": [60,70,80,90],    // per-table values, if driver
--                   "companies": ["PETR4","PRIO3"],// if company
--                   "years":     ["y1","y2"] },     // if year
--     "col_axis": { ... same shape ... },
--     "cells":           [[num,...],...],  // [rowIndex][colIndex] primary typed value
--     "cells_secondary": [[num,...],...]   // ONLY for value_mode='ev_ebitda' (net debt)
--   }
--
--   RLS ENABLED, NO policies — all reads via the hide-aware SECURITY DEFINER RPC
--   get_stock_guide_sensitivity_tables() (non-admins get restricted companies'
--   axis entries + their cell rows/cols surgically stripped from the jsonb).
-- ============================================================================
CREATE TABLE public.stock_guide_sensitivities (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title          text NOT NULL,
  value_mode     text NOT NULL DEFAULT 'absolute'
                   CHECK (value_mode IN ('absolute','yield','pe','ev_ebitda','upside')),
  metric_label   text NOT NULL DEFAULT '',      -- e.g. 'FCFE'
  unit           text NOT NULL DEFAULT '',      -- e.g. 'BRL mn'
  companies      text[] NOT NULL DEFAULT '{}',  -- tickers involved (filter + hide gating)
  definition     jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order  int NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES auth.users(id),
  CONSTRAINT stock_guide_sensitivities_definition_is_object
    CHECK (jsonb_typeof(definition) = 'object')
);

ALTER TABLE public.stock_guide_sensitivities ENABLE ROW LEVEL SECURITY;
-- No policies.

CREATE INDEX stock_guide_sensitivities_order_idx
  ON public.stock_guide_sensitivities (display_order, id);

-- ============================================================================
-- RPCs — all SECURITY DEFINER SET search_path = public, pg_temp
-- ============================================================================

------------------------------------------------------------
-- RPC 1 (public read): get_stock_guide_drivers
--   Macro assumptions — not sensitive, so returned in full to everyone.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_stock_guide_drivers()
  RETURNS TABLE (
    id             bigint,
    name           text,
    unit           text,
    current_value  numeric,
    display_order  int
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT d.id, d.name, d.unit, d.current_value, d.display_order
      FROM public.stock_guide_drivers d
     ORDER BY d.display_order, d.id;
  $$;

------------------------------------------------------------
-- RPC 2 (public read, hide-aware): get_stock_guide_sensitivity_tables
--   Returns the visible sensitivity tables. For NON-admins, every restricted
--   company is surgically removed from each table:
--     * if a company axis exists (row or col): the hidden tickers' axis entries
--       are dropped AND the matching rows/cols are dropped from `cells`
--       (and `cells_secondary` if present); if 0 companies survive, the table
--       is skipped entirely.
--     * if NO company axis exists (single-company table keyed by companies[1]):
--       the table is skipped entirely if that company is not visible.
--   Admins get everything unfiltered.
--
--   A restricted company's typed cell values must NEVER reach a non-admin.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_stock_guide_sensitivity_tables()
  RETURNS TABLE (
    id            bigint,
    title         text,
    value_mode    text,
    metric_label  text,
    unit          text,
    companies     text[],
    definition    jsonb,
    display_order int
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_admin    boolean := public.is_admin();
    v_visible  text[];                  -- visible ticker set
    r          record;                  -- each sensitivity row
    v_def      jsonb;                   -- working definition
    v_row_axis jsonb;
    v_col_axis jsonb;
    v_row_kind text;
    v_col_kind text;
    v_keep_idx int[];                   -- surviving indices along the company axis
    v_axis_cos jsonb;                   -- company array on the axis (jsonb)
    v_new_cos  jsonb;                   -- rebuilt visible company array (jsonb)
    v_present  text[];                  -- visible companies actually present in this table
    i          int;
    v_co       text;
  BEGIN
    -- Visible-ticker set: everything is visible to an admin; otherwise only
    -- companies flagged is_visible.
    SELECT array_agg(c.ticker)
      INTO v_visible
      FROM public.stock_guide_companies c
     WHERE c.is_visible OR v_admin;
    v_visible := COALESCE(v_visible, ARRAY[]::text[]);

    FOR r IN
      SELECT s.id, s.title, s.value_mode, s.metric_label, s.unit,
             s.companies, s.definition, s.display_order
        FROM public.stock_guide_sensitivities s
       ORDER BY s.display_order, s.id
    LOOP
      -- ---- Admin: emit untouched -------------------------------------------
      IF v_admin THEN
        id            := r.id;
        title         := r.title;
        value_mode    := r.value_mode;
        metric_label  := r.metric_label;
        unit          := r.unit;
        companies     := r.companies;
        definition    := r.definition;
        display_order := r.display_order;
        RETURN NEXT;
        CONTINUE;
      END IF;

      v_def      := r.definition;
      v_row_axis := v_def->'row_axis';
      v_col_axis := v_def->'col_axis';
      v_row_kind := v_row_axis->>'kind';
      v_col_kind := v_col_axis->>'kind';

      -- ---- Case A: a COMPANY axis exists -----------------------------------
      IF v_row_kind = 'company' OR v_col_kind = 'company' THEN
        -- locate the company array on whichever axis is the company axis
        IF v_row_kind = 'company' THEN
          v_axis_cos := v_row_axis->'companies';
        ELSE
          v_axis_cos := v_col_axis->'companies';
        END IF;

        IF v_axis_cos IS NULL OR jsonb_typeof(v_axis_cos) <> 'array' THEN
          -- malformed axis — fail safe by skipping the table for non-admins
          CONTINUE;
        END IF;

        -- compute surviving indices (0-based) + rebuilt company array
        v_keep_idx := ARRAY[]::int[];
        v_new_cos  := '[]'::jsonb;
        v_present  := ARRAY[]::text[];
        FOR i IN 0 .. jsonb_array_length(v_axis_cos) - 1 LOOP
          v_co := v_axis_cos->>i;
          IF v_co = ANY (v_visible) THEN
            v_keep_idx := v_keep_idx || i;
            v_new_cos  := v_new_cos || to_jsonb(v_co);
            v_present  := v_present || v_co;
          END IF;
        END LOOP;

        -- nothing survives → skip whole table
        IF array_length(v_keep_idx, 1) IS NULL THEN
          CONTINUE;
        END IF;

        -- rebuild definition: write the filtered company array back onto its axis
        IF v_row_kind = 'company' THEN
          v_row_axis := jsonb_set(v_row_axis, '{companies}', v_new_cos, true);
          v_def      := jsonb_set(v_def, '{row_axis}', v_row_axis, true);
          -- company axis is the ROW axis → drop those rows from the matrices
          v_def := public._sg_filter_rows(v_def, 'cells', v_keep_idx);
          IF v_def ? 'cells_secondary' THEN
            v_def := public._sg_filter_rows(v_def, 'cells_secondary', v_keep_idx);
          END IF;
        ELSE
          v_col_axis := jsonb_set(v_col_axis, '{companies}', v_new_cos, true);
          v_def      := jsonb_set(v_def, '{col_axis}', v_col_axis, true);
          -- company axis is the COL axis → drop those columns from the matrices
          v_def := public._sg_filter_cols(v_def, 'cells', v_keep_idx);
          IF v_def ? 'cells_secondary' THEN
            v_def := public._sg_filter_cols(v_def, 'cells_secondary', v_keep_idx);
          END IF;
        END IF;

        id            := r.id;
        title         := r.title;
        value_mode    := r.value_mode;
        metric_label  := r.metric_label;
        unit          := r.unit;
        companies     := v_present;        -- only the visible subset present
        definition    := v_def;
        display_order := r.display_order;
        RETURN NEXT;

      -- ---- Case B: NO company axis (single-company table) -------------------
      ELSE
        -- the table's company is companies[1]; skip entirely if not visible
        IF r.companies IS NULL
           OR array_length(r.companies, 1) IS NULL
           OR NOT (r.companies[1] = ANY (v_visible)) THEN
          CONTINUE;
        END IF;

        id            := r.id;
        title         := r.title;
        value_mode    := r.value_mode;
        metric_label  := r.metric_label;
        unit          := r.unit;
        -- recompute companies to the visible subset actually present
        SELECT COALESCE(array_agg(co), ARRAY[]::text[])
          INTO v_present
          FROM unnest(r.companies) AS co
         WHERE co = ANY (v_visible);
        companies     := v_present;
        definition    := r.definition;
        display_order := r.display_order;
        RETURN NEXT;
      END IF;
    END LOOP;

    RETURN;
  END;
  $$;

------------------------------------------------------------
-- RPC 3 (admin read): admin_get_stock_guide_sensitivity_tables
--   ALL rows UNFILTERED (full definition incl. hidden companies) for the builder.
--   Same columns as the public RPC + updated_at, updated_by.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_stock_guide_sensitivity_tables()
  RETURNS TABLE (
    id            bigint,
    title         text,
    value_mode    text,
    metric_label  text,
    unit          text,
    companies     text[],
    definition    jsonb,
    display_order int,
    updated_at    timestamptz,
    updated_by    uuid
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
      SELECT s.id, s.title, s.value_mode, s.metric_label, s.unit,
             s.companies, s.definition, s.display_order, s.updated_at, s.updated_by
        FROM public.stock_guide_sensitivities s
       ORDER BY s.display_order, s.id;
  END;
  $$;

------------------------------------------------------------
-- RPC 4 (admin write): admin_upsert_stock_guide_driver
--   p_id NULL → INSERT, else UPDATE that id. Returns the id.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_stock_guide_driver(
  p_id   bigint,
  p_data jsonb
) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_uid   uuid := auth.uid();
    v_id    bigint;
    v_name  text := NULLIF(trim(p_data->>'name'), '');
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF v_name IS NULL THEN
      RAISE EXCEPTION 'name_required' USING ERRCODE = '22023';
    END IF;

    IF p_id IS NULL THEN
      INSERT INTO public.stock_guide_drivers
        (name, unit, current_value, display_order, updated_by, updated_at)
      VALUES (
        v_name,
        COALESCE(p_data->>'unit', ''),
        (p_data->>'current_value')::numeric,
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

------------------------------------------------------------
-- RPC 5 (admin write): admin_delete_stock_guide_driver
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_stock_guide_driver(p_id bigint)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.stock_guide_drivers WHERE id = p_id;
  END;
  $$;

------------------------------------------------------------
-- RPC 6 (admin write): admin_upsert_stock_guide_sensitivity_table
--   p_data keys: title, value_mode, metric_label, unit, companies (json array
--   → text[]), definition (jsonb), display_order.
--   p_id NULL → INSERT, else UPDATE that id. Returns the id.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_stock_guide_sensitivity_table(
  p_id   bigint,
  p_data jsonb
) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_uid        uuid := auth.uid();
    v_id         bigint;
    v_title      text := NULLIF(trim(p_data->>'title'), '');
    v_value_mode text := COALESCE(NULLIF(p_data->>'value_mode', ''), 'absolute');
    v_companies  text[];
    v_definition jsonb;
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF v_title IS NULL THEN
      RAISE EXCEPTION 'title_required' USING ERRCODE = '22023';
    END IF;

    IF v_value_mode NOT IN ('absolute','yield','pe','ev_ebitda','upside') THEN
      RAISE EXCEPTION 'invalid_value_mode: %', v_value_mode USING ERRCODE = '22023';
    END IF;

    -- companies: accept a json array → text[] (default empty)
    IF p_data ? 'companies' AND jsonb_typeof(p_data->'companies') = 'array' THEN
      SELECT COALESCE(array_agg(elem), ARRAY[]::text[])
        INTO v_companies
        FROM jsonb_array_elements_text(p_data->'companies') AS elem;
    ELSE
      v_companies := ARRAY[]::text[];
    END IF;

    -- definition: must be a json object (default {})
    v_definition := COALESCE(p_data->'definition', '{}'::jsonb);
    IF jsonb_typeof(v_definition) <> 'object' THEN
      RAISE EXCEPTION 'definition_must_be_object' USING ERRCODE = '22023';
    END IF;

    IF p_id IS NULL THEN
      INSERT INTO public.stock_guide_sensitivities
        (title, value_mode, metric_label, unit, companies, definition,
         display_order, updated_by, updated_at)
      VALUES (
        v_title,
        v_value_mode,
        COALESCE(p_data->>'metric_label', ''),
        COALESCE(p_data->>'unit', ''),
        v_companies,
        v_definition,
        COALESCE((p_data->>'display_order')::int, 0),
        v_uid,
        now()
      )
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.stock_guide_sensitivities
         SET title         = v_title,
             value_mode    = v_value_mode,
             metric_label  = COALESCE(p_data->>'metric_label', ''),
             unit          = COALESCE(p_data->>'unit', ''),
             companies     = v_companies,
             definition    = v_definition,
             display_order = COALESCE((p_data->>'display_order')::int, 0),
             updated_by    = v_uid,
             updated_at    = now()
       WHERE id = p_id
      RETURNING id INTO v_id;

      IF v_id IS NULL THEN
        RAISE EXCEPTION 'sensitivity_table_not_found: %', p_id USING ERRCODE = '22023';
      END IF;
    END IF;

    RETURN v_id;
  END;
  $$;

------------------------------------------------------------
-- RPC 7 (admin write): admin_delete_stock_guide_sensitivity_table
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_stock_guide_sensitivity_table(p_id bigint)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.stock_guide_sensitivities WHERE id = p_id;
  END;
  $$;

-- ============================================================================
-- Internal helpers — jsonb cell-matrix surgery (drop rows / cols by index).
--   SECURITY DEFINER + restricted search_path; NOT granted to anon/authenticated
--   (only called from get_stock_guide_sensitivity_tables). Prefixed `_sg_`.
-- ============================================================================

------------------------------------------------------------
-- _sg_filter_rows(def, key, keep_idx)
--   Keep only the rows of def->key whose 0-based index is in keep_idx, in order.
--   If def->key is absent / not an array, def is returned untouched.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sg_filter_rows(
  p_def     jsonb,
  p_key     text,
  p_keep    int[]
) RETURNS jsonb
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_matrix jsonb := p_def->p_key;
    v_out    jsonb := '[]'::jsonb;
    i        int;
  BEGIN
    IF v_matrix IS NULL OR jsonb_typeof(v_matrix) <> 'array' THEN
      RETURN p_def;
    END IF;

    FOREACH i IN ARRAY p_keep LOOP
      IF i >= 0 AND i < jsonb_array_length(v_matrix) THEN
        v_out := v_out || jsonb_build_array(v_matrix->i);
      END IF;
    END LOOP;

    RETURN jsonb_set(p_def, ARRAY[p_key], v_out, true);
  END;
  $$;

------------------------------------------------------------
-- _sg_filter_cols(def, key, keep_idx)
--   For each row of def->key (a matrix), keep only the columns whose 0-based
--   index is in keep_idx, in order. Non-array rows are passed through.
--   If def->key is absent / not an array, def is returned untouched.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sg_filter_cols(
  p_def     jsonb,
  p_key     text,
  p_keep    int[]
) RETURNS jsonb
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_matrix jsonb := p_def->p_key;
    v_out    jsonb := '[]'::jsonb;
    v_row    jsonb;
    v_newrow jsonb;
    i        int;
  BEGIN
    IF v_matrix IS NULL OR jsonb_typeof(v_matrix) <> 'array' THEN
      RETURN p_def;
    END IF;

    FOR v_row IN SELECT * FROM jsonb_array_elements(v_matrix) LOOP
      IF jsonb_typeof(v_row) <> 'array' THEN
        v_out := v_out || jsonb_build_array(v_row);
        CONTINUE;
      END IF;
      v_newrow := '[]'::jsonb;
      FOREACH i IN ARRAY p_keep LOOP
        IF i >= 0 AND i < jsonb_array_length(v_row) THEN
          v_newrow := v_newrow || jsonb_build_array(v_row->i);
        END IF;
      END LOOP;
      v_out := v_out || jsonb_build_array(v_newrow);
    END LOOP;

    RETURN jsonb_set(p_def, ARRAY[p_key], v_out, true);
  END;
  $$;

-- ============================================================================
-- Grants
-- ============================================================================
-- Public reads → anon, authenticated
GRANT EXECUTE ON FUNCTION public.get_stock_guide_drivers()                        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_guide_sensitivity_tables()             TO anon, authenticated;
-- Admin reads (is_admin guard inside) → authenticated
GRANT EXECUTE ON FUNCTION public.admin_get_stock_guide_sensitivity_tables()       TO authenticated;
-- Admin writes (is_admin guard inside) → authenticated
GRANT EXECUTE ON FUNCTION public.admin_upsert_stock_guide_driver(bigint, jsonb)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_stock_guide_driver(bigint)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_stock_guide_sensitivity_table(bigint, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_stock_guide_sensitivity_table(bigint)        TO authenticated;
-- Internal helpers: NOT granted to anon/authenticated (called only from the
-- SECURITY DEFINER public RPC). Revoke the implicit PUBLIC grant defensively.
REVOKE ALL ON FUNCTION public._sg_filter_rows(jsonb, text, int[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sg_filter_cols(jsonb, text, int[]) FROM PUBLIC;
