-- Register the Alerts module in module_visibility.
-- Default: visible for public (anon double opt-in is the whole point of the Alerts product).
--
-- ON CONFLICT DO UPDATE is used instead of DO NOTHING so that a re-run corrects
-- any previous misconfiguration (e.g., if someone had manually set it to false).

INSERT INTO public.module_visibility
  (module_slug, is_visible_for_clients, is_visible_for_public, is_visible_on_home)
VALUES
  ('alerts', TRUE, TRUE, TRUE)
ON CONFLICT (module_slug) DO UPDATE SET
  is_visible_for_clients = EXCLUDED.is_visible_for_clients,
  is_visible_for_public  = EXCLUDED.is_visible_for_public,
  is_visible_on_home     = EXCLUDED.is_visible_on_home;
