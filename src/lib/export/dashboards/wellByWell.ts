// ─────────────────────────────────────────────────────────────────────────────
// Export spec — /well-by-well (Brazil Production Summary)
//
// Owned by: worker_dash-well-by-well.
// Decision table row (docs/app/export-library-contract.md):
//   Tier 2 · 5 sheets (Brasil + 4 empresas) · filterSource "none" (always full
//   history; ignores screen Period filter) · No charts · CSV mode
//   "single-with-discriminator" with discriminatorColumn "view".
//
// Each sheet returns 1 row per (ano, mes, campo, poço). Columns are the same
// across all sheets EXCEPT `stake_pct` which is only meaningful on the four
// company sheets (it's always 100 for Brasil, hidden in that sheet). Company
// rows are stake-weighted server-side; Brasil rows are 100% WI.
//
// Backend RPCs (owned by worker_supabase, shipped in parallel):
//   • get_production_brazil_well_full_history()  → Brasil sheet
//   • get_production_well_full_history(p_empresa) → one of the four company sheets
//
// Modal countRpc: there is no server-side count helper for these RPCs, so the
// estimator calls all 5 row-fetching RPCs in parallel and sums the resulting
// lengths. `SizeEstimator` debounces this to 300ms and only fires on modal
// open + format toggle changes, so the cost is bounded.
// ─────────────────────────────────────────────────────────────────────────────

import type { ExportSpec, ColumnDef, SheetSpec } from "@/lib/export";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetProductionBrazilWellFullHistory,
  rpcGetProductionWellFullHistory,
} from "@/lib/rpc";

// ── View / sheet identity ────────────────────────────────────────────────────
// The view labels here MUST match the sheet names declared in the contract:
// "Brasil", "Petrobras", "PRIO", "PetroReconcavo", "Brava Energia". They also
// double as the values of the CSV `view` discriminator column.
const BRASIL_VIEW = "Brasil";
const COMPANY_VIEWS = ["Petrobras", "PRIO", "PetroReconcavo", "Brava Energia"] as const;

// ── Column definitions ──────────────────────────────────────────────────────
// Shared base columns. The company sheets append `stake_pct`; the Brasil sheet
// omits it (a Brasil row is always 100% WI by construction).
const BASE_COLUMNS: ColumnDef[] = [
  { key: "ano",           header: "Year",            width: 8,  format: "0",         align: "center" },
  { key: "mes",           header: "Month",           width: 8,  format: "0",         align: "center" },
  { key: "bacia",         header: "Basin",           width: 22, align: "left" },
  { key: "estado",        header: "State",           width: 10, align: "center" },
  { key: "ambiente",      header: "Environment",     width: 14, align: "center" },
  { key: "campo",         header: "Field",           width: 28, align: "left" },
  { key: "poco",          header: "Well",            width: 22, align: "left" },
  { key: "operador",      header: "Operator",        width: 28, align: "left" },
  { key: "instalacao",    header: "Installation",    width: 28, align: "left" },
  { key: "oil_bbl_dia",   header: "Oil (bbl/day)",   width: 16, format: "#,##0.0",   align: "right" },
  { key: "gas_mm3_dia",   header: "Gas (Mm³/day)",   width: 16, format: "#,##0.000", align: "right" },
  { key: "water_bbl_dia", header: "Water (bbl/day)", width: 16, format: "#,##0.0",   align: "right" },
  { key: "uptime_hs_mes", header: "Uptime (h/month)", width: 16, format: "#,##0.0",  align: "right" },
];

const COMPANY_STAKE_COLUMN: ColumnDef = {
  key: "stake_pct",
  header: "Stake (%)",
  width: 12,
  format: "0.00",
  align: "right",
};

const BRASIL_COLUMNS: ColumnDef[] = BASE_COLUMNS;
const COMPANY_COLUMNS: ColumnDef[] = [...BASE_COLUMNS, COMPANY_STAKE_COLUMN];

// ── rowsAsync helpers ───────────────────────────────────────────────────────
// `filterSource: "none"` means the spec ignores any external filter state —
// the dashboard's Period and Reference Month selectors do NOT scope the
// export. Always full history at well granularity.

async function fetchBrasilRows(): Promise<Record<string, unknown>[]> {
  const sb = getSupabaseClient();
  if (!sb) return [];
  const rows = await rpcGetProductionBrazilWellFullHistory(sb);
  return rows as unknown as Record<string, unknown>[];
}

async function fetchCompanyRows(empresa: string): Promise<Record<string, unknown>[]> {
  const sb = getSupabaseClient();
  if (!sb) return [];
  const rows = await rpcGetProductionWellFullHistory(sb, empresa);
  return rows as unknown as Record<string, unknown>[];
}

// ── Sheets ──────────────────────────────────────────────────────────────────
const sheets: SheetSpec[] = [
  {
    name: BRASIL_VIEW,
    title: "Brazil — Monthly production by well (full history)",
    columns: BRASIL_COLUMNS,
    rowsAsync: () => fetchBrasilRows(),
  },
  ...COMPANY_VIEWS.map<SheetSpec>((empresa) => ({
    name: empresa,
    title: `${empresa} — Monthly production by well (stake-weighted, full history)`,
    columns: COMPANY_COLUMNS,
    rowsAsync: () => fetchCompanyRows(empresa),
  })),
];

// ── Modal size estimator ────────────────────────────────────────────────────
// No dedicated count RPC exists — call all 5 row-fetching RPCs in parallel
// and sum lengths. SizeEstimator debounces this to 300ms; under typical use
// the estimator fires once on modal open and once again only if the user
// flips between Excel / CSV.
async function countAllRows(): Promise<number> {
  const sb = getSupabaseClient();
  if (!sb) return 0;
  const results = await Promise.all([
    rpcGetProductionBrazilWellFullHistory(sb),
    ...COMPANY_VIEWS.map((empresa) => rpcGetProductionWellFullHistory(sb, empresa)),
  ]);
  return results.reduce((sum, arr) => sum + arr.length, 0);
}

// ── Spec ────────────────────────────────────────────────────────────────────
export const wellByWellExport: ExportSpec = {
  filename: "BrazilProductionSummary",
  tier: 2,
  filterSource: "none",
  excel: { sheets },
  csv: {
    mode: "single-with-discriminator",
    discriminatorColumn: "view",
    sheets,
  },
  modal: {
    filters: [],
    countRpc: () => countAllRows(),
  },
};
