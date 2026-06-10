/**
 * Locks the in-admin scenario-grid "filled template" upload parser/validator
 * (`src/lib/stockGuideGridUpload.ts`) — the TypeScript port of the canonical
 * Python uploader (`scripts/manual/stock_guide_brent_grid_upload.py`).
 *
 * Builds synthetic ExcelJS workbooks in memory and asserts: a happy 2-sheet
 * book, broken Cartesian completeness, a partial ticker column, a duplicate
 * coordinate tuple, an unknown sheet, and a 1-D book (y/z = 0). If these break,
 * the in-browser upload's validation has regressed vs the Python contract.
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseScenarioGridWorkbook, chunkUploadRows } from "../stockGuideGridUpload";
import type { SensitivityGridBlock } from "../../types/stockGuide";

// ── Grid shells ───────────────────────────────────────────────────────────────

const GRID_2D: SensitivityGridBlock = {
  axes: [
    { driver_key: "avg_brent_2026", label: "Brent (avg 2026)", unit: "USD/bbl" },
    { driver_key: "avg_brent_2027", label: "Brent (avg 2027)", unit: "USD/bbl" },
  ],
  outputs: [
    { key: "target_price", mode: "upside", label: "Target price" },
    { key: "fcfe", mode: "yield", label: "FCFE yield" },
  ],
};

const GRID_1D: SensitivityGridBlock = {
  axes: [{ driver_key: "avg_brent_2026", label: "Brent (avg 2026)", unit: "USD/bbl" }],
  outputs: [{ key: "target_price", mode: "upside", label: "Target price" }],
};

// ── Workbook builders ──────────────────────────────────────────────────────────

/** Add a sheet with header + data rows (each row is a flat array of values). */
function addSheet(wb: ExcelJS.Workbook, name: string, header: unknown[], rows: unknown[][]) {
  const ws = wb.addWorksheet(name);
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  return ws;
}

/** A complete 2×2 Brent mesh for the given tickers + a per-cell value generator. */
function mesh2x2Rows(tickers: string[], val: (x: number, y: number, t: string) => unknown): unknown[][] {
  const levels = [40, 50];
  const rows: unknown[][] = [];
  for (const x of levels) {
    for (const y of levels) {
      rows.push([x, y, ...tickers.map((t) => val(x, y, t))]);
    }
  }
  return rows;
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("parseScenarioGridWorkbook — happy path (2 sheets, 2-D)", () => {
  it("produces complete rows for both metrics with no errors", () => {
    const wb = new ExcelJS.Workbook();
    const tickers = ["PETR4", "PRIO3"];
    addSheet(
      wb,
      "target_price",
      ["Brent (avg 2026)", "Brent (avg 2027)", ...tickers],
      mesh2x2Rows(tickers, (x, y) => x + y),
    );
    addSheet(
      wb,
      "fcfe",
      ["Brent (avg 2026)", "Brent (avg 2027)", ...tickers],
      mesh2x2Rows(tickers, (x) => x * 10),
    );

    const res = parseScenarioGridWorkbook(wb, GRID_2D);
    expect(res.errors).toEqual([]);
    // 2 metrics × 2 tickers × 4 scenarios = 16 points.
    expect(res.rows).toHaveLength(16);
    expect(res.summary.byMetric).toEqual({ target_price: 8, fcfe: 8 });
    expect(res.summary.metricCount).toBe(2);
    expect(res.summary.tickerCount).toBe(2);
    expect(res.summary.scenarioCount).toBe(4);

    const sample = res.rows.find(
      (r) => r.metric === "target_price" && r.ticker === "PETR4" && r.x === 40 && r.y === 50,
    );
    expect(sample).toMatchObject({ z: 0, v: 90 });
  });
});

describe("parseScenarioGridWorkbook — Cartesian completeness", () => {
  it("flags a missing combination as an error", () => {
    const wb = new ExcelJS.Workbook();
    // 3 of the 4 (40,40),(40,50),(50,40) — missing (50,50).
    addSheet(
      wb,
      "target_price",
      ["Brent 2026", "Brent 2027", "PETR4"],
      [
        [40, 40, 10],
        [40, 50, 11],
        [50, 40, 12],
      ],
    );
    const res = parseScenarioGridWorkbook(wb, GRID_2D);
    expect(res.errors.some((e) => /not a complete Cartesian product/.test(e))).toBe(true);
    expect(res.errors.some((e) => /1 combination\(s\) missing/.test(e))).toBe(true);
    expect(res.rows).toHaveLength(0);
  });
});

describe("parseScenarioGridWorkbook — partial ticker column", () => {
  it("errors when a ticker has some but not all combos filled", () => {
    const wb = new ExcelJS.Workbook();
    addSheet(
      wb,
      "target_price",
      ["Brent 2026", "Brent 2027", "PETR4"],
      [
        [40, 40, 10],
        [40, 50, 11],
        [50, 40, 12],
        [50, 50, null], // hole
      ],
    );
    const res = parseScenarioGridWorkbook(wb, GRID_2D);
    expect(res.errors.some((e) => /combos empty/.test(e) && /PETR4/.test(e))).toBe(true);
  });

  it("warns + skips a 100%-empty ticker column", () => {
    const wb = new ExcelJS.Workbook();
    addSheet(
      wb,
      "target_price",
      ["Brent 2026", "Brent 2027", "PETR4", "EMPTY3"],
      mesh2x2Rows(["PETR4", "EMPTY3"], (x, y, t) => (t === "EMPTY3" ? null : x + y)),
    );
    const res = parseScenarioGridWorkbook(wb, GRID_2D);
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => /EMPTY3.*100% empty/.test(w))).toBe(true);
    // Only PETR4's 4 points land.
    expect(res.rows).toHaveLength(4);
    expect(res.summary.tickerCount).toBe(1);
  });
});

