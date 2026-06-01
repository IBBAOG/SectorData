// ─── anpGlp export spec — owned by worker_dash-anp-glp ──────────────────────
//
// Contract: docs/app/export-library-contract.md.
//
// /anp-glp was rebuilt (2026-06-05) as "LPG Market Share" — a faithful clone
// of /market-share over the anp_glp table. The export mirrors that dashboard's
// content: per-(month, distributor, category) LPG sales, with both a raw kg
// column and a thousand-tons (kt) convenience column.
//
// Tier 1, filterSource "none" — the export always returns the full LPG sales
// history regardless of dashboard selection (period slider, view mode,
// competitors). Power users want the full dataset; on-screen filters are
// exploratory only. The desktop header shows a live size estimate
// (get_anp_glp_ms_export_count via useExportSize) so the user knows the
// download footprint before clicking.
//
// Filenames mirror the /market-share convention for the LPG product:
//   Excel → "LPG Market Share DD-MM-YY.xlsx"   (date suffix added by core)
//   CSV   → "LPGMarketShare_DD-MM-YY.csv"
//
// Single Excel sheet "LPG Market Share" with English headers:
//   - vendas_kg      (raw kg, "#,##0")
//   - vendas_mil_ton (kg / 1e6, "0.000") — thousand-tons convenience column

import type { ExportSpec } from "@/lib/export/types";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { rpcGetAnpGlpMsSerieFast, type MsSerieRow } from "@/lib/rpc";
import { kgToMilTon } from "@/lib/units";

// ─── Row shape returned by rowsAsync ─────────────────────────────────────────

type LpgMarketShareExportRow = {
  date: string;
  distribuidora: string;
  categoria: string;
  vendas_kg: number;
  vendas_mil_ton: number;
};

// ─── Data fetcher (full history, no filters) ─────────────────────────────────
// Uses the market-share series RPC (column shape date / classificacao /
// nome_produto / quantidade) so the export and the on-screen charts share a
// single source of truth.

async function fetchAllLpgRows(): Promise<LpgMarketShareExportRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  // All-NULL filters → full history.
  const rows: MsSerieRow[] = await rpcGetAnpGlpMsSerieFast(supabase, {
    distribuidoras: null,
    categorias: null,
    anoInicio: null,
    anoFim: null,
  });

  return rows.map((r) => ({
    date: r.date,
    distribuidora: r.classificacao,
    categoria: r.nome_produto,
    vendas_kg: r.quantidade ?? 0,
    vendas_mil_ton: kgToMilTon(r.quantidade ?? 0),
  }));
}

// ─── Column definitions (shared by Excel + CSV) ──────────────────────────────

const COLUMNS = [
  { key: "date",           header: "Month",                align: "center" as const, width: 12 },
  { key: "distribuidora",  header: "Distributor",          align: "left"   as const, width: 28 },
  { key: "categoria",      header: "Category",             align: "left"   as const, width: 22 },
  { key: "vendas_kg",      header: "Sales (kg)",           align: "right"  as const, width: 16, format: "#,##0" },
  { key: "vendas_mil_ton", header: "Sales (thousand t)",   align: "right"  as const, width: 18, format: "0.000" },
];

// ─── Spec ────────────────────────────────────────────────────────────────────

export const anpGlpExport: ExportSpec = {
  filename: "LPGMarketShare",
  tier: 1,
  filterSource: "none",
  excel: {
    sheets: [
      {
        name: "LPG Market Share",
        title: "ANP — LPG Market Share by Distributor",
        columns: COLUMNS,
        rowsAsync: () => fetchAllLpgRows() as unknown as Promise<Record<string, unknown>[]>,
      },
    ],
  },
  csv: {
    mode: "single",
    columns: COLUMNS,
    rowsAsync: () => fetchAllLpgRows() as unknown as Promise<Record<string, unknown>[]>,
  },
};
