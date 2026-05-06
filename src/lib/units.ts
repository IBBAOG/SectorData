// Unit conversion helpers + canonical labels.
//
// Keeps the divisor and the chart label in lockstep so we never drift
// (e.g. dividing by 1e6 but labelling as "mil t" or vice-versa).
//
// Convention: source columns are stored in SI base (kg, m³). The frontend
// converts at display time; raw RPCs return base units.

// kg → mil toneladas (thousand metric tons): 1 mil t = 1.000.000 kg
export const kgToMilTon = (kg: number): number => kg / 1e6;

// m³ → mil m³: 1 mil m³ = 1.000 m³
export const m3ToMilM3 = (m3: number): number => m3 / 1e3;

// Canonical unit labels — use these in axis titles and hover templates.
export const LABEL = {
  MIL_T:    "mil t",
  MIL_M3:   "mil m³",
  RS_LITRO: "R$ / L",
  RS_KG:    "R$ / kg",
} as const;
