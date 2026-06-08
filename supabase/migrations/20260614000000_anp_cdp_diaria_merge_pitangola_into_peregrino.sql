-- ============================================================================
-- /anp-cdp-diaria — merge PITANGOLA into PEREGRINO via the canonical field map
--
-- Business rule (CEO): investors treat Peregrino = Peregrino + Pitangola. Both
-- carry the same PRIO working interest (80%) and sit in the same basin (Campos),
-- so they must surface as a SINGLE "Peregrino" series across the Field-level and
-- Company-level (stake-weighted net) surfaces of the daily-production dashboard.
--
-- Mechanism reused (built for /well-by-well, migration 20260528300000):
--   public.canonical_field_name(text)  +  public.field_canonical_names(variant PK)
--   A row ('PITANGOLA','PEREGRINO','manual') makes canonical_field_name('PITANGOLA')
--   return 'PEREGRINO'; canonical_field_name('PEREGRINO') stays 'PEREGRINO'
--   (idempotent — the manual-override branch returns the variant's own canonical).
--
-- This is a relabel-AND-aggregate change: anp_cdp_diaria has SEPARATE PEREGRINO
-- and PITANGOLA rows per day, so the field/company series RPCs must SUM by the
-- canonical field name (a bare relabel would emit two rows both named PEREGRINO).
--
-- Confirmed against live data (2026-06-08):
--   * Raw campo strings are exactly 'PEREGRINO' and 'PITANGOLA' (no accents /
--     casing / trailing-space variants) in BOTH anp_cdp_diaria and field_stakes.
--   * Both fields share bacia = 'Campos'  -> GROUP BY can keep bacia directly.
--   * field_stakes: PRIO holds 80% of BOTH PEREGRINO and PITANGOLA (Equinor holds
--     the other 20% of both) -> for a given company they fall in ONE stake group,
--     so the merge is clean (no MAX(stake_pct) fudge needed).
--
-- Granularity scope: the merge is FIELD-scoped. The installation- and well-level
-- RPCs (get_anp_cdp_diaria_instalacao_*, get_anp_cdp_diaria_poco_*) key on
-- installation / well, not field, and are intentionally LEFT UNTOUCHED. The
-- export-size oracle (get_anp_cdp_diaria_export_count) and the dead eligible-
-- companies counter (get_anp_cdp_diaria_empresas, no longer consumed by the
-- frontend) are also left untouched.
--
-- Pegadinha #18: anp_cdp_diaria has RLS granting SELECT only to `authenticated`.
-- Every RPC below is recreated with SECURITY DEFINER + SET search_path so anon
-- callers (the dashboard runs on the anon key) keep getting rows. CREATE OR
-- REPLACE preserves grants on functions whose signature is unchanged; all four
-- here keep their EXACT signature, so the existing GRANT ... TO anon, authenticated
-- carries over. We re-issue the grants anyway as belt-and-suspenders.
--
-- External-contract column names (campo, bacia, petroleo_bbl_dia, gas_mm3_dia,
-- stake_pct) stay in Portuguese — they are existing return-column contracts.
-- ============================================================================

-- ── (1) Seed the canonical override (idempotent) ────────────────────────────
-- variant is the PK; ON CONFLICT keeps this migration replayable.
INSERT INTO public.field_canonical_names (variant, canonical, source)
VALUES ('PITANGOLA', 'PEREGRINO', 'manual')
ON CONFLICT (variant) DO UPDATE
  SET canonical = EXCLUDED.canonical,
      source    = EXCLUDED.source;

-- ── (2a) Field-level filtros — return the CANONICAL field list ──────────────
-- Same JSONB shape/signature. The campos list now shows 'PEREGRINO' once and no
-- 'PITANGOLA'. bacias and date bounds are unchanged.
CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_filtros()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'campos', (
            SELECT COALESCE(
                     jsonb_agg(c ORDER BY c),
                     '[]'::jsonb)
            FROM (
                SELECT DISTINCT public.canonical_field_name(campo) AS c
                FROM public.anp_cdp_diaria
            ) q
        ),
        'bacias', (
            SELECT COALESCE(jsonb_agg(DISTINCT bacia ORDER BY bacia), '[]'::jsonb)
            FROM public.anp_cdp_diaria
        ),
        'data_min', (SELECT MIN(data) FROM public.anp_cdp_diaria),
        'data_max', (SELECT MAX(data) FROM public.anp_cdp_diaria)
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_filtros()
    TO anon, authenticated;

-- ── (2b) Field-level serie — merge by canonical field (SUM) ─────────────────
-- Same signature (p_campos, p_bacias, p_data_inicio, p_data_fim). Returns one
-- row per (data, canonical campo, bacia) with the gross volumes SUMMED across
-- raw variants. The p_campos filter matches on the CANONICAL name, so selecting
-- 'PEREGRINO' pulls BOTH raw PEREGRINO and PITANGOLA rows. PEREGRINO/PITANGOLA
-- share bacia 'Campos', so grouping by bacia is exact (no representative pick
-- needed); any other field is a single variant and is unaffected.
CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_serie(
    p_campos       text[]  DEFAULT NULL,
    p_bacias       text[]  DEFAULT NULL,
    p_data_inicio  date    DEFAULT NULL,
    p_data_fim     date    DEFAULT NULL
)
RETURNS TABLE(
    data             DATE,
    campo            TEXT,
    bacia            TEXT,
    petroleo_bbl_dia REAL,
    gas_mm3_dia      REAL
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        d.data,
        public.canonical_field_name(d.campo)        AS campo,
        d.bacia,
        SUM(d.petroleo_bbl_dia)::real               AS petroleo_bbl_dia,
        SUM(d.gas_mm3_dia)::real                     AS gas_mm3_dia
    FROM public.anp_cdp_diaria d
    WHERE
        (p_campos IS NULL OR public.canonical_field_name(d.campo) = ANY(p_campos))
        AND (p_bacias IS NULL OR d.bacia = ANY(p_bacias))
        AND (p_data_inicio IS NULL OR d.data >= p_data_inicio)
        AND (p_data_fim    IS NULL OR d.data <= p_data_fim)
    GROUP BY d.data, public.canonical_field_name(d.campo), d.bacia
    ORDER BY d.data ASC, public.canonical_field_name(d.campo) ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_serie(text[], text[], date, date)
    TO anon, authenticated;

-- ── (3a) Company-level serie — merge by canonical field (SUM gross + net) ───
-- Same signature (p_empresa, p_data_inicio, p_data_fim). One row per
-- (data, canonical campo). Gross AND net are summed across raw variants; the net
-- stays = gross * stake / 100 summed (equivalent to SUM(net) because both raw
-- variants share the company's stake). PEREGRINO/PITANGOLA share bacia 'Campos'
-- AND the company's stake_pct (PRIO 80% for both), so they collapse into a single
-- group cleanly; GROUP BY keeps fs.stake_pct for the label.
CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_empresa_serie(
  p_empresa      text,
  p_data_inicio  date DEFAULT NULL,
  p_data_fim     date DEFAULT NULL
)
RETURNS TABLE (
  data                  date,
  campo                 text,
  bacia                 text,
  stake_pct             numeric,
  petroleo_bbl_dia      real,     -- field gross oil (summed across canonical variants)
  gas_mm3_dia           real,     -- field gross gas (summed across canonical variants)
  petroleo_bbl_dia_net  numeric,  -- SUM(gross oil * stake_pct / 100)
  gas_mm3_dia_net       numeric   -- SUM(gross gas * stake_pct / 100)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    d.data,
    public.canonical_field_name(d.campo)                       AS campo,
    d.bacia,
    fs.stake_pct,
    SUM(d.petroleo_bbl_dia)::real                              AS petroleo_bbl_dia,
    SUM(d.gas_mm3_dia)::real                                   AS gas_mm3_dia,
    SUM(d.petroleo_bbl_dia::numeric * fs.stake_pct / 100)      AS petroleo_bbl_dia_net,
    SUM(d.gas_mm3_dia::numeric      * fs.stake_pct / 100)      AS gas_mm3_dia_net
  FROM field_stakes fs
  JOIN anp_cdp_diaria d ON d.campo = fs.campo
  WHERE fs.empresa = p_empresa
    AND (p_data_inicio IS NULL OR d.data >= p_data_inicio)
    AND (p_data_fim    IS NULL OR d.data <= p_data_fim)
  GROUP BY d.data, public.canonical_field_name(d.campo), d.bacia, fs.stake_pct
  ORDER BY d.data, public.canonical_field_name(d.campo);
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_empresa_serie(text, date, date)
  TO anon, authenticated;

-- ── (3b) Company-level field coverage — canonical fields (merge PITANGOLA) ──
-- Same signature (p_empresa). The stake-coverage list now reports 'PEREGRINO'
-- once (no separate 'PITANGOLA'). has_daily_data is OR-ed across raw variants:
-- the canonical field has daily data if ANY of its variants does. stake_pct is
-- MAX across variants (here identical, 80%, so MAX is exact). This keeps the
-- "Not yet in the daily feed: ..." note and the field count consistent with the
-- merged series.
CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_empresa_campos(
  p_empresa text
)
RETURNS TABLE (
  campo            text,
  stake_pct        numeric,
  has_daily_data   boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.canonical_field_name(fs.campo)                          AS campo,
    MAX(fs.stake_pct)                                              AS stake_pct,
    bool_or(
      EXISTS (SELECT 1 FROM anp_cdp_diaria d WHERE d.campo = fs.campo)
    )                                                              AS has_daily_data
  FROM field_stakes fs
  WHERE fs.empresa = p_empresa
  GROUP BY public.canonical_field_name(fs.campo)
  ORDER BY has_daily_data DESC, MAX(fs.stake_pct) DESC, public.canonical_field_name(fs.campo);
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_empresa_campos(text)
  TO anon, authenticated;
