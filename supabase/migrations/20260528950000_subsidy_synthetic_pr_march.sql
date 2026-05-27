-- Synthesize daily reference price (PR) for inaugural subsidy period (Mar 12-31, 2026).
--
-- Rationale: MP 1.340/2026 fixed the subsidy at R$ 0.32/L for the inaugural period.
-- The standard PR-PC relationship is PC = PR - 0.32 (Decreto 12.878 art. 3o, paragrafo 1o).
-- ANP did not publish daily PR for this period in the format we scrape (HTML page
-- lists PDFs from 2nd period onwards). For uniformity in trigger cascade and chart
-- rendering, we synthesize PR = PC + 0.32 for each date x region x tipo_agente.
--
-- Effect: compute_subsidy_reimbursement('2026-03-XX', ...) returns 0.32 (capped at
-- the unified 0.32 cap vigente_desde 2026-03-13). price_bands._w_subsidy in March
-- becomes raw +/- 0.32 instead of raw (current fallback behavior).
--
-- Expected row count: 20 days x 5 regions x 2 agents = 200 rows.
-- Idempotent: ON CONFLICT DO NOTHING on PK (data_referencia, regiao, tipo_agente).

INSERT INTO public.anp_subsidy_diesel_reference
  (data_referencia, regiao, preco_referencia, tipo_agente, inserted_at)
SELECT
  d.dia::date AS data_referencia,
  c.regiao,
  (c.preco_comercializacao + 0.32)::numeric(10,4) AS preco_referencia,
  c.tipo_agente,
  now() AS inserted_at
FROM public.anp_subsidy_commercialization c
CROSS JOIN generate_series('2026-03-12'::date, '2026-03-31'::date, '1 day'::interval) AS d(dia)
WHERE c.data_inicio = '2026-03-12' AND c.data_fim = '2026-03-31'
ON CONFLICT (data_referencia, regiao, tipo_agente) DO NOTHING;

-- Force cascade: trigger recompute_pb_on_reference_change should fire per row above.
-- Belt-and-suspenders: re-trigger price_bands rows in March so _w_subsidy is recomputed
-- regardless of whether the per-row trigger fired during the INSERT above.
UPDATE public.price_bands SET date = date
WHERE product='Diesel' AND date BETWEEN '2026-03-12' AND '2026-03-31';
