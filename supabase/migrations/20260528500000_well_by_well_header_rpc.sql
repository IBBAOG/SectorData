-- ─── Round 8 — /well-by-well PDF-style header table ─────────────────────────
-- One RPC to power a 16-row stacked table that replicates page 2 of the PDF
-- Petrobras report. Two sections (Brazil + selected Empresa), three categories
-- in the Brazil section, one in the Empresa section. Each row carries:
--   current_val | prev_month_val | mom_pct | prev_year_val | yoy_pct | ytd_avg
--
-- Math notes:
--   • Oil unit: bbl/d → kbpd via /1000.
--   • Gas unit: `anp_cdp_producao.gas_total_mm3_dia` is stored in m³/d (despite
--     the column name). To get kboed apply  *6.29 / 1000.0
--     (industry-standard 1 m³ gas ≈ 6.29 boe; /1000 takes us from boe/d to kboe/d).
--     Cross-check Apr-26: Brazil raw sum = 206,603 m³/d ⇒ 206,603 × 6.29 / 1000 ≈
--     1,299 kboed, matches PDF page 2 exactly.
--   • Main fields (Brazil only): top 3 raw 100% WI campos by oil in p_month.
--   • Company rows: stake-weighted (mv_production_monthly already pre-applies stake_pct/100).
--   • Ambiente translation: 'PreSal' → 'Pre-Salt', 'PosSal' → 'Post-Salt', 'Terra' → 'Onshore'.
--
-- All output rows ordered by `display_order` (1..N) so the frontend renders top→down
-- without re-sorting and section/category boundaries are stable.
--
-- Pegadinha #18: SECURITY DEFINER + SET search_path required so anon callers
-- bypass RLS on the source tables/MVs (which only grant SELECT to authenticated).

CREATE OR REPLACE FUNCTION public.get_well_by_well_header(
  p_empresa text,
  p_year    int,
  p_month   int
) RETURNS TABLE (
  display_order  int,
  section        text,
  category       text,
  subcategory    text,
  is_total       boolean,
  current_val    numeric,
  prev_month_val numeric,
  mom_pct        numeric,
  prev_year_val  numeric,
  yoy_pct        numeric,
  ytd_avg        numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev_month_y int := CASE WHEN p_month = 1 THEN p_year - 1 ELSE p_year END;
  v_prev_month_m int := CASE WHEN p_month = 1 THEN 12         ELSE p_month - 1 END;
  v_prev_year_y  int := p_year - 1;
  v_prev_year_m  int := p_month;
  v_company_section text := UPPER(p_empresa);
BEGIN
  RETURN QUERY
  WITH
  -- ── (A) Ambiente label CTE ────────────────────────────────────────────────
  ambiente_label_map AS (
    SELECT 'PreSal'::text AS local_raw, 'Pre-Salt'::text AS label, 1 AS ord
    UNION ALL SELECT 'PosSal', 'Post-Salt', 2
    UNION ALL SELECT 'Terra',  'Onshore',   3
  ),

  -- ── (B) Brazil monthly slice — current, prev_month, prev_year + YTD ──────
  --     Pulls from mv_brazil_monthly, one row per (ambiente, slice).
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

  -- ── (C) Brazil top 3 fields by oil in (p_year, p_month). 100% WI raw. ────
  brazil_top3_set AS (
    SELECT canonical_field_name(p.campo) AS canonical
      FROM anp_cdp_producao p
     WHERE p.ano = p_year AND p.mes = p_month
     GROUP BY canonical_field_name(p.campo)
     ORDER BY SUM(p.petroleo_bbl_dia) DESC NULLS LAST
     LIMIT 3
  ),
  -- For each top-3 canonical, build the 4 oil values (curr/prevm/prevy/ytd).
  brazil_top3_data AS (
    SELECT
      cf.canonical,
      SUM(CASE WHEN p.ano = p_year         AND p.mes = p_month         THEN p.petroleo_bbl_dia END) AS oil_curr,
      SUM(CASE WHEN p.ano = v_prev_month_y AND p.mes = v_prev_month_m  THEN p.petroleo_bbl_dia END) AS oil_prevm,
      SUM(CASE WHEN p.ano = v_prev_year_y  AND p.mes = v_prev_year_m   THEN p.petroleo_bbl_dia END) AS oil_prevy,
      -- ytd_avg: average of (sum-per-month) across months 1..p_month of p_year
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
  -- Stable ordering for top-3 rows by current-month oil DESC.
  brazil_top3_ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY oil_curr DESC NULLS LAST) AS rk
      FROM brazil_top3_data
  ),

  -- ── (D) Company section: stake-weighted oil per ambiente, 4 slices ───────
  company_per_ambiente AS (
    SELECT
      m.ambiente AS local_raw,
      MAX(CASE WHEN m.ano = p_year         AND m.mes = p_month         THEN m.oil_bbl_dia END) AS oil_curr,
      MAX(CASE WHEN m.ano = v_prev_month_y AND m.mes = v_prev_month_m  THEN m.oil_bbl_dia END) AS oil_prevm,
      MAX(CASE WHEN m.ano = v_prev_year_y  AND m.mes = v_prev_year_m   THEN m.oil_bbl_dia END) AS oil_prevy,
      AVG(CASE WHEN m.ano = p_year         AND m.mes <= p_month        THEN m.oil_bbl_dia END) AS oil_ytd
    FROM (
      -- mv_production_monthly has canonical+ambiente grain; collapse to (ambiente, ano, mes)
      SELECT empresa, ano, mes, ambiente, SUM(oil_bbl_dia) AS oil_bbl_dia
        FROM mv_production_monthly
       WHERE empresa = p_empresa
       GROUP BY empresa, ano, mes, ambiente
    ) m
    WHERE (m.ano = p_year)
       OR (m.ano = v_prev_month_y AND m.mes = v_prev_month_m)
       OR (m.ano = v_prev_year_y  AND m.mes = v_prev_year_m)
    GROUP BY m.ambiente
  ),

  -- ── (E) Brazil Oil rows (total + 3 ambientes), values converted to kbpd ──
  -- All numeric outputs are explicit-cast to numeric to avoid double precision
  -- coercion (Postgres parses 6.29 as numeric but mixed-type AVG()/MAX() with
  -- the constant can drift to double; RETURNS TABLE requires numeric exactly).
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

  -- ── (F) Brazil Gas rows. Gas unit conversion: m³/d × 6.29 / 1000 = kboed.
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

  -- ── (G) Brazil Main fields rows (top 3 + total) ──────────────────────────
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

  -- ── (H) Company Oil rows ─────────────────────────────────────────────────
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

  -- ── (I) Stitch all rows ──────────────────────────────────────────────────
  all_rows AS (
    SELECT * FROM brazil_oil_total
    UNION ALL SELECT * FROM brazil_oil_rows
    UNION ALL SELECT * FROM brazil_gas_total
    UNION ALL SELECT * FROM brazil_gas_rows
    UNION ALL SELECT * FROM brazil_main_total
    UNION ALL SELECT * FROM brazil_main_rows
    UNION ALL SELECT * FROM company_oil_total
    UNION ALL SELECT * FROM company_oil_rows
  )

  -- ── (J) Final SELECT with MoM/YoY derived columns ────────────────────────
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
$$;

GRANT EXECUTE ON FUNCTION public.get_well_by_well_header(text, int, int) TO anon, authenticated;
