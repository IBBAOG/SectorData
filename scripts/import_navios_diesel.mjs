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
// Prefer env vars (CI), fall back to .env file (local)
let url = process.env.SUPABASE_URL;
let key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  try {
    const envText = fs.readFileSync(path.resolve(".env"), "utf8");
    url = url || envText.match(/SUPABASE_URL=(.*)/)?.[1]?.trim();
    key = key || envText.match(/SUPABASE_SERVICE_KEY=(.*)/)?.[1]?.trim();
  } catch { /* no .env file */ }
}

if (!url || !key) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY (set env vars or .env)");
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

  // Build ISO string with BRT offset (-03:00)
  const pad = (n) => String(n).padStart(2, "0");
  const iso = `${y}-${pad(parseInt(month, 10))}-${pad(parseInt(day, 10))}T${pad(parseInt(hour ?? "0", 10))}:${pad(parseInt(minute ?? "0", 10))}:${pad(parseInt(second ?? "0", 10))}-03:00`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Parse "YYYY-MM-DD HH:MM" as BRT (UTC-3) */
function parseISOish(raw) {
  if (!raw || raw.trim() === "") return null;
  const s = raw.trim();
  // Must start with a digit (reject header rows like "Consulta")
  if (!/^\d/.test(s)) return null;
  const d = new Date(s.replace(" ", "T") + ":00-03:00");
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// ── Read and parse CSV ───────────────────────────────────────────────────────
const csvPath = path.resolve("output/navios_diesel.csv");
let csvText = fs.readFileSync(csvPath, "utf8");
// Strip BOM if present
if (csvText.charCodeAt(0) === 0xfeff) csvText = csvText.slice(1);
const lines = csvText.split("\n");

const records = [];
let skipped = 0;

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed) { skipped++; continue; }
  // Skip header row
  if (trimmed.startsWith("Consulta,") || trimmed.startsWith("Consulta\t")) { skipped++; continue; }

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

// ── Wipe table then insert (Supabase = exact mirror of CSV) ─────────────────
const { error: delErr } = await supabase.from("navios_diesel").delete().gte("id", 0);
if (delErr) {
  console.error("❌ Failed to wipe table:", delErr.message);
  process.exit(1);
}
console.log("🗑️  Table wiped");

const BATCH = 500;
let inserted = 0;

for (let i = 0; i < records.length; i += BATCH) {
  const batch = records.slice(i, i + BATCH);

  const { error } = await supabase
    .from("navios_diesel")
    .upsert(batch, { onConflict: "collected_at,porto,navio", ignoreDuplicates: true });

  if (error) {
    console.error(`❌ Batch ${i}-${i + batch.length} failed:`, error.message);
    process.exit(1);
  }

  inserted += batch.length;
  console.log(`✅ Upserted ${inserted}/${records.length}`);
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
