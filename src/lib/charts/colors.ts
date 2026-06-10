// Central chart-color assigner.
//
// One place that turns an ORDERED list of entities into an ordered list of
// { entity, color } pairs, guaranteeing by construction that:
//   - the same entity gets its canonical color (when a canonical map is given);
//   - no two entities in the same chart ever share a color (palette collisions
//     are skipped, not silently reused);
//   - "Others" is always grey (#7F7F7F) and always rendered LAST;
//   - the returned order IS the stack order AND the legend order (no inversion).
//
// Consumers must feed the entities in the order they want them stacked/legended
// and then pass `applyStackedLegendOrder(layout)` to the chart layout so Plotly
// does not reverse the legend for stacked traces.
//
// See docs/design/identity.md § "Central chart-color assigner + lock".

import { PALETTE, BRAND_ORANGE } from "@/lib/plotlyDefaults";
import type { Layout } from "plotly.js";

/** Canonical grey for the "Others" bucket (PALETTE pos 14). */
export const OTHERS_GREY = "#7F7F7F";

export interface AssignSeriesColorsOptions {
  /** Entity → fixed color map (e.g. COMPANY_COLORS / COUNTRY_COLORS). Consulted
   *  first for every entity. Values SHOULD be PALETTE members. */
  canonical?: Record<string, string>;
  /** EXPLICIT HIGHLIGHT pattern (distinct from the PALETTE leader order).
   *  When true, the FIRST entity is forced to BRAND_ORANGE so a user-selected
   *  series "pops" (BSW, anp-cdp-diaria). Ignored for the `othersLabel` entity.
   *
   *  Note: this is NOT the same thing as the default positional leader color.
   *  The PALETTE now leads with navy (#1f2937, pos 1); a plain positional /
   *  stacked chart that does NOT pass `leader` gets navy as its 1st series and
   *  orange as its 2nd. `leader: true` is the opt-in highlight override that
   *  re-claims orange for the selected series. Both coexist by design. */
  leader?: boolean;
  /** Label of the "Others" bucket. Always colored grey and pushed to the end. */
  othersLabel?: string;
}

export interface SeriesColor {
  entity: string;
  color: string;
}

/**
 * Assign a unique color to each entity, in the given order.
 *
 * Resolution order, per entity:
 *   1. If `leader` (explicit highlight) and this is the first non-Others
 *      entity → BRAND_ORANGE. (Without `leader`, the first entity simply
 *      takes PALETTE pos 1 = navy #1f2937 — the default leader-order color.)
 *   2. `opts.canonical[entity]` if present (and not already taken — if the
 *      canonical color was already consumed by an earlier entity it falls
 *      through to the palette step so we never duplicate).
 *   3. Next PALETTE color not yet used in this chart (collision-skip).
 *
 * `othersLabel` (if it appears in the list) is always grey (#7F7F7F) and is
 * moved to the END of the returned array regardless of its input position.
 *
 * If the palette is exhausted (> 14 distinct non-Others series), throws — the
 * caller must collapse the long tail into "Others" rather than repeat a color.
 *
 * The returned array order is authoritative: use it for BOTH the stack order
 * and the legend order.
 */
export function assignSeriesColors(
  orderedEntities: string[],
  opts: AssignSeriesColorsOptions = {},
): SeriesColor[] {
  const { canonical, leader, othersLabel } = opts;

  // Partition out the Others bucket so it can be appended last.
  const others: string[] = [];
  const main: string[] = [];
  const seen = new Set<string>();
  for (const e of orderedEntities) {
    if (seen.has(e)) continue; // dedupe input defensively
    seen.add(e);
    if (othersLabel != null && e === othersLabel) others.push(e);
    else main.push(e);
  }

  const used = new Set<string>();
  const out: SeriesColor[] = [];

  /** Next palette color not yet used in this chart. */
  const nextPaletteColor = (entityForError: string): string => {
    for (const c of PALETTE) {
      if (c === OTHERS_GREY) continue; // reserve grey for Others only
      if (!used.has(c)) return c;
    }
    throw new Error(
      `[assignSeriesColors] palette exhausted: cannot assign a unique color to ` +
        `"${entityForError}" (${main.length} distinct series requested, max ${PALETTE.length - 1}). ` +
        `Collapse the long tail into an "Others" bucket instead of repeating a color.`,
    );
  };

  main.forEach((entity, idx) => {
    let color: string | undefined;

    // 1. Leader override for the first non-Others entity.
    if (leader && idx === 0) {
      color = BRAND_ORANGE;
    }

    // 2. Canonical pin (only if not already taken in this chart).
    if (color == null && canonical) {
      const pinned = canonical[entity];
      if (pinned && pinned !== OTHERS_GREY && !used.has(pinned)) {
        color = pinned;
      }
    }

    // 3. Palette fallback (collision-skip → uniqueness guaranteed).
    if (color == null) {
      color = nextPaletteColor(entity);
    }

    used.add(color);
    out.push({ entity, color });
  });

  // Others always last, always grey.
  for (const e of others) {
    out.push({ entity: e, color: OTHERS_GREY });
  }

  return out;
}

/**
 * Non-destructive merge that pins `legend.traceorder` to 'normal' so a stacked
 * chart's legend reads in the SAME order the traces stack (bottom → top),
 * instead of Plotly's stacked default of 'reversed'.
 *
 * Existing legend props are preserved; only `traceorder` is overwritten.
 */
export function applyStackedLegendOrder(layout: Partial<Layout>): Partial<Layout> {
  return {
    ...layout,
    legend: {
      ...(layout.legend ?? {}),
      traceorder: "normal",
    },
  };
}

/**
 * Convenience: turn an assignment array into the `{ entity: color }` map shape
 * that most existing trace builders consume. Order is lost in a plain object,
 * so always pair this with the ordered entity list for stacking.
 */
export function toColorMap(assignment: SeriesColor[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const { entity, color } of assignment) map[entity] = color;
  return map;
}
