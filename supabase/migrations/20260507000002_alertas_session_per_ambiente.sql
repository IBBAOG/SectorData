-- ─────────────────────────────────────────────────────────────────────────────
-- 20260507000002_alertas_session_per_ambiente.sql
--
-- Mudança de PK de `alertas_session`: de (base) para (base, ambiente).
-- Motivação: ANP CDP exige Buscar separado por ambiente (Mar/Pré-Sal/Terra),
-- e cada Buscar gera uma session APEX distinta (FILE_ID e p_instance únicos).
-- Sem ambiente no PK, o último ambiente capturado sobrescrevia os 2 anteriores
-- e o alerter rodava replay para 3 ambientes contra a mesma session — baixando
-- dados do ambiente errado.
--
-- Idempotente. Bases que não usam ambiente (sem CDP por enquanto) ficam com
-- ambiente='_' por default.
--
-- Owner: worker_supabase
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Adicionar coluna ambiente
ALTER TABLE public.alertas_session
  ADD COLUMN IF NOT EXISTS ambiente text;

-- 2. Backfill: extrair ambiente de metadata.captured_ambiente (ou session.captured_ambiente)
UPDATE public.alertas_session
SET ambiente = COALESCE(
  metadata->>'captured_ambiente',
  (session->>'captured_ambiente'),
  '_'
)
WHERE ambiente IS NULL;

-- 3. NOT NULL + default para futuras bases sem ambiente
ALTER TABLE public.alertas_session
  ALTER COLUMN ambiente SET NOT NULL,
  ALTER COLUMN ambiente SET DEFAULT '_';

-- 4. Trocar PK para (base, ambiente)
ALTER TABLE public.alertas_session DROP CONSTRAINT IF EXISTS alertas_session_pkey;
ALTER TABLE public.alertas_session ADD PRIMARY KEY (base, ambiente);
