-- ============================================================================
-- Stock Guide — admin-curated equities-research module
--   * stock_guide_companies : wide registry + comps + live-calc inputs + visibility
--   * stock_guide_sensitivity: 1:1 freeform sensitivity grid (jsonb)
--   * stock_guide_config     : singleton (year labels + assumptions note)
--
-- RLS is ENABLED on all three tables but NO policies are created (deliberately
-- stricter than field_stakes). Direct PostgREST therefore returns 0 rows — all
-- access flows through the SECURITY DEFINER RPCs below so hidden financials
-- (and the yahoo_symbol that would let the browser fetch a price) never leak.
--
-- is_admin() helper already exists:
--   EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND role='Admin')
-- Precedent: supabase/migrations/20260527600000_field_stakes.sql
-- ============================================================================

------------------------------------------------------------
-- Table 1: stock_guide_companies (wide)
------------------------------------------------------------
CREATE TABLE public.stock_guide_companies (
  ticker              text PRIMARY KEY,                       -- e.g. 'PETR4' (no .SA)
  company_name        text NOT NULL,
  yahoo_symbol        text NOT NULL,                          -- usually = ticker; decouples display from quote symbol
  sector              text NOT NULL DEFAULT 'oil_gas'
                        CHECK (sector IN ('oil_gas','fuel_distribution')),
  volume_unit         text NOT NULL DEFAULT 'kbpd'
                        CHECK (volume_unit IN ('kbpd','thousand_m3')),
  shares_outstanding  numeric,                                -- admin input — ABSOLUTE share count; market cap = shares × live price
  last_update         date,
  target_price        numeric,
  recommendation      text CHECK (recommendation IN ('OP','MP','UP') OR recommendation IS NULL),
  -- forward-estimate pairs (Y1 / Y2)
  ev_ebitda_y1        numeric,
  ev_ebitda_y2        numeric,
  pe_y1               numeric,
  pe_y2               numeric,
  fcfe_yield_y1       numeric,                                -- percent points, e.g. 12.5
  fcfe_yield_y2       numeric,
  div_yield_y1        numeric,                                -- percent points, e.g. 12.5
  div_yield_y2        numeric,
  ebitda_y1           numeric,                                -- BRL mn
  ebitda_y2           numeric,
  volumes_y1          numeric,                                -- in unit per volume_unit
  volumes_y2          numeric,
  is_visible          boolean NOT NULL DEFAULT true,
  display_order       int NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES auth.users(id)
);

ALTER TABLE public.stock_guide_companies ENABLE ROW LEVEL SECURITY;
-- No policies: direct PostgREST returns 0 rows. Access via SECURITY DEFINER RPCs only.

CREATE INDEX stock_guide_companies_order_idx
  ON public.stock_guide_companies (display_order, ticker);

------------------------------------------------------------
-- Table 2: stock_guide_sensitivity (1:1 freeform grid)
------------------------------------------------------------
CREATE TABLE public.stock_guide_sensitivity (
  ticker      text PRIMARY KEY REFERENCES public.stock_guide_companies(ticker) ON DELETE CASCADE,
  grid        jsonb NOT NULL DEFAULT '{}'::jsonb,             -- { row_axis_title, col_axis_title, value_label, row_labels[], col_labels[], cells[][] }
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id),
  CONSTRAINT grid_is_object CHECK (jsonb_typeof(grid) = 'object')
);

ALTER TABLE public.stock_guide_sensitivity ENABLE ROW LEVEL SECURITY;
-- No policies.

------------------------------------------------------------
-- Table 3: stock_guide_config (singleton)
------------------------------------------------------------
CREATE TABLE public.stock_guide_config (
  id                int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  y1_label          text NOT NULL DEFAULT '2026E',
  y2_label          text NOT NULL DEFAULT '2027E',
  assumptions_note  text NOT NULL DEFAULT '',
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES auth.users(id)
);

ALTER TABLE public.stock_guide_config ENABLE ROW LEVEL SECURITY;
-- No policies.

