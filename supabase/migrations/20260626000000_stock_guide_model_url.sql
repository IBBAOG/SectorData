-- ============================================================================
-- Stock Guide — downloadable financial-model link per company (model_url).
--
-- Analysts want each /stock-guide comps row to optionally carry a link to the
-- company's downloadable financial model (an Excel hosted externally —
-- SharePoint/Drive/etc.). The link is a free-text URL; no format validation
-- beyond text. NULL or empty string = no model available for that company.
--
-- Layer: DB only. The front-old × DB-new window is tolerant — the JS mapper
-- reads the key defensively, so a missing key just yields no link until the
-- front catches up; no crash.
--
-- Order:
--   (1) ADD the nullable column (no data migration — NULL for all existing rows)
--       + COMMENT ON COLUMN documenting it.
--   (2) Recreate get_stock_guide_comps adding model_url as a strict superset
--       (DROP+CREATE because the RETURNS TABLE signature changes) — re-asserting
--       SECURITY DEFINER + search_path + the CORRECT grants (anon + authenticated)
--       per pegadinha #18 (DROP+CREATE wipes grants/attributes).
--       model_url is hide-aware like every other detail column: NULL for rows a
--       non-admin cannot see.
--   (3) Recreate admin_get_stock_guide_companies adding model_url so the admin
--       edit form pre-fills the saved link (otherwise re-saving blanks it).
--   (4) Recreate admin_upsert_stock_guide_company so it persists model_url from
--       p_data with the same empty-string -> NULL coercion as the other optional
--       text fields; re-asserting the is_admin() guard / SECURITY DEFINER /
--       authenticated-only grant (explicit REVOKE FROM anon — Supabase
--       pg_default_acl auto-grant, QA finding cfaf60df).
--
-- stock_guide_companies has RLS enabled with NO policies, so reads only flow
-- through these hide-aware SECURITY DEFINER RPCs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) Add the model_url column (free-text URL; NULL/empty = no model available)
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_guide_companies
  ADD COLUMN IF NOT EXISTS model_url text;   -- external URL to the downloadable financial model (Excel)

COMMENT ON COLUMN public.stock_guide_companies.model_url IS
  'Optional URL to the company''s downloadable financial model (Excel hosted externally, e.g. SharePoint/Drive). Free-text, no format validation. NULL or empty string = no model available.';

-- ============================================================================
-- (2) Recreate get_stock_guide_comps adding model_url as a strict superset.
--     DROP first because the RETURNS TABLE signature changes.
--     pegadinha #18: DROP+CREATE wipes grants + SECURITY DEFINER + search_path —
--     all re-applied explicitly.
-- ============================================================================

-- ---- get_stock_guide_comps (hide-aware; anon + authenticated) --------------
DROP FUNCTION IF EXISTS public.get_stock_guide_comps();
CREATE FUNCTION public.get_stock_guide_comps()
 RETURNS TABLE(ticker text, company_name text, is_visible boolean, display_order integer, sector text, volume_unit text, yahoo_symbol text, shares_outstanding numeric, net_debt_y1 numeric, net_debt_y2 numeric, last_update date, target_price numeric, recommendation text, ebitda_y1 numeric, ebitda_y2 numeric, net_income_y1 numeric, net_income_y2 numeric, net_income_ex_y1 numeric, net_income_ex_y2 numeric, npv_tax_credit_y1 numeric, npv_tax_credit_y2 numeric, fcfe_y1 numeric, fcfe_y2 numeric, dividends_y1 numeric, dividends_y2 numeric, volumes_y1 numeric, volumes_y2 numeric, model_url text)
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
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.volumes_y2         ELSE NULL END,
      CASE WHEN (c.is_visible OR public.is_admin()) THEN c.model_url          ELSE NULL END
    FROM public.stock_guide_companies c
    ORDER BY c.display_order, c.ticker;
  $function$;
REVOKE ALL ON FUNCTION public.get_stock_guide_comps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_stock_guide_comps() TO anon, authenticated;

-- ============================================================================
-- (3) Recreate admin_get_stock_guide_companies adding model_url, so the admin
--     edit form pre-fills the saved link (otherwise re-saving would blank it).
--     DROP first because the RETURNS TABLE signature changes; authenticated-only.
-- ============================================================================

-- ---- admin_get_stock_guide_companies (authenticated only) ------------------
DROP FUNCTION IF EXISTS public.admin_get_stock_guide_companies();
CREATE FUNCTION public.admin_get_stock_guide_companies()
 RETURNS TABLE(ticker text, company_name text, yahoo_symbol text, sector text, volume_unit text, shares_outstanding numeric, net_debt_y1 numeric, net_debt_y2 numeric, last_update date, target_price numeric, recommendation text, ebitda_y1 numeric, ebitda_y2 numeric, net_income_y1 numeric, net_income_y2 numeric, net_income_ex_y1 numeric, net_income_ex_y2 numeric, npv_tax_credit_y1 numeric, npv_tax_credit_y2 numeric, fcfe_y1 numeric, fcfe_y2 numeric, dividends_y1 numeric, dividends_y2 numeric, volumes_y1 numeric, volumes_y2 numeric, model_url text, is_visible boolean, display_order integer, updated_at timestamp with time zone, updated_by uuid)
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
        c.model_url,
        c.is_visible, c.display_order, c.updated_at, c.updated_by
      FROM public.stock_guide_companies c
      ORDER BY c.display_order, c.ticker;
  END;
  $function$;
REVOKE ALL ON FUNCTION public.admin_get_stock_guide_companies() FROM PUBLIC;
-- Strip the anon EXECUTE that Supabase pg_default_acl auto-grants (QA finding cfaf60df).
REVOKE EXECUTE ON FUNCTION public.admin_get_stock_guide_companies() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_stock_guide_companies() TO authenticated;

-- ============================================================================
-- (4) Recreate admin_upsert_stock_guide_company so it persists model_url.
--     RETURNS void is unchanged, but DROP+CREATE keeps it consistent with the
--     prior migration's style; re-assert guards/grants explicitly (pegadinha #18).
-- ============================================================================

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
    v_model_url    text := NULLIF(trim(p_data->>'model_url'), '');
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
      model_url,
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
      v_model_url,
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
      model_url          = EXCLUDED.model_url,
      display_order      = EXCLUDED.display_order,
      updated_by         = EXCLUDED.updated_by,
      updated_at         = EXCLUDED.updated_at;
  END;
  $function$;
REVOKE ALL ON FUNCTION public.admin_upsert_stock_guide_company(text, jsonb) FROM PUBLIC;
-- Strip the anon EXECUTE that Supabase pg_default_acl auto-grants (QA finding cfaf60df).
REVOKE EXECUTE ON FUNCTION public.admin_upsert_stock_guide_company(text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_stock_guide_company(text, jsonb) TO authenticated;
