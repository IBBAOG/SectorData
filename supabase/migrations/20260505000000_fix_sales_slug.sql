-- Rename module slug 'sales' → 'sales-volumes' to match the route path and
-- visibility guard call in sales-volumes/page.tsx. The original slug was
-- seeded as 'sales' but the route is /sales-volumes, so admin toggles had
-- no effect on the actual page or nav item.
UPDATE public.module_visibility
SET module_slug = 'sales-volumes'
WHERE module_slug = 'sales';
