// Export spec for /price-bands.
//
// Per the export-library-contract (docs/app/export-library-contract.md):
//   Tier 1 · filterSource "none" · 2 sheets (Diesel + Gasoline) · No modal · No charts
//   CSV: single-with-discriminator (discriminatorColumn: "product").
//
// Always full history, both products. The dashboard's slider only affects the
// chart viewport — exports carry the full price_bands history regardless.

import type { ExportSpec } from "@/lib/export/types";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { rpcGetPriceBandsData, type PriceBandsRow } from "@/lib/rpc";

// ─── Column definitions (English headers, numFmt "0.00") ─────────────────────

const DIESEL_COLUMNS = [
  { key: "date",                        header: "Date",                          format: "yyyy-mm-dd", align: "left" as const },
  { key: "bba_import_parity",           header: "BBA Import Parity",             format: "0.00" },
  { key: "bba_import_parity_w_subsidy", header: "BBA Import Parity w/ Subsidy",  format: "0.00" },
  { key: "bba_export_parity",           header: "BBA Export Parity",             format: "0.00" },
  { key: "petrobras_price",             header: "Petrobras Price",               format: "0.00" },
  { key: "petrobras_price_w_subsidy",   header: "Petrobras Price w/ Subsidy",    format: "0.00" },
];

const GASOLINE_COLUMNS = [
  { key: "date",              header: "Date",              format: "yyyy-mm-dd", align: "left" as const },
  { key: "bba_import_parity", header: "BBA Import Parity", format: "0.00" },
  { key: "bba_export_parity", header: "BBA Export Parity", format: "0.00" },
  { key: "petrobras_price",   header: "Petrobras Price",   format: "0.00" },
];

// ─── Row fetchers — one RPC call per product (always full history) ───────────

async function fetchDieselRows(): Promise<Record<string, unknown>[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const rows = await rpcGetPriceBandsData(supabase, "Diesel");
  return rows as unknown as Record<string, unknown>[];
}

async function fetchGasolineRows(): Promise<Record<string, unknown>[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const rows = await rpcGetPriceBandsData(supabase, "Gasoline");
  // Drop the subsidy columns at projection time — Gasoline has no subsidy data.
  return rows.map((r: PriceBandsRow) => ({
    date: r.date,
    bba_import_parity: r.bba_import_parity,
    bba_export_parity: r.bba_export_parity,
    petrobras_price: r.petrobras_price,
  })) as unknown as Record<string, unknown>[];
}

// ─── Spec ────────────────────────────────────────────────────────────────────

export const priceBandsExport: ExportSpec = {
  filename: "PriceBands",
  tier: 1,
  filterSource: "none",
  excel: {
    sheets: [
      {
        name: "Diesel",
        columns: DIESEL_COLUMNS,
        rowsAsync: fetchDieselRows,
      },
      {
        name: "Gasoline",
        columns: GASOLINE_COLUMNS,
        rowsAsync: fetchGasolineRows,
      },
    ],
  },
  csv: {
    mode: "single-with-discriminator",
    discriminatorColumn: "product",
    sheets: [
      {
        name: "Diesel",
        columns: DIESEL_COLUMNS,
        rowsAsync: fetchDieselRows,
      },
      {
        name: "Gasoline",
        columns: GASOLINE_COLUMNS,
        rowsAsync: fetchGasolineRows,
      },
    ],
  },
};
