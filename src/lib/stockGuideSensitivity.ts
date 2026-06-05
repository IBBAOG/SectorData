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

import type {
  SensitivityTable,
  SensitivityComposeBlock,
} from "@/types/stockGuide";

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

// ─── Elastic (coefficient) compose ─────────────────────────────────────────────
//
// An ELASTIC sensitivity table composes an OUTPUT (target price, BRL/share) live
// in the browser from analyst-provided slopes against one or more macro drivers.
// The analyst drives continuous multi-year sliders (Brent / FX 2026-2028) and the
// target price + upside re-price instantly. The math is a first-order linear
// composition (a Taylor expansion around the anchors):
//
//   TP[c] = base[c] + Σ_k by_company[c][k] × (level[k] − anchors[k])
//
// where for each driver_key `k`:
//   • level[k]   = the current slider / preset / live value,
//   • anchors[k] = the driver level at which base[c] was measured,
//   • by_company[c][k] = the slope Δ(output) per +1 unit of driver `k`.
//
// This is the single source of truth, reused by BOTH the /stock-guide dashboard
// brain and the admin builder's live preview.

/**
 * Compose the elastic OUTPUT (target price, BRL/share) for one ticker at the
 * given driver levels.
 *
 * Returns `null` when the ticker is NOT in `compose.base` — that is the hide-strip
 * contract: a restricted ticker is removed from `base` (and `by_company`)
 * server-side for non-admins, and a ticker with no base cannot be composed, so it
 * must NOT be rendered.
 *
 * Driver keys absent from `by_company[ticker]` contribute a zero slope (they
 * simply don't move the output). A missing `level[k]` falls back to the anchor
 * (so an unset/unknown slider leaves the output at the base value for that key).
 * Non-finite values are ignored (treated as no contribution) so the result is
 * never `NaN` — callers render "—" on `null`.
 */
export function composeElasticTargetPrice(
  ticker: string,
  driverLevels: Record<string, number | null | undefined>,
  compose: SensitivityComposeBlock,
): number | null {
  const base = compose.base?.[ticker];
  if (base == null || !Number.isFinite(base)) return null;

  const slopes = compose.by_company?.[ticker] ?? {};
  const anchors = compose.anchors ?? {};
  // Iterate the table's declared driver_keys (the slope map may carry extras).
  const keys =
    Array.isArray(compose.driver_keys) && compose.driver_keys.length > 0
      ? compose.driver_keys
      : Object.keys(slopes);

  let out = base;
  for (const k of keys) {
    const slope = slopes[k];
    if (slope == null || !Number.isFinite(slope)) continue; // no sensitivity to k
    const anchor = anchors[k];
    if (anchor == null || !Number.isFinite(anchor)) continue; // can't measure Δ
    const rawLevel = driverLevels[k];
    const level =
      rawLevel != null && Number.isFinite(rawLevel) ? rawLevel : anchor;
    out += slope * (level - anchor);
  }
  return Number.isFinite(out) ? out : null;
}
