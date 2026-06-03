// Bulk .xlsx upload for Data Input: parse a multi-sheet workbook, preview an
// insert/update diff, and upsert via PostgREST (anon key, Admin RLS).
//
// UI-agnostic: no React, no DOM beyond `File.arrayBuffer()`. ExcelJS is
// dynamically imported so it never lands in the /admin-panel initial bundle.
//
// Mirrors the legacy scripts/manual/{price_bands,dg_margins}_upload.py mapping:
//   - one worksheet per partition value (Diesel / Gasoline, Diesel B / …)
//   - sheet-specific header → column map
//   - rows missing the conflict-key columns are skipped (as the scripts do)
//   - non-key columns are lenient: NULL/empty is allowed

import type { SupabaseClient } from "@supabase/supabase-js";

import { coerceValue } from "./persistence";
import { validateCell } from "./validation";
import type {
  BulkParseResult,
  BulkRowError,
  ColumnConfig,
  EditableTableConfig,
  Row,
} from "./types";

// ── Cell helpers ────────────────────────────────────────────────────────────

/**
 * Format a JS `Date` as `YYYY-MM-DD` using its UTC parts. ExcelJS stores Excel
 * serial dates as UTC midnight, so reading UTC parts avoids a timezone-induced
 * off-by-one day. supabase-js may also hand back DB date columns as `Date`.
 */
function toUtcYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Convert an ExcelJS Date cell to an ISO `YYYY-MM-DD` string.
 * Returns null for anything that isn't a valid date.
 *
 * ExcelJS yields JS `Date` objects for date-formatted cells.
 */
function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return toUtcYmd(value);
  }
  // Some templates store the date as text already — accept a clean ISO string.
  if (typeof value === "string") {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return null;
}

/**
 * Whether a normalized raw cell value is "empty" (null/undefined/blank string).
 * Empty non-key cells are lenient (→ null); non-empty malformed cells hard-error.
 */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/**
 * Normalize an ExcelJS cell value to a primitive suitable for coercion:
 *   - formula cells → their computed `.result`
 *   - rich text / hyperlink objects → their plain text
 *   - empty string → null
 */
function normalizeCell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("result" in obj) return normalizeCell(obj.result);
    if ("text" in obj) return obj.text;
    if ("richText" in obj && Array.isArray(obj.richText)) {
      return obj.richText.map((r) => (r as { text?: string }).text ?? "").join("");
    }
    if ("hyperlink" in obj && "text" in obj) return obj.text;
  }
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

// ── Parse ─────────────────────────────────────────────────────────────────────

/**
 * Parse an uploaded .xlsx file against a table's `bulkUpload` config.
 *
 * For each configured sheet present in the workbook: read the header row, map
 * each header to its registry column, iterate data rows, stamp the partition
 * column, convert dates to ISO, coerce numbers, and validate. Rows missing any
 * conflict-key column are skipped (mirrors the Python scripts). Non-key columns
 * are lenient — NULL/empty is allowed.
 *
 * Returns parsed rows plus collected errors and warnings; never throws on a bad
 * file shape (it reports via `warnings`/`errors` instead).
 */
