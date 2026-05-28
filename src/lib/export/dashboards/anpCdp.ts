/**
 * /anp-cdp — Monthly Production export spec.
 *
 * Owner: worker_dash-anp-cdp.
 *
 * Contract: docs/app/export-library-contract.md (v1).
 *
 * Decided shape (CTO, 2026-05-28):
 *  - Tier 2, modal-editable filters from zero (NOT WYSIWYG).
 *  - A `segmented` filter at the top of the modal switches between two modes:
 *      • "Raw"        → 1 row per (well × month) × 17 source columns.
 *      • "Aggregated" → 1 row per chosen groupBy combination × 5 metrics.
 *  - Modal-editable filters (visible in both modes): Period (date-range),
 *    Estado, Bacia, Campo, Operador, Ambiente (Local), Instalação destino,
 *    Tipo instalação.
 *  - Defaults: last 12 months · all environments · no campo/bacia/estado
 *    restriction · all operators.
 *  - CSV: single file with the chosen mode's columns.
 *  - No charts.
 *  - Filename suffix `_DD-MM-YY` is added by the library. For Aggregated, the
 *    library appends `_by-<groupBy.join('-')>` to the base name (per contract).
 *
 * Library integration:
 *  - All upstream library files (`core/`, `modal/`, `ui/`, `types.ts`,
 *    `index.ts`) are owned by `worker_subgerente-app` + `worker_designer` and
 *    do not yet exist in this worktree. The imports below resolve once the
 *    library lands. TS errors against `@/lib/export/*` until then are expected
 *    and tracked per the rollout plan.
 */

import type { ExportSpec } from "@/lib/export/types";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetAnpCdpExportCount,
  rpcGetAnpCdpRawExport,
  rpcGetAnpCdpAggregatedExport,
  rpcGetAnpCdpFiltros,
  type AnpCdpExportCountFilters,
  type AnpCdpGroupBy,
  type AnpCdpAggregatedRow,
  type AnpCdpRawRow,
} from "@/lib/rpc";

// ─── Filter-shape adapter ────────────────────────────────────────────────────
//
// The unified ExportModal hands the spec a `Record<string, unknown>` with the
// raw values of every filter control (keyed by `FilterControl.key`). The
// helper below normalises that bag into the `AnpCdpExportCountFilters` shape
// that the RPC wrappers expect, including year-range derivation from the
// `period` date-range control.

type ModalFilters = Record<string, unknown>;

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return v.map((x) => String(x));
}

function yearFromIso(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const y = Number(v.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function adaptFilters(f: ModalFilters): AnpCdpExportCountFilters {
  const period = Array.isArray(f.period) ? (f.period as unknown[]) : [];
  const fromIso = period[0];
  const toIso = period[1];
  return {
    bacoes: asStringArray(f.bacia),
    campos: asStringArray(f.campo),
    locais: asStringArray(f.ambiente),
    estados: asStringArray(f.estado),
    operadores: asStringArray(f.operador),
    instalacoes: asStringArray(f.instalacao_destino),
    tiposInstalacao: asStringArray(f.tipo_instalacao),
    pocos: null,
    anoInicio: yearFromIso(fromIso),
    anoFim: yearFromIso(toIso),
  };
}

function readMode(f: ModalFilters): "raw" | "aggregated" {
  return f.mode === "aggregated" ? "aggregated" : "raw";
}

function readGroupBy(f: ModalFilters): AnpCdpGroupBy[] {
  const raw = Array.isArray(f.groupBy) ? (f.groupBy as unknown[]) : [];
  const allowed: ReadonlySet<AnpCdpGroupBy> = new Set<AnpCdpGroupBy>([
    "ano",
    "mes",
    "campo",
    "bacia",
    "operador",
    "estado",
    "local",
    "instalacao_destino",
    "tipo_instalacao",
  ]);
  const out: AnpCdpGroupBy[] = [];
  for (const v of raw) {
    const k = String(v) as AnpCdpGroupBy;
    if (allowed.has(k)) out.push(k);
  }
  // Always anchor on ano + mes when the user did not pick a time dimension —
  // otherwise the aggregate collapses time and metrics become uninterpretable.
  if (out.length === 0) return ["ano", "mes"];
  return out;
}

// ─── Default period — last 12 months (ISO YYYY-MM-DD) ────────────────────────

function defaultPeriod(): [string, string] {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = new Date(to.getFullYear(), to.getMonth() - 11, 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return [iso(from), iso(to)];
}

// ─── optionsAsync helpers — pull filter universes from the existing RPC ──────
//
// `get_anp_cdp_filtros` returns the full universe for every list filter in a
// single round-trip. We cache the in-flight promise so concurrent control
// mounts share one network hit.

let filterCache: ReturnType<typeof loadFiltros> | null = null;

async function loadFiltros() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      bacoes: [] as string[],
      campos: [] as string[],
      locais: [] as string[],
      estados: [] as string[],
      operadores: [] as string[],
      instalacoes: [] as string[],
      tipos_instalacao: [] as string[],
      ano_min: null as number | null,
      ano_max: null as number | null,
    };
  }
  return rpcGetAnpCdpFiltros(supabase);
}

