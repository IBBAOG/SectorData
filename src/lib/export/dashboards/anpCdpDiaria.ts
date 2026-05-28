// Export spec for /anp-cdp-diaria (Daily Production).
//
// Owner: worker_dash-anp-cdp-diaria. Library internals owned by
// worker_subgerente-app. Contract: docs/app/export-library-contract.md.
//
// Decided spec (per CTO 2026-05-28):
//   filename:      "DailyProduction"
//   tier:          2 (modal)
//   filterSource:  "modal-editable" (filters drawn from zero in the modal,
//                  NOT WYSIWYG of dashboard state)
//   sheets:        3 candidate sheets, one per nível (campo / instalacao / poço).
//                  The modal's `segmented` filter `nivel` selects which sheet
//                  is materialized at download time. Sheet name = chosen nível,
//                  in pt-BR ("Campo" / "Instalação" / "Poço") per the decided
//                  spec. Columns vary per nível.
//   csv:           single mode — same row set as the active sheet, no zip.
//   filename mod:  ExportButton appends `_{nivel}_DD-MM-YY` (e.g.
//                  "DailyProduction_campo_28-05-26.xlsx").
//
// Sheet-selection convention (binding for the library):
//   When `filterSource === "modal-editable"` and `modal.filters` declares a
//   `segmented` control whose `key` matches the ColumnDef.key or the sheet
//   name (case-insensitive), the library materializes ONLY the matching sheet.
//   For this spec the segmented key is `nivel` and the 3 sheet names map to
//   the 3 nivel values via the `nivel -> sheetName` table below. The library
//   reads `filters.nivel` at download time and picks accordingly.
//
//   Mapping:
//     filters.nivel = "campo"       → sheet name "Campo"
//     filters.nivel = "instalacao"  → sheet name "Instalação"
//     filters.nivel = "poco"        → sheet name "Poço"
//
// All three sheets paginate behind the existing wrappers, which already loop
// PostgREST `.range(offset, offset+999)` until exhausted (Pegadinha guardrail
// on full-period exports). Defaults: last 30 days, all campos.
//
// `countRpc` calls `rpcGetAnpCdpDiariaExportCount` (server-side count via
// `get_anp_cdp_diaria_export_count`, shipped by worker_supabase).

import type { ExportSpec, SheetSpec } from "@/lib/export/types";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetAnpCdpDiariaFiltros,
  rpcGetAnpCdpDiariaSerie,
  rpcGetAnpCdpDiariaInstalacaoFiltros,
  rpcGetAnpCdpDiariaInstalacaoSerie,
  rpcGetAnpCdpDiariaPocoSerie,
  rpcGetAnpCdpDiariaExportCount,
} from "@/lib/rpc";

// ─── Filter helpers ──────────────────────────────────────────────────────────

type NivelKey = "campo" | "instalacao" | "poco";

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return v.filter((x): x is string => typeof x === "string");
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNivel(v: unknown): NivelKey {
  return v === "instalacao" || v === "poco" ? v : "campo";
}

/** ISO `YYYY-MM-DD` for today minus `days`. */
function todayMinusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** ISO `YYYY-MM-DD` for today (UTC). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Read `[start, end]` from the modal's date-range filter, defaulting to last 30d. */
function pickPeriod(filters: Record<string, unknown>): [string, string] {
  const raw = filters.period;
  if (Array.isArray(raw) && raw.length === 2 && typeof raw[0] === "string" && typeof raw[1] === "string") {
    return [raw[0], raw[1]];
  }
  return [todayMinusDays(30), todayIso()];
}

// ─── Sheet builders ──────────────────────────────────────────────────────────

const sheetCampo: SheetSpec = {
  name: "Campo",
  title: "ANP — Daily Production by Field",
  columns: [
    { key: "data",             header: "Date",           width: 12, align: "left" },
    { key: "campo",            header: "Field",          width: 30, align: "left" },
    { key: "bacia",            header: "Basin",          width: 24, align: "left" },
    { key: "petroleo_bbl_dia", header: "Oil (bbl/day)",  width: 18, format: "#,##0.0",   align: "right" },
    { key: "gas_mm3_dia",      header: "Gas (Mm3/day)",  width: 18, format: "#,##0.000", align: "right" },
  ],
  async rowsAsync(filters: Record<string, unknown>) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const [dStart, dEnd] = pickPeriod(filters);
    const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
      campos:     asStringArray(filters.campos),
      dataInicio: dStart,
      dataFim:    dEnd,
    });
    return rows as unknown as Record<string, unknown>[];
  },
};

