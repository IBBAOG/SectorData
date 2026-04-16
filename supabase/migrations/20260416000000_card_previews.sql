-- ── card_previews table ────────────────────────────────────────────────────────
-- Stores one row per dashboard card slug with the admin-uploaded preview URL.
CREATE TABLE IF NOT EXISTS public.card_previews (
  card_slug   TEXT        PRIMARY KEY,
  image_url   TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.card_previews ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read previews
CREATE POLICY "card_previews_select"
  ON public.card_previews FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only Admins can insert / update / delete
CREATE POLICY "card_previews_admin_write"
  ON public.card_previews FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'Admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'Admin'
    )
  );

-- ── Supabase Storage bucket ────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'card-previews',
  'card-previews',
  true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Public read (anyone, including unauthenticated, because bucket is public)
CREATE POLICY "card_previews_storage_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'card-previews');

-- Admin insert
CREATE POLICY "card_previews_storage_admin_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'card-previews' AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'Admin'
    )
  );

-- Admin update (upsert/replace)
CREATE POLICY "card_previews_storage_admin_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'card-previews' AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'Admin'
    )
  );

-- Admin delete
CREATE POLICY "card_previews_storage_admin_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'card-previews' AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'Admin'
    )
  );
