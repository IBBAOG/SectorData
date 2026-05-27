/**
 * Canonical color palette for /well-by-well dashboard charts.
 *
 * Sourced from the monthly Itaú BBA "Well-by-Well" PDF report. Eduardo's
 * report convention is the source of truth for visual identity in this
 * dashboard. Other dashboards may use different palettes per their own
 * conventions — these tokens are scoped to /well-by-well.
 */

export const WBW_COLORS = {
  /** Ambiente segments in stacked bars (Aggregate chart). PDF p2 reference. */
  ambiente: {
    PreSal: "#1f2937",   // dark navy
    PosSal: "#ff5000",   // brand orange
    Terra:  "#9bd9a9",   // mint green (Onshore)
  } as const,

  /** Single-color "Oil" bar (when not stacked). PDF p4. */
  oil: "#1f2937",

  /** "Water" bar shown alongside Oil. PDF p4 (Petrobras Búzios sample). */
  water: "#ff5000",

  /** Operating hours rate line (on dual-axis). PDF p11+ field detail charts. */
  hoursRate: "#ff5000",

  /** Current month bar in current-vs-prior comparison. PDF p3. */
  currentMonth: "#ff5000",

  /** Prior month bar in current-vs-prior comparison. PDF p3. */
  priorMonth: "#1f2937",
} as const;

/** Looks up the color for a raw ambiente DB value ('PreSal'/'PosSal'/'Terra'). */
export function ambienteColor(amb: string): string {
  return (WBW_COLORS.ambiente as Record<string, string>)[amb] ?? "#6b7280";
}
