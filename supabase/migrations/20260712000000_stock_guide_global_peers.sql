-- /stock-guide "Global Peers" read-only table (global oil-major peer multiples).
--
-- Source: analyst Excel data/majors_table.xlsx, sheet "Live" (Visible Alpha),
-- refreshed periodically and re-uploaded from the Admin Panel (browser-parsed via
-- ExcelJS, chunk-free — only ~14 rows). Mirrors the scenario-grid admin pattern
-- (admin_replace_stock_guide_scenario_grid, 20260619100000) but unchunked.
--
-- RLS ENABLED, NO policies — same as the other stock_guide_* tables; all reads go
-- through the hide-unaware SECURITY DEFINER RPC get_stock_guide_global_peers().
-- Div yields are stored as fractions (e.g. 0.0554 = 5.54%).
-- The Petrobras row is a live placeholder (is_live=true, numeric cols NULL); the
-- frontend fills its values live from the PETR4 comps.

-- ============================================================================
-- Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.stock_guide_global_peers (
  company        text PRIMARY KEY,
  pe_y1          numeric,
  pe_y2          numeric,
  ev_ebitda_y1   numeric,
  ev_ebitda_y2   numeric,
  div_yield_y1   numeric,
  div_yield_y2   numeric,
  is_aggregate   boolean NOT NULL DEFAULT false,
  is_live        boolean NOT NULL DEFAULT false,
  display_order  int     NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_guide_global_peers ENABLE ROW LEVEL SECURITY;
-- No policies by design: anon/authenticated cannot read directly; reads go via the
-- SECURITY DEFINER RPC below.

-- ============================================================================
-- RPC (public read): get_stock_guide_global_peers
--   All columns, ordered by display_order. No hide-aware logic (global peers).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_stock_guide_global_peers()
  RETURNS TABLE (
    company       text,
    pe_y1         numeric,
    pe_y2         numeric,
    ev_ebitda_y1  numeric,
    ev_ebitda_y2  numeric,
    div_yield_y1  numeric,
    div_yield_y2  numeric,
    is_aggregate  boolean,
    is_live       boolean,
    display_order int
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT
    g.company,
    g.pe_y1,
    g.pe_y2,
    g.ev_ebitda_y1,
    g.ev_ebitda_y2,
    g.div_yield_y1,
    g.div_yield_y2,
    g.is_aggregate,
    g.is_live,
    g.display_order
  FROM public.stock_guide_global_peers g
  ORDER BY g.display_order;
$$;

-- ============================================================================
-- RPC (admin write): admin_replace_stock_guide_global_peers
--   Replace-total (unchunked): DELETE all rows then INSERT from a jsonb array.
--   Each element: { company, pe_y1, pe_y2, ev_ebitda_y1, ev_ebitda_y2,
--                   div_yield_y1, div_yield_y2, is_aggregate, is_live,
--                   display_order }
--   Numeric fields are NULLABLE (live/placeholder rows carry NULLs); only NaN is
--   rejected. company must be non-empty; the array must be non-empty.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_replace_stock_guide_global_peers(
  p_rows jsonb
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  DECLARE
    v_count   integer := 0;
    v_elem    jsonb;
    v_company text;
    v_pe1     numeric;
    v_pe2     numeric;
    v_ev1     numeric;
    v_ev2     numeric;
    v_dy1     numeric;
    v_dy2     numeric;
    v_order   int;
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof(p_rows) <> 'array' THEN
      RAISE EXCEPTION 'rows_must_be_array' USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(p_rows) = 0 THEN
      RAISE EXCEPTION 'rows_must_be_non_empty' USING ERRCODE = '22023';
    END IF;

    -- Replace-total.
    DELETE FROM public.stock_guide_global_peers;

    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
      v_company := NULLIF(trim(v_elem->>'company'), '');
      IF v_company IS NULL THEN
        RAISE EXCEPTION 'company_required in row %', v_elem USING ERRCODE = '22023';
      END IF;

      -- Nullable numerics; a missing/null key yields NULL (allowed).
      v_pe1 := (v_elem->>'pe_y1')::numeric;
      v_pe2 := (v_elem->>'pe_y2')::numeric;
      v_ev1 := (v_elem->>'ev_ebitda_y1')::numeric;
      v_ev2 := (v_elem->>'ev_ebitda_y2')::numeric;
      v_dy1 := (v_elem->>'div_yield_y1')::numeric;
      v_dy2 := (v_elem->>'div_yield_y2')::numeric;

      -- Reject NaN (PG: NaN = NaN is TRUE, so compare to 'NaN'::numeric).
      IF v_pe1 = 'NaN'::numeric OR v_pe2 = 'NaN'::numeric
         OR v_ev1 = 'NaN'::numeric OR v_ev2 = 'NaN'::numeric
         OR v_dy1 = 'NaN'::numeric OR v_dy2 = 'NaN'::numeric THEN
        RAISE EXCEPTION 'nan_not_allowed in row %', v_elem USING ERRCODE = '22023';
      END IF;

      v_order := (v_elem->>'display_order')::int;
      IF v_order IS NULL THEN
        RAISE EXCEPTION 'display_order_required in row %', v_elem USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.stock_guide_global_peers
        (company, pe_y1, pe_y2, ev_ebitda_y1, ev_ebitda_y2,
         div_yield_y1, div_yield_y2, is_aggregate, is_live, display_order, updated_at)
      VALUES
        (v_company, v_pe1, v_pe2, v_ev1, v_ev2,
         v_dy1, v_dy2,
         COALESCE((v_elem->>'is_aggregate')::boolean, false),
         COALESCE((v_elem->>'is_live')::boolean, false),
         v_order, now());

      v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
  END;
$$;

-- ============================================================================
-- Grants.
-- ============================================================================
REVOKE ALL ON FUNCTION public.get_stock_guide_global_peers()              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_replace_stock_guide_global_peers(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_stock_guide_global_peers()              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_replace_stock_guide_global_peers(jsonb) TO authenticated;

-- ============================================================================
-- Seed (current "Live" sheet snapshot).
-- ============================================================================
INSERT INTO public.stock_guide_global_peers
  (display_order, company, pe_y1, pe_y2, ev_ebitda_y1, ev_ebitda_y2,
   div_yield_y1, div_yield_y2, is_aggregate, is_live)
VALUES
  (1,  'BP',             7.814728706410639,  9.964682295209046,  3.6114929222056436, 3.749102577917019,  0.055371255016565826, 0.05817418831974118,  false, false),
  (2,  'Chevron',        13.128470368758832, 15.120656094680031, 6.568736695078525,  7.052070962276248,  0.0683646816908583,   0.078274946394058,    false, false),
  (3,  'ConocoPhillips', 11.743945401153159, 13.11892088673563,  5.150616373124356,  5.5345910356437376, 0.06651376704384687,  0.06523803201669187,  false, false),
  (4,  'ExxonMobil',     13.680468593916451, 14.457264546770764, 7.4819148420039285, 7.760021483514094,  0.05959992547557659,  0.05958957382013603,  false, false),
  (5,  'Shell',          8.34358503919202,   9.171401608833527,  4.103961020112259,  4.436041817659568,  0.08966806950651247,  0.08848487967660575,  false, false),
  (6,  'TotalEnergies',  7.5133465175070695, 8.783686697440903,  4.591444174173731,  5.185694701802586,  0.06988307189377946,  0.07790834973860199,  false, false),
  (7,  'Majors Avg.',    10.370757437823029, 11.769435354944983, 5.25136100444974,   5.619587096468876,  0.06823346177118991,  0.07127832832763914,  true,  false),
  (8,  'CNOOC',          6.590836179392273,  7.141063554490864,  3.083419143239094,  3.291045086048955,  0.05887079499996904,  0.06334918123421883,  false, false),
  (9,  'PetroChina',     8.416452606328704,  9.081378177698046,  4.502265989584196,  4.639185870901703,  0.06038895606361258,  0.0588630663698933,   false, false),
  (10, 'EcoPetrol',      7.26060761111069,   8.112998412087112,  3.9790417615032454, 4.404742009147951,  0.06136864231623466,  0.0747321707250138,   false, false),
  (11, 'YPF',            9.383629928672292,  7.658572098450203,  3.9804290070432553, 3.354019981958349,  0,                    0.016374581593418938, false, false),
  (12, 'Others Avg.',    8.25593838013901,   8.757855715852019,  4.231326846665544,  4.415712457721404,  0.05312415450746428,  0.060417612998131004, true,  false),
  (13, 'Petrobras',      NULL,               NULL,               NULL,               NULL,               NULL,                 NULL,                 false, true);
