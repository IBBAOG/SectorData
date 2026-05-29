-- Raise PostgREST db-max-rows cap from default (1000) to 50000.
--
-- WHY: /well-by-well CSV export paginates via RPCs that internally accept
-- p_limit, but PostgREST silently truncates every response to db_max_rows
-- (default 1000). With PAGE_SIZE=5000 on the frontend, the loop quit after
-- one page because 1000 < 5000, producing ~4000 total rows on a 2.2M dataset
-- and empty sheets where the first page happened to short-return.
--
-- WHAT: set the cap on the `authenticator` role so PostgREST (which logs in
-- as authenticator and then SET ROLE to anon/authenticated) sees the higher
-- cap regardless of the caller's effective role.
--
-- The NOTIFY reloads PostgREST config without a restart. Idempotent ALTER ROLE
-- means re-running this migration is a no-op.

ALTER ROLE authenticator SET pgrst.db_max_rows TO '50000';

NOTIFY pgrst, 'reload config';
