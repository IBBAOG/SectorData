-- ============================================================================
-- Stock Guide — optional per-company NPV tax credit (BRL mn) for the
-- "ex-tax credit" comps row.
--
-- New feature on /stock-guide: an optional per-company "NPV tax credit"
-- (BRL mn). When present, the browser renders a second "X ex-tax credit" row
-- whose market cap is adjusted (market cap − NPV tax credit) and re-derives the
-- multiples off that adjusted market cap. NULL = no ex-tax-credit row.
--
-- DB layer only. One nullable column is added to stock_guide_companies and
-- threaded through the three comps RPCs as a strict superset (column ADDED,
-- nothing removed/renamed — the pre-existing mcap_adj_y1/y2 stay untouched).
-- No values populated here — Eduardo enters them via the admin panel.
--
-- RPCs rebuilt/extended (all retrocompatible — column/key ADDED, none removed):
--   get_stock_guide_comps()              — DROP+CREATE (RETURNS TABLE changes)
--   admin_get_stock_guide_companies()    — DROP+CREATE (RETURNS TABLE changes)
--   admin_upsert_stock_guide_company()   — CREATE OR REPLACE (reads 1 new key)
--
-- Pegadinha #18: DROP+CREATE wipes grants + SECURITY DEFINER + search_path —
-- all re-applied explicitly below. stock_guide_companies has RLS enabled with
-- NO policies, so reads only flow through these hide-aware SECURITY DEFINER RPCs.
-- ============================================================================

------------------------------------------------------------
-- 1) Add the nullable NPV-tax-credit column (BRL mn)
------------------------------------------------------------
ALTER TABLE public.stock_guide_companies
  ADD COLUMN IF NOT EXISTS npv_tax_credit numeric;   -- BRL mn; NULL = no ex-tax-credit row

-- ============================================================================
-- 2) get_stock_guide_comps — DROP + CREATE (RETURNS TABLE signature changes)
--   Hide-aware: the new column is wrapped in the same
--   CASE WHEN (is_visible OR is_admin) guard, placed right after mcap_adj_y2
--   so a restricted company's financials never leak.
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
    mcap_adj_y1         numeric,
    mcap_adj_y2         numeric,
    npv_tax_credit      numeric,
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
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.mcap_adj_y1        ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.mcap_adj_y2        ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.npv_tax_credit     ELSE NULL END,
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
--   Full unfiltered rows for the editor; new column after mcap_adj_y2.
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
    mcap_adj_y1         numeric,
    mcap_adj_y2         numeric,
    npv_tax_credit      numeric,
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
        c.mcap_adj_y1, c.mcap_adj_y2,
        c.npv_tax_credit,
        c.fcfe_y1, c.fcfe_y2, c.dividends_y1, c.dividends_y2,
        c.volumes_y1, c.volumes_y2,
        c.is_visible, c.display_order, c.updated_at, c.updated_by
      FROM public.stock_guide_companies c
      ORDER BY c.display_order, c.ticker;
  END;
  $$;

-- ============================================================================
-- 4) admin_upsert_stock_guide_company — CREATE OR REPLACE (signature unchanged)
--   Same (text, jsonb) signature; reads 1 new optional key from p_data.
--   Missing key -> jsonb ->> returns NULL -> NULL persisted (no ex-tax-credit row).
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
      mcap_adj_y1, mcap_adj_y2,
      npv_tax_credit,
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
      (p_data->>'mcap_adj_y1')::numeric,
      (p_data->>'mcap_adj_y2')::numeric,
      (p_data->>'npv_tax_credit')::numeric,
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
      mcap_adj_y1        = EXCLUDED.mcap_adj_y1,
      mcap_adj_y2        = EXCLUDED.mcap_adj_y2,
      npv_tax_credit     = EXCLUDED.npv_tax_credit,
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
-- Grants — DROP+CREATE drops grants (pegadinha #18); re-GRANT the 3 RPCs
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.get_stock_guide_comps()                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_stock_guide_companies()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_stock_guide_company(text, jsonb) TO authenticated;
