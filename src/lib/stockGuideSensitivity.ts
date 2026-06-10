// ─── Stock Guide sensitivity — shared compute helpers (single source of truth) ─
//
// These pure functions encode the EXACT transform a sensitivity-table cell
// undergoes from the admin-typed BASE value to the value the dashboard DISPLAYS.
// They are consumed by BOTH:
//   • the /stock-guide dashboard brain (`useStockGuideData.ts` → its
//     `computeSensitivityCell` / `formatSensitivityCell`), and
//   • the /admin-panel "Sensitivities" builder live preview.
//
// Keeping them here guarantees the admin preview matches the dashboard
// byte-for-byte: there is only ONE implementation of the math + formatting.
//
// Value modes (what the admin TYPES vs. what the dashboard SHOWS):
//   • absolute  — typed value, shown as-is in `unit`.            (no transform)
//   • yield     — typed BRL mn flow → typed ÷ market cap × 100   (%)
//   • pe        — typed net income  → market cap ÷ typed         (×)
//   • ev_ebitda — typed EBITDA (+ net debt secondary) →
//                 (market cap + net debt) ÷ EBITDA               (×)
//   • upside    — typed target price → typed ÷ live price − 1    (%, ×100)
//
// Each cell's company resolves its OWN live price + market cap; the caller
// passes those in. All guards mirror the original dashboard logic exactly.

import type { SensitivityTable } from "@/types/stockGuide";

export type SensitivityValueMode = SensitivityTable["value_mode"];

/**
 * Display unit per value_mode. 'absolute' has no fixed unit (uses the table's
 * own `unit`), so it is intentionally the empty string and callers fall back to
 * `table.unit`. (Mirrors the dashboard's VALUE_MODE_UNIT.)
 */
export const VALUE_MODE_UNIT: Record<SensitivityValueMode, string> = {
  absolute: "",
  yield: "%",
  pe: "×",
  ev_ebitda: "×",
  upside: "%",
};

/** Inputs needed to turn a typed BASE cell value into its DISPLAY value. */
export interface SensitivityCellInputs {
  valueMode: SensitivityValueMode;
  /** Primary typed base: flow/net income/EBITDA/target price (per the mode). */
  primary: number | null;
  /** ONLY for 'ev_ebitda' — the matching net debt (BRL mn). */
  secondary: number | null;
  /** The cell company's live market cap in BRL mn (shares × livePrice / 1e6). */
  marketCapBrlMn: number | null;
  /** The cell company's live share price (R$/share). */
  livePrice: number | null;
}

/**
 * Compute a sensitivity cell's DISPLAY value from the typed BASE value(s) and
 * the cell company's live numbers. Returns `null` (→ render "—") whenever an
 * input is missing or a guarded denominator is non-positive. This is the exact
 * logic the dashboard uses — do not diverge.
 *
 * Guards (identical to the dashboard):
 *   • yield     — needs marketCap > 0.
 *   • pe        — needs primary > 0.
 *   • ev_ebitda — needs primary > 0, secondary ≠ null, marketCap ≠ null.
 *   • upside    — needs livePrice > 0.
 *   • absolute  — no transform (echoes primary).
 *
 * 'yield' and 'upside' are scaled to percent POINTS here so the returned value
 * is display-ready and `formatSensitivityValue('%')` applies uniformly.
 */
export function computeSensitivityCellValue(
  inputs: SensitivityCellInputs,
): number | null {
  const { valueMode, primary, secondary, marketCapBrlMn, livePrice } = inputs;
  switch (valueMode) {
    case "absolute":
      return primary;
    case "yield":
      return primary != null && marketCapBrlMn != null && marketCapBrlMn > 0
        ? (primary / marketCapBrlMn) * 100
        : null;
    case "pe":
      return marketCapBrlMn != null && primary != null && primary > 0
        ? marketCapBrlMn / primary
        : null;
    case "ev_ebitda":
      return primary != null &&
        primary > 0 &&
        secondary != null &&
        marketCapBrlMn != null
        ? (marketCapBrlMn + secondary) / primary
        : null;
    case "upside":
      // Spec: `target / livePrice − 1` (a ratio). Scaled to percent points here
      // so the returned value is display-ready (same convention as 'yield').
      return primary != null && livePrice != null && livePrice > 0
        ? (primary / livePrice - 1) * 100
        : null;
    default:
      return null;
  }
}

/**
 * Resolve the display unit for a value_mode + the table's own unit. 'absolute'
 * → the table unit; the derived modes → their fixed unit ('%' / '×').
 */
export function unitForValueMode(
  valueMode: SensitivityValueMode,
  tableUnit: string,
): string {
  return valueMode === "absolute" ? tableUnit : VALUE_MODE_UNIT[valueMode];
}

/**
 * Format a computed sensitivity-cell value by its unit. Shared so desktop,
 * mobile and the admin preview render identically. The value is already
 * display-ready (percent points for '%'):
 *   • '%' → one-decimal percent.
 *   • '×' → one-decimal multiple with a "×" suffix.
 *   • else (absolute) → thousands-grouped value + the unit suffix.
 * Null/NaN → "—".
 */
