-- Wave 2b: seed the FULL 2021+ history for the two reference tables that drive
-- recompute_dg_margins, so a full recompute reproduces the manual d_g_margins
-- tax/blend behavior across every week (1/2021 -> present).
--
-- (A) fuel_tax_reference: BACK-SOLVED from the manual d_g_margins (the curated
--     source of truth). For each fuel we detect contiguous step-periods of
--     (federal_tax, state_tax) along the time axis (gaps-and-islands, NOT a
--     plain GROUP BY which would merge non-adjacent equal values) and write:
--       * one PIS_PASEP row carrying the full federal_tax of the period
--         (Wave 1 convention: federal represented as a single PIS_PASEP line),
--       * one ICMS row carrying the period's state_tax.
--     vigente_desde = period start (Monday of the first ISO week of the period);
--     vigente_ate   = next period start - 1 day; the latest period is open-ended
--     (vigente_ate = NULL) so future weeks keep resolving. This makes
--     federal_tax/state_tax reproduce the manual EXACTLY; only base_fuel /
--     biofuel_component / margin are left to be recomputed.
--
-- (B) fuel_blend_ratio: full CNPE legislation timeline, REPLACING the partial
--     Wave-1 seed. Two periods were back-solved against the manual and OVERRIDE
--     the headline legislation %, because recompute computes
--       biofuel_component = blend_pct * AVG(B-100 producer price for the week)
--     and the manual's implied blend (manual.biofuel_component / that same
--     B-100 average) lands a full step below the legislated % in those windows:
--       * Diesel B 2024-03-01..2025-07-31: legislation B14 (0.14) but the manual
--         implies ~0.13 (median 0.130, modal 0.13 in 53/74 weeks) -> seed 0.13.
--       * Diesel B 2025-08-01..open:       legislation B15 (0.15) but the manual
--         implies ~0.142 (median 0.142, avg 0.143) -> seed 0.142.
--     The 0.10 and 0.12 periods independently validated the method (their implied
--     medians land exactly on the legislated value), so they keep the legislation %.
--
-- Both tables are wiped and re-seeded inside this single migration so there are
-- no overlaps/dupes with the Wave-1 partial seed.
--
-- NOTE: this migration does NOT touch recompute_dg_margins or get_dg_margins_*,
-- and does NOT run a recompute (a later step does, after the CEPEA backfill).

BEGIN;

-- =========================================================================
-- (A) fuel_tax_reference -- full back-solved timeline (replace Wave-1 seed)
-- =========================================================================
DELETE FROM public.fuel_tax_reference;

WITH base AS (
  SELECT
    fuel_type,
    to_date(week, 'IW/IYYY') AS wk_dt,   -- Monday of the manual's ISO week
    federal_tax,
    state_tax,
    row_number() OVER (PARTITION BY fuel_type ORDER BY to_date(week, 'IW/IYYY')) AS rn
  FROM public.d_g_margins
),
flagged AS (
  SELECT
    *,
    CASE
      WHEN federal_tax IS DISTINCT FROM lag(federal_tax) OVER w
        OR state_tax  IS DISTINCT FROM lag(state_tax)  OVER w
      THEN 1 ELSE 0
    END AS is_change
  FROM base
  WINDOW w AS (PARTITION BY fuel_type ORDER BY rn)
),
islands AS (
  SELECT
    *,
    sum(is_change) OVER (PARTITION BY fuel_type ORDER BY rn) AS island
  FROM flagged
),
periods AS (
  -- one contiguous period = one island; the (federal,state) pair is constant in it
  SELECT
    fuel_type,
    island,
    min(wk_dt)       AS period_start,
    max(federal_tax) AS federal_tax,
    max(state_tax)   AS state_tax
  FROM islands
  GROUP BY fuel_type, island
),
bounded AS (
  SELECT
    fuel_type,
    period_start                                                                   AS vigente_desde,
    (lead(period_start) OVER (PARTITION BY fuel_type ORDER BY period_start) - 1)    AS vigente_ate,
    federal_tax,
    state_tax
  FROM periods
)
INSERT INTO public.fuel_tax_reference (vigente_desde, vigente_ate, fuel_type, tax_type, rate_rs_litro, fonte)
SELECT vigente_desde, vigente_ate, fuel_type, 'PIS_PASEP', federal_tax,
       'derived from manual d_g_margins (curated step-values)'
FROM bounded
UNION ALL
SELECT vigente_desde, vigente_ate, fuel_type, 'ICMS', state_tax,
       'derived from manual d_g_margins (curated step-values)'
FROM bounded;

-- =========================================================================
-- (B) fuel_blend_ratio -- full legislation timeline (+back-solve overrides)
-- =========================================================================
DELETE FROM public.fuel_blend_ratio;

-- Ethanol blend in Gasoline C (E27 stable through 2025-07, E30 from 2025-08 / CNPE 09/2025).
INSERT INTO public.fuel_blend_ratio (vigente_desde, vigente_ate, fuel_type, blend_pct, fonte) VALUES
  ('2015-03-16', '2025-07-31', 'Gasoline C', 0.27, 'CNPE legislation timeline (E27)'),
  ('2025-08-01', NULL,         'Gasoline C', 0.30, 'CNPE legislation timeline (E30, CNPE 09/2025)');

-- Biodiesel blend in Diesel B (CNPE legislation timeline; two periods back-solved).
INSERT INTO public.fuel_blend_ratio (vigente_desde, vigente_ate, fuel_type, blend_pct, fonte) VALUES
  ('2020-03-01', '2021-04-30', 'Diesel B', 0.13,  'CNPE legislation timeline (B13)'),
  ('2021-05-01', '2021-08-31', 'Diesel B', 0.10,  'CNPE legislation timeline (B10)'),
  ('2021-09-01', '2021-10-31', 'Diesel B', 0.12,  'CNPE legislation timeline (B12)'),
  ('2021-11-01', '2023-03-31', 'Diesel B', 0.10,  'CNPE legislation timeline (B10) -- back-solve confirms (manual implied median 0.10)'),
  ('2023-04-01', '2024-02-29', 'Diesel B', 0.12,  'CNPE legislation timeline (B12) -- back-solve confirms (manual implied median 0.118)'),
  ('2024-03-01', '2025-07-31', 'Diesel B', 0.13,  'back-solved from manual: legislation is B14 (0.14) but manual implies ~0.13 (median 0.130, modal 0.13 in 53/74 weeks)'),
  ('2025-08-01', NULL,         'Diesel B', 0.142, 'back-solved from manual: legislation is B15 (0.15) but manual implies ~0.142 (median 0.142, avg 0.143)');

COMMIT;
