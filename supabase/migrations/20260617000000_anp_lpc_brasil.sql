-- ANP published national ("BRASIL") weekly resale price.
--
-- This is the official volume-weighted national average pump price published
-- by ANP in the weekly "Levantamento de Preços" summary (sheet "BRASIL").
-- /diesel-gasoline-margins will consume this value directly as the pump price
-- instead of recomputing the national average from per-UF rows.
--
-- National-only, ~2 rows/week (one per product). Deliberately SEPARATE from
-- `anp_lpc` (per-UF, consumed by /anp-prices) to avoid polluting that
-- per-UF aggregation. Do NOT merge these two tables.
--
-- Step 1 of a chain: the ETL populates this next, and recompute_dg_margins
-- consumes it afterwards.

CREATE TABLE IF NOT EXISTS public.anp_lpc_brasil (
  data_fim       date    NOT NULL,                       -- week-end (Saturday) date — ANP "DATA FINAL"
  produto        text    NOT NULL,                        -- normalized: 'GASOLINA COMUM' | 'DIESEL S10'
  preco_revenda  numeric NOT NULL,                        -- ANP "PREÇO MÉDIO REVENDA", national (R$/L)
  n_postos       int,                                     -- ANP "NÚMERO DE POSTOS PESQUISADOS"
  fonte          text    DEFAULT 'ANP Levantamento de Preços — resumo_semanal_lpc (aba BRASIL)',
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT anp_lpc_brasil_pkey PRIMARY KEY (data_fim, produto)
);

-- Fast lookup by product over time (e.g. the diesel/gasoline series the recompute reads).
CREATE INDEX IF NOT EXISTS anp_lpc_brasil_produto_data_fim_idx
  ON public.anp_lpc_brasil (produto, data_fim);

-- RLS: authenticated may read; writes are service-role only (no public/anon write).
ALTER TABLE public.anp_lpc_brasil ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anp_lpc_brasil authenticated read" ON public.anp_lpc_brasil;
CREATE POLICY "anp_lpc_brasil authenticated read"
  ON public.anp_lpc_brasil
  FOR SELECT
  TO authenticated
  USING (true);
-- No INSERT/UPDATE/DELETE policies: only the service-role ETL writes (RLS bypass).
