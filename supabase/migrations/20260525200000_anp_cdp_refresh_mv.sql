-- =============================================================================
-- Refresh mv_anp_cdp_pocos and validate it is in sync with anp_cdp_producao
-- =============================================================================
-- Context
-- -------
-- Workflow `etl_anp_cdp.yml` was stuck since 2026-05-23 (57/60 runs failed)
-- because the cross-local guard trigger (20260521130000) blocks INSERTs whose
-- (ano, mes, poco, campo, bacia, local) collides with an already-persisted
-- row that has a different `local`. ANP republished some Apr/2026 wells with
-- a different local than the one our quarantine migration (20260521120000)
-- chose, so the daily ETL re-upload aborts on the first such well.
--
-- Diagnostic (executed via MCP execute_sql against the remote project on
-- 2026-05-25):
--   * Last loaded period               = 2026-04 (4337.4 kbpd, 6846 wells)
--   * Cross-local duplicate rows now   = 0 (trigger is doing its job)
--   * mv_anp_cdp_pocos rows            = 29443
--   * distinct keys in anp_cdp_producao = 29443  -> MV is in sync today
--   * Quarantine table                  = 2076 rows (as expected from Phase A)
--
-- Therefore: no dedupe needed at the DB level. The fix that unblocks the ETL
-- belongs to scripts/pipelines/anp/cdp/02_upload.py (the parallel
-- worker_etl-pipelines frontend will teach the uploader to honor the trigger
-- by reconciling cross-local conflicts before INSERT).
--
-- What THIS migration does
-- ------------------------
-- 1. Refresh mv_anp_cdp_pocos (CONCURRENTLY, no read lock) so that downstream
--    `/anp-cdp-bsw` and `/anp-cdp-depletion` RPCs serve the freshest snapshot.
-- 2. Run a sanity check: |mv_anp_cdp_pocos| must equal the distinct natural
--    key count in anp_cdp_producao. If not, raise.
--
-- Idempotency
-- -----------
-- REFRESH MATERIALIZED VIEW CONCURRENTLY can be re-run any number of times.
-- The sanity check is read-only.
-- =============================================================================

-- NOTE: This migration intentionally has NO BEGIN/COMMIT around the REFRESH.
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY` cannot run inside a transaction
-- block (Postgres restriction). The Supabase migration runner executes each
-- statement in its own transaction when no BEGIN is present, which is what
-- we need here. The sanity check (DO block) runs in its own implicit tx.

-- ----- 1. Refresh the materialized view (non-blocking, CONCURRENTLY) -----
SELECT public.refresh_anp_cdp_pocos();

-- ----- 2. Sanity check: MV row count == distinct natural keys -----
DO $$
DECLARE
  mv_rows          bigint;
  prod_keys        bigint;
  prod_max_period  text;
BEGIN
  SELECT count(*) INTO mv_rows FROM public.mv_anp_cdp_pocos;
  SELECT count(*) INTO prod_keys FROM (
    SELECT DISTINCT poco, campo, bacia, local FROM public.anp_cdp_producao
  ) t;
  SELECT (max(ano)::text || '-' || lpad(max(mes)::text, 2, '0'))
    INTO prod_max_period
    FROM (
      SELECT ano, mes FROM public.anp_cdp_producao GROUP BY ano, mes
      ORDER BY ano DESC, mes DESC LIMIT 1
    ) t;

  RAISE NOTICE '[mv_anp_cdp_pocos refresh] mv_rows=% prod_keys=% last_loaded_period=%',
               mv_rows, prod_keys, prod_max_period;

  IF mv_rows <> prod_keys THEN
    RAISE EXCEPTION
      'mv_anp_cdp_pocos out of sync after refresh: mv_rows=% expected=%',
      mv_rows, prod_keys;
  END IF;
END $$;