export async function parseWorkbook(
  file: File,
  config: EditableTableConfig
): Promise<BulkParseResult> {
  const errors: BulkRowError[] = [];
  const warnings: string[] = [];
  const rows: Row[] = [];

  if (!config.bulkUpload) {
    return { rows, errors, warnings: ["This table does not support bulk upload."], sheetsFound: [] };
  }
  const { partitionColumn, sheets } = config.bulkUpload;

  // Column-config lookup built once (avoids a per-row, per-key linear scan).
  const colByKey = new Map<string, ColumnConfig>();
  for (const col of config.columns) colByKey.set(col.key, col);

  // Dynamic import keeps ExcelJS out of the admin-panel initial bundle.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch (e) {
    return {
      rows,
      errors,
      warnings: [`Could not read the .xlsx file: ${e instanceof Error ? e.message : String(e)}`],
      sheetsFound: [],
    };
  }

  const sheetsFound = wb.worksheets.map((ws) => ws.name);
  const expectedNames = sheets.map((s) => s.sheetName);
  if (!expectedNames.some((n) => sheetsFound.includes(n))) {
    warnings.push(
      `None of the expected sheets (${expectedNames.join(", ")}) were found. Sheets in file: ${sheetsFound.join(", ") || "none"}.`
    );
  }

  // Synthetic negative ids so parsed rows have the `Row.id` shape; never sent
  // to the DB (stripped by the upsert allowlist).
  let syntheticId = -1;

  for (const sheetSpec of sheets) {
    const ws = wb.getWorksheet(sheetSpec.sheetName);
    if (!ws) {
      warnings.push(`Expected sheet "${sheetSpec.sheetName}" is missing — skipped.`);
      continue;
    }

    // Header row → column index map.
    const headerRow = ws.getRow(1);
    const headerToCol = new Map<number, string>(); // Excel column index → registry key
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = String(normalizeCell(cell.value) ?? "").trim();
      const mapped = sheetSpec.headerMap[header];
      if (mapped) headerToCol.set(colNumber, mapped);
    });

    // Confirm every conflict-key column is reachable from this sheet's headers.
    const mappedKeys = new Set(headerToCol.values());
    const missingKeyCols = config.conflictColumns.filter(
      (k) => k !== partitionColumn && !mappedKeys.has(k)
    );
    if (missingKeyCols.length > 0) {
      warnings.push(
        `Sheet "${sheetSpec.sheetName}" is missing required column(s): ${missingKeyCols
          .map((k) => colByKey.get(k)?.label ?? k)
          .join(", ")} — its rows were skipped.`
      );
      continue;
    }

    // Iterate data rows (row 1 is the header).
    ws.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
      if (rowNumber === 1) return; // header

      const parsed: Record<string, unknown> = {
        [partitionColumn]: sheetSpec.partitionValue,
      };

      for (const [colNumber, key] of headerToCol) {
        const raw = normalizeCell(excelRow.getCell(colNumber).value);
        const col = colByKey.get(key);
        if (col?.type === "date") {
          parsed[key] = toIsoDate(raw);
        } else if (col?.type === "number") {
          // Hard-fail a non-empty cell that isn't a finite number BEFORE coercing
          // (coerceValue would silently turn "N/A" into null, and the lenient
          // non-key path would then treat it as empty → data silently dropped).
          // Empty/blank stays lenient (→ null) for non-key columns; missing
          // conflict-key cells are caught by the skip/validate logic below.
          if (!isBlank(raw) && !Number.isFinite(Number(raw))) {
            errors.push({
              sheet: sheetSpec.sheetName,
              rowNumber,
              message: `Column "${col?.label ?? key}": "${String(raw).trim()}" is not a number`,
            });
          }
          parsed[key] = coerceValue(raw, "number");
        } else {
          // text / select / partition column
          parsed[key] = raw === null ? null : String(raw).trim();
        }
      }

      // Skip rows missing any conflict-key column (mirrors the Python scripts
      // skipping no-Date / no-Week rows). The partition column is always set.
      const missingKey = config.conflictColumns.some((k) => {
        const v = parsed[k];
        return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
      });
      if (missingKey) return;

      // Validate. Hard errors only for: malformed type/format and missing
      // conflict-key columns (already handled above). Non-key columns are
      // lenient — NULL/empty allowed — so we validate against a config where
      // non-key columns are treated as optional.
      const rowErrors = validateParsedRow(parsed, config);
      for (const message of rowErrors) {
        errors.push({ sheet: sheetSpec.sheetName, rowNumber, message });
      }

      rows.push({ id: syntheticId--, ...parsed } as Row);
    });
  }

  return { rows, errors, warnings, sheetsFound };
}

/**
 * Validate one parsed row leniently: conflict-key columns must be valid and
 * present; non-key columns may be empty but, if present, must match their type
 * (e.g. a number column can't hold text). Returns a list of error messages.
 */
