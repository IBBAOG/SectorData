// ─────────────────────────────────────────────────────────────────────────────
// importsExports.ts — Export spec for /imports-exports.
//
// Tier 2 (modal-editable filters). Two heterogeneous outputs:
//
//   Sheet/file 1 — "Imports": raw rows from anp_desembaracos joined with
//     mdic_comex (for valor_usd) and ncm_densidade_kg_m3 (for volume_m3 +
//     unit_price_usd_ton). Carries importer-level granularity (importador,
//     cnpj, uf_cnpj). One row per (ano, mes, pais_origem, importador, cnpj,
//     ncm_codigo).
//   Sheet/file 2 — "Exports": raw rows from mdic_comex (flow='export').
//     No importer identity (MDIC does not carry it). One row per
//     (ano, mes, pais_destino, ncm_codigo).
//
// The modal lets the user edit:
//   • Period (date-range — anos: YYYY-MM-DD, but only year is meaningful)
//   • Produto (multi-select: Diesel / Gasoline / Crude Oil)
//   • Flow toggle (segmented: imports / exports / both)
//   • País (multi-select, optional — empty means all)
//
// Defaults: last 2 years, all 3 products, both flows.
//
// CSV mode is "zip" because Imports and Exports have heterogeneous schemas
// (Exports has no importador / cnpj / uf_cnpj columns). The two files travel
// together in a single .zip.
//
// Owner: worker_dash-imports-exports.
// Sub-PRD: docs/app/imports-exports.md § "Export — Tier 2 (unified library)".
//
// Dependencies (provided by other workers):
//   • src/lib/export/types.ts (worker_subgerente-app)
//   • RPCs get_imports_exports_raw_imports / get_imports_exports_raw_exports /
//     get_imports_exports_export_count (worker_supabase)
//   • RPC wrappers rpcGetImportsExportsRawImports / ...RawExports /
//     ...ExportCount in src/lib/rpc.ts (this commit adds the wrappers).
// ─────────────────────────────────────────────────────────────────────────────

import type { ExportSpec } from "@/lib/export";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetImportsExportsRawImports,
  rpcGetImportsExportsRawExports,
  rpcGetImportsExportsExportCount,
} from "@/lib/rpc";

// Default period: last 2 years ending today (calendar-based; the RPC clamps
// against the actual data bounds anyway).
function defaultDateRange(): [string, string] {
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - 2);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  return [fmt(start), fmt(end)];
}

// Shape of the modal filter state once the user clicks Download.
// The keys mirror FilterControl.key in `spec.modal.filters` below.
type ModalFilters = {
  period?: [string, string];
  produtos?: string[];
  flow?: "imports" | "exports" | "both";
  paises?: string[];
};

// Translates date-range strings into (anoInicio, mesInicio, anoFim, mesFim).
function parsePeriod(period?: [string, string]): {
  anoInicio: number;
  mesInicio: number;
  anoFim: number;
  mesFim: number;
} {
  const [startStr, endStr] = period ?? defaultDateRange();
  const start = new Date(startStr);
  const end = new Date(endStr);
  return {
    anoInicio: start.getFullYear(),
    mesInicio: start.getMonth() + 1,
    anoFim: end.getFullYear(),
    mesFim: end.getMonth() + 1,
  };
}

function pickProdutos(filters: ModalFilters): string[] {
  const all: string[] = ["Diesel", "Gasoline", "Crude Oil"];
  return filters.produtos && filters.produtos.length > 0
    ? filters.produtos
    : all;
}

function pickPaises(filters: ModalFilters): string[] | null {
  return filters.paises && filters.paises.length > 0 ? filters.paises : null;
}

function pickFlow(filters: ModalFilters): "imports" | "exports" | "both" {
  return filters.flow ?? "both";
}

// Build the RPC param object once — used by rowsAsync + countRpc to stay
// in lockstep (so the size estimator never disagrees with what actually
// downloads).
function buildRpcFilters(raw: Record<string, unknown>): {
  anoInicio: number;
  mesInicio: number;
  anoFim: number;
  mesFim: number;
  produtos: string[];
  paises: string[] | null;
  flow: "imports" | "exports" | "both";
} {
  const f = raw as ModalFilters;
  const period = parsePeriod(f.period);
  return {
    ...period,
    produtos: pickProdutos(f),
    paises: pickPaises(f),
    flow: pickFlow(f),
  };
}

// ─── rowsAsync helpers ───────────────────────────────────────────────────────

async function fetchImportsRows(
  raw: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const f = buildRpcFilters(raw);
  if (f.flow === "exports") return []; // Flow toggle hid the imports sheet
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  return rpcGetImportsExportsRawImports(supabase, {
    ano_inicio: f.anoInicio,
    mes_inicio: f.mesInicio,
    ano_fim: f.anoFim,
    mes_fim: f.mesFim,
    produtos: f.produtos,
    paises: f.paises,
  });
}

async function fetchExportsRows(
  raw: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const f = buildRpcFilters(raw);
  if (f.flow === "imports") return []; // Flow toggle hid the exports sheet
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  return rpcGetImportsExportsRawExports(supabase, {
    ano_inicio: f.anoInicio,
    mes_inicio: f.mesInicio,
    ano_fim: f.anoFim,
    mes_fim: f.mesFim,
    produtos: f.produtos,
    paises: f.paises,
  });
}