const sheetInstalacao: SheetSpec = {
  name: "Instalação",
  title: "ANP — Daily Production by Installation",
  columns: [
    { key: "data",             header: "Date",           width: 12, align: "left" },
    { key: "instalacao",       header: "Installation",   width: 30, align: "left" },
    { key: "campo",            header: "Field",          width: 30, align: "left" },
    { key: "petroleo_bbl_dia", header: "Oil (bbl/day)",  width: 18, format: "#,##0.0",   align: "right" },
    { key: "gas_mm3_dia",      header: "Gas (Mm3/day)",  width: 18, format: "#,##0.000", align: "right" },
  ],
  async rowsAsync(filters: Record<string, unknown>) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const [dStart, dEnd] = pickPeriod(filters);
    const rows = await rpcGetAnpCdpDiariaInstalacaoSerie(supabase, {
      campos:      asStringArray(filters.campos),
      instalacoes: asStringArray(filters.instalacoes),
      dataInicio:  dStart,
      dataFim:     dEnd,
    });
    return rows as unknown as Record<string, unknown>[];
  },
};

const sheetPoco: SheetSpec = {
  name: "Poço",
  title: "ANP — Daily Production by Well",
  columns: [
    { key: "data",             header: "Date",           width: 12, align: "left" },
    { key: "poco",             header: "Well",           width: 30, align: "left" },
    { key: "campo",            header: "Field",          width: 30, align: "left" },
    { key: "bacia",            header: "Basin",          width: 24, align: "left" },
    { key: "instalacao",       header: "Installation",   width: 30, align: "left" },
    { key: "petroleo_bbl_dia", header: "Oil (bbl/day)",  width: 18, format: "#,##0.0",   align: "right" },
    { key: "gas_mm3_dia",      header: "Gas (Mm3/day)",  width: 18, format: "#,##0.000", align: "right" },
  ],
  async rowsAsync(filters: Record<string, unknown>) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const [dStart, dEnd] = pickPeriod(filters);
    const search = asString(filters.poco);
    const rows = await rpcGetAnpCdpDiariaPocoSerie(supabase, {
      campos:     asStringArray(filters.campos),
      pocos:      search ? [search] : null,
      dataInicio: dStart,
      dataFim:    dEnd,
    });
    return rows as unknown as Record<string, unknown>[];
  },
};

// ─── Spec ────────────────────────────────────────────────────────────────────

export const anpCdpDiariaExport: ExportSpec = {
  filename: "DailyProduction",
  tier: 2,
  filterSource: "modal-editable",

  excel: {
    sheets: [sheetCampo, sheetInstalacao, sheetPoco],
  },

  csv: {
    mode: "single",
    columns: sheetCampo.columns, // overridden by library based on active sheet
    async rowsAsync(filters: Record<string, unknown>) {
      // CSV mirrors the active sheet — picks the same nivel as Excel.
      const nivel = asNivel(filters.nivel);
      if (nivel === "instalacao") return sheetInstalacao.rowsAsync(filters);
      if (nivel === "poco")       return sheetPoco.rowsAsync(filters);
      return sheetCampo.rowsAsync(filters);
    },
  },

  modal: {
    filters: [
      {
        type: "segmented",
        key: "nivel",
        label: "Level",
        default: "campo",
        options: [
          { value: "campo",      label: "Field" },
          { value: "instalacao", label: "Installation" },
          { value: "poco",       label: "Well" },
        ],
      },
      {
        type: "date-range",
        key: "period",
        label: "Period",
        default: [todayMinusDays(30), todayIso()],
      },
      {
        type: "multi-select",
        key: "campos",
        label: "Fields",
        default: [],
        async optionsAsync(): Promise<{ value: string; label: string }[]> {
          const supabase = getSupabaseClient();
          if (!supabase) return [];
          const f = await rpcGetAnpCdpDiariaFiltros(supabase);
          return f.campos.map((c) => ({ value: c, label: c }));
        },
      },
      {
        type: "multi-select",
        key: "instalacoes",
        label: "Installations",
        default: [],
        async optionsAsync(): Promise<{ value: string; label: string }[]> {
          const supabase = getSupabaseClient();
          if (!supabase) return [];
          const f = await rpcGetAnpCdpDiariaInstalacaoFiltros(supabase);
          return f.instalacoes.map((i) => ({ value: i, label: i }));
        },
      },
      {
        type: "search",
        key: "poco",
        label: "Well",
        placeholder: "Type a well name (e.g. 7-BUZ-10-RJS)",
      },
    ],
    async countRpc(filters: Record<string, unknown>): Promise<number> {
      const supabase = getSupabaseClient();
      if (!supabase) return 0;
      const nivel = asNivel(filters.nivel);
      const [dStart, dEnd] = pickPeriod(filters);
      const search = asString(filters.poco);
      const payload: Record<string, unknown> = {
        data_inicio: dStart,
        data_fim:    dEnd,
        campos:      asStringArray(filters.campos),
        instalacoes: asStringArray(filters.instalacoes),
        pocos:       search ? [search] : null,
      };
      try {
        return await rpcGetAnpCdpDiariaExportCount(nivel, payload);
      } catch (e) {
        console.error("anpCdpDiariaExport.countRpc failed", e);
        return 0;
      }
    },
  },
};
