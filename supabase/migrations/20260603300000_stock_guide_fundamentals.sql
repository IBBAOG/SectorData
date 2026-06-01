-- ============================================================================
-- Stock Guide — store price-INDEPENDENT fundamentals; derive multiples live
--
-- Rework of supabase/migrations/20260603200000_stock_guide.sql.
-- The price-sensitive multiples (EV/EBITDA, P/E, FCFE Yield, Dividend Yield)
-- are no longer stored as static numbers — the browser derives them live from
-- the Yahoo price + the stored fundamentals:
--
--   Market cap   = shares_outstanding × live_price
--   EV           = Market cap + net_debt                  (single net_debt, both yrs)
--   EV/EBITDA(y) = EV          ÷ ebitda(y)
--   P/E(y)       = Market cap   ÷ net_income(y)
--   FCFE Yield(y)= fcfe(y)      ÷ Market cap
--   Div Yield(y) = dividends(y) ÷ Market cap
--
-- All monetary fundamentals are in BRL mn. net_debt may be negative (net cash).
--
-- The table carries NO real financial data yet (the stored-multiple columns were
-- never populated), so DROP/ADD of columns is non-destructive.
--
-- 3 RPCs are rebuilt:
--   get_stock_guide_comps()              — DROP+CREATE (RETURNS TABLE changes)
--   admin_get_stock_guide_companies()    — DROP+CREATE (RETURNS TABLE changes)
--   admin_upsert_stock_guide_company()   — CREATE OR REPLACE (void return unchanged)
--
-- Untouched: get_stock_guide_sensitivity, get_stock_guide_config, the
-- sensitivity/config admin RPCs, visibility/delete RPCs, and the seed.
-- ============================================================================

------------------------------------------------------------
-- 1) Reshape stock_guide_companies
------------------------------------------------------------
ALTER TABLE public.stock_guide_companies
  -- price-independent fundamentals (BRL mn unless noted)
  ADD COLUMN IF NOT EXISTS net_debt       numeric,   -- single current value; net cash if negative
  ADD COLUMN IF NOT EXISTS net_income_y1  numeric,
  ADD COLUMN IF NOT EXISTS net_income_y2  numeric,
  ADD COLUMN IF NOT EXISTS fcfe_y1        numeric,   -- FCFE value (NOT a yield)
  ADD COLUMN IF NOT EXISTS fcfe_y2        numeric,
  ADD COLUMN IF NOT EXISTS dividends_y1   numeric,   -- total dividends
  ADD COLUMN IF NOT EXISTS dividends_y2   numeric;

ALTER TABLE public.stock_guide_companies
  -- stored multiples — now always computed client-side, no admin override
  DROP COLUMN IF EXISTS ev_ebitda_y1,
  DROP COLUMN IF EXISTS ev_ebitda_y2,
  DROP COLUMN IF EXISTS pe_y1,
  DROP COLUMN IF EXISTS pe_y2,
  DROP COLUMN IF EXISTS fcfe_yield_y1,
  DROP COLUMN IF EXISTS fcfe_yield_y2,
  DROP COLUMN IF EXISTS div_yield_y1,
  DROP COLUMN IF EXISTS div_yield_y2;

-- ============================================================================
-- 2) get_stock_guide_comps — DROP + CREATE (RETURNS TABLE signature changes)
--   Hide-aware: every column EXCEPT ticker/company_name/is_visible/display_order
--   is wrapped in CASE WHEN (is_visible OR is_admin) THEN col ELSE NULL — incl.
--   the NEW fundamentals + shares_outstanding + yahoo_symbol, so a restricted
--   company's fundamentals never leak (the browser can't back out its mkt cap).
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_stock_guide_comps();

CREATE FUNCTION public.get_stock_guide_comps()
  RETURNS TABLE (
    ticker              text,
    company_name        text,
    is_visible          boolean,
    display_order       int,
    sector              text,
    volume_unit         text,
    yahoo_symbol        text,
    shares_outstanding  numeric,
    net_debt            numeric,
    last_update         date,
    target_price        numeric,
    recommendation      text,
    ebitda_y1           numeric,
    ebitda_y2           numeric,
    net_income_y1       numeric,
    net_income_y2       numeric,
    fcfe_y1             numeric,
    fcfe_y2             numeric,
    dividends_y1        numeric,
    dividends_y2        numeric,
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
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.net_debt           ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.last_update        ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.target_price       ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.recommendation     ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.ebitda_y1          ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.ebitda_y2          ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.net_income_y1      ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.net_income_y2      ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.fcfe_y1            ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.fcfe_y2            ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.dividends_y1       ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.dividends_y2       ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.volumes_y1         ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.volumes_y2         ELSE NULL END
    FROM public.stock_guide_companies c
    ORDER BY c.display_order, c.ticker;
  $$;

-- ============================================================================
-- 3) admin_get_stock_guide_companies — DROP + CREATE (RETURNS TABLE changes)
--   Full unfiltered rows (incl. hidden, incl. fundamentals) for the editor.
-- ============================================================================
DROP FUNCTION IF EXISTS public.admin_get_stock_guide_companies();

