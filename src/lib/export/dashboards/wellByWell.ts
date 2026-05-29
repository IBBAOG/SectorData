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
//   • get_production_brazil_well_full_history(p_offset, p_limit)
//   • get_production_well_full_history(p_empresa, p_offset, p_limit)
//   • get_production_brazil_well_count()           ← size estimator
//   • get_production_well_count(p_empresa)         ← size estimator
//
// Pagination. PostgREST's `db-max-rows` cap (now raised to 50000 server-side
// by worker_supabase, up from the default 1000) bounds every SETOF response.
// We loop in chunks of PAGE_SIZE (50000, matching the cap) and stop ONLY on
// an empty chunk — a partial chunk is NOT a reliable end-of-data signal,
// because exactly-PAGE_SIZE rows remaining would still come back as a "full"
// page and the next call would be the one that returns empty. Trusting
// `chunk.length < PAGE_SIZE` (the old heuristic) misfired catastrophically
// while the server cap was 1000: every chunk was capped at 1000, so the
// short-chunk check tripped after page 1 and the export shipped with only
// 1000 rows per sheet. A hard offset safety cap (MAX_OFFSET_SAFETY) prevents
// an infinite loop in case the RPC ever misbehaves and returns full pages
// forever.
//
// Resilience. Each sheet's rowsAsync is wrapped in try/catch so a single
// sheet failure (e.g. one company RPC errors out) does not blank the entire
// workbook — the failing sheet emits an empty rowset and the others render.
//
// Size estimator. The previous implementation fetched all 5 row-RPCs in
// parallel and summed `.length` — that was both slow (full payloads pulled
// just to count) and broken (truncated to 1000 per RPC, undercounting the
// real export by 5–6×). We now call 5 dedicated lightweight COUNT RPCs.
// ─────────────────────────────────────────────────────────────────────────────

import type { ExportSpec, ColumnDef, SheetSpec } from "@/lib/export";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  type ProductionWellFullHistoryRow,
  rpcGetProductionBrazilWellCount,
  rpcGetProductionBrazilWellFullHistory,
  rpcGetProductionWellCount,
  rpcGetProductionWellFullHistory,
} from "@/lib/rpc";

// ── View / sheet identity ────────────────────────────────────────────────────
// The view labels here MUST match the sheet names declared in the contract:
// "Brasil", "Petrobras", "PRIO", "PetroReconcavo", "Brava Energia". They also
// double as the values of the CSV `view` discriminator column.
const BRASIL_VIEW = "Brasil";
const COMPANY_VIEWS = ["Petrobras", "PRIO", "PetroReconcavo", "Brava Energia"] as const;

// ── Pagination constants ────────────────────────────────────────────────────
// PAGE_SIZE matches the PostgREST `db-max-rows` cap (50000, raised from the
// default 1000 by worker_supabase). Going above the cap has no effect — the
// server will still truncate to the cap silently. Going below leaves perf on
// the table (more round-trips than necessary). With ~2.2M Brasil rows this
// is ~45 round-trips at ~500ms each ≈ ~22s for a full-history Brasil export,
// which is acceptable for a Tier 2 modal-gated download.
// MAX_OFFSET_SAFETY guards against runaway loops — at 5_000_000 rows the
// largest sheet (Brasil) would still finish in ~100 round-trips, well past
// any realistic dataset size.
const PAGE_SIZE = 50000;
const MAX_OFFSET_SAFETY = 5_000_000;

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

async function fetchAllPagesBrasil(): Promise<Record<string, unknown>[]> {
  const sb = getSupabaseClient();
  if (!sb) return [];
  const all: ProductionWellFullHistoryRow[] = [];
  let offset = 0;
  for (;;) {
    let chunk: ProductionWellFullHistoryRow[] = [];
    try {
      chunk = await rpcGetProductionBrazilWellFullHistory(sb, offset, PAGE_SIZE);
    } catch (e) {
      console.error("[wellByWell] Brasil page failed at offset", offset, e);
      break;
    }
    if (chunk.length === 0) break; // end-of-data — partial chunks are NOT a reliable signal
    all.push(...chunk);
    offset += PAGE_SIZE;
    if (offset > MAX_OFFSET_SAFETY) {
      console.warn("[wellByWell] Brasil offset cap reached", offset);
      break;
    }
  }
  return all as unknown as Record<string, unknown>[];
}

async function fetchAllPagesCompany(empresa: string): Promise<Record<string, unknown>[]> {
  const sb = getSupabaseClient();
  if (!sb) return [];
  const all: ProductionWellFullHistoryRow[] = [];
  let offset = 0;
  for (;;) {
    let chunk: ProductionWellFullHistoryRow[] = [];
    try {
      chunk = await rpcGetProductionWellFullHistory(sb, empresa, offset, PAGE_SIZE);
    } catch (e) {
      console.error(`[wellByWell] Company '${empresa}' page failed at offset`, offset, e);
      break;
    }
    if (chunk.length === 0) break; // end-of-data — partial chunks are NOT a reliable signal
    all.push(...chunk);
    offset += PAGE_SIZE;
    if (offset > MAX_OFFSET_SAFETY) {
      console.warn(`[wellByWell] Company '${empresa}' offset cap reached`, offset);
      break;
    }
  }
  return all as unknown as Record<string, unknown>[];
}

// ── Sheets ──────────────────────────────────────────────────────────────────
// Each rowsAsync is wrapped in try/catch so a single sheet failure does not
// blank the workbook — failed sheets return [] and the workbook still ships.
const sheets: SheetSpec[] = [
  {
    name: BRASIL_VIEW,
    title: "Brazil — Monthly production by well (full history)",
    columns: BRASIL_COLUMNS,
    rowsAsync: async () => {
      try {
        return await fetchAllPagesBrasil();
      } catch (e) {
        console.error("[wellByWell] Brasil sheet failed", e);
        return [];
      }
    },
  },
  ...COMPANY_VIEWS.map<SheetSpec>((empresa) => ({
    name: empresa,
    title: `${empresa} — Monthly production by well (stake-weighted, full history)`,
    columns: COMPANY_COLUMNS,
    rowsAsync: async () => {
      try {
        return await fetchAllPagesCompany(empresa);
      } catch (e) {
        console.error(`[wellByWell] Company sheet '${empresa}' failed`, e);
        return [];
      }
    },
  })),
];

// ── Modal size estimator ────────────────────────────────────────────────────
// Lightweight dedicated COUNT RPCs — see header comment for the rationale of
// the change. SizeEstimator debounces this to 300ms; under typical use it
// fires once on modal open and once again only if the user flips Excel ↔ CSV.
async function countAllRows(): Promise<number> {
  const sb = getSupabaseClient();
  if (!sb) return 0;
  const counts = await Promise.all([
    rpcGetProductionBrazilWellCount(sb),
    ...COMPANY_VIEWS.map((empresa) => rpcGetProductionWellCount(sb, empresa)),
  ]);
  return counts.reduce((sum, n) => sum + n, 0);
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
