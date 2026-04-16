/**
 * Supabase helpers for the card_previews table and the card-previews storage bucket.
 * Admins upload images; all authenticated users can read them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Read ──────────────────────────────────────────────────────────────────────

/**
 * Returns a slug → image_url map for all rows in card_previews.
 * Falls back to an empty object on error (home page will use static previews).
 */
export async function getCardPreviews(
  supabase: SupabaseClient,
): Promise<Record<string, string>> {
  try {
    const { data, error } = await supabase
      .from("card_previews")
      .select("card_slug, image_url");
    if (error) throw error;
    const map: Record<string, string> = {};
    for (const row of data ?? []) map[row.card_slug] = row.image_url;
    return map;
  } catch (e) {
    console.error("[cardPreviewRpc] getCardPreviews error:", e);
    return {};
  }
}

// ─── Write (Admin only — enforced by RLS) ─────────────────────────────────────

/**
 * Uploads an image file to the card-previews bucket and upserts the public URL
 * into card_previews. Returns the public URL on success, null on failure.
 */
export async function uploadCardPreview(
  supabase: SupabaseClient,
  slug: string,
  file: File,
): Promise<string | null> {
  try {
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${slug}.${ext}`;

    // Upload (upsert so replacing an existing image works)
    const { error: uploadError } = await supabase.storage
      .from("card-previews")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) throw uploadError;

    // Get the permanent public URL
    const { data } = supabase.storage
      .from("card-previews")
      .getPublicUrl(path);
    const publicUrl = data.publicUrl;

    // Persist the URL in card_previews
    const { error: upsertError } = await supabase
      .from("card_previews")
      .upsert({ card_slug: slug, image_url: publicUrl, updated_at: new Date().toISOString() });
    if (upsertError) throw upsertError;

    return publicUrl;
  } catch (e) {
    console.error("[cardPreviewRpc] uploadCardPreview error:", e);
    return null;
  }
}
