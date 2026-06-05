-- ============================================================================
-- Stock Guide — hide-strip the elastic "compose" maps in the sensitivity read RPC
--
-- New capability: "elastic" sensitivity tables that compose valuations live in
-- the browser from analyst-provided slopes. Most of it lives in the frontend +
-- the `definition` jsonb (stored verbatim by the upsert RPC). The presence of
-- `definition.compose` marks a table as elastic.
--
--   definition.compose = {
--     output:      "target_price",                       // string, NOT sensitive
--     driver_keys: ["avg_brent_2026", ...],              // NOT sensitive
--     anchors:     { "avg_brent_2026": 80, ... },        // per-driver, NOT sensitive
--     base:        { "PETR4": 42.0, "PRIO3": 48.0 },     // PER-TICKER — SENSITIVE
--     by_company:  { "PETR4": { "avg_brent_2026": 0.15 } } // PER-TICKER — SENSITIVE
--     scenarios:   { "Base": {...}, "Bull": {...} }       // optional, NOT sensitive
--   }
--
-- SECURITY GAP this migration closes: the existing hide-gating in
-- get_stock_guide_sensitivity_tables() only filters the `company` axis (rewriting
-- the company array + dropping cell rows/cols via _sg_filter_rows/_sg_filter_cols).
-- A compose table is keyed entirely by ticker INSIDE `compose.base` /
-- `compose.by_company` and may have NO company axis at all (so it would hit
-- "Case B" and currently returns `definition` VERBATIM). That would leak hidden
-- companies' per-ticker base valuations + slopes to non-admins.
--
-- This migration adds a helper `_sg_strip_compose(def, visible[])` that, when
-- `def ? 'compose'`, removes every ticker key NOT in the visible set from
-- `compose.base` and `compose.by_company`. `compose.anchors`, `driver_keys`,
-- `scenarios` and `output` do not name companies and pass through intact.
-- It is then applied to the working definition on BOTH the company-axis path
-- (Case A) and the no-company-axis path (Case B), for NON-admins only.
-- Admins still receive everything untouched.
--
-- Pegadinha #18: CREATE OR REPLACE preserves grants/attributes, but we re-assert
-- SECURITY DEFINER + SET search_path = public, pg_temp + the GRANT/REVOKE on
-- every touched function explicitly anyway (defense in depth).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: _sg_strip_compose(def, visible)
--   If def has a 'compose' object, keep only the ticker keys present in
--   `visible` inside compose.base and compose.by_company. Everything else
--   (anchors / driver_keys / scenarios / output, and any non-compose keys of
--   def) is left untouched. If def has no 'compose' object (or it is not a
--   json object), def is returned unchanged.
--
--   SECURITY DEFINER + restricted search_path; NOT granted to anon/authenticated
--   (called only from the SECURITY DEFINER public RPC). Prefixed `_sg_`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sg_strip_compose(
  p_def     jsonb,
  p_visible text[]
) RETURNS jsonb
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_compose jsonb := p_def->'compose';
    v_sub     jsonb;       -- the sub-object being filtered (base / by_company)
    v_new     jsonb;       -- rebuilt sub-object keeping only visible tickers
  BEGIN
    -- No compose block, or malformed → return untouched.
    IF v_compose IS NULL OR jsonb_typeof(v_compose) <> 'object' THEN
      RETURN p_def;
    END IF;

    -- compose.base : { "<ticker>": <num>, ... }
    v_sub := v_compose->'base';
    IF v_sub IS NOT NULL AND jsonb_typeof(v_sub) = 'object' THEN
      SELECT COALESCE(jsonb_object_agg(kv.key, kv.value), '{}'::jsonb)
        INTO v_new
        FROM jsonb_each(v_sub) AS kv
       WHERE kv.key = ANY (p_visible);
      v_compose := jsonb_set(v_compose, '{base}', v_new, true);
    END IF;

    -- compose.by_company : { "<ticker>": { "<driver_key>": <slope>, ... }, ... }
    v_sub := v_compose->'by_company';
    IF v_sub IS NOT NULL AND jsonb_typeof(v_sub) = 'object' THEN
      SELECT COALESCE(jsonb_object_agg(kv.key, kv.value), '{}'::jsonb)
        INTO v_new
        FROM jsonb_each(v_sub) AS kv
       WHERE kv.key = ANY (p_visible);
      v_compose := jsonb_set(v_compose, '{by_company}', v_new, true);
    END IF;

    RETURN jsonb_set(p_def, '{compose}', v_compose, true);
  END;
  $$;

-- ----------------------------------------------------------------------------
-- Recreate get_stock_guide_sensitivity_tables() — identical to the
-- 20260606000000 version EXCEPT non-admins now also get compose.base /
-- compose.by_company stripped of hidden tickers (Case A and Case B both apply
-- _sg_strip_compose to the working definition before RETURN NEXT).
-- ----------------------------------------------------------------------------
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

        -- ELASTIC compose maps: strip hidden tickers from base / by_company.
        -- (no-op if the table has no `compose` block)
        v_def := public._sg_strip_compose(v_def, v_visible);

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

        -- ELASTIC compose maps: a compose table may have NO company axis and be
        -- keyed entirely inside compose.base / compose.by_company. Strip hidden
        -- tickers there too. (no-op if the table has no `compose` block)
        v_def := public._sg_strip_compose(r.definition, v_visible);

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
        definition    := v_def;
        display_order := r.display_order;
        RETURN NEXT;
      END IF;
    END LOOP;

    RETURN;
  END;
  $$;

-- ============================================================================
-- Grants (re-assert; CREATE OR REPLACE preserves them but be explicit — #18)
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.get_stock_guide_sensitivity_tables() TO anon, authenticated;
-- Internal helper: NOT granted to anon/authenticated. Revoke implicit PUBLIC.
REVOKE ALL ON FUNCTION public._sg_strip_compose(jsonb, text[]) FROM PUBLIC;
