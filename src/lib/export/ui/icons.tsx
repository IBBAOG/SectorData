// ─────────────────────────────────────────────────────────────────────────────
// icons.tsx — Canonical SVG icons for the unified export library.
//
// These three components are the SINGLE visual identity for every export
// surface across the app. They are referenced by `ExportButton`, which in turn
// is consumed by every dashboard via `DashboardHeader.rightSlot`.
//
// Do NOT add new icon variants. Do NOT inline alternate SVG markup in any
// dashboard or component. If a new icon is required, add it here and document
// the use case in `docs/app/export-library-contract.md`.
//
// SVG markup is locked to the contract — colors, viewBox, paths, and stroke
// widths must match `docs/app/export-library-contract.md` § "Icons" verbatim.
// ─────────────────────────────────────────────────────────────────────────────

import type { JSX } from "react";

/**
 * ExcelIcon — green (#217346) rounded square with a white "X" glyph.
 *
 * Canonical — do not create alternates. Used by:
 *   - `ExportButton` (Tier 1: paired with the literal label "Excel")
 *   - Anywhere a user-facing surface needs to advertise an .xlsx download
 *
 * If you need a different size, wrap this component; do not inline a fork.
 */
export const ExcelIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 24 24" style={{ verticalAlign: "middle" }}>
    <rect x="2" y="2" width="20" height="20" rx="3" fill="#217346" />
    <text x="4" y="17" fontFamily="Arial" fontWeight="bold" fontSize="12" fill="#fff">
      X
    </text>
  </svg>
);

/**
 * CsvIcon — blue (#1565C0) rounded rectangle with three stacked white rows
 * suggesting a tabular CSV file.
 *
 * Canonical — do not create alternates. Used by:
 *   - `ExportButton` (Tier 1: paired with the literal label "CSV")
 *   - Anywhere a user-facing surface needs to advertise a .csv download
 *
 * If you need a different size, wrap this component; do not inline a fork.
 */
export const CsvIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 24 24" style={{ verticalAlign: "middle" }}>
    <rect x="3" y="2" width="18" height="20" rx="2" fill="#1565C0" />
    <rect x="6" y="7" width="12" height="1.5" rx="0.75" fill="#fff" />
    <rect x="6" y="11" width="12" height="1.5" rx="0.75" fill="#fff" />
    <rect x="6" y="15" width="8" height="1.5" rx="0.75" fill="#fff" />
  </svg>
);

/**
 * DownloadIcon — neutral stroke "down arrow into tray" glyph used for the
 * Tier 2 single-button "Export ↓" trigger.
 *
 * Canonical — do not create alternates. Uses `currentColor` so it inherits the
 * button's text color (and hover orange) automatically.
 *
 * If you need a different size, wrap this component; do not inline a fork.
 */
export const DownloadIcon = (): JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" style={{ verticalAlign: "middle" }}>
    <path
      d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
