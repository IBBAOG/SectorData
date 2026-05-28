// ─── anpGlp export spec — owned by worker_dash-anp-glp ──────────────────────
//
// Contract: docs/app/export-library-contract.md.
//
// Tier 1, filterSource "none" — the export always returns the full LPG sales
// history regardless of what the user has selected on the dashboard (period
// slider, category checkboxes, top-distributor select). Power users want the
// full dataset; the dashboard's filters are exploratory only.
//
// Single Excel sheet "LPG Sales" with English headers and two volume columns:
//   - vendas_kg     (raw kg, "#,##0")
//   - vendas_mil_ton (kg / 1e6, "0.000") — kt convenience column
//
// CSV is the same column set, single-mode.

import type { ExportSpec } from "@/lib/export/types";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { rpcGetAnpGlpSerie, type AnpGlpSerieRow } from "@/lib/rpc";
import { kgToMilTon } from "@/lib/units";

// ─── Row shape returned by rowsAsync ─────────────────────────────────────────

type AnpGlpExportRow = {
  ano: number;
  mes: number;
  distribuidora: string;
  categoria: string;
  vendas_kg: number;
  vendas_mil_ton: number;
};

// ─── Data fetcher (full history, no filters) ─────────────────────────────────

async function fetchAllAnpGlpRows(): Promise<AnpGlpExportRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  // Empty params → RPC receives all-NULL filters → full history.
  const rows: AnpGlpSerieRow[] = await rpcGetAnpGlpSerie(supabase, {});

  return rows.map((r) => ({
    ano: r.ano,
    mes: r.mes,
    distribuidora: r.distribuidora,
    categoria: r.categoria,
    vendas_kg: r.vendas_kg ?? 0,
    vendas_mil_ton: kgToMilTon(r.vendas_kg ?? 0),
  }));
}

// ─── Column definitions (shared by Excel + CSV) ──────────────────────────────

const COLUMNS = [
  { key: "ano",            header: "Year",                 align: "center" as const, width: 8  },
  { key: "mes",            header: "Month",                align: "center" as const, width: 8  },
  { key: "distribuidora",  header: "Distributor",          align: "left"   as const, width: 28 },
  { key: "categoria",      header: "Category",             align: "left"   as const, width: 22 },
  { key: "vendas_kg",      header: "Sales (kg)",           align: "right"  as const, width: 16, format: "#,##0" },
  { key: "vendas_mil_ton", header: "Sales (thousand t)",   align: "right"  as const, width: 18, format: "0.000" },
];

// ─── Spec ────────────────────────────────────────────────────────────────────

export const anpGlpExport: ExportSpec = {
  filename: "LPGSales",
  tier: 1,
  filterSource: "none",
  excel: {
    sheets: [
      {
        name: "LPG Sales",
        title: "ANP — LPG Sales by Distributor",
        columns: COLUMNS,
        rowsAsync: () => fetchAllAnpGlpRows() as unknown as Promise<Record<string, unknown>[]>,
      },
    ],
  },
  csv: {
    mode: "single",
    columns: COLUMNS,
    rowsAsync: () => fetchAllAnpGlpRows() as unknown as Promise<Record<string, unknown>[]>,
  },
};
