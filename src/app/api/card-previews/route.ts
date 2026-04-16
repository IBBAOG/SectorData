import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * GET /api/card-previews
 * Returns all card preview URLs using the service role key (bypasses RLS).
 * Public endpoint — no auth required since the images are already public.
 */
export async function GET() {
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await admin
      .from("card_previews")
      .select("card_slug, image_url");
    if (error) throw error;

    const map: Record<string, string> = {};
    for (const row of data ?? []) map[row.card_slug] = row.image_url;

    return NextResponse.json(map, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[card-previews GET]", message);
    return NextResponse.json({}, { status: 500 });
  }
}
