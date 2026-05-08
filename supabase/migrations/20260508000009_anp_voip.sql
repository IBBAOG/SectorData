-- ============================================================================
-- ANP VOIP (Volume Original In Place) — published annually by ANP in the
-- Boletim Anual de Reservas (BAR). One row per (ano_publicacao, campo).
-- Source: https://www.gov.br/anp/.../tabela-dados-bar-YYYY.xlsx
-- Populated by scripts/pipelines/anp/voip_sync.py (annual GHA on May 1st).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.anp_voip (
  ano_publicacao         int     NOT NULL,
  campo                  text    NOT NULL,
  bacia                  text,
  estado                 text,
  voip_bbl               float8,
  vgip_m3                float8,
  petroleo_acumulado_bbl float8,
  gas_acumulado_m3       float8,
  fracao_recuperada      float4,
  situacao               text,
  PRIMARY KEY (ano_publicacao, campo)
);

ALTER TABLE public.anp_voip ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read anp_voip"
  ON public.anp_voip
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_anp_voip_campo ON public.anp_voip (campo);
CREATE INDEX IF NOT EXISTS idx_anp_voip_ano   ON public.anp_voip (ano_publicacao DESC);
