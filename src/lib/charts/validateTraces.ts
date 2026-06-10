// Runtime trace lock.
//
// Guards every chart that routes through it against the two recurring defects
// the CTO flagged on /imports-exports (2026-06-09):
//
//   A) Two VISIBLE series in the same chart rendered with the SAME color.
//   B) A stacked chart whose legend order is inverted vs. the stack order
//      (Plotly's stacked-legend default is traceorder:'reversed').
//
// SCOPE — the lock ONLY ever MUTATES charts on the migrated allowlist
// (MIGRATED_CTX). Unmigrated charts (ctx absent, or not on the allowlist) are
// a strict no-op in EVERY environment: their colors and legend.traceorder are
// returned exactly as the caller passed them. This matters because unmigrated
// dashboards can LEGITIMATELY repeat a color — e.g. /price-bands draws
// solid+dashed families ("Import Parity" + "Import Parity w/ subsidy") sharing
// one color, distinguished only by dash style. Auto-repainting those broke the
// chart in production (2026-06-09 regression). A chart must be explicitly
// migrated to the central color assigner before the lock is allowed to touch
// it.
//
// Behavior:
//   - migrated ctx (enforce === true):
//       · dev / CI (NODE_ENV !== 'production'): THROW with a precise message
//         (fails the build/test) on a violation.
//       · production: NEVER throws. Auto-corrects (re-assigns the colliding
//         color to the next free palette color; forces legend.traceorder:
//         'normal') and console.error's so the end user's chart never breaks.
//   - unmigrated ctx (enforce === false, incl. ctx undefined):
//       · NEVER mutates color or traceorder, in ANY environment.
//       · dev / CI only: a purely informational console.warn on a detected
//         issue (no mutation).
//       · production: silent, no mutation.
//
// As dashboards are migrated to the central color assigner, add their ctx
// strings to MIGRATED_CTX to opt them into enforcement (dev-throw / prod-fix).

import { PALETTE } from "@/lib/plotlyDefaults";
import type { Layout, PlotData } from "plotly.js";

const OTHERS_GREY = "#7F7F7F";

/**
 * Charts already migrated to the central color assigner. Only these are
 * subject to dev/CI `throw`; everything else gets a soft `console.warn` in dev
 * so unmigrated dashboards don't break the build during rollout.
 *
 * Rollout: extend this set as each dashboard adopts assignSeriesColors +
 * applyStackedLegendOrder. Right now it only contains the /imports-exports
 * charts fixed in the 2026-06-09 lock-introduction commit.
 */
export const MIGRATED_CTX: ReadonlySet<string> = new Set<string>([
  "imports-exports:by-origin-country",
  "imports-exports:by-importer",
  "imports-exports:imports-unit-price",
  "imports-exports:exports-by-destination",
  "imports-exports:exports-unit-price",
]);

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/** True for traces that should NOT be checked for color collisions. */
function isHidden(t: Partial<PlotData> & { visible?: unknown }): boolean {
  return t.visible === false || t.visible === "legendonly";
}

/** Extract the dominant color a trace renders with, in priority order. */
function traceColor(t: Partial<PlotData>): string | undefined {
  const anyT = t as Record<string, unknown>;
  if (typeof anyT.fillcolor === "string") return anyT.fillcolor;
  const line = anyT.line as { color?: unknown } | undefined;
  if (line && typeof line.color === "string") return line.color;
  const marker = anyT.marker as { color?: unknown } | undefined;
  // marker.color may be an array (per-point colors, e.g. horizontal bars) —
  // those are intentionally multi-color, so skip the single-color check.
  if (marker && typeof marker.color === "string") return marker.color;
  return undefined;
}

function setTraceColor(t: Partial<PlotData>, color: string): void {
  const anyT = t as Record<string, unknown>;
  if (typeof anyT.fillcolor === "string") anyT.fillcolor = color;
  const line = anyT.line as { color?: unknown } | undefined;
  if (line && typeof line.color === "string") line.color = color;
  const marker = anyT.marker as { color?: unknown } | undefined;
  if (marker && typeof marker.color === "string") marker.color = color;
}

