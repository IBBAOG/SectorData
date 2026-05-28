// ─── Export spec — /navios-diesel (Diesel Imports Line-Up) ──────────────────
//
// Tier 1 (direct download, no modal). filterSource: "wysiwyg" — the live
// dashboard hook (`useNaviosDieselData`) decides which collection snapshot
// is current and which rows are displayed, then passes the resulting array
// into the spec via a factory.
//
// 1 sheet "Vessels". Columns mirror the dashboard's Line-Up tables:
// porto, navio, status, produto, quantidade_m3 (Volume m³), eta,
// inicio_descarga, fim_descarga, origem, imo, mmsi, flag, dias_em_porto.
//
// Cabotage rule: `get_nd_navios` already filters `NOT is_cabotagem`
// server-side (see migration 20260423000001_cabotage_filter.sql), so
// rows produced by the hook are import-only by construction. We do NOT
// re-filter here — the binding rule lives in the RPC.

import type {
  ExportSpec,
  ColumnDef,
} from "../types";
import type { NavioDieselRow } from "../../rpc";

// ── Shared column shape (Excel header row + CSV header row + cell formatting)
const VESSEL_COLUMNS: ColumnDef[] = [
  { key: "porto",            header: "Port",          width: 22, align: "left"  },
  { key: "navio",            header: "Vessel",        width: 26, align: "left"  },
  { key: "status",           header: "Status",        width: 18, align: "left"  },
  { key: "produto",          header: "Product",       width: 18, align: "left"  },
  { key: "quantidade_m3",    header: "Volume (m³)",   width: 14, format: "#,##0", align: "right"  },
  { key: "eta",              header: "ETA",           width: 12, format: "yyyy-mm-dd", align: "center" },
  { key: "inicio_descarga",  header: "Discharge Start", width: 14, format: "yyyy-mm-dd", align: "center" },
  { key: "fim_descarga",     header: "Discharge End",   width: 14, format: "yyyy-mm-dd", align: "center" },
  { key: "origem",           header: "Origin",        width: 22, align: "left"  },
  { key: "imo",              header: "IMO",           width: 12, align: "center" },
  { key: "mmsi",             header: "MMSI",          width: 14, align: "center" },
  { key: "flag",             header: "Flag",          width: 12, align: "center" },
  { key: "dias_em_porto",    header: "Days in Port",  width: 12, format: "0", align: "right"  },
];

// ── Compute `dias_em_porto` for one row
//
// Days the vessel has been (or was) in port:
//   - if both inicio_descarga and fim_descarga are set → fim - inicio
//   - if only inicio_descarga is set → now - inicio
//   - else null (still expected)
function computeDiasEmPorto(row: NavioDieselRow): number | null {
  const start = row.inicio_descarga ? new Date(row.inicio_descarga).getTime() : null;
  if (start == null) return null;
  const end = row.fim_descarga ? new Date(row.fim_descarga).getTime() : Date.now();
  const days = Math.max(0, Math.round((end - start) / 86_400_000));
  return days;
}

// ── Project a NavioDieselRow into the export row shape used by the columns
function toExportRow(r: NavioDieselRow): Record<string, unknown> {
  return {
    porto:           r.porto,
    navio:           r.navio,
    status:          r.status,
    produto:         r.produto,
    quantidade_m3:   r.quantidade_convertida,
    eta:             r.eta,
    inicio_descarga: r.inicio_descarga,
    fim_descarga:    r.fim_descarga,
    origem:          r.origem,
    imo:             r.imo,
    mmsi:            r.mmsi,
    flag:            r.flag,
    dias_em_porto:   computeDiasEmPorto(r),
  };
}

// ── Factory — builds the spec bound to the current dashboard state
//
// Pattern: View renders `<ExportButton spec={buildNaviosDieselExport(navios)} />`.
// The hook owns the live row set (`naviosDisplay`); the spec is a pure
// projection over it. This keeps `filterSource: "wysiwyg"` true to its name:
// whatever the user sees on screen is what gets exported.
export function buildNaviosDieselExport(
  rows: NavioDieselRow[],
): ExportSpec {
  const projected = rows.map(toExportRow);
  const rowsAsync = async () => projected;

  return {
    filename: "DieselImportsLineUp",
    tier: 1,
    filterSource: "wysiwyg",
    excel: {
      sheets: [
        {
          name: "Vessels",
          title: "Diesel Imports Line-Up — Expected / Pending Discharge",
          columns: VESSEL_COLUMNS,
          rowsAsync,
        },
      ],
    },
    csv: {
      mode: "single",
      columns: VESSEL_COLUMNS,
      rowsAsync,
    },
  };
}
