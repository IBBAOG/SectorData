// Unit conversion helpers + canonical labels.
//
// Keeps the divisor and the chart label in lockstep so we never drift
// (e.g. dividing by 1e6 but labelling as "mil t" or vice-versa).
//
// Convention: source columns are stored in SI base (kg, m³). The frontend
// converts at display time; raw RPCs return base units.

// kg → thousand tons (kt): 1 kt = 1,000,000 kg
export const kgToMilTon = (kg: number): number => kg / 1e6;

// m³ → thousand m³ (km³ in volume convention): 1 thousand m³ = 1,000 m³
export const m3ToMilM3 = (m3: number): number => m3 / 1e3;

/** Convert barrels per day to thousand barrels per day (kbpd).
 *  1 kbpd = 1,000 bbl/day. Used by Oil & Gas dashboards (/anp-cdp*) so the
 *  display scale stays legible (e.g. ~3,000 kbpd vs 3,000,000 bbl/day). */
export const bblDiaToKbpd = (v: number | null | undefined): number =>
  (v ?? 0) / 1000;

// Canonical unit labels — use these in axis titles and hover templates.
export const LABEL = {
  MIL_T:    "kt",
  MIL_M3:   "thousand m³",
  RS_LITRO: "R$ / L",
  RS_KG:    "R$ / kg",
  KBPD:     "kbpd",
} as const;
