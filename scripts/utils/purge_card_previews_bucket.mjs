// Purge the `card-previews` Storage bucket via the Supabase Storage REST API.
//
// Background: the `card_previews` table and matching bucket are orphans after
// the /home icon redesign (2026-05-26). We dropped the table via a normal SQL
// migration, but the bucket cannot be removed via SQL because Supabase added
// platform triggers `protect_objects_delete` / `protect_buckets_delete` that
// reject direct DELETEs on `storage.objects` / `storage.buckets` (error 42501).
// The supported path is the Storage REST API with the service-role key.
//
// Reads credentials from .env (preferred) or .env.local at the repo root.
// Required vars (any of):
//   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY

import fs from "node:fs";
import path from "node:path";

const BUCKET = "card-previews";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf8");
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function resolveEnv() {
  // Walk up looking for the repo root (file with .env or .env.local present).
  // Start from this script's directory and ascend.
  const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const candidates = [];
  let dir = scriptDir;
  for (let i = 0; i < 8; i++) {
    candidates.push(path.join(dir, ".env"));
    candidates.push(path.join(dir, ".env.local"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Also include process.cwd() lookup.
  candidates.push(path.join(process.cwd(), ".env"));
  candidates.push(path.join(process.cwd(), ".env.local"));

  const merged = {};
  for (const file of candidates) {
    const data = loadEnvFile(file);
    for (const [k, v] of Object.entries(data)) {
      if (!(k in merged)) merged[k] = v;
    }
  }
  // process.env wins last (so explicit shell overrides work).
  for (const k of Object.keys(merged)) {
    if (process.env[k]) merged[k] = process.env[k];
  }
  return merged;
}

const env = resolveEnv();
const supabaseUrl =
  env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "";
const serviceKey =
  env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || "";

if (!supabaseUrl || !serviceKey) {
  console.error(
    "Missing Supabase credentials. Need NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) " +
      "and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) in .env or .env.local."
  );
  process.exit(1);
}

const baseUrl = supabaseUrl.replace(/\/+$/, "");
const headers = {
  Authorization: `Bearer ${serviceKey}`,
  apikey: serviceKey,
};

async function listAllObjects() {
  const all = [];
  const limit = 1000;
  let offset = 0;
  // Loop until a page returns fewer than `limit` rows.
  while (true) {
    const resp = await fetch(
      `${baseUrl}/storage/v1/object/list/${encodeURIComponent(BUCKET)}`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix: "",
          limit,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      }
    );
    const bodyText = await resp.text();
    if (!resp.ok) {
      throw new Error(
        `list failed (status ${resp.status}): ${bodyText.slice(0, 500)}`
      );
    }
    let page;
    try {
      page = JSON.parse(bodyText);
    } catch (err) {
      throw new Error(
        `list returned non-JSON (status ${resp.status}): ${bodyText.slice(0, 200)}`
      );
    }
    if (!Array.isArray(page)) {
      throw new Error(
        `list returned non-array: ${JSON.stringify(page).slice(0, 200)}`
      );
    }
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

async function deleteObject(name) {
  const resp = await fetch(
    `${baseUrl}/storage/v1/object/${encodeURIComponent(BUCKET)}/${name
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    { method: "DELETE", headers }
  );
  const bodyText = await resp.text();
  return { ok: resp.ok, status: resp.status, body: bodyText };
}

async function deleteBucket() {
  const resp = await fetch(
    `${baseUrl}/storage/v1/bucket/${encodeURIComponent(BUCKET)}`,
    { method: "DELETE", headers }
  );
  const bodyText = await resp.text();
  return { ok: resp.ok, status: resp.status, body: bodyText };
}

async function main() {
  console.log(`Target project: ${baseUrl}`);
  console.log(`Target bucket:  ${BUCKET}`);
  console.log("");

  console.log("Step 1/3: listing objects...");
  const objects = await listAllObjects();
  console.log(`  found ${objects.length} object(s)`);
  for (const obj of objects) {
    console.log(`    - ${obj.name}`);
  }
  console.log("");

  console.log("Step 2/3: deleting objects...");
  let deletedOk = 0;
  let deletedFail = 0;
  for (const obj of objects) {
    const result = await deleteObject(obj.name);
    if (result.ok) {
      deletedOk += 1;
      console.log(`  OK   ${obj.name}`);
    } else {
      deletedFail += 1;
      console.log(
        `  FAIL ${obj.name} (status ${result.status}): ${result.body.slice(0, 200)}`
      );
    }
  }
  console.log(`  summary: ${deletedOk} ok, ${deletedFail} fail`);
  console.log("");

  if (deletedFail > 0) {
    console.error("Aborting before bucket deletion: some objects failed to delete.");
    process.exit(2);
  }

  console.log("Step 3/3: deleting bucket...");
  const bucketResult = await deleteBucket();
  if (bucketResult.ok) {
    console.log(`  OK   bucket '${BUCKET}' deleted (status ${bucketResult.status})`);
  } else {
    console.log(
      `  FAIL bucket '${BUCKET}' (status ${bucketResult.status}): ${bucketResult.body.slice(0, 500)}`
    );
    process.exit(3);
  }
  console.log("");
  console.log("Done.");
}

main().catch((err) => {
  console.error("Unhandled error:", err.message);
  console.error(err.stack);
  process.exit(99);
});
