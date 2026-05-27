-- Round 12: expand get_well_by_well_header to emit per-empresa Gas + Main fields rows.
--
-- BEFORE: 16 rows (Brazil 1-12, Company Oil 13-16).
-- AFTER:  24 rows (adds Company Gas 17-20 + Company Main fields 21-24).
--
-- All Brazil rows (1-12) and Company Oil rows (13-16) preserved verbatim
-- (math, signatures, CTE names). Only NEW CTEs and rows added.
--
-- Math notes:
--  - Gas kboed conversion: gas_mm3_dia * 6.29 / 1000  (same factor as Brazil Gas).
--  - Main fields: top 3 canonical for the empresa from mv_production_monthly
--    (already stake-weighted at extract time; no JOIN with stakes at query time).
--  - Empresa with empty ambiente (e.g. PRIO has no PreSal) → LEFT JOIN with
--    ambiente_label_map yields NULL current/prev/etc; mom_pct/yoy_pct then NULL.
--  - When the empresa has < 3 canonicals (e.g. very small operator), the
--    Main fields total still equals SUM of whatever exists and rows 22-24 fill
--    only as far as data exists.

CREATE OR REPLACE FUNCTION public.get_well_by_well_header(
  p_empresa text,
  p_year integer,
  p_month integer
)
RETURNS TABLE(
  display_order integer,
  section text,
  category text,
  subcategory text,
  is_total boolean,
  current_val numeric,
  prev_month_val numeric,
  mom_pct numeric,
  prev_year_val numeric,
  yoy_pct numeric,
  ytd_avg numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_prev_month_y int := CASE WHEN p_month = 1 THEN p_year - 1 ELSE p_year END;
  v_prev_month_m int := CASE WHEN p_month = 1 THEN 12         ELSE p_month - 1 END;
  v_prev_year_y  int := p_year - 1;
  v_prev_year_m  int := p_month;
  v_company_section text := UPPER(p_empresa);
BEGIN
  RETURN QUERY
  WITH
  ambiente_label_map AS (
    SELECT 'PreSal'::text AS local_raw, 'Pre-Salt'::text AS label, 1 AS ord
    UNION ALL SELECT 'PosSal', 'Post-Salt', 2
    UNION ALL SELECT 'Terra',  'Onshore',   3
  ),
  brazil_per_ambiente AS (
    SELECT
      m.ambiente AS local_raw,
      MAX(CASE WHEN m.ano = p_year         AND m.mes = p_month         THEN m.oil_bbl_dia END) AS oil_curr,
      MAX(CASE WHEN m.ano = v_prev_month_y AND m.mes = v_prev_month_m  THEN m.oil_bbl_dia END) AS oil_prevm,
      MAX(CASE WHEN m.ano = v_prev_year_y  AND m.mes = v_prev_year_m   THEN m.oil_bbl_dia END) AS oil_prevy,
      AVG(CASE WHEN m.ano = p_year         AND m.mes <= p_month        THEN m.oil_bbl_dia END) AS oil_ytd,
      MAX(CASE WHEN m.ano = p_year         AND m.mes = p_month         THEN m.gas_mm3_dia END) AS gas_curr,
      MAX(CASE WHEN m.ano = v_prev_month_y AND m.mes = v_prev_month_m  THEN m.gas_mm3_dia END) AS gas_prevm,
      MAX(CASE WHEN m.ano = v_prev_year_y  AND m.mes = v_prev_year_m   THEN m.gas_mm3_dia END) AS gas_prevy,
      AVG(CASE WHEN m.ano = p_year         AND m.mes <= p_month        THEN m.gas_mm3_dia END) AS gas_ytd
    FROM mv_brazil_monthly m
    WHERE (m.ano = p_year)
       OR (m.ano = v_prev_month_y AND m.mes = v_prev_month_m)
       OR (m.ano = v_prev_year_y  AND m.mes = v_prev_year_m)
    GROUP BY m.ambiente
  ),
  brazil_top3_set AS (
    SELECT canonical_field_name(p.campo) AS canonical
      FROM anp_cdp_producao p
     WHERE p.ano = p_year AND p.mes = p_month
     GROUP BY canonical_field_name(p.campo)
     ORDER BY SUM(p.petroleo_bbl_dia) DESC NULLS LAST
     LIMIT 3
  ),
  brazil_top3_data AS (
    SELECT
      cf.canonical,
      SUM(CASE WHEN p.ano = p_year         AND p.mes = p_month         THEN p.petroleo_bbl_dia END) AS oil_curr,
      SUM(CASE WHEN p.ano = v_prev_month_y AND p.mes = v_prev_month_m  THEN p.petroleo_bbl_dia END) AS oil_prevm,
      SUM(CASE WHEN p.ano = v_prev_year_y  AND p.mes = v_prev_year_m   THEN p.petroleo_bbl_dia END) AS oil_prevy,
      (
        SELECT AVG(monthly_sum)
        FROM (
          SELECT p2.ano, p2.mes, SUM(p2.petroleo_bbl_dia) AS monthly_sum
            FROM anp_cdp_producao p2
           WHERE p2.ano = p_year
             AND p2.mes <= p_month
             AND canonical_field_name(p2.campo) = cf.canonical
           GROUP BY p2.ano, p2.mes
        ) sub
      ) AS oil_ytd
    FROM brazil_top3_set cf
    JOIN anp_cdp_producao p
      ON canonical_field_name(p.campo) = cf.canonical
    WHERE (p.ano = p_year)
       OR (p.ano = v_prev_month_y AND p.mes = v_prev_month_m)
       OR (p.ano = v_prev_year_y  AND p.mes = v_prev_year_m)
    GROUP BY cf.canonical
  ),
  brazil_top3_ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY oil_curr DESC NULLS LAST) AS rk
      FROM brazil_top3_data
  ),
  -- Company per-ambiente: aggregate oil AND gas from already-stake-weighted MV.
  company_per_ambiente AS (
    SELECT
      m.ambiente AS local_raw,
      MAX(CASE WHEN m.ano = p_year         AND m.mes = p_month         THEN m.oil_bbl_dia END) AS oil_curr,
      MAX(CASE WHEN m.ano = v_prev_month_y AND m.mes = v_prev_month_m  THEN m.oil_bbl_dia END) AS oil_prevm,
      MAX(CASE WHEN m.ano = v_prev_year_y  AND m.mes = v_prev_year_m   THEN m.oil_bbl_dia END) AS oil_prevy,
      AVG(CASE WHEN m.ano = p_year         AND m.mes <= p_month        THEN m.oil_bbl_dia END) AS oil_ytd,
      MAX(CASE WHEN m.ano = p_year         AND m.mes = p_month         THEN m.gas_mm3_dia END) AS gas_curr,
      MAX(CASE WHEN m.ano = v_prev_month_y AND m.mes = v_prev_month_m  THEN m.gas_mm3_dia END) AS gas_prevm,
      MAX(CASE WHEN m.ano = v_prev_year_y  AND m.mes = v_prev_year_m   THEN m.gas_mm3_dia END) AS gas_prevy,
      AVG(CASE WHEN m.ano = p_year         AND m.mes <= p_month        THEN m.gas_mm3_dia END) AS gas_ytd
    FROM (
      SELECT empresa, ano, mes, ambiente,
             SUM(oil_bbl_dia) AS oil_bbl_dia,
             SUM(gas_mm3_dia) AS gas_mm3_dia
        FROM mv_production_monthly
       WHERE empresa = p_empresa
       GROUP BY empresa, ano, mes, ambiente
    ) m
    WHERE (m.ano = p_year)
       OR (m.ano = v_prev_month_y AND m.mes = v_prev_month_m)
       OR (m.ano = v_prev_year_y  AND m.mes = v_prev_year_m)
    GROUP BY m.ambiente
  ),
  -- Company top 3 canonical fields (oil-based ranking, current month).
  company_top3_set AS (
    SELECT m.canonical
      FROM mv_production_monthly m
     WHERE m.empresa = p_empresa
       AND m.ano = p_year
       AND m.mes = p_month
     GROUP BY m.canonical
     ORDER BY SUM(m.oil_bbl_dia) DESC NULLS LAST
     LIMIT 3
  ),
  company_top3_data AS (
    SELECT
      cf.canonical,
      SUM(CASE WHEN m.ano = p_year         AND m.mes = p_month         THEN m.oil_bbl_dia END) AS oil_curr,
      SUM(CASE WHEN m.ano = v_prev_month_y AND m.mes = v_prev_month_m  THEN m.oil_bbl_dia END) AS oil_prevm,
      SUM(CASE WHEN m.ano = v_prev_year_y  AND m.mes = v_prev_year_m   THEN m.oil_bbl_dia END) AS oil_prevy,
      (
        SELECT AVG(monthly_sum)
        FROM (
          SELECT m2.ano, m2.mes, SUM(m2.oil_bbl_dia) AS monthly_sum
            FROM mv_production_monthly m2
           WHERE m2.empresa = p_empresa
             AND m2.ano = p_year
             AND m2.mes <= p_month
             AND m2.canonical = cf.canonical
           GROUP BY m2.ano, m2.mes
        ) sub
      ) AS oil_ytd
    FROM company_top3_set cf
    JOIN mv_production_monthly m
      ON m.canonical = cf.canonical
     AND m.empresa = p_empresa
    WHERE (m.ano = p_year)
       OR (m.ano = v_prev_month_y AND m.mes = v_prev_month_m)
       OR (m.ano = v_prev_year_y  AND m.mes = v_prev_year_m)
    GROUP BY cf.canonical
  ),
  company_top3_ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY oil_curr DESC NULLS LAST) AS rk
      FROM company_top3_data
  ),
  brazil_oil_total AS (
    SELECT
      1 AS display_order,
      'BRAZIL'::text AS section,
      'Oil (kbpd)'::text AS category,
      NULL::text AS subcategory,
      TRUE AS is_total,
      (SUM(oil_curr)  / 1000.0)::numeric AS current_val,
      (SUM(oil_prevm) / 1000.0)::numeric AS prev_month_val,
      (SUM(oil_prevy) / 1000.0)::numeric AS prev_year_val,
      (SUM(oil_ytd)   / 1000.0)::numeric AS ytd_avg
    FROM brazil_per_ambiente
  ),
  brazil_oil_rows AS (
    SELECT
      1 + lm.ord AS display_order,
      'BRAZIL'::text AS section,
      'Oil (kbpd)'::text AS category,
      lm.label AS subcategory,
      FALSE AS is_total,
      (b.oil_curr  / 1000.0)::numeric AS current_val,
      (b.oil_prevm / 1000.0)::numeric AS prev_month_val,
      (b.oil_prevy / 1000.0)::numeric AS prev_year_val,
      (b.oil_ytd   / 1000.0)::numeric AS ytd_avg
    FROM ambiente_label_map lm
    LEFT JOIN brazil_per_ambiente b ON b.local_raw = lm.local_raw
  ),
  brazil_gas_total AS (
    SELECT
      5 AS display_order,
      'BRAZIL'::text AS section,
      'Gas (kboed)'::text AS category,
      NULL::text AS subcategory,
      TRUE AS is_total,
      (SUM(gas_curr)  * 6.29 / 1000.0)::numeric AS current_val,
      (SUM(gas_prevm) * 6.29 / 1000.0)::numeric AS prev_month_val,
      (SUM(gas_prevy) * 6.29 / 1000.0)::numeric AS prev_year_val,
      (SUM(gas_ytd)   * 6.29 / 1000.0)::numeric AS ytd_avg
    FROM brazil_per_ambiente
  ),
  brazil_gas_rows AS (
    SELECT
      5 + lm.ord AS display_order,
      'BRAZIL'::text AS section,
      'Gas (kboed)'::text AS category,
      lm.label AS subcategory,
      FALSE AS is_total,
      (b.gas_curr  * 6.29 / 1000.0)::numeric AS current_val,
      (b.gas_prevm * 6.29 / 1000.0)::numeric AS prev_month_val,
      (b.gas_prevy * 6.29 / 1000.0)::numeric AS prev_year_val,
      (b.gas_ytd   * 6.29 / 1000.0)::numeric AS ytd_avg
    FROM ambiente_label_map lm
    LEFT JOIN brazil_per_ambiente b ON b.local_raw = lm.local_raw
  ),
  brazil_main_total AS (
    SELECT
      9 AS display_order,
      'BRAZIL'::text AS section,
      'Main fields (kbpd)'::text AS category,
      NULL::text AS subcategory,
      TRUE AS is_total,
      (SUM(oil_curr)  / 1000.0)::numeric AS current_val,
      (SUM(oil_prevm) / 1000.0)::numeric AS prev_month_val,
      (SUM(oil_prevy) / 1000.0)::numeric AS prev_year_val,
      (SUM(oil_ytd)   / 1000.0)::numeric AS ytd_avg
    FROM brazil_top3_data
  ),
  brazil_main_rows AS (
    SELECT
      9 + r.rk::int AS display_order,
      'BRAZIL'::text AS section,
      'Main fields (kbpd)'::text AS category,
      r.canonical AS subcategory,
      FALSE AS is_total,
      (r.oil_curr  / 1000.0)::numeric AS current_val,
      (r.oil_prevm / 1000.0)::numeric AS prev_month_val,
      (r.oil_prevy / 1000.0)::numeric AS prev_year_val,
      (r.oil_ytd   / 1000.0)::numeric AS ytd_avg
    FROM brazil_top3_ranked r
  ),
  company_oil_total AS (
    SELECT
      13 AS display_order,
      v_company_section AS section,
      'Oil (kbpd)'::text AS category,
      NULL::text AS subcategory,
      TRUE AS is_total,
      (SUM(oil_curr)  / 1000.0)::numeric AS current_val,
      (SUM(oil_prevm) / 1000.0)::numeric AS prev_month_val,
      (SUM(oil_prevy) / 1000.0)::numeric AS prev_year_val,
      (SUM(oil_ytd)   / 1000.0)::numeric AS ytd_avg
    FROM company_per_ambiente
  ),
  company_oil_rows AS (
    SELECT
      13 + lm.ord AS display_order,
      v_company_section AS section,
      'Oil (kbpd)'::text AS category,
      lm.label AS subcategory,
      FALSE AS is_total,
      (c.oil_curr  / 1000.0)::numeric AS current_val,
      (c.oil_prevm / 1000.0)::numeric AS prev_month_val,
      (c.oil_prevy / 1000.0)::numeric AS prev_year_val,
      (c.oil_ytd   / 1000.0)::numeric AS ytd_avg
    FROM ambiente_label_map lm
    LEFT JOIN company_per_ambiente c ON c.local_raw = lm.local_raw
  ),
  -- NEW (Round 12): company gas total at display_order 17.
  company_gas_total AS (
    SELECT
      17 AS display_order,
      v_company_section AS section,
      'Gas (kboed)'::text AS category,
      NULL::text AS subcategory,
      TRUE AS is_total,
      (SUM(gas_curr)  * 6.29 / 1000.0)::numeric AS current_val,
      (SUM(gas_prevm) * 6.29 / 1000.0)::numeric AS prev_month_val,
      (SUM(gas_prevy) * 6.29 / 1000.0)::numeric AS prev_year_val,
      (SUM(gas_ytd)   * 6.29 / 1000.0)::numeric AS ytd_avg
    FROM company_per_ambiente
  ),
  -- NEW (Round 12): company gas per ambiente at display_order 18-20.
  company_gas_rows AS (
    SELECT
      17 + lm.ord AS display_order,
      v_company_section AS section,
      'Gas (kboed)'::text AS category,
      lm.label AS subcategory,
      FALSE AS is_total,
      (c.gas_curr  * 6.29 / 1000.0)::numeric AS current_val,
      (c.gas_prevm * 6.29 / 1000.0)::numeric AS prev_month_val,
      (c.gas_prevy * 6.29 / 1000.0)::numeric AS prev_year_val,
      (c.gas_ytd   * 6.29 / 1000.0)::numeric AS ytd_avg
    FROM ambiente_label_map lm
    LEFT JOIN company_per_ambiente c ON c.local_raw = lm.local_raw
  ),
  -- NEW (Round 12): company main fields total at display_order 21.
  company_main_total AS (
    SELECT
      21 AS display_order,
      v_company_section AS section,
      'Main fields (kbpd)'::text AS category,
      NULL::text AS subcategory,
      TRUE AS is_total,
      (SUM(oil_curr)  / 1000.0)::numeric AS current_val,
      (SUM(oil_prevm) / 1000.0)::numeric AS prev_month_val,
      (SUM(oil_prevy) / 1000.0)::numeric AS prev_year_val,
      (SUM(oil_ytd)   / 1000.0)::numeric AS ytd_avg
    FROM company_top3_data
  ),
  -- NEW (Round 12): company top 3 canonical fields at display_order 22-24.
  company_main_rows AS (
    SELECT
      21 + r.rk::int AS display_order,
      v_company_section AS section,
      'Main fields (kbpd)'::text AS category,
      r.canonical AS subcategory,
      FALSE AS is_total,
      (r.oil_curr  / 1000.0)::numeric AS current_val,
      (r.oil_prevm / 1000.0)::numeric AS prev_month_val,
      (r.oil_prevy / 1000.0)::numeric AS prev_year_val,
      (r.oil_ytd   / 1000.0)::numeric AS ytd_avg
    FROM company_top3_ranked r
  ),
  all_rows AS (
    SELECT * FROM brazil_oil_total
    UNION ALL SELECT * FROM brazil_oil_rows
    UNION ALL SELECT * FROM brazil_gas_total
    UNION ALL SELECT * FROM brazil_gas_rows
    UNION ALL SELECT * FROM brazil_main_total
    UNION ALL SELECT * FROM brazil_main_rows
    UNION ALL SELECT * FROM company_oil_total
    UNION ALL SELECT * FROM company_oil_rows
    UNION ALL SELECT * FROM company_gas_total
    UNION ALL SELECT * FROM company_gas_rows
    UNION ALL SELECT * FROM company_main_total
    UNION ALL SELECT * FROM company_main_rows
  )
  SELECT
    a.display_order,
    a.section,
    a.category,
    a.subcategory,
    a.is_total,
    a.current_val,
    a.prev_month_val,
    CASE WHEN a.prev_month_val IS NULL OR a.prev_month_val = 0 THEN NULL
         ELSE (a.current_val / a.prev_month_val - 1) * 100 END AS mom_pct,
    a.prev_year_val,
    CASE WHEN a.prev_year_val IS NULL OR a.prev_year_val = 0 THEN NULL
         ELSE (a.current_val / a.prev_year_val - 1) * 100 END AS yoy_pct,
    a.ytd_avg
  FROM all_rows a
  ORDER BY a.display_order;
END;
$function$;

-- Preserve grants explicitly (CREATE OR REPLACE preserves them, but Pegadinha #18
-- says always re-state defensively in case of future DROP+CREATE).
GRANT EXECUTE ON FUNCTION public.get_well_by_well_header(text, integer, integer)
  TO anon, authenticated;
