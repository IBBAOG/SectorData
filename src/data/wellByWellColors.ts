/**
 * Canonical color palette for /well-by-well dashboard charts.
 *
 * Originally sourced from the monthly Itaú BBA "Well-by-Well" PDF report.
 * Re-pinned 2026-06-10 to the official brand palette (the closed 12-color
 * series rotation in src/lib/plotlyDefaults.ts — see
 * .claude/skills/design-standards/SKILL.md). The old PDF navy/mint values
 * (#1f2937 / #9bd9a9) are retired; tokens below map onto palette members.
 * These tokens stay scoped to /well-by-well.
 */

export const WBW_COLORS = {
  /** Ambiente segments in stacked bars (Aggregate chart). PDF p2 reference. */
  ambiente: {
    PreSal: "#000512",   // Very Dark Blue — official series leader
    PosSal: "#ff5000",   // Standard Orange — positional 2nd
    Terra:  "#73C6A1",   // Green (Onshore) — official PALETTE pos 5
  } as const,

  /** Single-color "Oil" bar (when not stacked). PDF p4. */
  oil: "#000512",        // Very Dark Blue — official series leader

  /** "Water" bar shown alongside Oil. PDF p4 (Petrobras Búzios sample). */
  water: "#ff5000",      // Standard Orange — positional 2nd

  /** Operating hours rate line (on dual-axis). PDF p11+ field detail charts.
   *  Green (#73C6A1 — official PALETTE pos 5) so the line stays distinct from
   *  Oil (#000512) and Water (#ff5000) in that chart. Terra also uses #73C6A1
   *  but renders in a DIFFERENT chart (the ambiente stacked bar) — the two
   *  never co-render, so no in-chart collision. */
  hoursRate: "#73C6A1",

  /** Current month bar in current-vs-prior comparison. PDF p3. */
  currentMonth: "#ff5000",   // Standard Orange — positional 2nd

  /** Prior month bar in current-vs-prior comparison. PDF p3. */
  priorMonth: "#000512",     // Very Dark Blue — official series leader
} as const;

/** Looks up the color for a raw ambiente DB value ('PreSal'/'PosSal'/'Terra'). */
export function ambienteColor(amb: string): string {
  return (WBW_COLORS.ambiente as Record<string, string>)[amb] ?? "#6b7280";
}