export function formatSensitivityValue(
  value: number | null,
  unit: string,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "×") return `${value.toFixed(1)}×`;
  const isInt = Number.isInteger(value);
  const num = value.toLocaleString("en-US", {
    minimumFractionDigits: isInt ? 0 : 1,
    maximumFractionDigits: isInt ? 0 : 1,
  });
  return unit ? `${num} ${unit}` : num;
}

/** Per-mode base-input metadata for the admin builder (labels + a hint). */
export interface BaseInputMeta {
  /** Label for the primary cell matrix (what the admin types into it). */
  primaryLabel: string;
  /** Label for the secondary matrix — only present for 'ev_ebitda'. */
  secondaryLabel?: string;
  /** One-line description of "you type X → the dashboard shows Y". */
  hint: string;
}

/**
 * Describe, per value_mode, what the admin TYPES into the matrix and what the
 * dashboard DISPLAYS after the transform. Drives the builder's hint banner +
 * matrix labels so the derived modes are obvious at input time.
 *
 * `metricLabel` (the table's own metric label) is only used by 'absolute', to
 * preserve the existing "metric_label || 'Values'" behavior.
 */
export function baseInputMeta(
  valueMode: SensitivityValueMode,
  metricLabel?: string,
): BaseInputMeta {
  switch (valueMode) {
    case "yield":
      return {
        primaryLabel: "FCFE / dividends (BRL mn)",
        hint: "You type the BRL mn flow; the dashboard shows value ÷ market cap × 100 = yield (%).",
      };
    case "pe":
      return {
        primaryLabel: "Net income (BRL mn)",
        hint: "You type net income; the dashboard shows market cap ÷ value = P/E (×).",
      };
    case "ev_ebitda":
      return {
        primaryLabel: "EBITDA (BRL mn)",
        secondaryLabel: "Net Debt (BRL mn)",
        hint: "You type EBITDA + Net Debt; the dashboard shows (market cap + net debt) ÷ EBITDA = EV/EBITDA (×).",
      };
    case "upside":
      return {
        primaryLabel: "Target price (R$/share)",
        hint: "You type the target price; the dashboard shows TP ÷ live price − 1 = upside (%).",
      };
    case "absolute":
    default:
      return {
        primaryLabel: (metricLabel && metricLabel.trim()) || "Values",
        hint: "Cells display exactly as typed.",
      };
  }
}

// ─── Scenario-grid multilinear interpolation (1..3 axes) ───────────────────────
//
// A SCENARIO-GRID sensitivity table is a REGULAR mesh over 1..3 driver axes
// (e.g. Avg Brent 2026 / 2027 / 2028+). The analyst runs their model over the
// FULL Cartesian product of per-axis levels and uploads, per company, the output
// (target price) at every mesh node. The dashboard reads that per-company point
// cloud and, as the analyst drags ONE slider per axis, INTERPOLATES the output
// live MULTILINEARLY (a 2^d corner blend — linear in 1-D, bilinear in 2-D,
// trilinear in 3-D).
//
// This REPLACES the 1-D `interpolateGrid`/`GridPoint` shape (the single ambiguous
// "Brent" axis), which itself replaced the linear `compose` elastic layer.
//
// Pure + testable, reused by BOTH the /stock-guide dashboard brain and (for the
// point-count read-out) the admin builder.

/** One node of a per-ticker grid mesh: `coords` = the per-axis levels, `value` = output. */
export interface MeshPoint {
  /** Coordinate per axis (length === dim). */
  coords: number[];
  /** Output value at that node (e.g. target price BRL/share). */
  value: number;
}

/**
 * A per-ticker regular mesh ready for multilinear interpolation.
 *   • `dim`    — number of axes (1..3).
 *   • `levels[axis]` — the DISTINCT, ascending levels seen along that axis.
 *   • `values` — node lookup keyed by the tuple of per-axis INDICES
 *     (`"i"` for 1-D, `"i,j"` for 2-D, `"i,j,k"` for 3-D) → output value.
 */
export interface GridMesh {
  dim: number;
  levels: number[][];
  values: Map<string, number>;
}

/** Index-tuple key for a node at the given per-axis index positions. */
function meshKey(indices: number[]): string {
  return indices.join(",");
}

/**
 * Build a regular `GridMesh` from a point cloud. The points are assumed to form
 * a (possibly sparse) regular Cartesian mesh; this:
 *   • collects the DISTINCT ascending levels per axis (exact equality — both the
 *     stored coordinates and the live slider value flow from the same numeric
 *     column, so float identity holds; the upload script rounds to 6 decimals);
 *   • maps each point's coords → a tuple of per-axis indices into those levels;
 *   • on a duplicate coordinate tuple, LAST write wins.
 *
 * Returns `null` for an empty point cloud (the caller then shows the empty/loading
 * card). `dim` is taken from the caller (the number of `definition.grid.axes`),
 * not inferred, so a degenerate axis (a single level) is still a real axis.
 */