// Sum imports + exports counts respecting the flow toggle.
async function countRows(raw: Record<string, unknown>): Promise<number> {
  const f = buildRpcFilters(raw);
  const supabase = getSupabaseClient();
  if (!supabase) return 0;
  const rows = await rpcGetImportsExportsExportCount(supabase, {
    ano_inicio: f.anoInicio,
    mes_inicio: f.mesInicio,
    ano_fim: f.anoFim,
    mes_fim: f.mesFim,
    produtos: f.produtos,
    paises: f.paises,
  });
  // RPC returns 2 rows: [{ flow: 'imports', n: ... }, { flow: 'exports', n: ... }]
  return rows
    .filter((r) => {
      const flow = String(r.flow ?? "");
      if (f.flow === "both") return true;
      return flow === f.flow;
    })
    .reduce((sum, r) => sum + Number(r.n ?? 0), 0);
}

// ─── optionsAsync helpers ─────────────────────────────────────────────────────

async function fetchProdutoOptions(): Promise<
  { value: string; label: string }[]
> {
  return [
    { value: "Diesel", label: "Diesel" },
    { value: "Gasoline", label: "Gasoline" },
    { value: "Crude Oil", label: "Crude Oil" },
  ];
}

// Empty fetch — we expose the País filter as a free-text-like multi-select
// without pre-populated options so the modal doesn't pay for an extra RPC.
// Most users will leave it empty (=> all countries). If they need to filter,
// they can paste a known country name (e.g. "Estados Unidos" / "Argentina").
// If post-launch usage shows the empty-options UX is awkward, ship an
// options RPC and swap this stub.
async function fetchPaisOptions(): Promise<
  { value: string; label: string }[]
> {
  return [];
}

// ─── Column definitions ──────────────────────────────────────────────────────

const IMPORTS_COLUMNS = [
  { key: "ano", header: "Year", width: 8, format: "0", align: "center" as const },
  { key: "mes", header: "Month", width: 8, format: "0", align: "center" as const },
  { key: "pais_origem", header: "Origin Country", width: 28, align: "left" as const },
  { key: "importador", header: "Importer", width: 38, align: "left" as const },
  { key: "cnpj", header: "CNPJ", width: 18, align: "left" as const },
  { key: "uf_cnpj", header: "UF", width: 6, align: "center" as const },
  { key: "ncm_codigo", header: "NCM Code", width: 12, align: "center" as const },
  { key: "descricao_ncm", header: "NCM Description", width: 40, align: "left" as const },
  { key: "unified_product", header: "Unified Product", width: 14, align: "left" as const },
  { key: "quantidade_kg", header: "Quantity (kg)", width: 16, format: "#,##0", align: "right" as const },
  { key: "volume_m3", header: "Volume (m³)", width: 14, format: "#,##0.000", align: "right" as const },
  { key: "valor_usd", header: "Value (USD)", width: 16, format: "#,##0.00", align: "right" as const },
  { key: "unit_price_usd_ton", header: "Unit Price (USD/ton)", width: 18, format: "#,##0.00", align: "right" as const },
];

const EXPORTS_COLUMNS = [
  { key: "ano", header: "Year", width: 8, format: "0", align: "center" as const },
  { key: "mes", header: "Month", width: 8, format: "0", align: "center" as const },
  { key: "pais_destino", header: "Destination Country", width: 28, align: "left" as const },
  { key: "ncm_codigo", header: "NCM Code", width: 12, align: "center" as const },
  { key: "descricao_ncm", header: "NCM Description", width: 40, align: "left" as const },
  { key: "unified_product", header: "Unified Product", width: 14, align: "left" as const },
  { key: "quantidade_kg", header: "Quantity (kg)", width: 16, format: "#,##0", align: "right" as const },
  { key: "volume_m3", header: "Volume (m³)", width: 14, format: "#,##0.000", align: "right" as const },
  { key: "valor_usd", header: "Value (USD)", width: 16, format: "#,##0.00", align: "right" as const },
  { key: "unit_price_usd_bbl", header: "Unit Price (USD/bbl)", width: 18, format: "#,##0.00", align: "right" as const },
];

// ─── Spec ─────────────────────────────────────────────────────────────────────

export const importsExportsExport: ExportSpec = {
  filename: "ImportsExports",
  tier: 2,
  filterSource: "modal-editable",
  excel: {
    sheets: [
      {
        name: "Imports",
        title: "Brazilian Fuel Imports",
        columns: IMPORTS_COLUMNS,
        rowsAsync: fetchImportsRows,
      },
      {
        name: "Exports",
        title: "Brazilian Fuel Exports",
        columns: EXPORTS_COLUMNS,
        rowsAsync: fetchExportsRows,
      },
    ],
  },
  csv: {
    mode: "zip",
    files: [
      {
        name: "imports",
        columns: IMPORTS_COLUMNS,
        rowsAsync: fetchImportsRows,
      },
      {
        name: "exports",
        columns: EXPORTS_COLUMNS,
        rowsAsync: fetchExportsRows,
      },
    ],
  },
  modal: {
    filters: [
      {
        type: "date-range",
        key: "period",
        label: "Period",
        default: defaultDateRange(),
      },
      {
        type: "multi-select",
        key: "produtos",
        label: "Product",
        optionsAsync: fetchProdutoOptions,
        default: ["Diesel", "Gasoline", "Crude Oil"],
      },
      {
        type: "segmented",
        key: "flow",
        label: "Flow",
        options: [
          { value: "imports", label: "Imports" },
          { value: "exports", label: "Exports" },
          { value: "both", label: "Both" },
        ],
        default: "both",
      },
      {
        type: "multi-select",
        key: "paises",
        label: "Country (optional)",
        optionsAsync: fetchPaisOptions,
        default: [],
      },
    ],
    countRpc: countRows,
  },
};