CREATE FUNCTION public.admin_get_stock_guide_companies()
  RETURNS TABLE (
    ticker              text,
    company_name        text,
    yahoo_symbol        text,
    sector              text,
    volume_unit         text,
    shares_outstanding  numeric,
    net_debt            numeric,
    last_update         date,
    target_price        numeric,
    recommendation      text,
    ebitda_y1           numeric,
    ebitda_y2           numeric,
    net_income_y1       numeric,
    net_income_y2       numeric,
    fcfe_y1             numeric,
    fcfe_y2             numeric,
    dividends_y1        numeric,
    dividends_y2        numeric,
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
        c.shares_outstanding, c.net_debt, c.last_update, c.target_price, c.recommendation,
        c.ebitda_y1, c.ebitda_y2, c.net_income_y1, c.net_income_y2,
        c.fcfe_y1, c.fcfe_y2, c.dividends_y1, c.dividends_y2,
        c.volumes_y1, c.volumes_y2,
        c.is_visible, c.display_order, c.updated_at, c.updated_by
      FROM public.stock_guide_companies c
      ORDER BY c.display_order, c.ticker;
  END;
  $$;

-- ============================================================================
-- 4) admin_upsert_stock_guide_company — CREATE OR REPLACE (void return unchanged)
--   Reads fundamentals from p_data; no longer reads the dropped multiple keys.
-- ============================================================================
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
      shares_outstanding, net_debt, last_update, target_price, recommendation,
      ebitda_y1, ebitda_y2, net_income_y1, net_income_y2,
      fcfe_y1, fcfe_y2, dividends_y1, dividends_y2,
      volumes_y1, volumes_y2,
      is_visible, display_order, updated_by, updated_at
    ) VALUES (
      trim(p_ticker),
      v_company_name,
      v_yahoo_symbol,
      COALESCE(NULLIF(p_data->>'sector', ''), 'oil_gas'),
      COALESCE(NULLIF(p_data->>'volume_unit', ''), 'kbpd'),
      (p_data->>'shares_outstanding')::numeric,
      (p_data->>'net_debt')::numeric,
      (p_data->>'last_update')::date,
      (p_data->>'target_price')::numeric,
      NULLIF(p_data->>'recommendation', ''),
      (p_data->>'ebitda_y1')::numeric,
      (p_data->>'ebitda_y2')::numeric,
      (p_data->>'net_income_y1')::numeric,
      (p_data->>'net_income_y2')::numeric,
      (p_data->>'fcfe_y1')::numeric,
      (p_data->>'fcfe_y2')::numeric,
      (p_data->>'dividends_y1')::numeric,
      (p_data->>'dividends_y2')::numeric,
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
      net_debt           = EXCLUDED.net_debt,
      last_update        = EXCLUDED.last_update,
      target_price       = EXCLUDED.target_price,
      recommendation     = EXCLUDED.recommendation,
      ebitda_y1          = EXCLUDED.ebitda_y1,
      ebitda_y2          = EXCLUDED.ebitda_y2,
      net_income_y1      = EXCLUDED.net_income_y1,
      net_income_y2      = EXCLUDED.net_income_y2,
      fcfe_y1            = EXCLUDED.fcfe_y1,
      fcfe_y2            = EXCLUDED.fcfe_y2,
      dividends_y1       = EXCLUDED.dividends_y1,
      dividends_y2       = EXCLUDED.dividends_y2,
      volumes_y1         = EXCLUDED.volumes_y1,
      volumes_y2         = EXCLUDED.volumes_y2,
      -- is_visible deliberately NOT updated here (preserve existing)
      display_order      = EXCLUDED.display_order,
      updated_by         = EXCLUDED.updated_by,
      updated_at         = EXCLUDED.updated_at;
  END;
  $$;

-- ============================================================================
-- Grants — DROP+CREATE drops grants (pegadinha #18); re-GRANT the 3 rebuilt RPCs
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.get_stock_guide_comps()                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_stock_guide_companies()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_stock_guide_company(text, jsonb) TO authenticated;
