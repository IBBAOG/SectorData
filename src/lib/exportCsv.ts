// Shared CSV download helper.
//
// Replaces the duplicated inline `downloadCsv` previously living in
// `market-share/page.tsx` and `price-bands/page.tsx`. Behavior is identical:
// every cell is wrapped in double quotes, embedded quotes are escaped by
// doubling (RFC 4180 style), rows are joined with `\n`, and the resulting
// blob is served as `text/csv;charset=utf-8`.
//
// Optional knobs:
// - `columns`: explicit column ordering. When omitted, falls back to
//   `Object.keys(rows[0])` (matches the historical behavior).
// - `separator`: defaults to `,`. Switch to `;` if a downstream tool needs
//   semicolon-delimited CSV.
// - `includeBom`: prepends UTF-8 BOM (`﻿`). Excel-pt-BR opens BOM-prefixed
//   files with the right encoding without an import wizard.
//
// Usage (replacing the legacy inline helper):
//
//   import { downloadCsv } from "@/lib/exportCsv";
//   downloadCsv({ rows, filename: "vendas" });

export type ExportCsvOptions<T extends Record<string, unknown>> = {
  rows: T[];
  /** Filename without extension — `.csv` is appended automatically. */
  filename: string;
  /** Explicit column order. Defaults to `Object.keys(rows[0])`. */
  columns?: (keyof T)[];
  /** Cell separator. Defaults to `,`. */
  separator?: string;
  /** Prepend UTF-8 BOM (helps Excel-pt-BR detect encoding). Defaults to `false`. */
  includeBom?: boolean;
};

function escapeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return `"${s.replaceAll('"', '""')}"`;
}

export function downloadCsv<T extends Record<string, unknown>>(
  opts: ExportCsvOptions<T>,
): void {
  const { rows, filename, columns, separator = ",", includeBom = false } = opts;
  if (!rows || rows.length === 0) return;

  const cols = (columns ?? (Object.keys(rows[0]) as (keyof T)[])) as (keyof T)[];

  const lines = [cols.map((c) => escapeCell(c)).join(separator)].concat(
    rows.map((r) => cols.map((c) => escapeCell(r[c])).join(separator)),
  );

  const text = (includeBom ? "﻿" : "") + lines.join("\n");
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
