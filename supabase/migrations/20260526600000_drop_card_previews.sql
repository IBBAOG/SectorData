-- Drop card_previews table + matching Storage bucket — orphaned after /home
-- icon redesign (2026-05-26).
--
-- The home page was redesigned to use inline SVG icons instead of uploaded
-- preview images. Backing image-upload UI and code paths were removed in:
--   * 5eb97335  feat(home): replace image cards with icon+name list (desktop + mobile)
--   * 249a8270  refactor(admin-panel): remove orphan image upload from Card Images tab, rename to Home Visibility
--   * d5f92cd9  chore(home): delete dead card_previews code paths after icon redesign
--
-- After audit, no code in src/ references this table or the matching Storage
-- bucket anymore. CASCADE drops any leftover policies/triggers attached to
-- the table.

-- 1. Drop the public table.
DROP TABLE IF EXISTS public.card_previews CASCADE;

-- 2. Purge any objects still sitting in the matching Storage bucket and then
--    drop the bucket itself. Both are plain rows in the storage schema.
--    DELETE order matters: storage.buckets has a FK from storage.objects.
DELETE FROM storage.objects WHERE bucket_id = 'card-previews';
DELETE FROM storage.buckets WHERE id = 'card-previews';
