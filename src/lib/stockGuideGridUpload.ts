/**
 * Browser-side parser + validator for the Stock Guide scenario-grid "filled
 * template" upload (the in-admin Upload path that closes the configure →
 * download template → fill → upload loop without a terminal).
 *
 * It is the TypeScript port of the canonical Python uploader's validations
 * (`scripts/manual/stock_guide_brent_grid_upload.py`), kept in lock-step:
 *
 *   - ONE SHEET PER OUTPUT metric. The sheet NAME (case-insensitive) matches a
 *     configured output `key` → that sheet's `metric`. A sheet matching no
 *     configured output → WARNING (skipped). A configured output with no
 *     (non-empty) sheet → WARNING (absent from the upload).
 *   - Per sheet (LONG format): the FIRST `d` columns are the axis coordinates,
 *     read POSITIONALLY in `grid.axes` order (a header that does not match the
 *     axis label/driver key is only a WARNING, never an error). Every coordinate
 *     cell must be numeric (ERROR with up to 10 Excel row numbers), rounded to 6
 *     decimals. A duplicate coordinate tuple is an ERROR. The mesh must be a
 *     COMPLETE Cartesian product (`rows === Π distinct levels per axis`; ERROR
 *     with the count of missing combinations).
 *   - Every remaining non-empty, non-"Unnamed" column = a ticker. A ticker column
 *     that is 100 % empty → WARNING (skipped); partially filled → ERROR; a
 *     non-numeric cell → ERROR.
 *   - Total points across all sheets === 0 → ERROR (refuse to wipe with nothing).
 *
 * Pure + framework-free apart from the ExcelJS `Workbook` it reads, so the unit
 * tests build synthetic workbooks in memory. It NEVER touches the network — the
 * admin UI calls `rpcAdminReplaceStockGuideScenarioGrid` with `result.rows`
 * AFTER the report is clean (no blocking errors).
 */
import type { Workbook, Worksheet } from "exceljs";
import type {
  SensitivityGridBlock,
  ScenarioGridPoint,
} from "../types/stockGuide";
import type { ScenarioGridUploadRow } from "./rpc";

/** Coordinate rounding — neutralises float drift between template & model. */
const COORD_ROUND = 6;

/**
 * Known dynamic-driver catalog keys (kept in sync with the Python uploader's
 * `_DRIVER_CATALOG_KEYS` and `src/hooks/useMarketDrivers.ts`). Used only to WARN
 * when a leftover (ticker) header looks like a driver key — a strong hint a
 * coordinate column was mis-placed or the wrong file was paired.
 */
const DRIVER_CATALOG_KEYS = new Set([
  "avg_brent_2026",
  "avg_brent_2027",
  "avg_brent_2028",
  "avg_fx_2026",
  "avg_fx_2027",
  "avg_fx_2028",
]);

export interface GridUploadSummary {
  /** Total mesh points across every matched sheet. */
  totalRows: number;
  /** metric → point count. */
  byMetric: Record<string, number>;
  /** ticker → point count (summed across metrics). */
  byTicker: Record<string, number>;
  /** Distinct metric count (matched sheets that produced ≥1 point). */
  metricCount: number;
  /** Distinct ticker count. */
  tickerCount: number;
  /** Distinct scenario (coordinate-tuple) count, max across metrics. */
  scenarioCount: number;
}

export interface GridUploadResult {
  /** Upload rows ready for `rpcAdminReplaceStockGuideScenarioGrid` (short keys). */
  rows: ScenarioGridUploadRow[];
  /** Blocking problems — a non-empty list means "do NOT upload". */
  errors: string[];
  /** Non-blocking advisories — the admin may proceed. */
  warnings: string[];
  summary: GridUploadSummary;
}

// ── Cell helpers ────────────────────────────────────────────────────────────

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
  if (typeof raw === "boolean") return null;
  return null;
}

/** Read a cell's display value for header text (string), trimmed. */
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

/** Round to COORD_ROUND decimals (matches the template generator + uploader). */
function roundCoord(v: number): number {
  const f = 10 ** COORD_ROUND;
  return Math.round(v * f) / f;
}

// ── Sheet → row matrix ──────────────────────────────────────────────────────

interface SheetMatrix {
  /** Trimmed header strings (one per column, in column order). */
  headers: string[];
  /** Data rows; `rows[i][c]` is the raw cell value for column `c`. */
  rows: unknown[][];
  /** Excel row number (1-based, incl. header) for `rows[i]`, for error messages. */
  excelRowOf: number[];
}

/**
 * Flatten a worksheet to a header row + data rows. The first non-empty row is the
 * header; every subsequent row that is not entirely blank is a data row. Columns
 * are taken up to the header's width.
 */
