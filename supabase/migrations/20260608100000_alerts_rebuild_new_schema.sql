-- ============================================================================
-- Alerts Rebuild — Phase 1b: clean logged-in-only schema, RPCs, seed
--
-- The new alerts product is LOGGED-IN ONLY:
--   * No anon signup, no double opt-in, no confirmation tokens, no per-IP
--     rate limiting. A subscription is owned by an auth.users row; the email
--     is resolved from auth.users at send time (never stored on the sub).
--   * The only anon-callable write is unsubscribe_by_token (email footer link).
--
-- Objects created here:
--   Tables: alert_sources, alert_subscriptions, alert_events, alert_outbox,
--           alert_email_log, alert_source_state.
--   RPCs:   service/internal (alerts_current_period, alerts_active_recipients),
--           client (list_subscribable_bases, set_my_subscription[s],
--           set_my_subscription_cadence, list_my_subscriptions,
--           list_my_recent_alerts), anon-safe (unsubscribe_by_token),
--           admin (admin_alerts_*).
--   Seed:   22 alert_sources rows (21 active + anp_subsidy_caps inactive).
--   module_visibility('alerts') -> clients=true, public=false.
--
-- All public RPCs are SECURITY DEFINER + pinned search_path (Pegadinha #18).
-- All auth.uid() in RLS is wrapped (select auth.uid()) (Pegadinha #8 / Hardening A).
-- ============================================================================

-- ============================================================================
-- SECTION 1 — TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- alert_sources — catalog of subscribable bases
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alert_sources (
  source_slug    TEXT PRIMARY KEY,
  category       TEXT NOT NULL CHECK (category IN ('Fuel Distribution','Oil & Gas','Vessels','Proprietary')),
  display_name   TEXT NOT NULL,
  description    TEXT,
  frequency_hint TEXT,
  cadence        TEXT NOT NULL DEFAULT 'immediate' CHECK (cadence IN ('immediate','digest')),
  period_kind    TEXT NOT NULL CHECK (period_kind IN ('month','date','iso_week','window_end','year','timestamp')),
  period_table   TEXT NOT NULL,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_sources ENABLE ROW LEVEL SECURITY;

-- Logged-in product: any authenticated user can read the catalog.
DROP POLICY IF EXISTS alert_sources_select_auth ON public.alert_sources;
CREATE POLICY alert_sources_select_auth ON public.alert_sources
  FOR SELECT TO authenticated
  USING (true);

-- Only admins may mutate the catalog.
DROP POLICY IF EXISTS alert_sources_write_admin ON public.alert_sources;
CREATE POLICY alert_sources_write_admin ON public.alert_sources
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- alert_subscriptions — per-user opt-in (email resolved from auth.users at send)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alert_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_slug       TEXT NOT NULL REFERENCES public.alert_sources(source_slug) ON DELETE CASCADE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  cadence_override  TEXT NULL CHECK (cadence_override IN ('immediate','digest')),
  unsubscribe_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_alert_subscriptions_user_source UNIQUE (user_id, source_slug)
);

ALTER TABLE public.alert_subscriptions ENABLE ROW LEVEL SECURITY;

-- Client reads/writes only their own rows; wrapped auth.uid() per Hardening A.
DROP POLICY IF EXISTS alert_subscriptions_select_self ON public.alert_subscriptions;
CREATE POLICY alert_subscriptions_select_self ON public.alert_subscriptions
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS alert_subscriptions_insert_self ON public.alert_subscriptions;
CREATE POLICY alert_subscriptions_insert_self ON public.alert_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS alert_subscriptions_update_self ON public.alert_subscriptions;
CREATE POLICY alert_subscriptions_update_self ON public.alert_subscriptions
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS alert_subscriptions_delete_self ON public.alert_subscriptions;
CREATE POLICY alert_subscriptions_delete_self ON public.alert_subscriptions
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- Admins manage every subscription.
DROP POLICY IF EXISTS alert_subscriptions_admin_all ON public.alert_subscriptions;
CREATE POLICY alert_subscriptions_admin_all ON public.alert_subscriptions
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- alert_events — one row per detected base update (deduped by source+key)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alert_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug TEXT NOT NULL REFERENCES public.alert_sources(source_slug) ON DELETE CASCADE,
  event_key   TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_alert_events_source_key UNIQUE (source_slug, event_key)
);

ALTER TABLE public.alert_events ENABLE ROW LEVEL SECURITY;

-- Admin SELECT only. INSERT is service_role (bypasses RLS) — no authenticated/anon policy.
DROP POLICY IF EXISTS alert_events_select_admin ON public.alert_events;
CREATE POLICY alert_events_select_admin ON public.alert_events
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- alert_outbox — fanout of events to subscriptions (one per subscriber/event)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alert_outbox (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id     UUID NOT NULL REFERENCES public.alert_subscriptions(id) ON DELETE CASCADE,
  event_id            UUID NOT NULL REFERENCES public.alert_events(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','skipped')),
  send_attempts       SMALLINT NOT NULL DEFAULT 0,
  last_attempt_at     TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  provider_message_id TEXT,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_alert_outbox_sub_event UNIQUE (subscription_id, event_id)
);

ALTER TABLE public.alert_outbox ENABLE ROW LEVEL SECURITY;

-- Admin sees everything.
DROP POLICY IF EXISTS alert_outbox_select_admin ON public.alert_outbox;
CREATE POLICY alert_outbox_select_admin ON public.alert_outbox
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Self sees its own deliveries via the owning subscription.
DROP POLICY IF EXISTS alert_outbox_select_self ON public.alert_outbox;
CREATE POLICY alert_outbox_select_self ON public.alert_outbox
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.alert_subscriptions s
    WHERE s.id = alert_outbox.subscription_id
      AND s.user_id = (select auth.uid())
  ));