describe("parseScenarioGridWorkbook — duplicate coordinate tuple", () => {
  it("errors on a repeated scenario", () => {
    const wb = new ExcelJS.Workbook();
    addSheet(
      wb,
      "target_price",
      ["Brent 2026", "Brent 2027", "PETR4"],
      [
        [40, 40, 10],
        [40, 50, 11],
        [50, 40, 12],
        [40, 40, 13], // dup of row 1's coords
      ],
    );
    const res = parseScenarioGridWorkbook(wb, GRID_2D);
    expect(res.errors.some((e) => /duplicate coordinate tuple/.test(e))).toBe(true);
    expect(res.rows).toHaveLength(0);
  });
});

describe("parseScenarioGridWorkbook — unknown sheet", () => {
  it("warns about a sheet that matches no output and still parses the good one", () => {
    const wb = new ExcelJS.Workbook();
    const tickers = ["PETR4"];
    addSheet(
      wb,
      "target_price",
      ["Brent 2026", "Brent 2027", ...tickers],
      mesh2x2Rows(tickers, (x, y) => x + y),
    );
    addSheet(wb, "garbage_sheet", ["a", "b", "PETR4"], [[1, 2, 3]]);

    const res = parseScenarioGridWorkbook(wb, GRID_2D);
    expect(res.warnings.some((w) => /garbage_sheet.*matches no configured output/.test(w))).toBe(true);
    // fcfe configured but absent → its own warning.
    expect(res.warnings.some((w) => /Output "fcfe".*ABSENT/.test(w))).toBe(true);
    expect(res.rows).toHaveLength(4);
    expect(res.errors).toEqual([]);
  });
});

describe("parseScenarioGridWorkbook — 1-D book (y/z = 0)", () => {
  it("stores y=z=0 for a single-axis mesh", () => {
    const wb = new ExcelJS.Workbook();
    addSheet(
      wb,
      "target_price",
      ["Brent (avg 2026)", "PETR4", "PRIO3"],
      [
        [40, 20.1, 28.4],
        [50, 24.0, 30.1],
        [60, 27.8, 33.9],
      ],
    );
    const res = parseScenarioGridWorkbook(wb, GRID_1D);
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(6);
    expect(res.rows.every((r) => r.y === 0 && r.z === 0)).toBe(true);
    expect(res.summary.scenarioCount).toBe(3);
  });
});