function nextFreeColor(used: Set<string>): string | undefined {
  for (const c of PALETTE) {
    if (c === OTHERS_GREY) continue;
    if (!used.has(c)) return c;
  }
  return undefined;
}

/**
 * Validate (and, in production, auto-correct) the data + layout of a chart.
 *
 * Returns the possibly-corrected `{ data, layout }`. In dev/CI for migrated
 * charts a violation throws; otherwise it warns/auto-fixes.
 *
 * @param data   Plotly traces.
 * @param layout Plotly layout.
 * @param ctx    Stable chart identifier (e.g. "imports-exports:by-importer").
 */
export function validateTraces(
  data: readonly Partial<PlotData>[] | undefined,
  layout: Partial<Layout> | undefined,
  ctx?: string,
): { data: Partial<PlotData>[]; layout: Partial<Layout> } {
  // Shallow-clone each trace (plus its nested line/marker) so production
  // auto-correction never mutates the caller's source objects.
  const traces: Partial<PlotData>[] = Array.isArray(data)
    ? data.map((t) => {
        const c: Record<string, unknown> = { ...(t as Record<string, unknown>) };
        if (c.line && typeof c.line === "object") c.line = { ...(c.line as object) };
        if (c.marker && typeof c.marker === "object") c.marker = { ...(c.marker as object) };
        return c as Partial<PlotData>;
      })
    : [];
  let outLayout: Partial<Layout> = layout ? { ...layout } : {};

  const prod = isProd();
  const enforce = ctx != null && MIGRATED_CTX.has(ctx);
  const label = ctx ? `"${ctx}"` : "(unlabeled chart)";

  // ── Checagem A — duplicate color among VISIBLE traces ──────────────────────
  const used = new Set<string>();
  const colorOwner = new Map<string, string>(); // color → first entity name
  for (const t of traces) {
    if (isHidden(t)) continue;
    const color = traceColor(t);
    if (color == null) continue;
    const name = (t as { name?: string }).name ?? "(unnamed)";
    if (used.has(color)) {
      const firstName = colorOwner.get(color) ?? "(unnamed)";
      const msg =
        `[validateTraces] color collision in ${label}: ` +
        `"${name}" and "${firstName}" both render with ${color}.`;
      if (!enforce) {
        // Unmigrated chart — NEVER mutate. Unmigrated dashboards may repeat a
        // color on purpose (e.g. /price-bands solid+dashed families). Only an
        // informational warn in dev; silent in production.
        if (!prod) {
          console.warn(`${msg} (chart not yet migrated — not enforced, no change)`);
        }
        // Keep the color owned so we don't warn again for the same color.
        used.add(color);
      } else if (prod) {
        // Migrated chart in production — auto-correct: re-assign the colliding
        // trace to the next free palette color.
        const replacement = nextFreeColor(used);
        if (replacement) {
          setTraceColor(t, replacement);
          used.add(replacement);
          console.error(`${msg} Auto-corrected "${name}" → ${replacement}.`);
        } else {
          console.error(`${msg} No free palette color left to auto-correct.`);
        }
      } else {
        // Migrated chart in dev / CI — fail loud.
        throw new Error(msg);
      }
    } else {
      used.add(color);
      colorOwner.set(color, name);
    }
  }

  // ── Checagem B — stacked chart with unpinned legend order ──────────────────
  const hasStack = traces.some(
    (t) => (t as { stackgroup?: unknown }).stackgroup != null && !isHidden(t),
  );
  if (hasStack) {
    const order = outLayout.legend?.traceorder;
    const explicit = order === "normal" || order === "reversed";
    if (!explicit) {
      const msg =
        `[validateTraces] stacked chart ${label} does not pin ` +
        `legend.traceorder — legend may read inverted vs. the stack.`;
      if (!enforce) {
        // Unmigrated chart — NEVER force traceorder. Warn only in dev.
        if (!prod) {
          console.warn(`${msg} (chart not yet migrated — not enforced, no change)`);
        }
      } else if (prod) {
        outLayout = {
          ...outLayout,
          legend: { ...(outLayout.legend ?? {}), traceorder: "normal" },
        };
        console.error(`${msg} Auto-corrected to 'normal'.`);
      } else {
        throw new Error(msg);
      }
    }
  }

  return { data: traces, layout: outLayout };
}
