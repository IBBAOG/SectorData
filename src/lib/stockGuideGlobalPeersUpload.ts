/**
 * Browser-side parser + validator for the Stock Guide "Global Peers" re-upload
 * (analyst Excel `data/majors_table.xlsx`, sheet "Live", Visible Alpha). The
 * Admin Panel parses the workbook client-side with ExcelJS, runs these
 * validations, and on a clean report calls `rpcAdminReplaceStockGuideGlobalPeers`
 * with `result.rows` (a replace-total of the whole table).
 *
 * Sheet contract ("Live", range A1:G15):
 *   - Row 1: metric GROUP headers — "P/E" over B:C, "EV/EBITDA" over D:E,
 *     "Div. Yield + Buyback" over F:G (merged cells; only the first cell of each
 *     group carries text). Read positionally — col A = company, B/C = P/E y1/y2,
 *     D/E = EV/EBITDA y1/y2, F/G = Div yield y1/y2. Header text is NOT validated.
 *   - Row 2: the forward-year labels (e.g. 2026E, 2027E ×3). Skipped — the
 *     dashboard uses the global config's y1/y2 labels.
 *   - Rows 3+: company name in col A + six values. A row is one of:
 *       • a NUMERIC row  — all six cells numeric (an "Avg." suffix on the company
 *         name → `is_aggregate=true`);
 *       • a LIVE row     — all six cells the literal 'x' → `is_live=true`, the six
 *         numerics stored NULL (filled live in the browser from our own coverage).
 *     A row mixing 'x' and numeric cells is an ERROR.
 *   - `display_order` = sheet order (1-based among data rows).
 *
 * Div yields in the sheet are FRACTIONS (e.g. 0.0554 = 5.54%) and stored verbatim
 * as fractions; the dashboard ×100s them for display.
 *
 * Pure + framework-free apart from the ExcelJS `Workbook` it reads (so unit tests
 * can build synthetic workbooks in memory). It NEVER touches the network.
 */
import type { Workbook, Worksheet } from "exceljs";
import type { StockGuideGlobalPeerUploadRow } from "./rpc";

/** Expected data sheet name (case-insensitive). */
const SHEET_NAME = "Live";

/** Number of value columns after the company column (B..G). */
const VALUE_COLS = 6;

export interface GlobalPeersUploadSummary {
  /** Total companies (data rows) in the replace-total. */
  rowCount: number;
  /** How many `is_aggregate` ("Avg.") rows. */
  aggregateCount: number;
  /** How many `is_live` ('x') rows. */
  liveCount: number;
}

export interface GlobalPeersUploadResult {
  /** Rows ready for `rpcAdminReplaceStockGuideGlobalPeers`. */
  rows: StockGuideGlobalPeerUploadRow[];
  /** Blocking problems — a non-empty list means "do NOT upload". */
  errors: string[];
  /** Non-blocking advisories — the admin may proceed. */
  warnings: string[];
  summary: GlobalPeersUploadSummary;
}

// ── Cell helpers ──────────────────────────────────────────────────────────────

/** True for a blank cell (null / undefined / empty string / whitespace). */
function isBlank(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

/**
 * Coerce a worksheet cell value to a finite number, or `null` if not numeric.
 * Handles ExcelJS rich values (`{ result }` formula, `{ text }` rich text).
 */
function coerceNum(v: unknown): number | null {
  if (isBlank(v)) return null;
  let raw: unknown = v;
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    if ("result" in o) raw = o.result;
    else if ("text" in o) raw = o.text;
    else if (raw instanceof Date) return null;
  }
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Read a cell's display text (string), trimmed. */
function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v).trim();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text.trim();
    if (typeof o.result === "string" || typeof o.result === "number")
      return String(o.result).trim();
  }
  return "";
}

