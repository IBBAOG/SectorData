/**
 * Export spec for `/diesel-gasoline-margins` (Diesel & Gasoline Margins).
 *
 * Tier 1, no filters (always full history, both fuel types).
 * - Excel: 2 sheets ("Diesel B" + "Gasoline C") with biofuel column header
 *   renamed per fuel ("Biodiesel" vs "Anhydrous Ethanol") and base_fuel
 *   header renamed per fuel ("Diesel A" vs "Gasoline A").
 * - CSV: single file with discriminator column `fuel_type` (Diesel B / Gasoline C).
 *
 * Decision: no chart embed (descartado o stacked bar — confirmado pelo CTO).
 *
 * Owner: worker_dash-margins (see docs/app/export-library-contract.md
 * → "Worker dispatch — file ownership matrix").
 */

import { getSupabaseClient } from "@/lib/supabaseClient";
import { rpcGetDgMarginsData, type DgMarginsRow } from "@/lib/rpc";
import type { ColumnDef, ExportSpec, SheetSpec } from "@/lib/export/types";

// ── Column order (shared across both sheets and the CSV) ─────────────────────
//
// Order matches the analyst's mental layout (margin first, then taxes,
// then biofuel/base, then total). `biofuel_component` and `base_fuel`
// have per-fuel header overrides — defined inline per sheet below.

const NUM_FMT = "0.00";

function buildColumns(opts: {
  biofuelHeader: string;
  baseFuelHeader: string;
}): ColumnDef[] {
  return [
    { key: "week",                            header: "Week",                            width: 12, align: "left"  },
    { key: "distribution_and_resale_margin", header: "Distribution & Resale Margin",    width: 32, format: NUM_FMT, align: "right" },
    { key: "state_tax",                       header: "State Tax",                       width: 14, format: NUM_FMT, align: "right" },
    { key: "federal_tax",                     header: "Federal Tax",                     width: 14, format: NUM_FMT, align: "right" },
    { key: "biofuel_component",               header: opts.biofuelHeader,                width: 20, format: NUM_FMT, align: "right" },
    { key: "base_fuel",                       header: opts.baseFuelHeader,               width: 14, format: NUM_FMT, align: "right" },
    { key: "total",                           header: "Total",                           width: 12, format: NUM_FMT, align: "right" },
  ];
}

const DIESEL_COLS   = buildColumns({ biofuelHeader: "Biodiesel",         baseFuelHeader: "Diesel A"   });
const GASOLINE_COLS = buildColumns({ biofuelHeader: "Anhydrous Ethanol", baseFuelHeader: "Gasoline A" });

// ── rowsAsync — one RPC call per fuel type, no filters ──────────────────────

async function fetchRows(fuelType: "Diesel B" | "Gasoline C"): Promise<Record<string, unknown>[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const rows = await rpcGetDgMarginsData(supabase, fuelType);
  return rows as unknown as Record<string, unknown>[];
}

// ── Sheets ───────────────────────────────────────────────────────────────────

const dieselSheet: SheetSpec = {
  name:    "Diesel B",
  title:   "Diesel B — Price Composition (BRL/L)",
  columns: DIESEL_COLS,
  rowsAsync: () => fetchRows("Diesel B"),
};

const gasolineSheet: SheetSpec = {
  name:    "Gasoline C",
  title:   "Gasoline C — Price Composition (BRL/L)",
  columns: GASOLINE_COLS,
  rowsAsync: () => fetchRows("Gasoline C"),
};

// ── Public spec ──────────────────────────────────────────────────────────────

export const dgMarginsExport: ExportSpec = {
  filename:     "DGMargins",
  tier:         1,
  filterSource: "none",
  excel: {
    sheets: [dieselSheet, gasolineSheet],
  },
  csv: {
    mode: "single-with-discriminator",
    discriminatorColumn: "fuel_type",
    sheets: [dieselSheet, gasolineSheet],
  },
};

// Type re-export so callers don't need to chase the source row type.
export type { DgMarginsRow };
