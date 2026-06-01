-- ============================================================================
-- Stock Guide — net debt is per forward year (2026E/2027E), not a single value
--
-- Small correction on top of supabase/migrations/20260603300000_stock_guide_fundamentals.sql.
-- Net Debt must be projected per forward year, so the browser can compute EV
-- (and EV/EBITDA) per year:
--
--   Market cap      = shares_outstanding × live_price        (single current value)
--   EV(year)        = Market cap + net_debt(year)            (per forward year)
--   EV/EBITDA(year) = EV(year)   ÷ ebitda(year)
--
-- net_debt is split: net_debt → net_debt_y1 + net_debt_y2 (BRL mn, nullable,
-- may be negative = net cash). No real financial data exists yet (the column
-- was never populated), so the swap is non-destructive.
--
-- 3 RPCs rebuilt to swap the single net_debt for the two per-year columns,
-- in the same position (right after shares_outstanding):
--   get_stock_guide_comps()              — DROP+CREATE (RETURNS TABLE changes)
--   admin_get_stock_guide_companies()    — DROP+CREATE (RETURNS TABLE changes)
--   admin_upsert_stock_guide_company()   — CREATE OR REPLACE (void return unchanged)
--
-- Untouched: get_stock_guide_sensitivity, get_stock_guide_config, the
-- sensitivity/config admin RPCs, visibility/delete RPCs, and the seed.
-- ============================================================================

------------------------------------------------------------
-- 1) Split net_debt → net_debt_y1 + net_debt_y2
------------------------------------------------------------
ALTER TABLE public.stock_guide_companies
  DROP COLUMN IF EXISTS net_debt;

ALTER TABLE public.stock_guide_companies
  ADD COLUMN IF NOT EXISTS net_debt_y1 numeric,   -- forward year 1 (e.g. 2026E); net cash if negative
  ADD COLUMN IF NOT EXISTS net_debt_y2 numeric;   -- forward year 2 (e.g. 2027E); net cash if negative

-- ============================================================================
-- 2) get_stock_guide_comps — DROP + CREATE (RETURNS TABLE signature changes)
--   Hide-aware: every column EXCEPT ticker/company_name/is_visible/display_order
--   is wrapped in CASE WHEN (is_visible OR is_admin) THEN col ELSE NULL — incl.
--   BOTH net_debt_y1 and net_debt_y2, so a restricted company's fundamentals
--   never leak (the browser can't back out its mkt cap / EV).
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
    net_debt_y1         numeric,
    net_debt_y2         numeric,
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
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.net_debt_y1        ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.net_debt_y2        ELSE NULL END,
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
    net_debt_y1         numeric,
    net_debt_y2         numeric,
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
        c.shares_outstanding, c.net_debt_y1, c.net_debt_y2, c.last_update, c.target_price, c.recommendation,
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
--   Reads net_debt_y1 / net_debt_y2 from p_data; no longer reads single net_debt.
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
      shares_outstanding, net_debt_y1, net_debt_y2, last_update, target_price, recommendation,
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
      (p_data->>'net_debt_y1')::numeric,
      (p_data->>'net_debt_y2')::numeric,
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
      net_debt_y1        = EXCLUDED.net_debt_y1,
      net_debt_y2        = EXCLUDED.net_debt_y2,
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
