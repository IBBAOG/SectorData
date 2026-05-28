// ─── /subsidy-tracker — unified export spec ────────────────────────────────
//
// Tier 1, no modal, no filters (`filterSource: "none"`). Always exports the
// full RPC history. Two Excel sheets — Importador and Produtor — mirror the
// dual-agent chart layout. CSV uses single-with-discriminator on `tipo_agente`
// (one CSV file containing both agents, distinguished by the column).
//
// Column placement reflects the dashboard's per-agent semantics:
//   - Importador sheet: date, ipp, ipp_adjusted, anp_reference, commercialization, cap
//   - Produtor   sheet: date, petrobras, petrobras_adjusted, anp_reference, commercialization, cap
//
// `cap` is derived from the date + agent using the seed timeline in
// `anp_subsidy_caps`: 0.32 (unified) before 2026-04-07; from 2026-04-07
// importador = 1.52, produtor = 1.12. Caps are stable seed data, not pulled
// from an extra RPC.
//
// The underlying RPC `rpcGetSubsidyTrackerDiesel()` returns BOTH agents in a
// single call (13 columns). We memoize that one call across all sheet/CSV
// builders so we never re-hit the network.

import type { ExportSpec, ColumnDef } from "@/lib/export/types";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetSubsidyTrackerDiesel,
  type SubsidyTrackerRow,
} from "@/lib/rpc";

// ─── Cap timeline (mirrors the seed in `anp_subsidy_caps`) ──────────────────
// vigente_desde 2026-03-13: importador 0.32, produtor 0.32 (unified)
// vigente_desde 2026-04-07: importador 1.52, produtor 1.12
const CAP_SPLIT_DATE = "2026-04-07";

function capForDate(date: string, agent: "importador" | "produtor"): number | null {
  if (!date) return null;
  // Pre-subsidy: leave cap blank rather than backdating an arbitrary 0.
  if (date < "2026-03-13") return null;
  if (date < CAP_SPLIT_DATE) return 0.32;
  return agent === "importador" ? 1.52 : 1.12;
}

// ─── Per-request memoization ────────────────────────────────────────────────
// Both Excel sheets + CSV may all fire rowsAsync in the same click. Avoid
// duplicate RPC roundtrips by caching the latest in-flight promise.
let cachedPromise: Promise<SubsidyTrackerRow[]> | null = null;
let cachedAt = 0;

function fetchOnce(): Promise<SubsidyTrackerRow[]> {
  const now = Date.now();
  // 30s TTL — a single export click resolves all sheets within milliseconds;
  // back-to-back clicks within the window also reuse.
  if (cachedPromise && now - cachedAt < 30_000) return cachedPromise;
  cachedAt = now;
  const supabase = getSupabaseClient();
  if (!supabase) {
    cachedPromise = Promise.resolve([]);
  } else {
    cachedPromise = rpcGetSubsidyTrackerDiesel(supabase).catch((err) => {
      // Reset cache so the next click retries.
      cachedPromise = null;
      cachedAt = 0;
      throw err;
    });
  }
  return cachedPromise;
}

// ─── Row shapers per agent ──────────────────────────────────────────────────

function toImportadorRow(r: SubsidyTrackerRow): Record<string, unknown> {
  return {
    date: r.date,
    ipp: r.ipp,
    ipp_adjusted: r.ipp_adjusted,
    anp_reference: r.anp_reference_importador,
    commercialization: r.anp_commercialization_importador,
    cap: capForDate(r.date, "importador"),
  };
}

function toProdutorRow(r: SubsidyTrackerRow): Record<string, unknown> {
  return {
    date: r.date,
    petrobras: r.petrobras,
    petrobras_adjusted: r.petrobras_adjusted,
    anp_reference: r.anp_reference_produtor,
    commercialization: r.anp_commercialization_produtor,
    cap: capForDate(r.date, "produtor"),
  };
}

// ─── Column definitions (Arial 10, brand-aligned numFmt for BRL/L) ─────────
// Format "0.0000" preserves 4 decimals on prices (BRL/L is typically priced to
// the 4th decimal in ANP publications). Header text is English.
const PRICE_FMT = "0.0000";

const IMPORTADOR_COLUMNS: ColumnDef[] = [
  { key: "date",              header: "Date",                  width: 12, align: "left"   },
  { key: "ipp",               header: "IPP",                   width: 12, format: PRICE_FMT, align: "center" },
  { key: "ipp_adjusted",      header: "IPP (adjusted)",        width: 18, format: PRICE_FMT, align: "center" },
  { key: "anp_reference",     header: "ANP Reference",         width: 16, format: PRICE_FMT, align: "center" },
  { key: "commercialization", header: "ANP Commercialization", width: 22, format: PRICE_FMT, align: "center" },
  { key: "cap",               header: "Cap (BRL/L)",           width: 14, format: PRICE_FMT, align: "center" },
];

const PRODUTOR_COLUMNS: ColumnDef[] = [
  { key: "date",                header: "Date",                  width: 12, align: "left"   },
  { key: "petrobras",           header: "Petrobras",             width: 12, format: PRICE_FMT, align: "center" },
  { key: "petrobras_adjusted",  header: "Petrobras (adjusted)",  width: 22, format: PRICE_FMT, align: "center" },
  { key: "anp_reference",       header: "ANP Reference",         width: 16, format: PRICE_FMT, align: "center" },
  { key: "commercialization",   header: "ANP Commercialization", width: 22, format: PRICE_FMT, align: "center" },
  { key: "cap",                 header: "Cap (BRL/L)",           width: 14, format: PRICE_FMT, align: "center" },
];

// ─── Spec ───────────────────────────────────────────────────────────────────

export const subsidyTrackerExport: ExportSpec = {
  filename: "SubsidyTracker",
  tier: 1,
  filterSource: "none",
  excel: {
    sheets: [
      {
        name: "Importador",
        title: "Subsidy Tracker — Diesel (Importador)",
        columns: IMPORTADOR_COLUMNS,
        rowsAsync: async () => {
          const all = await fetchOnce();
          return all.map(toImportadorRow);
        },
      },
      {
        name: "Produtor",
        title: "Subsidy Tracker — Diesel (Produtor)",
        columns: PRODUTOR_COLUMNS,
        rowsAsync: async () => {
          const all = await fetchOnce();
          return all.map(toProdutorRow);
        },
      },
    ],
  },
  csv: {
    mode: "single-with-discriminator",
    discriminatorColumn: "tipo_agente",
    sheets: [
      {
        name: "Importador",
        columns: IMPORTADOR_COLUMNS,
        rowsAsync: async () => {
          const all = await fetchOnce();
          return all.map(toImportadorRow);
        },
      },
      {
        name: "Produtor",
        columns: PRODUTOR_COLUMNS,
        rowsAsync: async () => {
          const all = await fetchOnce();
          return all.map(toProdutorRow);
        },
      },
    ],
  },
};
