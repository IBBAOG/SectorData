// Spec-driven CSV builder for the unified export library.
//
// Binding contract: docs/app/export-library-contract.md
// § "Types" (CsvSpec) + § "Filename convention".
//
// Three modes:
//   • single                       — 1 CSV; rows from a single source
//   • single-with-discriminator    — 1 CSV; rows merged from N sheets, each
//                                    tagged with the source sheet name in a
//                                    new discriminator column
//   • zip                          — N CSV files zipped (heterogeneous schemas)
//
// RFC4180 escape rules: every cell wrapped in double quotes; embedded quotes
// doubled. Same behavior as the legacy src/lib/exportCsv.ts so files round-trip
// through Excel + spreadsheets without import wizards.

import JSZip from "jszip";

import type { CsvSpec, ColumnDef } from "../types";

function nowDdMmYy(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

function escapeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return `"${s.replaceAll('"', '""')}"`;
}

function buildCsvText(
  columns: ColumnDef[],
  rows: Record<string, unknown>[],
  separator = ",",
): string {
  const header = columns.map((c) => escapeCell(c.header)).join(separator);
  const body = rows.map((r) =>
    columns.map((c) => escapeCell(r[c.key])).join(separator),
  );
  return [header, ...body].join("\n");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Build + download CSV (or zip of CSVs) from a spec.
 *
 * @param spec      CSV spec (one of 3 modes).
 * @param filename  Base filename WITHOUT extension or date suffix.
 *                  `_DD-MM-YY.csv` (single modes) or `_DD-MM-YY.zip` (zip mode)
 *                  is appended automatically.
 * @param filters   Filter snapshot passed to every `rowsAsync`.
 */
export async function downloadCsv(
  spec: CsvSpec,
  filename: string,
  filters: Record<string, unknown>,
): Promise<void> {
  const dateStamp = nowDdMmYy();

  if (spec.mode === "single") {
    const rows = await spec.rowsAsync(filters);
    if (rows.length === 0) return;
    const text = buildCsvText(spec.columns, rows);
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, `${filename}_${dateStamp}.csv`);
    return;
  }

  if (spec.mode === "single-with-discriminator") {
    // Merge rows from every sheet, prepend the discriminator column with the
    // sheet name as value.
    const mergedRows: Record<string, unknown>[] = [];
    // Resolve a unified column set from the first sheet (contract assumption:
    // sheets share a schema when merged in this mode).
    const firstSheet = spec.sheets[0];
    if (!firstSheet) return;

    for (const sheet of spec.sheets) {
      const rows = await sheet.rowsAsync(filters);
      for (const r of rows) {
        mergedRows.push({ ...r, [spec.discriminatorColumn]: sheet.name });
      }
    }
    if (mergedRows.length === 0) return;

    const discCol: ColumnDef = {
      key: spec.discriminatorColumn,
      header: spec.discriminatorColumn,
      width: 16,
      align: "left",
    };
    const columns: ColumnDef[] = [discCol, ...firstSheet.columns];

    const text = buildCsvText(columns, mergedRows);
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, `${filename}_${dateStamp}.csv`);
    return;
  }

  // zip mode — N CSVs, 1 per declared file
  const zip = new JSZip();
  let totalRows = 0;
  for (const f of spec.files) {
    const rows = await f.rowsAsync(filters);
    totalRows += rows.length;
    const text = buildCsvText(f.columns, rows);
    const safeName = f.name.endsWith(".csv") ? f.name : `${f.name}.csv`;
    zip.file(safeName, text);
  }
  if (totalRows === 0) return;

  const zipBuffer = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBuffer, `${filename}_${dateStamp}.zip`);
}
