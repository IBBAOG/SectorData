-- ============================================================================
-- alert_recipients — destinatários de alertas gerenciados via /admin-panel
-- RLS: somente Admins podem SELECT/INSERT/UPDATE/DELETE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.alert_recipients (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  email      TEXT        NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ          DEFAULT NOW(),
  added_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT alert_recipients_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_alert_recipients_is_active
  ON public.alert_recipients (is_active);

ALTER TABLE public.alert_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alert_recipients_admin_all"
  ON public.alert_recipients
  FOR ALL
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) = 'Admin'
  )
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) = 'Admin'
  );

INSERT INTO public.alert_recipients (email, is_active)
VALUES ('eduardo.mendes@itaubba.com', TRUE)
ON CONFLICT (email) DO NOTHING;
