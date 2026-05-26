-- Hotfix follow-up to 20260526400000_drop_sv_rpcs (2026-05-26)
-- The prior migration targeted module_slug='sales-volumes' but the actual
-- seeded slug is 'sales' (the rename migration 20260505000000 was undone
-- by the seed in 20260505000008). Drop the correct row.

DELETE FROM public.module_visibility WHERE module_slug = 'sales';
