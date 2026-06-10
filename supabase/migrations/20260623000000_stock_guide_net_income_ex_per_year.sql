-- ============================================================================
-- Stock Guide — per-year adjusted net income for the ex-tax-credit row (BRL mn).
--
-- The /stock-guide ex-tax-credit companion row (case: Vibra) already adjusts the
-- market cap by the per-year NPV of the tax credit (npv_tax_credit_y1/y2,
-- migration 20260622000000). The analyst now also needs that ex-row to adjust the
-- NET INCOME (the P/E denominator) independently.
--
-- Add two optional per-company columns:
--   net_income_ex_y1 / net_income_ex_y2  (BRL mn, nullable)
-- Semantics: when filled, the ex-tax-credit row's P/E uses this net income for
-- that forward year; when NULL, it falls back to the normal net_income_yN.
-- The NORMAL (non-ex) row NEVER uses these columns.
--
-- DB layer only. front-old × DB-new window is tolerant — the JS mapper reads the
-- keys via toNumOrNull, so a missing key yields null and the ex-row simply keeps
-- using net_income_yN until the front catches up — no crash.
--
-- Order: (1) ADD the two columns (nullable, no data migration — NULL for all
-- existing rows), (2) DROP+CREATE the 3 RPCs adding the two fields as a strict
-- superset (re-asserting SECURITY DEFINER + search_path + the CORRECT grants —
-- pegadinha #18; comps: anon+authenticated, admin RPCs: authenticated only with
-- explicit REVOKE FROM anon — pegadinha re Supabase pg_default_acl auto-grant).
--
-- stock_guide_companies has RLS enabled with NO policies, so reads only flow
-- through these hide-aware SECURITY DEFINER RPCs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) Add the two per-year columns (BRL mn; NULL = ex-row uses normal net income)
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_guide_companies
  ADD COLUMN IF NOT EXISTS net_income_ex_y1 numeric,   -- BRL mn, ex-tax-credit row net income 2026E
  ADD COLUMN IF NOT EXISTS net_income_ex_y2 numeric;   -- BRL mn, ex-tax-credit row net income 2027E

-- ============================================================================
-- (2) Recreate the 3 RPCs adding net_income_ex_y1/y2 as a strict superset.
--     DROP first because the RETURNS TABLE signature changes.
--     pegadinha #18: DROP+CREATE wipes grants + SECURITY DEFINER + search_path —
--     all re-applied explicitly.
-- ============================================================================

-- ---- get_stock_guide_comps (hide-aware; anon + authenticated) --------------
DROP FUNCTION IF EXISTS public.get_stock_guide_comps();
CREATE FUNCTION public.get_stock_guide_comps()
 RETURNS TABLE(ticker text, company_name text, is_visible boolean, display_order integer, sector text, volume_unit text, yahoo_symbol text, shares_outstanding numeric, net_debt_y1 numeric, net_debt_y2 numeric, last_update date, target_price numeric, recommendation text, ebitda_y1 numeric, ebitda_y2 numeric, net_income_y1 numeric, net_income_y2 numeric, net_income_ex_y1 numeric, net_income_ex_y2 numeric, npv_tax_credit_y1 numeric, npv_tax_credit_y2 numeric, fcfe_y1 numeric, fcfe_y2 numeric, dividends_y1 numeric, dividends_y2 numeric, volumes_y1 numeric, volumes_y2 numeric)
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
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.net_income_ex_y1   ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.net_income_ex_y2   ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.npv_tax_credit_y1  ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.npv_tax_credit_y2  ELSE NULL END,
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

-- ---- admin_get_stock_guide_companies (authenticated only) ------------------
DROP FUNCTION IF EXISTS public.admin_get_stock_guide_companies();
CREATE FUNCTION public.admin_get_stock_guide_companies()
 RETURNS TABLE(ticker text, company_name text, yahoo_symbol text, sector text, volume_unit text, shares_outstanding numeric, net_debt_y1 numeric, net_debt_y2 numeric, last_update date, target_price numeric, recommendation text, ebitda_y1 numeric, ebitda_y2 numeric, net_income_y1 numeric, net_income_y2 numeric, net_income_ex_y1 numeric, net_income_ex_y2 numeric, npv_tax_credit_y1 numeric, npv_tax_credit_y2 numeric, fcfe_y1 numeric, fcfe_y2 numeric, dividends_y1 numeric, dividends_y2 numeric, volumes_y1 numeric, volumes_y2 numeric, is_visible boolean, display_order integer, updated_at timestamp with time zone, updated_by uuid)
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
        c.net_income_ex_y1, c.net_income_ex_y2,
        c.npv_tax_credit_y1, c.npv_tax_credit_y2,
        c.fcfe_y1, c.fcfe_y2, c.dividends_y1, c.dividends_y2,
        c.volumes_y1, c.volumes_y2,
        c.is_visible, c.display_order, c.updated_at, c.updated_by
      FROM public.stock_guide_companies c
      ORDER BY c.display_order, c.ticker;
  END;
  $function$;
REVOKE ALL ON FUNCTION public.admin_get_stock_guide_companies() FROM PUBLIC;
-- Strip the anon EXECUTE that Supabase pg_default_acl auto-grants to every new
-- public function — admin RPCs must be authenticated-only (QA finding cfaf60df).
REVOKE EXECUTE ON FUNCTION public.admin_get_stock_guide_companies() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_stock_guide_companies() TO authenticated;

-- ---- admin_upsert_stock_guide_company (authenticated only) -----------------
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
      net_income_ex_y1, net_income_ex_y2,
      npv_tax_credit_y1, npv_tax_credit_y2,
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
      (p_data->>'net_income_ex_y1')::numeric,
      (p_data->>'net_income_ex_y2')::numeric,
      (p_data->>'npv_tax_credit_y1')::numeric,
      (p_data->>'npv_tax_credit_y2')::numeric,
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
      net_income_ex_y1   = EXCLUDED.net_income_ex_y1,
      net_income_ex_y2   = EXCLUDED.net_income_ex_y2,
      npv_tax_credit_y1  = EXCLUDED.npv_tax_credit_y1,
      npv_tax_credit_y2  = EXCLUDED.npv_tax_credit_y2,
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
-- Strip the anon EXECUTE that Supabase pg_default_acl auto-grants (QA finding cfaf60df).
REVOKE EXECUTE ON FUNCTION public.admin_upsert_stock_guide_company(text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_stock_guide_company(text, jsonb) TO authenticated;