function readSheet(ws: Worksheet): SheetMatrix {
  const allRows: { excelRow: number; values: unknown[] }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // ExcelJS row.values is 1-based (index 0 is undefined). Normalise to 0-based.
    const vals = Array.isArray(row.values)
      ? (row.values as unknown[]).slice(1)
      : [];
    allRows.push({ excelRow: rowNumber, values: vals });
  });

  // Header = first row with any non-blank cell.
  let headerIdx = -1;
  for (let i = 0; i < allRows.length; i++) {
    if (allRows[i].values.some((v) => !isBlank(v))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return { headers: [], rows: [], excelRowOf: [] };
  }

  const headerVals = allRows[headerIdx].values;
  const headers = headerVals.map((v) => cellText(v));
  const width = headers.length;

  const rows: unknown[][] = [];
  const excelRowOf: number[] = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const vals = allRows[i].values;
    const trimmed: unknown[] = [];
    for (let c = 0; c < width; c++) trimmed.push(vals[c]);
    // Drop fully-empty data rows silently.
    if (trimmed.every((v) => isBlank(v))) continue;
    rows.push(trimmed);
    excelRowOf.push(allRows[i].excelRow);
  }
  return { headers, rows, excelRowOf };
}

// ── Axis-name helpers ─────────────────────────────────────────────────────────

function axisName(grid: SensitivityGridBlock, idx: number): string {
  const a = grid.axes[idx];
  return a.label.trim() || a.driver_key?.trim() || `axis_${idx + 1}`;
}

// ── Per-sheet validation ──────────────────────────────────────────────────────

interface SheetParse {
  rows: ScenarioGridUploadRow[];
  errors: string[];
  warnings: string[];
  /** Distinct scenario (coord-tuple) count for this sheet. */
  scenarioCount: number;
}