export function buildGridMesh(
  points: MeshPoint[],
  dim: number,
): GridMesh | null {
  if (points.length === 0 || dim < 1) return null;

  // Distinct ascending levels per axis.
  const levelSets: Set<number>[] = Array.from({ length: dim }, () => new Set<number>());
  for (const p of points) {
    for (let a = 0; a < dim; a++) {
      levelSets[a].add(p.coords[a] ?? 0);
    }
  }
  const levels = levelSets.map((s) => Array.from(s).sort((x, y) => x - y));

  // Index maps per axis (level value → its index) for fast tuple keys.
  const indexOf: Map<number, number>[] = levels.map((arr) => {
    const m = new Map<number, number>();
    arr.forEach((v, i) => m.set(v, i));
    return m;
  });

  const values = new Map<string, number>();
  for (const p of points) {
    const indices: number[] = [];
    let ok = true;
    for (let a = 0; a < dim; a++) {
      const idx = indexOf[a].get(p.coords[a] ?? 0);
      if (idx == null) {
        ok = false;
        break;
      }
      indices.push(idx);
    }
    if (!ok) continue;
    values.set(meshKey(indices), p.value); // last write wins
  }

  return { dim, levels, values };
}

/** Per-axis bracket: the lower/upper level INDICES + the interpolation fraction. */
interface Bracket {
  lo: number;
  hi: number;
  /** 0..1 weight toward `hi`; 0 collapses the axis (no upper corner enumerated). */
  frac: number;
}

/**
 * Bracket a query value `v` against the ascending `levels` of one axis:
 *   • a non-finite `v` is treated as the axis minimum (clamp);
 *   • a single level OR `v ≤ first` → `(0, 0, 0)` (collapsed at the lower edge);
 *   • `v ≥ last` → `(last, last, 0)` (collapsed at the upper edge);
 *   • otherwise binary-search for the cell `[lo, hi]` and
 *     `frac = (v − levels[lo]) / (levels[hi] − levels[lo])` (a zero span → 0).
 *
 * A `frac` of exactly 0 (an on-node hit or a clamped edge) signals the caller to
 * COLLAPSE this axis — it then enumerates only the lower corner. That is what
 * lets a border-clamped query against a COMPLETE mesh never demand a corner
 * outside the active cell.
 */
function bracketAxis(levels: number[], v: number): Bracket {
  const n = levels.length;
  const x = Number.isFinite(v) ? v : levels[0];
  if (n <= 1 || x <= levels[0]) return { lo: 0, hi: 0, frac: 0 };
  if (x >= levels[n - 1]) return { lo: n - 1, hi: n - 1, frac: 0 };

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (levels[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = levels[hi] - levels[lo];
  const frac = span === 0 ? 0 : (x - levels[lo]) / span;
  return { lo, hi, frac };
}

/**
 * Multilinearly interpolate a `GridMesh` at the query `at` (one coordinate per
 * axis). Per axis it brackets + clamps; axes whose bracket collapses (a single
 * level, an on-node hit, or a border clamp — `frac === 0` or `lo === hi`) are NOT
 * enumerated, so only the active cell's corners are visited (≤ 2^k, k ≤ 3). The
 * result is the weighted sum `Σ weight · value` with `weight = Π (frac | 1−frac)`.
 *
 * Returns `null` (never `NaN`) when the mesh is empty/zero-dim OR when a corner the
 * active cell REQUIRES is missing from the mesh (a sparse hole inside a live cell).
 * A corner outside the active cell is never requested, so a border clamp on a
 * complete mesh always resolves.
 */
export function interpolateMesh(mesh: GridMesh, at: number[]): number | null {
  const { dim, levels, values } = mesh;
  if (dim < 1 || values.size === 0) return null;

  const brackets: Bracket[] = [];
  const activeAxes: number[] = []; // axes that contribute an upper corner
  for (let a = 0; a < dim; a++) {
    const b = bracketAxis(levels[a], at[a] ?? NaN);
    brackets.push(b);
    if (b.lo !== b.hi && b.frac !== 0) activeAxes.push(a);
  }

  const k = activeAxes.length;
  let acc = 0;
  // Enumerate the 2^k corners of the active cell (collapsed axes pinned to `lo`).
  for (let mask = 0; mask < 1 << k; mask++) {
    const indices = brackets.map((b) => b.lo);
    let weight = 1;
    for (let bit = 0; bit < k; bit++) {
      const axis = activeAxes[bit];
      const upper = (mask & (1 << bit)) !== 0;
      if (upper) {
        indices[axis] = brackets[axis].hi;
        weight *= brackets[axis].frac;
      } else {
        weight *= 1 - brackets[axis].frac;
      }
    }
    const v = values.get(meshKey(indices));
    if (v == null) return null; // a required corner is missing → null, never NaN
    acc += weight * v;
  }
  return acc;
}
