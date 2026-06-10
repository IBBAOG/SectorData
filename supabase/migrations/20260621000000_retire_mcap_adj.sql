-- Retire mcap_adj_y1/y2 — npv_tax_credit (ex-tax-credit companion row) is the
-- single tax-credit mechanism. mcap_adj_y1/y2 (migration 20260610120000, which
-- adjusted the normal row in-place) and npv_tax_credit (migration 20260620000000,
-- which adds a companion "ex-tax credit" row) served the SAME purpose. Keep
-- npv_tax_credit; drop mcap_adj_y1/y2.
--
-- Order: (1) migrate any surviving mcap_adj values into npv_tax_credit (idempotent,
-- y1 as NPV proxy), (2) DROP+CREATE the 3 RPCs without the 2 fields (re-asserting
-- SECURITY DEFINER + search_path + GRANTs — pegadinha #18), (3) DROP the 2 columns.

-- ---------------------------------------------------------------------------
-- (1) Data migration — idempotent. y1 is the NPV proxy; only fill when the
--     target is still NULL so re-runs never clobber a real npv_tax_credit.
--     Guarded so a re-run of this file AFTER the column is dropped (db push
--     --include-all + phantom revert — pegadinha #22) does not fail with 42703.
--     The UPDATE is wrapped in EXECUTE on a string so plpgsql never parses the
--     dropped column unless it still exists.
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'stock_guide_companies'
      AND column_name  = 'mcap_adj_y1'
  ) THEN
    EXECUTE $upd$
      UPDATE public.stock_guide_companies
      SET npv_tax_credit = COALESCE(npv_tax_credit, mcap_adj_y1)
      WHERE mcap_adj_y1 IS NOT NULL
        AND npv_tax_credit IS NULL
    $upd$;
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- (2) Recreate the 3 RPCs WITHOUT mcap_adj_y1/y2 (everything else identical,
--     incl. npv_tax_credit). DROP first because the return signature changes.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_stock_guide_comps();
CREATE FUNCTION public.get_stock_guide_comps()
 RETURNS TABLE(ticker text, company_name text, is_visible boolean, display_order integer, sector text, volume_unit text, yahoo_symbol text, shares_outstanding numeric, net_debt_y1 numeric, net_debt_y2 numeric, last_update date, target_price numeric, recommendation text, ebitda_y1 numeric, ebitda_y2 numeric, net_income_y1 numeric, net_income_y2 numeric, npv_tax_credit numeric, fcfe_y1 numeric, fcfe_y2 numeric, dividends_y1 numeric, dividends_y2 numeric, volumes_y1 numeric, volumes_y2 numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.npv_tax_credit     ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.fcfe_y1            ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.fcfe_y2            ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.dividends_y1       ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.dividends_y2       ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.volumes_y1         ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.volumes_y2         ELSE NULL END
    FROM public.stock_guide_companies c
    ORDER BY c.display_order, c.ticker;
  $function$;
REVOKE ALL ON FUNCTION public.get_stock_guide_comps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_stock_guide_comps() TO anon, authenticated;

DROP FUNCTION IF EXISTS public.admin_get_stock_guide_companies();
CREATE FUNCTION public.admin_get_stock_guide_companies()
 RETURNS TABLE(ticker text, company_name text, yahoo_symbol text, sector text, volume_unit text, shares_outstanding numeric, net_debt_y1 numeric, net_debt_y2 numeric, last_update date, target_price numeric, recommendation text, ebitda_y1 numeric, ebitda_y2 numeric, net_income_y1 numeric, net_income_y2 numeric, npv_tax_credit numeric, fcfe_y1 numeric, fcfe_y2 numeric, dividends_y1 numeric, dividends_y2 numeric, volumes_y1 numeric, volumes_y2 numeric, is_visible boolean, display_order integer, updated_at timestamp with time zone, updated_by uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
      SELECT
        c.ticker, c.company_name, c.yahoo_symbol, c.sector, c.volume_unit,
        c.shares_outstanding, c.net_debt_y1, c.net_debt_y2, c.last_update, c.target_price, c.recommendation,
        c.ebitda_y1, c.ebitda_y2, c.net_income_y1, c.net_income_y2,
        c.npv_tax_credit,
        c.fcfe_y1, c.fcfe_y2, c.dividends_y1, c.dividends_y2,
        c.volumes_y1, c.volumes_y2,
        c.is_visible, c.display_order, c.updated_at, c.updated_by
      FROM public.stock_guide_companies c
      ORDER BY c.display_order, c.ticker;
  END;
  $function$;
REVOKE ALL ON FUNCTION public.admin_get_stock_guide_companies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_stock_guide_companies() TO authenticated;

DROP FUNCTION IF EXISTS public.admin_upsert_stock_guide_company(text, jsonb);
CREATE FUNCTION public.admin_upsert_stock_guide_company(p_ticker text, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      (p_data->>'npv_tax_credit')::numeric,
      (p_data->>'fcfe_y1')::numeric,
      (p_data->>'fcfe_y2')::numeric,
      (p_data->>'dividends_y1')::numeric,
      (p_data->>'dividends_y2')::numeric,
      (p_data->>'volumes_y1')::numeric,
      (p_data->>'volumes_y2')::numeric,
      true,
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
      npv_tax_credit     = EXCLUDED.npv_tax_credit,
      fcfe_y1            = EXCLUDED.fcfe_y1,
      fcfe_y2            = EXCLUDED.fcfe_y2,
      dividends_y1       = EXCLUDED.dividends_y1,
      dividends_y2       = EXCLUDED.dividends_y2,
      volumes_y1         = EXCLUDED.volumes_y1,
      volumes_y2         = EXCLUDED.volumes_y2,
      display_order      = EXCLUDED.display_order,
      updated_by         = EXCLUDED.updated_by,
      updated_at         = EXCLUDED.updated_at;
  END;
  $function$;
REVOKE ALL ON FUNCTION public.admin_upsert_stock_guide_company(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_stock_guide_company(text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- (3) Drop the retired columns (after the RPCs no longer reference them).
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_guide_companies
  DROP COLUMN IF EXISTS mcap_adj_y1,
  DROP COLUMN IF EXISTS mcap_adj_y2;