function validateParsedRow(
  row: Record<string, unknown>,
  config: EditableTableConfig
): string[] {
  const out: string[] = [];
  const keySet = new Set(config.conflictColumns);

  for (const col of config.columns) {
    const value = row[col.key];
    const isEmpty =
      value === null || value === undefined || (typeof value === "string" && value.trim() === "");

    if (keySet.has(col.key)) {
      // Conflict-key column: must be present AND well-formed.
      const err = validateCell(value, { ...col, required: true });
      if (err) out.push(err);
    } else if (!isEmpty) {
      // Non-key column: lenient — only flag a malformed non-empty value.
      const err = validateCell(value, { ...col, required: false });
      if (err) out.push(err);
    }
  }
  return out;
}

// ── Diff ────────────────────────────────────────────────────────────────────

/**
 * Build the conflict-key tuple for a row, used to classify insert vs update.
 * Dates/numbers are stringified so a parsed ISO string matches a DB Date/number.
 */
function conflictKey(row: Record<string, unknown>, conflictColumns: string[]): string {
  return conflictColumns
    .map((k) => {
      const v = row[k];
      if (v === null || v === undefined) return "";
      // Parsed rows already carry ISO date strings (toIsoDate), so this `Date`
      // branch only fires for `existingRows` — supabase-js can hand DB date
      // columns back as `Date` objects. Normalize both sides to `YYYY-MM-DD`.
      if (v instanceof Date) return toUtcYmd(v);
      return String(v).trim();
    })
    .join(" ");
}

/**
 * Classify parsed rows against the table's currently-loaded rows by the
 * conflict-key tuple: existing keys count as updates, new keys as inserts.
 */
export function computeBulkDiff(
  parsedRows: Row[],
  existingRows: Row[],
  conflictColumns: string[]
): { insertCount: number; updateCount: number } {
  const existingKeys = new Set(existingRows.map((r) => conflictKey(r, conflictColumns)));
  let insertCount = 0;
  let updateCount = 0;
  // Dedupe parsed rows by key so two file rows with the same key count once.
  const seen = new Set<string>();
  for (const row of parsedRows) {
    const key = conflictKey(row, conflictColumns);
    if (seen.has(key)) continue;
    seen.add(key);
    if (existingKeys.has(key)) updateCount++;
    else insertCount++;
  }
  return { insertCount, updateCount };
}

// ── Upsert ──────────────────────────────────────────────────────────────────

const CHUNK = 500;

/**
 * Upsert parsed rows into the table in chunks of ~500.
 *
 * Values are coerced (same logic as persistence.saveChanges) and stripped to an
 * allowlist of registry columns + conflict columns. The synthetic `id` is NEVER
 * sent (Postgres auto-generates), and DB-computed columns such as
 * `bba_import_parity_w_subsidy` / `petrobras_price_w_subsidy` can never be in
 * the payload because they aren't in the registry. Conflict target is
 * `config.conflictColumns.join(",")`.
 */
export async function bulkUpsert(
  supabase: SupabaseClient,
  config: EditableTableConfig,
  parsedRows: Row[]
): Promise<{ upserted: number; error?: string }> {
  // Allowlist: registry columns + conflict columns. NOTE: `id` is intentionally
  // excluded so Postgres auto-generates it for inserts (parsed rows carry only
  // synthetic negative ids).
  const allowedKeys = new Set<string>();
  for (const col of config.columns) allowedKeys.add(col.key);
  for (const col of config.conflictColumns) allowedKeys.add(col);

  // Column-config lookup built once (avoids a per-row, per-key linear scan).
  const colByKey = new Map<string, ColumnConfig>();
  for (const col of config.columns) colByKey.set(col.key, col);

  const payload: Record<string, unknown>[] = parsedRows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (!(key in row)) continue;
      const col = colByKey.get(key);
      out[key] = col ? coerceValue(row[key], col.type) : row[key];
    }
    return out;
  });

  let upserted = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const chunk = payload.slice(i, i + CHUNK);
    const { error } = await supabase
      .from(config.tableName)
      .upsert(chunk, { onConflict: config.conflictColumns.join(",") });
    if (error) {
      return { upserted, error: error.message };
    }
    upserted += chunk.length;
  }

  return { upserted };
}
