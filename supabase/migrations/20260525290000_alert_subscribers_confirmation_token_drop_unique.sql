-- ============================================================================
-- Bug fix: subscribe_to_alerts() generates ONE confirmation token per call
-- and writes it across all N source rows of that signup, so the user clicks
-- a single confirm link to activate every source they selected.
--
-- The column-level UNIQUE constraint on confirmation_token (defined in
-- 20260525210000) blocked the 2nd+ row INSERT whenever N>1, and could also
-- trip on retries when residual unconfirmed rows shared a token.
--
-- Observed failure (2026-05-25, production project rrrkgynlpqtmvuuqdjpb):
--   anon click /alerts subscribe with email 'eduardomendes07122@gmail.com'
--   and source ['price_bands'] returned
--   "duplicate key value violates unique constraint
--    alert_subscribers_confirmation_token_key".
--
-- The confirm_subscription() RPC explicitly handles shared tokens
--   (line: "a user can subscribe to multiple sources in one signup; they
--   share the same token") — so the UNIQUE constraint contradicts the
-- documented design.
--
-- Security: confirm_subscription() filters by
--   confirmation_token = p_token AND confirmation_expires_at > NOW()
-- which relies on 122-bit UUID entropy + a 48h expiry window, not on
-- column-level uniqueness. UUID collisions are astronomically improbable.
--
-- The partial index idx_alert_subscribers_confirmation_token (already
-- present from 20260525210000) covers the confirm-flow lookup path.
-- ============================================================================

ALTER TABLE public.alert_subscribers
  DROP CONSTRAINT IF EXISTS alert_subscribers_confirmation_token_key;

-- Ensure the lookup index is present (idempotent — already created in the
-- foundation migration; re-stated here in case of out-of-order replay).
CREATE INDEX IF NOT EXISTS idx_alert_subscribers_confirmation_token
  ON public.alert_subscribers (confirmation_token)
  WHERE confirmation_token IS NOT NULL;

COMMENT ON COLUMN public.alert_subscribers.confirmation_token IS
  'Shared across all rows of a single subscribe_to_alerts() call. NOT unique:
   one user signs up for N sources with one token; confirm_subscription
   confirms all N rows at once. Security: 122-bit UUID entropy +
   confirmation_expires_at time window.';
