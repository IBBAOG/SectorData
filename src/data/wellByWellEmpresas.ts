/**
 * Allowlist of views shown as mutually-exclusive pills on the /well-by-well
 * dashboard.
 *
 * Round 9 (2026-05-27): the legacy `<select>` for picking ONE empresa was
 * replaced by FIVE view pills: `Brasil` + four IR-relevant companies. Each
 * pill toggles the whole dashboard between Brazil (100% WI, no stake math)
 * and a stake-weighted view of the chosen company. Brazil sits at position 0
 * because it's the "open the dashboard, what's happening in the country"
 * default — the most relevant first view per Eduardo's report style.
 *
 * Names of company views must match the canonical normalized forms used in
 * `field_stakes.empresa`. Brava Energia (not "Brava"), PetroReconcavo (no
 * accent, no space).
 *
 * The full `get_field_stakes_empresas()` returns 63+ companies including
 * many small onshore operators (Origem Energia, Petrosynergy, Eneva,
 * Alvopetro, etc.) — useful for stake input in the admin panel but visually
 * noisy here. Only the 4 listed companies are the IR-relevant covered
 * universe per Eduardo's Well-by-Well report.
 */
export const WELL_BY_WELL_VIEWS = [
  "Brasil",
  "Petrobras",
  "PRIO",
  "PetroReconcavo",
  "Brava Energia",
] as const;

export type WellByWellView = (typeof WELL_BY_WELL_VIEWS)[number];

/** True for any company view (everything except the Brazil-wide rollup). */
export const isCompanyView = (
  v: WellByWellView,
): v is Exclude<WellByWellView, "Brasil"> => v !== "Brasil";

/**
 * Back-compat: existing consumers (admin panel autocomplete, hook bootstrap
 * snapping) expect a list of company names only. Derived from the view list
 * via the `isCompanyView` filter so there's exactly one source of truth.
 */
export const WELL_BY_WELL_EMPRESAS = WELL_BY_WELL_VIEWS.filter(
  isCompanyView,
) as readonly Exclude<WellByWellView, "Brasil">[];

export type WellByWellEmpresa = Exclude<WellByWellView, "Brasil">;
