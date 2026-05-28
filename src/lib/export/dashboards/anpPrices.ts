// Export spec for /anp-prices.
//
// Owner: worker_subgerente-app (no dedicated dash worker yet — handed off in
// the unified-export wave per docs/app/export-library-contract.md
// § "Worker dispatch — file ownership matrix").
//
// Decision-table row for /anp-prices:
//   • tier            = 2 (Tier 2 modal — heavy dataset)
//   • sheets          = 3 (Producer / Distribution / Retail) — heterogeneous schemas
//   • filterSource    = modal-editable
//   • charts          = none
//   • csv mode        = zip (3 files, schemas differ)
//
// Source RPCs (wrappers in src/lib/rpc.ts):
//   • get_anp_prices_export_counts          → modal.countRpc  (worker_supabase ships)
//   • get_anp_prices_export_producer        → Producer sheet
//   • get_anp_prices_export_distribution    → Distribution sheet
//   • get_anp_prices_export_retail          → Retail sheet
//
// Filters in the modal (4):
//   • Period      (date-range)   — defaults to last 6 months
//   • Product     (multi-select) — 5 unified products
//   • UF          (multi-select) — 27 states
//   • Region      (multi-select) — 5 regions

import type { ExportSpec, ColumnDef } from "../types";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetAnpPricesExportCounts,
  rpcGetAnpPricesExportProducer,
  rpcGetAnpPricesExportDistribution,
  rpcGetAnpPricesExportRetail,
  loadAnpPricesProductOptions,
  makeAnpPricesUfOptionsLoader,
  makeAnpPricesRegionOptionsLoader,
  type AnpPricesExportCountFilters,
} from "@/lib/rpc";

// ─── Filter-key contract (shared by the modal's FilterControl[] + RPCs) ──────
//
// The modal owns its filter state as Record<string, unknown> keyed by these
// strings. The translation `modal filters → AnpPricesExportCountFilters` lives
// here so the spec is the single source of truth.

const FK = {
  period:   "period",   // date-range tuple [from, to]
  products: "products", // string[]
  ufs:      "ufs",      // string[]
  regions:  "regions",  // string[]
} as const;

function translate(filters: Record<string, unknown>): AnpPricesExportCountFilters {
  const period = filters[FK.period] as [string, string] | undefined;
  const products = filters[FK.products] as string[] | undefined;
  const ufs = filters[FK.ufs] as string[] | undefined;
  const regions = filters[FK.regions] as string[] | undefined;

  // The serie RPC uses a single `p_locais` array — merge UFs + regions.
  const locais: string[] = [];
  if (regions && regions.length > 0) locais.push(...regions);
  if (ufs && ufs.length > 0) locais.push(...ufs);

  return {
    produtos:       products && products.length > 0 ? products : null,
    granularidades: null, // let the per-source loader pick the relevant granularities
    locais:         locais.length > 0 ? locais : null,
    dataInicio:     period?.[0] || null,
    dataFim:        period?.[1] || null,
  };
}

// ─── Column definitions (English headers per the contract) ───────────────────
//
// The contract's per-sheet column lists are aspirational (they reference raw
// source-table columns like `distribuidora` / `municipio` that the current
// unified RPC does not surface). Until worker_supabase ships dedicated
// export RPCs, we ship the columns the unified RPC actually returns —
// adapted to the contract's spirit (Date / Source / Product / Location /
// Price / Unit). Once the raw-export RPCs land, swap the column lists below
// without touching the rest of the spec.

const PRODUCER_COLUMNS: ColumnDef[] = [
  { key: "data",    header: "Date Reference", width: 14, align: "left" },
  { key: "produto", header: "Product",        width: 14, align: "left" },
  { key: "local",   header: "Region",         width: 22, align: "left" },
  { key: "preco",   header: "Price",          width: 14, format: "0.0000" },
  { key: "unidade", header: "Unit",           width: 14, align: "left" },
];

const DISTRIBUTION_COLUMNS: ColumnDef[] = [
  { key: "data",    header: "Date Reference", width: 14, align: "left" },
  { key: "produto", header: "Product",        width: 14, align: "left" },
  { key: "local",   header: "Location",       width: 22, align: "left" },
  { key: "preco",   header: "Price",          width: 14, format: "0.0000" },
  { key: "unidade", header: "Unit",           width: 14, align: "left" },
];

