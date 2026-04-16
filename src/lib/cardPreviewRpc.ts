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

// ─── Write (Admin only — goes through server API route that uses service role) ──

/**
 * Uploads an image file via the /api/upload-card-preview route, which uses the
 * Supabase service role on the server side. This bypasses storage RLS entirely.
 * Returns the public URL on success, null on failure.
 */
export async function uploadCardPreview(
  supabase: SupabaseClient,
  slug: string,
  file: File,
): Promise<string | null> {
  try {
    // Get the current user's access token to authenticate the API call
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Not authenticated");

    const form = new FormData();
    form.append("slug", slug);
    form.append("file", file);

    const res = await fetch("/api/upload-card-preview", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Upload failed");

    return json.url as string;
  } catch (e) {
    console.error("[cardPreviewRpc] uploadCardPreview error:", e);
    return null;
  }
}