-- ----------------------------------------------------------------------------
-- alert_email_log — provider send audit
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alert_email_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id           UUID REFERENCES public.alert_outbox(id) ON DELETE SET NULL,
  email               TEXT,
  subject             TEXT,
  status              TEXT,
  provider_message_id TEXT,
  provider_response   JSONB,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alert_email_log_select_admin ON public.alert_email_log;
CREATE POLICY alert_email_log_select_admin ON public.alert_email_log
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- alert_source_state — last period processed per source (service-role bookkeeping)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alert_source_state (
  source_slug     TEXT PRIMARY KEY REFERENCES public.alert_sources(source_slug) ON DELETE CASCADE,
  last_period_key TEXT,
  last_event_id   UUID REFERENCES public.alert_events(id) ON DELETE SET NULL,
  last_alerted_at TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_source_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alert_source_state_select_admin ON public.alert_source_state;
CREATE POLICY alert_source_state_select_admin ON public.alert_source_state
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_source_active
  ON public.alert_subscriptions (source_slug, is_active);
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_user
  ON public.alert_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_alert_outbox_queued
  ON public.alert_outbox (status) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_alert_events_source_detected
  ON public.alert_events (source_slug, detected_at DESC);

-- ============================================================================
-- SECTION 2 — SEED alert_sources (22 rows; 21 active + anp_subsidy_caps inactive)
-- ============================================================================
INSERT INTO public.alert_sources
  (source_slug, category, display_name, description, frequency_hint, cadence, period_kind, period_table, metadata, is_active)
VALUES
  -- Fuel Distribution
  ('vendas','Fuel Distribution','ANP Monthly Fuel Sales',
     'ANP''s official monthly fuel sales data by distributor, product, segment, region, and UF. Updated when ANP publishes the prior month''s bulletin.',
     'Monthly','immediate','date','vendas',
     jsonb_build_object('frontend_route','/market-share'),TRUE),
  ('anp_glp','Fuel Distribution','ANP LPG Sales (P13 / Others)',
     'Monthly LPG (P13, commercial, industrial) distribution volumes by distributor. Published alongside ANP producer prices.',
     'Monthly','immediate','month','anp_glp',
     jsonb_build_object('frontend_route','/anp-glp'),TRUE),
  ('anp_precos_produtores','Fuel Distribution','ANP Producer Prices',
     'Weekly producer-level fuel prices published by ANP. Covers diesel, gasoline, ethanol, LPG, and other products at the refinery/producer level.',
     'Weekly (Mon)','immediate','window_end','anp_precos_produtores',
     jsonb_build_object('frontend_route','/anp-prices'),TRUE),
  ('anp_lpc','Fuel Distribution','ANP Retail Fuel Prices (LPC)',
     'Weekly ANP retail-level pump prices (Levantamento de Preços ao Consumidor) by municipality, product, and fuel station count.',
     'Weekly (Wed)','immediate','window_end','anp_lpc',
     jsonb_build_object('frontend_route','/anp-prices'),TRUE),
  ('anp_precos_distribuicao','Fuel Distribution','ANP Distribution Prices',
     'Monthly ANP distribution prices by distributor, product, and UF. Published around the 5th of each month and also updated weekly.',
     'Monthly','immediate','date','anp_precos_distribuicao',
     jsonb_build_object('frontend_route','/anp-prices'),TRUE),
  ('anp_daie','Fuel Distribution','ANP Imports/Exports (DAIE)',
     'Monthly ANP fuel import/export volumes (DAIE) by product and operation, feeding the Imports & Exports dashboard.',
     'Monthly','immediate','month','anp_daie',
     jsonb_build_object('frontend_route','/imports-exports'),TRUE),
  ('anp_desembaracos','Fuel Distribution','ANP Customs Clearances',
     'Monthly ANP fuel customs clearance records enriched with importer name, CNPJ, and UF, feeding the Imports & Exports dashboard.',
     'Monthly','immediate','month','anp_desembaracos',
     jsonb_build_object('frontend_route','/imports-exports'),TRUE),
  ('mdic_comex','Fuel Distribution','MDIC Comex Trade (fuel NCMs)',
     'Brazil''s foreign trade statistics from MDIC Comex Stat, filtered to fuel NCMs. Feeds the Imports & Exports unit-price chart and price summary tables.',
     'Daily','immediate','month','mdic_comex',
     jsonb_build_object('frontend_route','/imports-exports'),TRUE),
  -- Oil & Gas
  ('anp_cdp_producao','Oil & Gas','ANP Monthly Well Production',
     'Monthly per-well oil, gas, and water production from ANP''s APEX CDP portal, scraped via Selenium and a CAPTCHA solver.',
     'Monthly','immediate','month','anp_cdp_producao',
     jsonb_build_object('frontend_route','/well-by-well'),TRUE),
  ('anp_cdp_diaria','Oil & Gas','ANP Daily Production (field)',
     'Field-level daily oil and gas production from ANP''s Power BI public API.',
     'Daily','digest','date','anp_cdp_diaria',
     jsonb_build_object('frontend_route','/anp-cdp-diaria'),TRUE),
  ('anp_cdp_diaria_instalacao','Oil & Gas','ANP Daily Production (installation)',
     'Installation-level daily oil and gas production from ANP''s Power BI public API.',
     'Daily','digest','date','anp_cdp_diaria_instalacao',
     jsonb_build_object('frontend_route','/anp-cdp-diaria'),TRUE),
  ('anp_cdp_diaria_poco','Oil & Gas','ANP Daily Production (well)',
     'Well-level daily oil and gas production from ANP''s Power BI public API.',
     'Daily','digest','date','anp_cdp_diaria_poco',
     jsonb_build_object('frontend_route','/anp-cdp-diaria'),TRUE),
  ('anp_voip','Oil & Gas','ANP VOIP Reserves',
     'Annual ANP Volume of Oil Initially in Place (VOIP) and recovered fraction by field and basin. Published once per year in May.',
     'Annual','immediate','year','anp_voip',
     jsonb_build_object('frontend_route','/anp-cdp-bsw'),TRUE),
  -- Vessels (all digest, timestamp period)
  ('navios_diesel','Vessels','Diesel Vessel Lineup',
     'Scheduled diesel import line-ups at Brazilian fuel ports, scraped from Porto de Itaqui and partner port systems.',
     'Every 6h','digest','timestamp','navios_diesel',
     jsonb_build_object('frontend_route','/navios-diesel'),TRUE),
  ('vessel_positions','Vessels','AIS Vessel Positions',
     'Real-time AIS vessel positions streamed via the AISStream WebSocket and persisted for port-call and import-candidate analysis.',
     'Every 6h','digest','timestamp','vessel_positions',
     jsonb_build_object('frontend_route','/navios-diesel'),TRUE),
  ('port_arrivals','Vessels','Port Arrivals',
     'Port arrival events derived from AIS positions via geofence detection at Brazilian fuel ports.',
     'Every 6h','digest','timestamp','port_arrivals',
     jsonb_build_object('frontend_route','/navios-diesel'),TRUE),
  ('import_candidates','Vessels','Diesel Import Candidates',
     'Global vessels scored (0–100) as likely diesel imports to Brazil, derived from AIS movement patterns.',
     'Every 4h','digest','timestamp','import_candidates',
     jsonb_build_object('frontend_route','/navios-diesel'),TRUE),
  -- Proprietary
  ('d_g_margins','Proprietary','Diesel & Gasoline Margins',
     'Weekly diesel and gasoline margin breakdown by component (base fuel, biofuel, federal tax, state tax, distribution and resale margin). Maintained as an Excel workbook.',
     'Weekly (Mon)','immediate','iso_week','d_g_margins',
     jsonb_build_object('frontend_route','/diesel-gasoline-margins'),TRUE),
  ('price_bands','Proprietary','Price Bands (Parity)',
     'Petrobras and parity-derived price bands by fuel type, including import parity, export parity, and subsidy-adjusted variants. Manual Excel upload.',
     'Ad-hoc','immediate','date','price_bands',
     jsonb_build_object('frontend_route','/price-bands'),TRUE),
  ('anp_subsidy_diesel_reference','Proprietary','Diesel Subsidy — Reference Price',
     'ANP diesel subsidy reference prices (PDRR) by region, used to compute per-region reimbursement under the subsidy framework.',
     'Daily','immediate','date','anp_subsidy_diesel_reference',
     jsonb_build_object('frontend_route','/subsidy-tracker'),TRUE),
  ('anp_subsidy_commercialization','Proprietary','Diesel Subsidy — Commercialization',
     'Commercialization prices by period, region, and agent type (importador/produtor), scraped from the ANP subsidy HTML page.',
     'Daily','immediate','date','anp_subsidy_commercialization',
     jsonb_build_object('frontend_route','/subsidy-tracker'),TRUE),
  -- Proprietary — admin-edited, no clean trigger yet -> inactive at launch
  ('anp_subsidy_caps','Proprietary','Diesel Subsidy — Caps',
     'Historical subsidy cap rates (BRL/L) by agent type (importador/produtor). Admin-edited when ANP revises the cap policy.',
     'Ad-hoc','immediate','timestamp','anp_subsidy_caps',
     jsonb_build_object('frontend_route','/subsidy-tracker'),FALSE)
ON CONFLICT (source_slug) DO NOTHING;

-- ============================================================================
-- SECTION 3 — RPCs
-- ============================================================================

-- ----------------------------------------------------------------------------
-- alerts_current_period(source_slug) -> TEXT
--   Returns the current, lexicographically-sortable period key for a base.
--   Logic ported verbatim from get_data_sources_freshness
--   (20260527300000_data_sources_freshness_subsidy_fix.sql), mapped by
--   period_kind. NULL if the source is unknown or its table is empty.
--   smallint ano/mes columns are cast to int for make_date.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alerts_current_period(p_source_slug TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key TEXT;
BEGIN
  CASE p_source_slug
    -- ---- Fuel Distribution ----
    WHEN 'vendas' THEN
      SELECT to_char(MAX(date), 'YYYY-MM-DD') INTO v_key FROM public.vendas;
    WHEN 'anp_glp' THEN
      SELECT to_char(MAX(make_date(ano::int, mes::int, 1)), 'YYYY-MM') INTO v_key FROM public.anp_glp;
    WHEN 'anp_precos_produtores' THEN
      SELECT to_char(MAX(data_fim), 'YYYY-MM-DD') INTO v_key FROM public.anp_precos_produtores;
    WHEN 'anp_lpc' THEN
      SELECT to_char(MAX(data_fim), 'YYYY-MM-DD') INTO v_key FROM public.anp_lpc;
    WHEN 'anp_precos_distribuicao' THEN
      SELECT to_char(MAX(data_referencia), 'YYYY-MM-DD') INTO v_key FROM public.anp_precos_distribuicao;
    WHEN 'anp_daie' THEN
      SELECT to_char(MAX(make_date(ano::int, mes::int, 1)), 'YYYY-MM') INTO v_key FROM public.anp_daie;
    WHEN 'anp_desembaracos' THEN
      SELECT to_char(MAX(make_date(ano::int, mes::int, 1)), 'YYYY-MM') INTO v_key FROM public.anp_desembaracos;
    WHEN 'mdic_comex' THEN
      SELECT to_char(MAX(make_date(ano::int, mes::int, 1)), 'YYYY-MM') INTO v_key FROM public.mdic_comex;
    -- ---- Oil & Gas ----
    WHEN 'anp_cdp_producao' THEN
      SELECT to_char(MAX(make_date(ano::int, mes::int, 1)), 'YYYY-MM') INTO v_key FROM public.anp_cdp_producao;
    WHEN 'anp_cdp_diaria' THEN
      SELECT to_char(MAX(data), 'YYYY-MM-DD') INTO v_key FROM public.anp_cdp_diaria;
    WHEN 'anp_cdp_diaria_instalacao' THEN
      SELECT to_char(MAX(data), 'YYYY-MM-DD') INTO v_key FROM public.anp_cdp_diaria_instalacao;
    WHEN 'anp_cdp_diaria_poco' THEN
      SELECT to_char(MAX(data), 'YYYY-MM-DD') INTO v_key FROM public.anp_cdp_diaria_poco;
    WHEN 'anp_voip' THEN
      SELECT MAX(ano_publicacao)::text INTO v_key FROM public.anp_voip;
    -- ---- Vessels (timestamp -> ISO8601 sorts lexicographically) ----
    WHEN 'navios_diesel' THEN
      SELECT to_char(MAX(collected_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') INTO v_key FROM public.navios_diesel;
    WHEN 'vessel_positions' THEN
      SELECT to_char(MAX(ts) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') INTO v_key FROM public.vessel_positions;
    WHEN 'port_arrivals' THEN
      SELECT to_char(MAX(detected_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') INTO v_key FROM public.port_arrivals;
    WHEN 'import_candidates' THEN
      SELECT to_char(MAX(last_seen_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') INTO v_key FROM public.import_candidates;
    -- ---- Proprietary ----
    WHEN 'd_g_margins' THEN
      -- week is text "IW/IYYY"; key on the ISO Monday so it sorts chronologically.
      SELECT to_char(MAX(to_date(week, 'IW/IYYY')), 'YYYY-MM-DD') INTO v_key FROM public.d_g_margins;
    WHEN 'price_bands' THEN
      SELECT to_char(MAX(date), 'YYYY-MM-DD') INTO v_key FROM public.price_bands;
    WHEN 'anp_subsidy_diesel_reference' THEN
      SELECT to_char(MAX(data_referencia), 'YYYY-MM-DD') INTO v_key FROM public.anp_subsidy_diesel_reference;
    WHEN 'anp_subsidy_commercialization' THEN
      -- period on data_inicio (NOT inserted_at) per product spec.
      SELECT to_char(MAX(data_inicio), 'YYYY-MM-DD') INTO v_key FROM public.anp_subsidy_commercialization;
    WHEN 'anp_subsidy_caps' THEN
      SELECT to_char(MAX(inserted_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') INTO v_key FROM public.anp_subsidy_caps;
    ELSE
      v_key := NULL;
  END CASE;

  RETURN v_key;
END;
$$;

-- service_role ONLY: called by the Phase-2 send scripts with the service key.
-- The frontend never calls this (it uses get_data_sources_freshness). Least
-- privilege: explicitly strip anon/authenticated (Supabase auto-grants the API
-- roles on CREATE, which a plain REVOKE ... FROM PUBLIC does not remove).
REVOKE ALL ON FUNCTION public.alerts_current_period(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.alerts_current_period(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alerts_current_period(TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- alerts_active_recipients(source_slug) -> (subscription_id, email, unsubscribe_token)
--   Resolves emails from auth.users for active subscriptions of a source.
--   Definer so the (service-key) caller can read auth.users.email.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alerts_active_recipients(p_source_slug TEXT)
RETURNS TABLE (
  subscription_id   UUID,
  email             TEXT,
  unsubscribe_token UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id, u.email::text, s.unsubscribe_token
  FROM public.alert_subscriptions s
  JOIN auth.users u ON u.id = s.user_id
  WHERE s.source_slug = p_source_slug
    AND s.is_active = TRUE
    AND u.email IS NOT NULL;
$$;

-- service_role ONLY: this returns every active subscriber's email +
-- unsubscribe_token for a source. Granting it to authenticated (or anon) would
-- let any caller harvest other users' emails/tokens (IDOR). Only the Phase-2
-- send scripts call it, with the service key. Explicitly strip anon/authenticated
-- because Supabase auto-grants the API roles on CREATE (REVOKE ... FROM PUBLIC
-- alone does not remove those named-role grants).
REVOKE ALL ON FUNCTION public.alerts_active_recipients(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.alerts_active_recipients(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alerts_active_recipients(TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- list_subscribable_bases() — active catalog + current user's flags
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_subscribable_bases()
RETURNS TABLE (
  source_slug      TEXT,
  category         TEXT,
  display_name     TEXT,
  description      TEXT,
  frequency_hint   TEXT,
  cadence          TEXT,
  is_subscribed    BOOLEAN,
  sub_is_active    BOOLEAN,
  cadence_override TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    src.source_slug,
    src.category,
    src.display_name,
    src.description,
    src.frequency_hint,
    src.cadence,
    (sub.id IS NOT NULL)                AS is_subscribed,
    COALESCE(sub.is_active, FALSE)      AS sub_is_active,
    sub.cadence_override
  FROM public.alert_sources src
  LEFT JOIN public.alert_subscriptions sub
    ON sub.source_slug = src.source_slug
   AND sub.user_id = (select auth.uid())
  WHERE src.is_active = TRUE
  ORDER BY src.category, src.display_name;
$$;

GRANT EXECUTE ON FUNCTION public.list_subscribable_bases() TO authenticated;

-- ----------------------------------------------------------------------------
-- set_my_subscription(source_slug, active) — upsert/flip one subscription
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_my_subscription(
  p_source_slug TEXT,
  p_active      BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := (select auth.uid());
BEGIN
  IF v_user IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Source must exist and be active to subscribe to it.
  IF NOT EXISTS (
    SELECT 1 FROM public.alert_sources
    WHERE source_slug = p_source_slug AND is_active = TRUE
  ) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.alert_subscriptions (user_id, source_slug, is_active)
  VALUES (v_user, p_source_slug, p_active)
  ON CONFLICT (user_id, source_slug)
  DO UPDATE SET is_active = EXCLUDED.is_active;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_my_subscription(TEXT, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- set_my_subscriptions(source_slugs[], active) — bulk; returns affected count
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_my_subscriptions(
  p_source_slugs TEXT[],
  p_active       BOOLEAN
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  UUID := (select auth.uid());
  v_count INT  := 0;
BEGIN
  IF v_user IS NULL OR p_source_slugs IS NULL OR cardinality(p_source_slugs) = 0 THEN
    RETURN 0;
  END IF;

  WITH valid AS (
    SELECT source_slug
    FROM public.alert_sources
    WHERE source_slug = ANY(p_source_slugs) AND is_active = TRUE
  ),
  upserted AS (
    INSERT INTO public.alert_subscriptions (user_id, source_slug, is_active)
    SELECT v_user, v.source_slug, p_active FROM valid v
    ON CONFLICT (user_id, source_slug)
    DO UPDATE SET is_active = EXCLUDED.is_active
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upserted;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_my_subscriptions(TEXT[], BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- set_my_subscription_cadence(source_slug, cadence) — set cadence_override
--   p_cadence NULL inherits the source default; otherwise 'immediate'/'digest'.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_my_subscription_cadence(
  p_source_slug TEXT,
  p_cadence     TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user    UUID := (select auth.uid());
  v_updated INT;
BEGIN
  IF v_user IS NULL THEN
    RETURN FALSE;
  END IF;

  IF p_cadence IS NOT NULL AND p_cadence NOT IN ('immediate','digest') THEN
    RETURN FALSE;
  END IF;

  UPDATE public.alert_subscriptions
  SET cadence_override = p_cadence
  WHERE user_id = v_user
    AND source_slug = p_source_slug;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_my_subscription_cadence(TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- list_my_subscriptions() — current user's subs with effective cadence
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_subscriptions()
RETURNS TABLE (
  source_slug       TEXT,
  display_name      TEXT,
  category          TEXT,
  is_active         BOOLEAN,
  effective_cadence TEXT,
  created_at        TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    sub.source_slug,
    src.display_name,
    src.category,
    sub.is_active,
    COALESCE(sub.cadence_override, src.cadence) AS effective_cadence,
    sub.created_at
  FROM public.alert_subscriptions sub
  JOIN public.alert_sources src ON src.source_slug = sub.source_slug
  WHERE sub.user_id = (select auth.uid())
  ORDER BY src.category, src.display_name;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_subscriptions() TO authenticated;

-- ----------------------------------------------------------------------------
-- list_my_recent_alerts(limit) — recent deliveries for the logged user
--   frontend_route lives inside events.payload (and source metadata).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_recent_alerts(p_limit INT DEFAULT 20)
RETURNS TABLE (
  outbox_id    UUID,
  source_slug  TEXT,
  display_name TEXT,
  event_key    TEXT,
  payload      JSONB,
  status       TEXT,
  sent_at      TIMESTAMPTZ,
  detected_at  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    o.id,
    e.source_slug,
    src.display_name,
    e.event_key,
    -- ensure frontend_route is available even for older events
    (e.payload || jsonb_build_object('frontend_route',
        COALESCE(e.payload->>'frontend_route', src.metadata->>'frontend_route'))) AS payload,
    o.status,
    o.sent_at,
    e.detected_at
  FROM public.alert_outbox o
  JOIN public.alert_subscriptions sub ON sub.id = o.subscription_id
  JOIN public.alert_events e ON e.id = o.event_id
  JOIN public.alert_sources src ON src.source_slug = e.source_slug
  WHERE sub.user_id = (select auth.uid())
    AND e.source_slug NOT LIKE 'system_%'
  ORDER BY COALESCE(o.sent_at, o.created_at) DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

GRANT EXECUTE ON FUNCTION public.list_my_recent_alerts(INT) TO authenticated;

-- ----------------------------------------------------------------------------
-- unsubscribe_by_token(token) — the ONLY anon-callable write (email footer)
--   Idempotent: re-click returns success.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unsubscribe_by_token(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slug    TEXT;
  v_updated INT;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'missing_token');
  END IF;

  UPDATE public.alert_subscriptions
  SET is_active = FALSE
  WHERE unsubscribe_token = p_token
    AND is_active = TRUE
  RETURNING source_slug INTO v_slug;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    -- Idempotent: already inactive (or token simply matches) -> still success.
    IF EXISTS (SELECT 1 FROM public.alert_subscriptions WHERE unsubscribe_token = p_token) THEN
      RETURN jsonb_build_object('success', TRUE, 'already_unsubscribed', TRUE);
    END IF;
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_token');
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'source_slug', v_slug);
END;
$$;

GRANT EXECUTE ON FUNCTION public.unsubscribe_by_token(UUID) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- admin_alerts_list_subscribers(source_slug?, limit) — admin listing
--   Resolves email from auth.users (definer).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_alerts_list_subscribers(
  p_source_slug TEXT DEFAULT NULL,
  p_limit       INT  DEFAULT 200
)
RETURNS TABLE (
  subscription_id  UUID,
  user_id          UUID,
  email            TEXT,
  source_slug      TEXT,
  is_active        BOOLEAN,
  cadence_override TEXT,
  created_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.user_id,
    u.email::text,
    s.source_slug,
    s.is_active,
    s.cadence_override,
    s.created_at
  FROM public.alert_subscriptions s
  JOIN auth.users u ON u.id = s.user_id
  WHERE p_source_slug IS NULL OR s.source_slug = p_source_slug
  ORDER BY s.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_alerts_list_subscribers(TEXT, INT) TO authenticated;

-- ----------------------------------------------------------------------------
-- admin_alerts_email_log_recent(limit) — provider send audit
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_alerts_email_log_recent(p_limit INT DEFAULT 100)
RETURNS TABLE (
  id                  UUID,
  outbox_id           UUID,
  email               TEXT,
  subject             TEXT,
  status              TEXT,
  provider_message_id TEXT,
  recorded_at         TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    l.id, l.outbox_id, l.email, l.subject, l.status, l.provider_message_id, l.recorded_at
  FROM public.alert_email_log l
  ORDER BY l.recorded_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_alerts_email_log_recent(INT) TO authenticated;

-- ----------------------------------------------------------------------------
-- admin_alerts_stats() — totals, per-source, 7d sent/bounced
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_alerts_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_totals      JSONB;
  v_per_source  JSONB;
  v_sent_7d     INT;
  v_bounced_7d  INT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT jsonb_build_object(
    'subscriptions_total',  count(*),
    'subscriptions_active', count(*) FILTER (WHERE is_active),
    'unique_users',         count(DISTINCT user_id)
  )
  INTO v_totals
  FROM public.alert_subscriptions;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_per_source
  FROM (
    SELECT
      s.source_slug,
      count(*)                            AS subscriptions_total,
      count(*) FILTER (WHERE s.is_active) AS subscriptions_active
    FROM public.alert_subscriptions s
    GROUP BY s.source_slug
    ORDER BY s.source_slug
  ) t;

  SELECT count(*) INTO v_sent_7d
  FROM public.alert_email_log
  WHERE status = 'sent' AND recorded_at > NOW() - INTERVAL '7 days';

  SELECT count(*) INTO v_bounced_7d
  FROM public.alert_email_log
  WHERE status IN ('bounced','complained') AND recorded_at > NOW() - INTERVAL '7 days';

  RETURN jsonb_build_object(
    'totals',     v_totals,
    'per_source', v_per_source,
    'sent_7d',    v_sent_7d,
    'bounced_7d', v_bounced_7d
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_alerts_stats() TO authenticated;

-- ----------------------------------------------------------------------------
-- admin_alerts_toggle_source(source_slug, is_active) — flip catalog activity
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_alerts_toggle_source(
  p_source_slug TEXT,
  p_is_active   BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  UPDATE public.alert_sources
  SET is_active = p_is_active
  WHERE source_slug = p_source_slug;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_alerts_toggle_source(TEXT, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- admin_alerts_send_test(source_slug, email) — inject a synthetic test event
--   Used to validate fanout/delivery end-to-end. Returns the new event id.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_alerts_send_test(
  p_source_slug TEXT,
  p_email       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.alert_sources WHERE source_slug = p_source_slug) THEN
    RAISE EXCEPTION 'unknown source: %', p_source_slug;
  END IF;

  INSERT INTO public.alert_events (source_slug, event_key, payload)
  VALUES (
    p_source_slug,
    'test:' || extract(epoch FROM now())::bigint,
    jsonb_build_object(
      'test', TRUE,
      'message', 'Synthetic test event injected by admin.',
      'target_email', p_email,
      'injected_by', (select auth.uid()),
      'injected_at', NOW(),
      'frontend_route', (SELECT metadata->>'frontend_route'
                           FROM public.alert_sources WHERE source_slug = p_source_slug)
    )
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_alerts_send_test(TEXT, TEXT) TO authenticated;

-- ============================================================================
-- SECTION 4 — module_visibility for the 'alerts' slug
--   Logged-in product: visible to clients, NOT public. Preserves the
--   public=true => clients=true invariant. on_home left as-is.
-- ============================================================================
INSERT INTO public.module_visibility (module_slug, is_visible_for_public, is_visible_for_clients)
VALUES ('alerts', FALSE, TRUE)
ON CONFLICT (module_slug)
DO UPDATE SET is_visible_for_public = FALSE,
              is_visible_for_clients = TRUE;