const RETAIL_COLUMNS: ColumnDef[] = [
  { key: "data",    header: "Date Reference", width: 14, align: "left" },
  { key: "produto", header: "Product",        width: 14, align: "left" },
  { key: "local",   header: "Location",       width: 22, align: "left" },
  { key: "preco",   header: "Price",          width: 14, format: "0.0000" },
  { key: "unidade", header: "Unit",           width: 14, align: "left" },
];

// ─── Default period (last 6 months) — ISO strings ────────────────────────────

function isoToday(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function isoMinusMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// ─── Spec ────────────────────────────────────────────────────────────────────

export const anpPricesExport: ExportSpec = {
  filename: "ANPPrices",
  tier: 2,
  filterSource: "modal-editable",

  excel: {
    sheets: [
      {
        name: "Producer prices",
        columns: PRODUCER_COLUMNS,
        rowsAsync: async (f) => {
          const supabase = getSupabaseClient();
          if (!supabase) return [];
          const rows = await rpcGetAnpPricesExportProducer(supabase, translate(f));
          // ExcelJS expects Record<string, unknown> — the rpc returns
          // AnpPricesSerieRow + optional produto field, both compatible.
          return rows as unknown as Record<string, unknown>[];
        },
      },
      {
        name: "Distribution prices",
        columns: DISTRIBUTION_COLUMNS,
        rowsAsync: async (f) => {
          const supabase = getSupabaseClient();
          if (!supabase) return [];
          const rows = await rpcGetAnpPricesExportDistribution(supabase, translate(f));
          return rows as unknown as Record<string, unknown>[];
        },
      },
      {
        name: "Retail prices LPC",
        columns: RETAIL_COLUMNS,
        rowsAsync: async (f) => {
          const supabase = getSupabaseClient();
          if (!supabase) return [];
          const rows = await rpcGetAnpPricesExportRetail(supabase, translate(f));
          return rows as unknown as Record<string, unknown>[];
        },
      },
    ],
  },

  csv: {
    mode: "zip",
    files: [
      {
        name: "ANPPrices_Producer",
        columns: PRODUCER_COLUMNS,
        rowsAsync: async (f) => {
          const supabase = getSupabaseClient();
          if (!supabase) return [];
          const rows = await rpcGetAnpPricesExportProducer(supabase, translate(f));
          return rows as unknown as Record<string, unknown>[];
        },
      },
      {
        name: "ANPPrices_Distribution",
        columns: DISTRIBUTION_COLUMNS,
        rowsAsync: async (f) => {
          const supabase = getSupabaseClient();
          if (!supabase) return [];
          const rows = await rpcGetAnpPricesExportDistribution(supabase, translate(f));
          return rows as unknown as Record<string, unknown>[];
        },
      },
      {
        name: "ANPPrices_Retail",
        columns: RETAIL_COLUMNS,
        rowsAsync: async (f) => {
          const supabase = getSupabaseClient();
          if (!supabase) return [];
          const rows = await rpcGetAnpPricesExportRetail(supabase, translate(f));
          return rows as unknown as Record<string, unknown>[];
        },
      },
    ],
  },

  modal: {
    filters: [
      {
        type: "date-range",
        key: FK.period,
        label: "Period",
        default: [isoMinusMonths(6), isoToday()],
      },
      {
        type: "multi-select",
        key: FK.products,
        label: "Products",
        optionsAsync: loadAnpPricesProductOptions,
      },
      {
        type: "multi-select",
        key: FK.ufs,
        label: "States (UF)",
        optionsAsync: () => {
          const supabase = getSupabaseClient();
          if (!supabase) return Promise.resolve([]);
          return makeAnpPricesUfOptionsLoader(supabase)();
        },
      },
      {
        type: "multi-select",
        key: FK.regions,
        label: "Regions",
        optionsAsync: () => {
          const supabase = getSupabaseClient();
          if (!supabase) return Promise.resolve([]);
          return makeAnpPricesRegionOptionsLoader(supabase)();
        },
      },
    ],
    countRpc: async (filters) => {
      const supabase = getSupabaseClient();
      if (!supabase) return 0;
      const counts = await rpcGetAnpPricesExportCounts(supabase, translate(filters));
      return counts.producer + counts.distribution + counts.retail;
    },
  },
};
