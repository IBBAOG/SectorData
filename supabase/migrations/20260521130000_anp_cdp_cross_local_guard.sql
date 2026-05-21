-- =============================================================================
-- Guard against cross-local duplication in anp_cdp_producao
-- =============================================================================
-- Context: Apr/2026 incident (triplication) — same well published with
-- different `local` values (PosSal + PreSal + Terra) produced 3x rows because
-- the natural PK includes `local`. Dashboard SUMs them and overcounts.
--
-- Phase A (20260521120000_fix_anp_cdp_apr2026_triplication.sql) quarantined
-- 2,076 rows. Phase B1 added defenses in the Python pipeline. This (Phase B2)
-- is the last line of defense at the DB level: a BEFORE INSERT trigger that
-- makes the cross-local insert physically impossible.
--
-- Behavior:
-- * INSERT with same (ano, mes, poco, campo, bacia) but different `local`
--   than existing row -> raises exception (unique_violation).
-- * INSERT with same full PK (ano, mes, poco, campo, bacia, local) ->
--   ON CONFLICT in ETL still triggers UPDATE path; trigger does not run on
--   UPDATE, so existing ETL semantics are preserved.
-- * Legitimate reclassification (well moved PosSal -> PreSal): ETL must
--   DELETE the old row first. Trigger fails loudly with instructive message
--   if the caller forgets.
--
-- Performance:
-- * Existing PK `anp_cdp_producao_pkey` on (ano, mes, poco, campo, bacia, local)
--   indexes the 5-column natural key as a prefix; lookup is O(log n).
-- * No new index needed.
-- =============================================================================

BEGIN;

-- ----- 1. Trigger function -----
CREATE OR REPLACE FUNCTION public.fn_anp_cdp_guard_cross_local()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conflicting_local text;
BEGIN
  -- Only INSERT is guarded. UPDATE on the same PK is fine (ON CONFLICT path).
  -- If `local` itself changes via UPDATE, that's a PK column change and Postgres
  -- already disallows it cleanly under the PK constraint.
  IF TG_OP = 'INSERT' THEN
    SELECT local INTO conflicting_local
    FROM public.anp_cdp_producao
    WHERE ano = NEW.ano
      AND mes = NEW.mes
      AND poco = NEW.poco
      AND campo = NEW.campo
      AND bacia = NEW.bacia
      AND local <> NEW.local
    LIMIT 1;

    IF conflicting_local IS NOT NULL THEN
      RAISE EXCEPTION
        'Cross-local duplicate blocked: (ano=%, mes=%, poco=%, campo=%, bacia=%) already exists with local=%. New insert would add local=%. For legitimate reclassification, DELETE the old row first.',
        NEW.ano, NEW.mes, NEW.poco, NEW.campo, NEW.bacia, conflicting_local, NEW.local
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.fn_anp_cdp_guard_cross_local IS
  'Prevents cross-local triplication in anp_cdp_producao (Apr/2026 incident defense). See migration 20260521130000_anp_cdp_cross_local_guard.sql.';

-- ----- 2. Attach trigger (BEFORE INSERT only) -----
DROP TRIGGER IF EXISTS trg_anp_cdp_guard_cross_local ON public.anp_cdp_producao;
CREATE TRIGGER trg_anp_cdp_guard_cross_local
  BEFORE INSERT ON public.anp_cdp_producao
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_anp_cdp_guard_cross_local();

-- ----- 3. Self-test (object existence + enabled state) -----
DO $$
DECLARE
  test_passed boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_anp_cdp_guard_cross_local'
      AND tgrelid = 'public.anp_cdp_producao'::regclass
      AND tgenabled <> 'D'  -- not disabled
  ) THEN
    test_passed := true;
  END IF;

  IF NOT test_passed THEN
    RAISE EXCEPTION 'Trigger trg_anp_cdp_guard_cross_local was not properly created/enabled';
  END IF;
  RAISE NOTICE '[OK] Trigger trg_anp_cdp_guard_cross_local installed and enabled';
END $$;

COMMIT;