function parseSheet(
  mat: SheetMatrix,
  grid: SensitivityGridBlock,
  metric: string,
): SheetParse {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dim = grid.axes.length;
  const sheetLabel = `Sheet "${metric}"`;

  if (mat.headers.length < dim) {
    errors.push(
      `${sheetLabel}: has ${mat.headers.length} column(s) but the table defines ${dim} ` +
        `axis/axes — the first ${dim} columns must be the coordinates.`,
    );
    return { rows: [], errors, warnings, scenarioCount: 0 };
  }

  const coordCols = Array.from({ length: dim }, (_, i) => i);
  // Sanity WARN: coordinate header should resemble the axis label/driver key.
  for (let i = 0; i < dim; i++) {
    const hdr = mat.headers[i].toLowerCase();
    const a = grid.axes[i];
    const expected = new Set(
      [a.driver_key?.toLowerCase(), a.label.toLowerCase()].filter(
        (s): s is string => !!s,
      ),
    );
    if (expected.size > 0 && !expected.has(hdr)) {
      warnings.push(
        `${sheetLabel}: coordinate column header "${mat.headers[i]}" does not match ` +
          `axis (label "${a.label}"${a.driver_key ? `, key "${a.driver_key}"` : ""}) — ` +
          `read positionally anyway.`,
      );
    }
  }

  // Ticker columns = remaining non-empty, non-"Unnamed" headers.
  const tickerCols: { col: number; ticker: string }[] = [];
  for (let c = dim; c < mat.headers.length; c++) {
    const h = mat.headers[c];
    if (!h || h.startsWith("Unnamed")) continue;
    tickerCols.push({ col: c, ticker: h });
    if (DRIVER_CATALOG_KEYS.has(h.toLowerCase())) {
      warnings.push(
        `${sheetLabel}: header "${h}" is a known driver key but sits in the ticker ` +
          `region — treated as a ticker. Coordinate column mis-placed / wrong file?`,
      );
    }
  }
  if (tickerCols.length === 0) {
    errors.push(
      `${sheetLabel}: after the coordinate columns there are no ticker columns. ` +
        `Add at least one ticker column with metric values.`,
    );
    return { rows: [], errors, warnings, scenarioCount: 0 };
  }

  if (mat.rows.length === 0) {
    warnings.push(`${sheetLabel}: every row was empty — skipped.`);
    return { rows: [], errors, warnings, scenarioCount: 0 };
  }

  const names = Array.from({ length: dim }, (_, i) => axisName(grid, i));

  // --- Coordinates: every coord cell must be numeric (ERROR) ---
  const coordTuples: (number[] | null)[] = [];
  const badCoordRows: number[] = [];
  for (let i = 0; i < mat.rows.length; i++) {
    const coords: number[] = [];
    let ok = true;
    for (const c of coordCols) {
      const v = coerceNum(mat.rows[i][c]);
      if (v == null) {
        ok = false;
        break;
      }
      coords.push(roundCoord(v));
    }
    if (!ok) {
      badCoordRows.push(mat.excelRowOf[i]);
      coordTuples.push(null);
    } else {
      coordTuples.push(coords);
    }
  }
  if (badCoordRows.length > 0) {
    const shown = badCoordRows.slice(0, 10).join(", ");
    const more =
      badCoordRows.length > 10 ? ` (+${badCoordRows.length - 10} more)` : "";
    errors.push(
      `${sheetLabel}: ${badCoordRows.length} row(s) have a non-numeric / blank ` +
        `coordinate cell — every coordinate must be numeric. Excel rows: ${shown}${more}`,
    );
    return { rows: [], errors, warnings, scenarioCount: 0 };
  }

  const tuples = coordTuples as number[][];
  const keyOf = (t: number[]) => t.join("|");

  // --- Duplicate coordinate tuples = ERROR (up to 5 examples) ---
  const seen = new Map<string, number[]>(); // key → Excel row numbers
  for (let i = 0; i < tuples.length; i++) {
    const k = keyOf(tuples[i]);
    const arr = seen.get(k) ?? [];
    arr.push(mat.excelRowOf[i]);
    seen.set(k, arr);
  }
  const dups = [...seen.entries()].filter(([, rowsArr]) => rowsArr.length > 1);
  if (dups.length > 0) {
    const examples = dups
      .slice(0, 5)
      .map(([k, rowsArr]) => {
        const t = k.split("|").map(Number);
        const desc = names.map((n, j) => `${n}=${t[j]}`).join(", ");
        return `{${desc}} @ Excel rows ${rowsArr.join(", ")}`;
      })
      .join("; ");
    errors.push(
      `${sheetLabel}: ${dups.length} duplicate coordinate tuple(s) — each scenario ` +
        `must appear exactly once. ${examples}`,
    );
    return { rows: [], errors, warnings, scenarioCount: 0 };
  }

  // --- Cartesian completeness: len === Π(distinct levels per axis) ---
  const perAxisLevels: number[][] = [];
  for (let d = 0; d < dim; d++) {
    const lv = [...new Set(tuples.map((t) => t[d]))].sort((a, b) => a - b);
    perAxisLevels.push(lv);
  }
  const expectedCombos = perAxisLevels.reduce((acc, lv) => acc * lv.length, 1);
  const actual = tuples.length;
  if (actual !== expectedCombos) {
    const present = new Set(tuples.map(keyOf));
    const full = cartesian(perAxisLevels);
    const missing = full.filter((t) => !present.has(keyOf(t)));
    const examples = missing
      .slice(0, 5)
      .map((t) => `{${names.map((n, j) => `${n}=${t[j]}`).join(", ")}}`)
      .join("; ");
    const dimsTxt = perAxisLevels.map((lv) => lv.length).join(" × ");
    errors.push(
      `${sheetLabel}: the mesh is not a complete Cartesian product. Distinct levels ` +
        `per axis: ${dimsTxt} = ${expectedCombos} combinations expected, but ${actual} ` +
        `rows present (${missing.length} combination(s) missing). Missing examples: ${examples}`,
    );
    return { rows: [], errors, warnings, scenarioCount: actual };
  }

  // --- Per ticker: full blank → WARN+skip; partial → ERROR; cell numeric ---
  const outRows: ScenarioGridUploadRow[] = [];
  const M = actual;
  for (const { col, ticker } of tickerCols) {
    const cells: (number | null)[] = [];
    let nBlank = 0;
    const badCellRows: number[] = [];
    for (let i = 0; i < mat.rows.length; i++) {
      const raw = mat.rows[i][col];
      if (isBlank(raw)) {
        cells.push(null);
        nBlank++;
        continue;
      }
      const v = coerceNum(raw);
      if (v == null) {
        badCellRows.push(mat.excelRowOf[i]);
        cells.push(null);
      } else {
        cells.push(v);
      }
    }
    if (badCellRows.length > 0) {
      const shown = badCellRows.slice(0, 10).join(", ");
      const more =
        badCellRows.length > 10 ? ` (+${badCellRows.length - 10} more)` : "";
      errors.push(
        `${sheetLabel}, ticker "${ticker}": ${badCellRows.length} non-numeric ` +
          `cell(s). Excel rows: ${shown}${more}`,
      );
      continue;
    }
    if (nBlank === M) {
      warnings.push(`${sheetLabel}: ticker "${ticker}" column 100% empty — skipped.`);
      continue;
    }
    if (nBlank > 0) {
      errors.push(
        `${sheetLabel}, ticker "${ticker}": ${nBlank} of ${M} combos empty — the ` +
          `mesh must be complete per ticker.`,
      );
      continue;
    }
    for (let i = 0; i < M; i++) {
      const t = tuples[i];
      outRows.push({
        ticker,
        metric,
        x: t[0],
        y: dim >= 2 ? t[1] : 0,
        z: dim >= 3 ? t[2] : 0,
        v: cells[i] as number,
      });
    }
  }

  return { rows: outRows, errors, warnings, scenarioCount: actual };
}

