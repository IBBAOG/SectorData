/**
 * Seed script — clipping_cookies table
 *
 * Reads Netscape-format cookie files from a local directory and upserts each
 * one into public.clipping_cookies via the Supabase service role (bypasses RLS).
 *
 * Usage:
 *   node scripts/manual/upload_clipping_cookies.mjs [/path/to/cookies/dir]
 *
 * Cookie directory resolution (first match wins):
 *   1. CLI argument (process.argv[2])
 *   2. Env var  CLIPPING_COOKIES_DIR
 *   3. Default  C:\Users\eduar\Documents\clipinator\cookies
 *
 * Credentials resolved from env vars, then .env.local, then .env:
 *   SUPABASE_URL           (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY  (or SUPABASE_SERVICE_KEY)
 */

import { readdir, readFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ── Env loading ───────────────────────────────────────────────────────────────

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const result = {};
  const lines = (() => {
    try {
      return require("fs").readFileSync(filePath, "utf8").split(/\r?\n/);
    } catch {
      return [];
    }
  })();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

// ESM-compatible env file reader (no require available)
async function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const result = {};
  try {
    const text = await readFile(filePath, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const idx = line.indexOf("=");
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  } catch {
    // ignore unreadable file
  }
  return result;
}

async function resolveCredentials() {
  // Layer 1: process env
  let url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  let key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url || !key) {
    // Layer 2: .env.local (Next.js convention)
    const local = await readEnvFile(".env.local");
    url = url || local.SUPABASE_URL || local.NEXT_PUBLIC_SUPABASE_URL || "";
    key = key || local.SUPABASE_SERVICE_ROLE_KEY || local.SUPABASE_SERVICE_KEY || "";
  }

  if (!url || !key) {
    // Layer 3: .env
    const env = await readEnvFile(".env");
    url = url || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
    key = key || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || "";
  }

  if (!url || !key) {
    console.error(
      "ERROR: Missing Supabase credentials.\n" +
        "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and\n" +
        "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)\n" +
        "as environment variables or in .env.local / .env at the project root."
    );
    process.exit(1);
  }

  return { url, key };
}

// ── Cookie directory ──────────────────────────────────────────────────────────

const DEFAULT_COOKIES_DIR = String.raw`C:\Users\eduar\Documents\clipinator\cookies`;

function resolveCookiesDir() {
  return (
    process.argv[2] ||
    process.env.CLIPPING_COOKIES_DIR ||
    DEFAULT_COOKIES_DIR
  );
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Returns true if the content has at least one non-comment, non-empty line.
 * A valid Netscape cookie file starts with "# Netscape HTTP Cookie File" then
 * has data lines (tab-separated, 7 fields). We only check the line exists.
 */
function hasDataLines(content) {
  return content.split(/\r?\n/).some((line) => {
    const t = line.trim();
    return t.length > 0 && !t.startsWith("#");
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cookiesDir = resolveCookiesDir();

  // Verify directory exists
  if (!existsSync(cookiesDir)) {
    console.error(
      `ERROR: Cookies directory not found: ${cookiesDir}\n` +
        "Run the clipinator login.py script first to generate cookie files,\n" +
        "or set CLIPPING_COOKIES_DIR to the correct path."
    );
    process.exit(1);
  }

  // List *.txt files
  let files;
  try {
    const entries = await readdir(cookiesDir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && extname(e.name).toLowerCase() === ".txt")
      .map((e) => e.name);
  } catch (err) {
    console.error(`ERROR: Cannot read directory ${cookiesDir}: ${err.message}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.warn(`WARNING: No .txt files found in ${cookiesDir}. Nothing to upload.`);
    process.exit(0);
  }

  console.log(`Found ${files.length} cookie file(s) in ${cookiesDir}\n`);

  const { url, key } = await resolveCredentials();
  const supabase = createClient(url, key, {
    auth: { persistSession: false },
  });

  let anyError = false;

  for (const filename of files) {
    const domain = basename(filename, ".txt");
    const filePath = join(cookiesDir, filename);

    let content;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (err) {
      console.error(`  x ${domain} — error reading file: ${err.message}`);
      anyError = true;
      continue;
    }

    // Sanity check: must have at least one data line
    if (!hasDataLines(content)) {
      console.warn(`  ! ${domain} — skipped (empty or only comments)`);
      continue;
    }

    const byteSize = Buffer.byteLength(content, "utf-8");

    const { error } = await supabase
      .from("clipping_cookies")
      .upsert(
        {
          domain,
          cookies_netscape: content,
          updated_at: new Date().toISOString(),
          updated_by: null, // service role — no user context
        },
        { onConflict: "domain" }
      );

    if (error) {
      console.error(`  x ${domain} — error: ${error.message}`);
      anyError = true;
    } else {
      console.log(`  + ${domain} — ${byteSize.toLocaleString()} bytes (upserted)`);
    }
  }

  if (anyError) {
    console.error("\nFinished with errors. Check output above.");
    process.exit(1);
  }

  console.log(`\nDone. ${files.length} domain(s) upserted into clipping_cookies.`);
}

main();