function getFiltrosCached() {
  if (!filterCache) filterCache = loadFiltros();
  return filterCache;
}

async function optionsFromKey(
  key:
    | "bacoes"
    | "campos"
    | "locais"
    | "estados"
    | "operadores"
    | "instalacoes"
    | "tipos_instalacao",
): Promise<{ value: string; label: string }[]> {
  const f = await getFiltrosCached();
  const labelFor = (v: string) =>
    key === "locais"
      ? (v === "PreSal" ? "Pre-Salt" : v === "PosSal" ? "Post-Salt (Offshore)" : v === "Terra" ? "Onshore" : v)
      : v;
  return (f[key] ?? []).map((v: string) => ({ value: v, label: labelFor(v) }));
}

// ─── Column definitions ──────────────────────────────────────────────────────

const RAW_COLUMNS = [
  { key: "ano",                  header: "Year",                width: 8,  align: "center" as const },
  { key: "mes",                  header: "Month",               width: 8,  align: "center" as const },
  { key: "estado",               header: "State",               width: 12, align: "left" as const },
  { key: "bacia",                header: "Basin",               width: 18, align: "left" as const },
  { key: "campo",                header: "Field",               width: 22, align: "left" as const },
  { key: "poco",                 header: "Well",                width: 22, align: "left" as const },
  { key: "operador",             header: "Operator",            width: 22, align: "left" as const },
  { key: "nome_poco_operador",   header: "Operator Well Name",  width: 24, align: "left" as const },
  { key: "num_contrato",         header: "Contract No.",        width: 16, align: "left" as const },
  { key: "instalacao_destino",   header: "Destination Facility", width: 22, align: "left" as const },
  { key: "tipo_instalacao",      header: "Facility Type",       width: 18, align: "left" as const },
  { key: "local",                header: "Environment",         width: 12, align: "left" as const },
  { key: "petroleo_bbl_dia",     header: "Petroleum (bbl/day)", width: 16, align: "right" as const, format: "#,##0.0000" },
  { key: "oleo_bbl_dia",         header: "Oil (bbl/day)",       width: 16, align: "right" as const, format: "#,##0.0000" },
  { key: "gas_total_mm3_dia",    header: "Total Gas (Mm³/day)", width: 18, align: "right" as const, format: "#,##0.0000" },
  { key: "agua_bbl_dia",         header: "Water (bbl/day)",     width: 16, align: "right" as const, format: "#,##0.0000" },
  { key: "tempo_prod_hs_mes",    header: "Production Time (hrs/month)", width: 22, align: "right" as const, format: "#,##0.00" },
] as const;