describe("parseScenarioGridWorkbook — non-numeric coordinate + empty book", () => {
  it("errors on a non-numeric coordinate cell with the Excel row", () => {
    const wb = new ExcelJS.Workbook();
    addSheet(
      wb,
      "target_price",
      ["Brent 2026", "PETR4"],
      [
        [40, 10],
        ["abc", 11],
      ],
    );
    const res = parseScenarioGridWorkbook(wb, GRID_1D);
    expect(res.errors.some((e) => /non-numeric \/ blank coordinate/.test(e))).toBe(true);
    // Header is Excel row 1, the bad data row is Excel row 3.
    expect(res.errors.some((e) => /Excel rows: 3/.test(e))).toBe(true);
  });

  it("errors when no sheet matches any output", () => {
    const wb = new ExcelJS.Workbook();
    addSheet(wb, "nope", ["a", "PETR4"], [[1, 2]]);
    const res = parseScenarioGridWorkbook(wb, GRID_1D);
    expect(res.errors.some((e) => /0 mesh points produced/.test(e))).toBe(true);
  });
});

// ── Per-output YEAR (base_year effective keys) ──────────────────────────────────

const GRID_YEARED: SensitivityGridBlock = {
  axes: [
    { driver_key: "avg_brent_2026", label: "Brent (avg 2026)", unit: "USD/bbl" },
    { driver_key: "avg_brent_2027", label: "Brent (avg 2027)", unit: "USD/bbl" },
  ],
  // Effective keys carry a year suffix — sheet names must match these verbatim.
  outputs: [
    { key: "fcfe_2026", mode: "yield", label: "FCFE yield 2026" },
    { key: "fcfe_2027", mode: "yield", label: "FCFE yield 2027" },
  ],
};

describe("parseScenarioGridWorkbook — per-output year (base_year keys)", () => {
  it("matches sheets by the effective base_year key and keys byMetric on it", () => {
    const wb = new ExcelJS.Workbook();
    const tickers = ["PETR4", "PRIO3"];
    addSheet(
      wb,
      "fcfe_2026",
      ["Brent (avg 2026)", "Brent (avg 2027)", ...tickers],
      mesh2x2Rows(tickers, (x) => x * 10),
    );
    addSheet(
      wb,
      "fcfe_2027",
      ["Brent (avg 2026)", "Brent (avg 2027)", ...tickers],
      mesh2x2Rows(tickers, (x) => x * 11),
    );

    const res = parseScenarioGridWorkbook(wb, GRID_YEARED);
    expect(res.errors).toEqual([]);
    // 2 metrics × 2 tickers × 4 scenarios = 16 points; metric = the effective key.
    expect(res.rows).toHaveLength(16);
    expect(res.summary.byMetric).toEqual({ fcfe_2026: 8, fcfe_2027: 8 });
    expect(res.rows.every((r) => r.metric === "fcfe_2026" || r.metric === "fcfe_2027")).toBe(true);
  });

  it("warns citing the effective base_year key when its sheet is absent", () => {
    const wb = new ExcelJS.Workbook();
    const tickers = ["PETR4"];
    addSheet(
      wb,
      "fcfe_2026",
      ["Brent (avg 2026)", "Brent (avg 2027)", ...tickers],
      mesh2x2Rows(tickers, (x) => x * 10),
    );
    // fcfe_2027 configured but missing → warning must name the effective key.
    const res = parseScenarioGridWorkbook(wb, GRID_YEARED);
    expect(res.warnings.some((w) => /Output "fcfe_2027".*ABSENT/.test(w))).toBe(true);
    expect(res.rows).toHaveLength(4);
    expect(res.errors).toEqual([]);
  });
});

describe("chunkUploadRows", () => {
  it("marks only the first chunk firstChunk=true", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      ticker: "PETR4",
      metric: "target_price",
      x: i,
      y: 0,
      z: 0,
      v: i,
    }));
    const chunks = chunkUploadRows(rows, 2);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.firstChunk)).toEqual([true, false, false]);
    expect(chunks.map((c) => c.rows.length)).toEqual([2, 2, 1]);
  });

  it("returns [] for empty input", () => {
    expect(chunkUploadRows([])).toEqual([]);
  });
});
