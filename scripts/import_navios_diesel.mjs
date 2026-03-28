/**
 * Import navios_diesel.csv into Supabase.
 *
 * Usage:  node scripts/import_navios_diesel.mjs
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_KEY in .env
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// ── Config ───────────────────────────────────────────────────────────────────
const envText = fs.readFileSync(path.resolve(".env"), "utf8");
const url = envText.match(/SUPABASE_URL=(.*)/)?.[1]?.trim();
const key = envText.match(/SUPABASE_SERVICE_KEY=(.*)/)?.[1]?.trim();

if (!url || !key) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

// ── Date parsing helpers ─────────────────────────────────────────────────────

/** Parse "DD/MM/YYYY HH:MM:SS" or "DD/MM/YYYY HH:MM" or "DD/MM/YYYY" or "DD/MM/YY" */
function parseBRDate(raw) {
  if (!raw || raw.trim() === "") return null;
  const s = raw.trim();

  // Match DD/MM/YYYY (with optional time)
  const m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!m) return null;

  let [, day, month, year, hour, minute, second] = m;
  let y = parseInt(year, 10);
  if (y < 100) y += 2000; // 2-digit year

  const d = new Date(
    y,
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hour ?? "0", 10),
    parseInt(minute ?? "0", 10),
    parseInt(second ?? "0", 10)
  );

  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Parse "YYYY-MM-DD HH:MM" */
function parseISOish(raw) {
  if (!raw || raw.trim() === "") return null;
  const d = new Date(raw.trim().replace(" ", "T") + ":00");
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// ── Read and parse CSV ───────────────────────────────────────────────────────
const csvPath = path.resolve("output/navios_diesel.csv");
const lines = fs.readFileSync(csvPath, "utf8").split("\n");

const records = [];
let skipped = 0;

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed) { skipped++; continue; }

  const cols = trimmed.split(",");
  if (cols.length < 13) { skipped++; continue; }

  const collectedAt = parseISOish(cols[0]);
  if (!collectedAt) { skipped++; continue; }

  records.push({
    collected_at:          collectedAt,
    porto:                 cols[1]?.trim() || "",
    status:                cols[2]?.trim() || "",
    navio:                 cols[3]?.trim() || "",
    produto:               cols[4]?.trim() || "Óleo Diesel",
    quantidade:            parseFloat(cols[5]) || 0,
    unidade:               cols[6]?.trim() || null,
    quantidade_convertida: parseFloat(cols[7]) || 0,
    eta:                   parseBRDate(cols[8]),
    inicio_descarga:       parseBRDate(cols[9]),
    fim_descarga:          parseBRDate(cols[10]),
    origem:                cols[11]?.trim() || null,
    berco:                 cols[12]?.trim() || null,
  });
}

console.log(`📊 Parsed ${records.length} records (skipped ${skipped} blank/invalid lines)`);

// ── Insert into Supabase ─────────────────────────────────────────────────────
const BATCH = 500;
let inserted = 0;

for (let i = 0; i < records.length; i += BATCH) {
  const batch = records.slice(i, i + BATCH);

  const { error } = await supabase
    .from("navios_diesel")
    .upsert(batch, { onConflict: "collected_at,porto,navio" });

  if (error) {
    console.error(`❌ Batch ${i}-${i + batch.length} failed:`, error.message);
    process.exit(1);
  }

  inserted += batch.length;
  console.log(`✅ Inserted ${inserted}/${records.length}`);
}

// ── Verify ───────────────────────────────────────────────────────────────────
const { count, error: countErr } = await supabase
  .from("navios_diesel")
  .select("*", { count: "exact", head: true });

if (countErr) {
  console.error("❌ Count query failed:", countErr.message);
} else {
  console.log(`\n🎉 Import complete! Total rows in navios_diesel: ${count}`);
}

// Test RPCs
const { data: ultima } = await supabase.rpc("get_nd_ultima_coleta", {});
console.log("  get_nd_ultima_coleta:", JSON.stringify(ultima));

const { data: coletas } = await supabase.rpc("get_nd_coletas_distintas", {});
console.log("  get_nd_coletas_distintas:", JSON.stringify(coletas));

const { data: resumo } = await supabase.rpc("get_nd_resumo_portos", {
  p_collected_at: Array.isArray(coletas) ? coletas[0] : null,
});
console.log("  get_nd_resumo_portos:", JSON.stringify(resumo));
