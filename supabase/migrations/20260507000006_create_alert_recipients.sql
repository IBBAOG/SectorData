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

-- Função SECURITY DEFINER para evitar recursão de RLS ao consultar profiles
-- (a policy inline `SELECT role FROM profiles WHERE id = auth.uid()` causa loop
--  porque profiles também tem RLS que re-avalia auth.uid() por row)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Admin'
  );
$$;

CREATE POLICY "alert_recipients_admin_all"
  ON public.alert_recipients
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

INSERT INTO public.alert_recipients (email, is_active)
VALUES ('eduardo.mendes@itaubba.com', TRUE)
ON CONFLICT (email) DO NOTHING;