INSERT INTO public.stock_guide_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================================
-- RPCs — all SECURITY DEFINER SET search_path = public, pg_temp
-- ============================================================================

------------------------------------------------------------
-- RPC 1 (public read, hide-aware core): get_stock_guide_comps
--   One row per company ordered by display_order, ticker.
--   Always returns ticker, company_name, is_visible, display_order.
--   Every other column is CASE WHEN (is_visible OR is_admin) THEN col ELSE NULL.
--   → non-admin gets a hidden company's NAME (for the restricted footnote) but
--     NULL financials AND NULL yahoo_symbol (browser can't fetch its price).
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_stock_guide_comps()
  RETURNS TABLE (
    ticker              text,
    company_name        text,
    is_visible          boolean,
    display_order       int,
    sector              text,
    volume_unit         text,
    yahoo_symbol        text,
    shares_outstanding  numeric,
    last_update         date,
    target_price        numeric,
    recommendation      text,
    ev_ebitda_y1        numeric,
    ev_ebitda_y2        numeric,
    pe_y1               numeric,
    pe_y2               numeric,
    fcfe_yield_y1       numeric,
    fcfe_yield_y2       numeric,
    div_yield_y1        numeric,
    div_yield_y2        numeric,
    ebitda_y1           numeric,
    ebitda_y2           numeric,
    volumes_y1          numeric,
    volumes_y2          numeric
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT
      c.ticker,
      c.company_name,
      c.is_visible,
      c.display_order,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.sector             ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.volume_unit        ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.yahoo_symbol       ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.shares_outstanding ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.last_update        ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.target_price       ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.recommendation     ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.ev_ebitda_y1       ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.ev_ebitda_y2       ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.pe_y1              ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.pe_y2              ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.fcfe_yield_y1      ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.fcfe_yield_y2      ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.div_yield_y1       ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.div_yield_y2       ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.ebitda_y1          ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.ebitda_y2          ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.volumes_y1         ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.volumes_y2         ELSE NULL END
    FROM public.stock_guide_companies c
    ORDER BY c.display_order, c.ticker;
  $$;

------------------------------------------------------------
-- RPC 2 (public read): get_stock_guide_sensitivity
--   Returns the grid for p_ticker only if the company is_visible OR caller is admin.
--   Otherwise returns '{}'::jsonb.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_stock_guide_sensitivity(p_ticker text)
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT COALESCE(
      (
        SELECT s.grid
          FROM public.stock_guide_sensitivity s
          JOIN public.stock_guide_companies c ON c.ticker = s.ticker
         WHERE s.ticker = p_ticker
           AND (c.is_visible OR public.is_admin())
      ),
      '{}'::jsonb
    );
  $$;

------------------------------------------------------------
-- RPC 3 (public read): get_stock_guide_config (singleton)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_stock_guide_config()
  RETURNS TABLE (
    y1_label          text,
    y2_label          text,
    assumptions_note  text
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT y1_label, y2_label, assumptions_note
      FROM public.stock_guide_config
     WHERE id = 1;
  $$;

------------------------------------------------------------
-- RPC 4 (admin read): admin_get_stock_guide_companies
--   Full unfiltered rows (incl. hidden, incl. shares_outstanding) for the editor.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_stock_guide_companies()
  RETURNS TABLE (
    ticker              text,
    company_name        text,
    yahoo_symbol        text,
    sector              text,
    volume_unit         text,
    shares_outstanding  numeric,
    last_update         date,
    target_price        numeric,
    recommendation      text,
    ev_ebitda_y1        numeric,
    ev_ebitda_y2        numeric,
    pe_y1               numeric,
    pe_y2               numeric,
    fcfe_yield_y1       numeric,
    fcfe_yield_y2       numeric,
    div_yield_y1        numeric,
    div_yield_y2        numeric,
    ebitda_y1           numeric,
    ebitda_y2           numeric,
    volumes_y1          numeric,
    volumes_y2          numeric,
    is_visible          boolean,
    display_order       int,
    updated_at          timestamptz,
    updated_by          uuid
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
      SELECT
        c.ticker, c.company_name, c.yahoo_symbol, c.sector, c.volume_unit,
        c.shares_outstanding, c.last_update, c.target_price, c.recommendation,
        c.ev_ebitda_y1, c.ev_ebitda_y2, c.pe_y1, c.pe_y2,
        c.fcfe_yield_y1, c.fcfe_yield_y2, c.div_yield_y1, c.div_yield_y2,
        c.ebitda_y1, c.ebitda_y2, c.volumes_y1, c.volumes_y2,
        c.is_visible, c.display_order, c.updated_at, c.updated_by
      FROM public.stock_guide_companies c
      ORDER BY c.display_order, c.ticker;
  END;
  $$;

------------------------------------------------------------
-- RPC 5 (admin read): admin_get_stock_guide_sensitivity
--   Raw grid, no visibility gate, is_admin guard.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_stock_guide_sensitivity(p_ticker text)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_grid jsonb;
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    SELECT grid INTO v_grid
      FROM public.stock_guide_sensitivity
     WHERE ticker = p_ticker;

    RETURN COALESCE(v_grid, '{}'::jsonb);
  END;
  $$;

------------------------------------------------------------
-- RPC 6 (admin write): admin_upsert_stock_guide_company
--   INSERT ... ON CONFLICT (ticker) DO UPDATE. is_visible is NOT taken from
--   p_data (separate RPC) — preserved on update, defaults true on insert.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_stock_guide_company(
  p_ticker text,
  p_data   jsonb
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_uid          uuid := auth.uid();
    v_company_name text := NULLIF(trim(p_data->>'company_name'), '');
    v_yahoo_symbol text := NULLIF(trim(p_data->>'yahoo_symbol'), '');
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF p_ticker IS NULL OR length(trim(p_ticker)) = 0 THEN
      RAISE EXCEPTION 'ticker_required' USING ERRCODE = '22023';
    END IF;

    IF v_company_name IS NULL THEN
      RAISE EXCEPTION 'company_name_required' USING ERRCODE = '22023';
    END IF;

    IF v_yahoo_symbol IS NULL THEN
      RAISE EXCEPTION 'yahoo_symbol_required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.stock_guide_companies (
      ticker, company_name, yahoo_symbol, sector, volume_unit,
      shares_outstanding, last_update, target_price, recommendation,
      ev_ebitda_y1, ev_ebitda_y2, pe_y1, pe_y2,
      fcfe_yield_y1, fcfe_yield_y2, div_yield_y1, div_yield_y2,
      ebitda_y1, ebitda_y2, volumes_y1, volumes_y2,
      is_visible, display_order, updated_by, updated_at
    ) VALUES (
      trim(p_ticker),
      v_company_name,
      v_yahoo_symbol,
      COALESCE(NULLIF(p_data->>'sector', ''), 'oil_gas'),
      COALESCE(NULLIF(p_data->>'volume_unit', ''), 'kbpd'),
      (p_data->>'shares_outstanding')::numeric,
      (p_data->>'last_update')::date,
      (p_data->>'target_price')::numeric,
      NULLIF(p_data->>'recommendation', ''),
      (p_data->>'ev_ebitda_y1')::numeric,
      (p_data->>'ev_ebitda_y2')::numeric,
      (p_data->>'pe_y1')::numeric,
      (p_data->>'pe_y2')::numeric,
      (p_data->>'fcfe_yield_y1')::numeric,
      (p_data->>'fcfe_yield_y2')::numeric,
      (p_data->>'div_yield_y1')::numeric,
      (p_data->>'div_yield_y2')::numeric,
      (p_data->>'ebitda_y1')::numeric,
      (p_data->>'ebitda_y2')::numeric,
      (p_data->>'volumes_y1')::numeric,
      (p_data->>'volumes_y2')::numeric,
      true,                                                   -- is_visible default on insert
      COALESCE((p_data->>'display_order')::int, 0),
      v_uid,
      now()
    )
    ON CONFLICT (ticker) DO UPDATE SET
      company_name       = EXCLUDED.company_name,
      yahoo_symbol       = EXCLUDED.yahoo_symbol,
      sector             = EXCLUDED.sector,
      volume_unit        = EXCLUDED.volume_unit,
      shares_outstanding = EXCLUDED.shares_outstanding,
      last_update        = EXCLUDED.last_update,
      target_price       = EXCLUDED.target_price,
      recommendation     = EXCLUDED.recommendation,
      ev_ebitda_y1       = EXCLUDED.ev_ebitda_y1,
      ev_ebitda_y2       = EXCLUDED.ev_ebitda_y2,
      pe_y1              = EXCLUDED.pe_y1,
      pe_y2              = EXCLUDED.pe_y2,
      fcfe_yield_y1      = EXCLUDED.fcfe_yield_y1,
      fcfe_yield_y2      = EXCLUDED.fcfe_yield_y2,
      div_yield_y1       = EXCLUDED.div_yield_y1,
      div_yield_y2       = EXCLUDED.div_yield_y2,
      ebitda_y1          = EXCLUDED.ebitda_y1,
      ebitda_y2          = EXCLUDED.ebitda_y2,
      volumes_y1         = EXCLUDED.volumes_y1,
      volumes_y2         = EXCLUDED.volumes_y2,
      -- is_visible deliberately NOT updated here (preserve existing)
      display_order      = EXCLUDED.display_order,
      updated_by         = EXCLUDED.updated_by,
      updated_at         = EXCLUDED.updated_at;
  END;
  $$;

------------------------------------------------------------
-- RPC 7 (admin write): admin_upsert_stock_guide_sensitivity
--   Validates company exists + grid dims (cells matches row_labels/col_labels).
--   Empty grid '{}' is allowed. INSERT ... ON CONFLICT (ticker) DO UPDATE.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_stock_guide_sensitivity(
  p_ticker text,
  p_grid   jsonb
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_uid       uuid := auth.uid();
    v_n_rows    int;
    v_n_cols    int;
    v_row       jsonb;
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.stock_guide_companies WHERE ticker = p_ticker) THEN
      RAISE EXCEPTION 'company_not_found: %', p_ticker USING ERRCODE = '22023';
    END IF;

    IF p_grid IS NULL OR jsonb_typeof(p_grid) <> 'object' THEN
      RAISE EXCEPTION 'grid_must_be_object' USING ERRCODE = '22023';
    END IF;

    -- Dimension validation only when the grid actually carries cells.
    IF p_grid ? 'cells' AND jsonb_typeof(p_grid->'cells') = 'array' THEN
      v_n_rows := jsonb_array_length(p_grid->'cells');

      IF v_n_rows <> COALESCE(jsonb_array_length(p_grid->'row_labels'), -1) THEN
        RAISE EXCEPTION 'grid_dims_mismatch: cells rows (%) <> row_labels (%)',
          v_n_rows, COALESCE(jsonb_array_length(p_grid->'row_labels'), -1)
          USING ERRCODE = '22023';
      END IF;

      v_n_cols := COALESCE(jsonb_array_length(p_grid->'col_labels'), -1);

      FOR v_row IN SELECT jsonb_array_elements(p_grid->'cells') LOOP
        IF jsonb_typeof(v_row) <> 'array' OR jsonb_array_length(v_row) <> v_n_cols THEN
          RAISE EXCEPTION 'grid_dims_mismatch: a cells row length <> col_labels (%)', v_n_cols
            USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;

    INSERT INTO public.stock_guide_sensitivity (ticker, grid, updated_by, updated_at)
    VALUES (p_ticker, p_grid, v_uid, now())
    ON CONFLICT (ticker) DO UPDATE SET
      grid       = EXCLUDED.grid,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;
  END;
  $$;

------------------------------------------------------------
-- RPC 8 (admin write): admin_set_stock_guide_visibility
--   Flip is_visible, return the updated row.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_stock_guide_visibility(
  p_ticker     text,
  p_is_visible boolean
) RETURNS public.stock_guide_companies
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_row public.stock_guide_companies;
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    UPDATE public.stock_guide_companies
       SET is_visible = p_is_visible,
           updated_by = auth.uid(),
           updated_at = now()
     WHERE ticker = p_ticker
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'company_not_found: %', p_ticker USING ERRCODE = '22023';
    END IF;

    RETURN v_row;
  END;
  $$;

------------------------------------------------------------
-- RPC 9 (admin write): admin_upsert_stock_guide_config (singleton update)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_stock_guide_config(
  p_y1   text,
  p_y2   text,
  p_note text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    UPDATE public.stock_guide_config
       SET y1_label         = p_y1,
           y2_label         = p_y2,
           assumptions_note = COALESCE(p_note, ''),
           updated_by       = auth.uid(),
           updated_at       = now()
     WHERE id = 1;
  END;
  $$;

------------------------------------------------------------
-- RPC 10 (admin write): admin_delete_stock_guide_company
--   Sensitivity row cascades via FK ON DELETE CASCADE.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_stock_guide_company(p_ticker text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.stock_guide_companies WHERE ticker = p_ticker;
  END;
  $$;

-- ============================================================================
-- Grants
-- ============================================================================
-- Public reads
GRANT EXECUTE ON FUNCTION public.get_stock_guide_comps()                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_guide_sensitivity(text)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_guide_config()                      TO anon, authenticated;
-- Admin reads (is_admin guard inside)
GRANT EXECUTE ON FUNCTION public.admin_get_stock_guide_companies()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_stock_guide_sensitivity(text)       TO authenticated;
-- Admin writes (is_admin guard inside)
GRANT EXECUTE ON FUNCTION public.admin_upsert_stock_guide_company(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_stock_guide_sensitivity(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_stock_guide_visibility(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_stock_guide_config(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_stock_guide_company(text)        TO authenticated;

-- ============================================================================
-- Module visibility registration (Public=FALSE → Client + Admin only)
-- ============================================================================
INSERT INTO public.module_visibility
  (module_slug, is_visible_for_clients, is_visible_for_public, is_visible_on_home)
VALUES
  ('stock-guide', TRUE, FALSE, TRUE)
ON CONFLICT (module_slug) DO UPDATE SET
  is_visible_for_clients = EXCLUDED.is_visible_for_clients,
  is_visible_for_public  = EXCLUDED.is_visible_for_public,
  is_visible_on_home     = EXCLUDED.is_visible_on_home;

-- ============================================================================
-- Seed 10 companies (6 visible, 4 restricted). yahoo_symbol = ticker for all.
-- ============================================================================
INSERT INTO public.stock_guide_companies
  (ticker, company_name, yahoo_symbol, sector, volume_unit, is_visible, display_order)
VALUES
  ('PETR4', 'Petrobras',       'PETR4', 'oil_gas',            'kbpd',        true,  1),
  ('PRIO3', 'PRIO',            'PRIO3', 'oil_gas',            'kbpd',        true,  2),
  ('RECV3', 'PetroReconcavo',  'RECV3', 'oil_gas',            'kbpd',        true,  3),
  ('OPCT3', 'OceanPact',       'OPCT3', 'oil_gas',            'kbpd',        true,  4),
  ('VBBR3', 'Vibra Energia',   'VBBR3', 'fuel_distribution',  'thousand_m3', true,  5),
  ('UGPA3', 'Ultrapar',        'UGPA3', 'fuel_distribution',  'thousand_m3', true,  6),
  ('BRAV3', 'BRAVA Energia',   'BRAV3', 'oil_gas',            'kbpd',        false, 7),
  ('RAIZ4', 'Raízen',          'RAIZ4', 'fuel_distribution',  'thousand_m3', false, 8),
  ('CSAN3', 'Cosan',           'CSAN3', 'fuel_distribution',  'thousand_m3', false, 9),
  ('BRKM4', 'Braskem',         'BRKM4', 'oil_gas',            'kbpd',        false, 10)
ON CONFLICT (ticker) DO NOTHING;