const DIMENSION_HEADERS: Record<AnpCdpGroupBy, { header: string; width: number; align: "left" | "center" }> = {
  ano:                { header: "Year",                 width: 8,  align: "center" },
  mes:                { header: "Month",                width: 8,  align: "center" },
  campo:              { header: "Field",                width: 22, align: "left" },
  bacia:              { header: "Basin",                width: 18, align: "left" },
  operador:           { header: "Operator",             width: 22, align: "left" },
  estado:             { header: "State",                width: 12, align: "left" },
  local:              { header: "Environment",          width: 12, align: "left" },
  instalacao_destino: { header: "Destination Facility", width: 22, align: "left" },
  tipo_instalacao:    { header: "Facility Type",        width: 18, align: "left" },
};

const METRIC_COLUMNS = [
  { key: "petroleo_bbl_dia",  header: "Petroleum (bbl/day)",         width: 16, align: "right" as const, format: "#,##0.0000" },
  { key: "oleo_bbl_dia",      header: "Oil (bbl/day)",               width: 16, align: "right" as const, format: "#,##0.0000" },
  { key: "gas_total_mm3_dia", header: "Total Gas (Mm³/day)",         width: 18, align: "right" as const, format: "#,##0.0000" },
  { key: "agua_bbl_dia",      header: "Water (bbl/day)",             width: 16, align: "right" as const, format: "#,##0.0000" },
  { key: "tempo_prod_hs_mes", header: "Production Time (hrs/month)", width: 22, align: "right" as const, format: "#,##0.00" },
] as const;

function aggregatedColumns(groupBy: AnpCdpGroupBy[]) {
  const dims = groupBy.map((k) => ({
    key: k,
    header: DIMENSION_HEADERS[k].header,
    width: DIMENSION_HEADERS[k].width,
    align: DIMENSION_HEADERS[k].align,
  }));
  return [...dims, ...METRIC_COLUMNS];
}

// ─── rowsAsync — dispatches Raw vs Aggregated based on modal filter state ────

async function rowsAsync(f: ModalFilters): Promise<Record<string, unknown>[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const filters = adaptFilters(f);
  const mode = readMode(f);

  if (mode === "raw") {
    const rows = await rpcGetAnpCdpRawExport(supabase, filters);
    return rows as unknown as Record<string, unknown>[];
  }
  const groupBy = readGroupBy(f);
  const rows = await rpcGetAnpCdpAggregatedExport(supabase, filters, groupBy);
  // Project to the requested dimensions + 5 metrics so the Excel/CSV writer
  // emits exactly the chosen columns (no stray NULL dimension columns).
  const wanted = [...groupBy, ...METRIC_COLUMNS.map((c) => c.key)];
  return rows.map((r: AnpCdpAggregatedRow) => {
    const out: Record<string, unknown> = {};
    for (const k of wanted) out[k] = (r as unknown as Record<string, unknown>)[k];
    return out;
  });
}

// Columns differ per mode. The library asks the spec for columns up-front; we
// resolve them at build-time from the same filter bag.
function columnsForFilters(f: ModalFilters) {
  if (readMode(f) === "raw") return RAW_COLUMNS as unknown as typeof RAW_COLUMNS[number][];
  return aggregatedColumns(readGroupBy(f));
}

// ─── Count fetcher — used by the modal's debounced size estimator ────────────

async function countFetcher(f: ModalFilters): Promise<number> {
  const supabase = getSupabaseClient();
  if (!supabase) return 0;
  const filters = adaptFilters(f);
  if (readMode(f) === "raw") {
    return rpcGetAnpCdpExportCount(supabase, filters);
  }
  // Aggregated row counts have no dedicated count RPC — return a conservative
  // hardcoded estimate per granularity (mirrors ANP_CDP_AGG_ESTIMATE in
  // useAnpCdpData). 252 ≈ years (21) × months (12).
  const groupBy = readGroupBy(f);
  const base = 252;
  let mult = 1;
  for (const k of groupBy) {
    if (k === "ano" || k === "mes") continue;
    if (k === "campo")              mult *= 50;
    else if (k === "operador")      mult *= 30;
    else if (k === "bacia")         mult *= 12;
    else if (k === "estado")        mult *= 6;
    else if (k === "local")         mult *= 3;
    else if (k === "instalacao_destino") mult *= 80;
    else if (k === "tipo_instalacao")    mult *= 6;
  }
  // If the user picked NO time dimension (we default to ano+mes inside
  // readGroupBy) the base already accounts for years×months — divide back out
  // when neither ano nor mes was actually requested by the user.
  const hasTime = groupBy.includes("ano") || groupBy.includes("mes");
  return Math.round((hasTime ? base : 1) * mult);
}