/** A cell is the literal live marker 'x' (case-insensitive, trimmed). */
function isLiveMarker(v: unknown): boolean {
  return cellText(v).toLowerCase() === "x";
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Parse + validate the filled "Global Peers" workbook. Returns
 * `{ rows, errors, warnings, summary }`. A non-empty `errors` means the upload
 * must NOT proceed. The returned `rows` carry the keys expected by
 * `rpcAdminReplaceStockGuideGlobalPeers`.
 */
export function parseGlobalPeersWorkbook(
  workbook: Workbook,
): GlobalPeersUploadResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: StockGuideGlobalPeerUploadRow[] = [];

  // Locate the "Live" sheet (case-insensitive); fall back to the only sheet.
  let ws: Worksheet | undefined = workbook.worksheets.find(
    (w) => (w.name ?? "").trim().toLowerCase() === SHEET_NAME.toLowerCase(),
  );
  if (!ws) {
    if (workbook.worksheets.length === 1) {
      ws = workbook.worksheets[0];
      warnings.push(
        `No sheet named "${SHEET_NAME}" — using the only sheet "${ws.name}".`,
      );
    } else {
      errors.push(
        `Workbook has no sheet named "${SHEET_NAME}". Found: ${workbook.worksheets
          .map((w) => `"${w.name}"`)
          .join(", ")}.`,
      );
      return { rows, errors, warnings, summary: emptySummary() };
    }
  }

  // Flatten to 0-based rows (drop fully-empty rows but keep the Excel row number).
  const allRows: { excelRow: number; values: unknown[] }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const vals = Array.isArray(row.values)
      ? (row.values as unknown[]).slice(1) // ExcelJS values are 1-based.
      : [];
    allRows.push({ excelRow: rowNumber, values: vals });
  });

  if (allRows.length < 3) {
    errors.push(
      "Expected at least 2 header rows + 1 data row in the \"Live\" sheet.",
    );
    return { rows, errors, warnings, summary: emptySummary() };
  }

  // Row 0 = group headers, row 1 = year labels — both skipped. Data starts at row 2.
  const dataRows = allRows.slice(2);
  let displayOrder = 0;
  let aggregateCount = 0;
  let liveCount = 0;

  for (const { excelRow, values } of dataRows) {
    const company = cellText(values[0]);
    if (company === "") {
      // A row with no company name but with values is suspicious; skip blanks.
      if (values.slice(1, 1 + VALUE_COLS).every((v) => isBlank(v))) continue;
      errors.push(`Excel row ${excelRow}: value cells present but company name (col A) is empty.`);
      continue;
    }

    const valueCells = Array.from({ length: VALUE_COLS }, (_, i) => values[1 + i]);
    const nLive = valueCells.filter(isLiveMarker).length;
    const numeric = valueCells.map(coerceNum);
    const nNumeric = numeric.filter((n) => n != null).length;
    const nBlank = valueCells.filter(isBlank).length;

    displayOrder += 1;
    const isAggregate = /\bavg\.?$/i.test(company.trim());

    if (nLive > 0) {
      // Live row: ALL six must be the 'x' marker (no mixing).
      if (nLive !== VALUE_COLS) {
        errors.push(
          `Excel row ${excelRow} ("${company}"): mixes live 'x' markers with ` +
            `other values — a live row must have all ${VALUE_COLS} cells set to 'x'.`,
        );
        continue;
      }
      liveCount += 1;
      rows.push({
        company,
        pe_y1: null,
        pe_y2: null,
        ev_ebitda_y1: null,
        ev_ebitda_y2: null,
        div_yield_y1: null,
        div_yield_y2: null,
        is_aggregate: isAggregate,
        is_live: true,
        display_order: displayOrder,
      });
      continue;
    }

    // Numeric row: every cell must be numeric (blanks allowed → stored NULL, but
    // a NON-numeric non-blank cell is an ERROR — likely a stray label / typo).
    const badCols: number[] = [];
    for (let i = 0; i < VALUE_COLS; i++) {
      if (!isBlank(valueCells[i]) && numeric[i] == null) badCols.push(i);
    }
    if (badCols.length > 0) {
      const colLetters = badCols.map((i) => String.fromCharCode(66 + i)).join(", ");
      errors.push(
        `Excel row ${excelRow} ("${company}"): non-numeric value in column(s) ${colLetters} ` +
          `— cells must be numeric or the literal 'x'.`,
      );
      continue;
    }
    if (nNumeric === 0 && nBlank === VALUE_COLS) {
      warnings.push(`Excel row ${excelRow} ("${company}"): all six values blank.`);
    }
    if (isAggregate) aggregateCount += 1;
    rows.push({
      company,
      pe_y1: numeric[0],
      pe_y2: numeric[1],
      ev_ebitda_y1: numeric[2],
      ev_ebitda_y2: numeric[3],
      div_yield_y1: numeric[4],
      div_yield_y2: numeric[5],
      is_aggregate: isAggregate,
      is_live: false,
      display_order: displayOrder,
    });
  }

  // Duplicate company names → ERROR (the table PK is `company`).
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.company, (seen.get(r.company) ?? 0) + 1);
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c);
  if (dups.length > 0) {
    errors.push(
      `Duplicate company name(s): ${dups.join(", ")}. Each company must appear once.`,
    );
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push("No data rows found in the \"Live\" sheet — refusing to wipe with nothing.");
  }

  const summary: GlobalPeersUploadSummary = {
    rowCount: rows.length,
    aggregateCount,
    liveCount,
  };
  return { rows, errors, warnings, summary };
}

function emptySummary(): GlobalPeersUploadSummary {
  return { rowCount: 0, aggregateCount: 0, liveCount: 0 };
}
