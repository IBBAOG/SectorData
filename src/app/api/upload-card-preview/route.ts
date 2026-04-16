import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest) {
  try {
    // ── 1. Parse multipart form ─────────────────────────────────────────────
    const form = await req.formData();
    const slug = form.get("slug");
    const file = form.get("file");

    if (typeof slug !== "string" || !slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 413 });
    }

    // ── 2. Verify the caller is an authenticated Admin ──────────────────────
    const authHeader = req.headers.get("authorization") ?? "";
    const userToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!userToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Use user token to get their profile (respects RLS)
    const userClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });
    const { data: profile, error: profileErr } = await userClient.rpc("get_my_profile");
    if (profileErr || !profile || profile.role !== "Admin") {
      return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
    }

    // ── 3. Upload using service role (bypasses storage RLS) ─────────────────
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const ext = (file instanceof File ? file.name.split(".").pop() : null) ?? "jpg";
    // Include timestamp in filename so the CDN never serves a stale cached version
    const path = `${slug}-${Date.now()}.${ext}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Delete old file(s) for this slug so the bucket stays clean
    const { data: existing } = await admin.storage.from("card-previews").list("", { search: slug });
    if (existing && existing.length > 0) {
      await admin.storage.from("card-previews").remove(existing.map((f) => f.name));
    }

    const { error: uploadErr } = await admin.storage
      .from("card-previews")
      .upload(path, buffer, { upsert: false, contentType: file.type });
    if (uploadErr) throw uploadErr;

    const { data: urlData } = admin.storage.from("card-previews").getPublicUrl(path);
    const publicUrl = urlData.publicUrl;

    // ── 4. Persist the URL in card_previews ─────────────────────────────────
    const { error: upsertErr } = await admin
      .from("card_previews")
      .upsert({ card_slug: slug, image_url: publicUrl, updated_at: new Date().toISOString() });
    if (upsertErr) throw upsertErr;

    return NextResponse.json({ url: publicUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[upload-card-preview]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
