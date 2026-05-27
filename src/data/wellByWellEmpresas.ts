/**
 * Allowlist of companies shown in the /well-by-well dashboard empresa dropdown.
 *
 * Why a whitelist: the full `get_field_stakes_empresas()` returns 63+ companies
 * including many small onshore operators (Origem Energia, Petrosynergy, Eneva,
 * Alvopetro, etc.) — useful for stake input in the admin panel, but visually
 * noisy in the executive dashboard. Only the 4 listed companies are the
 * IR-relevant covered universe per Eduardo's Well-by-Well report.
 *
 * Names must match the canonical normalized forms used in `field_stakes.empresa`.
 * Brava Energia (not "Brava"), PetroReconcavo (no accent, no space).
 */
export const WELL_BY_WELL_EMPRESAS = [
  "Petrobras",
  "PRIO",
  "PetroReconcavo",
  "Brava Energia",
] as const;

export type WellByWellEmpresa = (typeof WELL_BY_WELL_EMPRESAS)[number];
