-- Drop card_previews table — orphaned after /home icon redesign (2026-05-26).
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
--
-- The matching `card-previews` Storage bucket and its objects are purged
-- separately via the Storage REST API (see
-- scripts/utils/purge_card_previews_bucket.mjs) because Supabase platform
-- triggers (protect_objects_delete / protect_buckets_delete) block direct
-- SQL DELETEs on storage.objects / storage.buckets.

DROP TABLE IF EXISTS public.card_previews CASCADE;