/** Full Cartesian product of per-axis level vectors (first axis varies slowest). */
function cartesian(levels: number[][]): number[][] {
  let acc: number[][] = [[]];
  for (const lv of levels) {
    const next: number[][] = [];
    for (const prefix of acc) for (const v of lv) next.push([...prefix, v]);
    acc = next;
  }
  return acc;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Parse + validate a filled scenario-grid workbook against a table's `grid` block.
 * Returns `{ rows, errors, warnings, summary }`. A non-empty `errors` means the
 * upload must NOT proceed; `warnings` are advisory. The returned `rows` carry the
 * SHORT keys (`{ticker, metric, x, y, z, v}`) expected by
 * `rpcAdminReplaceStockGuideScenarioGrid`.
 */
export function parseScenarioGridWorkbook(
  workbook: Workbook,
  grid: SensitivityGridBlock,
): GridUploadResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: ScenarioGridUploadRow[] = [];

  if (!grid || !Array.isArray(grid.axes) || grid.axes.length === 0) {
    errors.push(
      "This sensitivity table has no scenario-grid axes — re-save the shell first.",
    );
    return { rows, errors, warnings, summary: emptySummary() };
  }
  const outputs = Array.isArray(grid.outputs) ? grid.outputs : [];
  if (outputs.length === 0) {
    errors.push("This scenario-grid table has no configured outputs.");
    return { rows, errors, warnings, summary: emptySummary() };
  }

  // Case-insensitive map: sheet name → canonical output (metric) key.
  const outputByLc = new Map<string, string>();
  for (const o of outputs) outputByLc.set(o.key.trim().toLowerCase(), o.key);

  const matchedMetrics = new Set<string>();
  const byMetric: Record<string, number> = {};
  const scenarioByMetric: Record<string, number> = {};

  for (const ws of workbook.worksheets) {
    const sheetName = (ws.name ?? "").trim();
    const metric = outputByLc.get(sheetName.toLowerCase());
    if (metric == null) {
      warnings.push(
        `Sheet "${sheetName}" matches no configured output (${outputs
          .map((o) => o.key)
          .join(", ")}) — skipped.`,
      );
      continue;
    }
    const mat = readSheet(ws);
    const res = parseSheet(mat, grid, metric);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
    if (res.rows.length > 0) {
      matchedMetrics.add(metric);
      byMetric[metric] = (byMetric[metric] ?? 0) + res.rows.length;
      scenarioByMetric[metric] = res.scenarioCount;
      rows.push(...res.rows);
    }
  }

  // Configured outputs with no (non-empty) matching sheet → WARN.
  for (const o of outputs) {
    if (!matchedMetrics.has(o.key)) {
      warnings.push(
        `Output "${o.key}" is configured on the table but has no (non-empty) sheet ` +
          `in the workbook — it will be ABSENT from the upload.`,
      );
    }
  }

  // total === 0 → ERROR (silent-empty is a bug; refuse to wipe with nothing).
  if (rows.length === 0 && errors.length === 0) {
    errors.push(
      "0 mesh points produced (no sheet matched a configured output, or every " +
        "matched sheet was empty). Check the sheet names match the table's outputs.",
    );
  }

  const byTicker: Record<string, number> = {};
  for (const r of rows) byTicker[r.ticker] = (byTicker[r.ticker] ?? 0) + 1;

  const summary: GridUploadSummary = {
    totalRows: rows.length,
    byMetric,
    byTicker,
    metricCount: matchedMetrics.size,
    tickerCount: Object.keys(byTicker).length,
    scenarioCount: Object.values(scenarioByMetric).reduce(
      (m, v) => Math.max(m, v),
      0,
    ),
  };

  return { rows, errors, warnings, summary };
}

function emptySummary(): GridUploadSummary {
  return {
    totalRows: 0,
    byMetric: {},
    byTicker: {},
    metricCount: 0,
    tickerCount: 0,
    scenarioCount: 0,
  };
}

/**
 * Convenience: chunk the upload rows for `rpcAdminReplaceStockGuideScenarioGrid`.
 * The first chunk carries `firstChunk: true` (replace-total wipe), the rest false.
 */
export function chunkUploadRows(
  rows: ScenarioGridUploadRow[],
  chunkSize = 2000,
): { rows: ScenarioGridUploadRow[]; firstChunk: boolean }[] {
  const out: { rows: ScenarioGridUploadRow[]; firstChunk: boolean }[] = [];
  if (rows.length === 0) return out;
  for (let i = 0; i < rows.length; i += chunkSize) {
    out.push({ rows: rows.slice(i, i + chunkSize), firstChunk: i === 0 });
  }
  return out;
}

/** Re-export the mesh-point type for callers that round-trip the result. */
export type { ScenarioGridPoint };
