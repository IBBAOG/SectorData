/**
 * Server Component — fetches card preview URLs at render time using the
 * service role key so the client receives them instantly with the HTML.
 * No client-side fetch, no loading flash.
 *
 * force-dynamic: ensures Next.js never serves a cached version of this page,
 * so admin-uploaded images appear immediately on the next visit to /home.
 */
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
import HomeClient from "./HomeClient";

async function getCardPreviews(): Promise<Record<string, string>> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data, error } = await supabase
      .from("card_previews")
      .select("card_slug, image_url");
    if (error) throw error;
    const map: Record<string, string> = {};
    for (const row of data ?? []) map[row.card_slug] = row.image_url;
    return map;
  } catch (e) {
    console.error("[home/page] getCardPreviews error:", e);
    return {};
  }
}

export default async function HomePage() {
  const initialPreviews = await getCardPreviews();
  return <HomeClient initialPreviews={initialPreviews} />;
}