// ─── ExportSpec — the only public surface of this file ───────────────────────

export const anpCdpExport: ExportSpec = {
  filename: "MonthlyProduction",
  tier: 2,
  filterSource: "modal-editable",
  excel: {
    sheets: [
      {
        name: "Monthly Production",
        title: "Monthly Production — ANP CDP",
        // Columns are resolved at write-time by the library from the modal
        // filter state (Raw vs Aggregated × groupBy). The library reads the
        // ColumnDef[] from the spec; until the library supports per-call
        // column resolution we expose the union of possible columns here and
        // let the writer ignore keys missing from the row payload.
        columns: RAW_COLUMNS as unknown as typeof RAW_COLUMNS[number][],
        rowsAsync,
      },
    ],
  },
  csv: {
    mode: "single",
    columns: RAW_COLUMNS as unknown as typeof RAW_COLUMNS[number][],
    rowsAsync,
  },
  modal: {
    countRpc: countFetcher,
    filters: [
      {
        type: "segmented",
        key: "mode",
        label: "Mode",
        options: [
          { value: "raw",        label: "Raw" },
          { value: "aggregated", label: "Aggregated" },
        ],
        default: "raw",
      },
      {
        type: "multi-select",
        key: "groupBy",
        label: "Group by (Aggregated only)",
        optionsAsync: async () => [
          { value: "ano",                label: "Year" },
          { value: "mes",                label: "Month" },
          { value: "campo",              label: "Field" },
          { value: "bacia",              label: "Basin" },
          { value: "operador",           label: "Operator" },
          { value: "estado",             label: "State" },
          { value: "local",              label: "Environment" },
          { value: "instalacao_destino", label: "Destination Facility" },
          { value: "tipo_instalacao",    label: "Facility Type" },
        ],
        default: ["ano", "mes", "campo"],
      },
      {
        type: "date-range",
        key: "period",
        label: "Period",
        default: defaultPeriod(),
      },
      {
        type: "multi-select",
        key: "estado",
        label: "State",
        optionsAsync: () => optionsFromKey("estados"),
      },
      {
        type: "multi-select",
        key: "bacia",
        label: "Basin",
        optionsAsync: () => optionsFromKey("bacoes"),
      },
      {
        type: "multi-select",
        key: "campo",
        label: "Field",
        optionsAsync: () => optionsFromKey("campos"),
      },
      {
        type: "multi-select",
        key: "operador",
        label: "Operator",
        optionsAsync: () => optionsFromKey("operadores"),
      },
      {
        type: "multi-select",
        key: "ambiente",
        label: "Environment",
        optionsAsync: () => optionsFromKey("locais"),
      },
      {
        type: "multi-select",
        key: "instalacao_destino",
        label: "Destination Facility",
        optionsAsync: () => optionsFromKey("instalacoes"),
      },
      {
        type: "multi-select",
        key: "tipo_instalacao",
        label: "Facility Type",
        optionsAsync: () => optionsFromKey("tipos_instalacao"),
      },
    ],
  },
};

// Re-export the columns resolver in case the library wants per-call columns
// (the contract leaves room for this once Tier 2 sub-modes are supported).
export const __anpCdpColumnsForFilters = columnsForFilters;
// Re-export raw types so callers can adapt without round-tripping through
// `@/lib/rpc` directly.
export type { AnpCdpRawRow };
