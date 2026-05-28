// src/lib/export/dashboards/marketShare.ts
//
// Strategy: FALLBACK (see docs/app/market-share.md § Export).
//
// /market-share is the only Tier-2 dashboard that embeds OOXML line charts
// inside the workbook (one chart per segment block, 4 sheets, 3–4 blocks
// per sheet, cores fixas Vibra/Raizen/Ipiranga/Big-3/Others). The OOXML
// builder lives in `src/lib/exportExcel.ts` (`downloadMarketShareExcel`
// + `downloadSalesVolumesExcel`) and its `<c:numFmt formatCode='...'>`
// single-quoted-attribute trick has been validated in production for
// years. Migrating it into the new declarative `ChartSpec` flow without
// end-to-end coverage is too risky during this migration wave.
//
// Decision: keep the legacy `<ExportPanel>` + `<ExportModal>` wiring in
// `desktop/View.tsx` (already in `DashboardHeader.rightSlot`) and treat
// this file as a stable contract anchor — when Phase 2 of the export
// wave verifies the new core can host an OOXML-embed chart, swap this
// placeholder for a real `ExportSpec` and the View import flips in a
// single commit.
//
// DO NOT delete `downloadMarketShareExcel` / `downloadSalesVolumesExcel`
// from `src/lib/exportExcel.ts`. They are the source of truth until the
// real spec lands.

export const marketShareExportStrategy = "fallback" as const;

/**
 * Placeholder export spec for /market-share.
 *
 * Intentionally NOT shaped as `ExportSpec` (from `@/lib/export/types`).
 * The unified `ExportButton` is bypassed for this dashboard during
 * Phase 1 of the export migration wave. See file header comment.
 *
 * Phase 2 (post-wave) will replace this with a full `ExportSpec` once
 * the new ExcelBuilder's OOXML-chart support has been verified for
 * cores fixas + single-quoted `numFmt` attribute compatibility.
 */
export const marketShareExport = {
  strategy: marketShareExportStrategy,
  reason:
    "OOXML line charts with cores fixas (Vibra/Raizen/Ipiranga/Big-3/Others) " +
    "and single-quoted numFmt attribute are too valuable to risk during " +
    "Phase 1. Legacy ExportPanel + ExportModal preserved in desktop/View.tsx.",
  legacyExcelHandler: "downloadMarketShareExcel | downloadSalesVolumesExcel",
  legacyExcelLocation: "src/lib/exportExcel.ts",
  legacyModalHandler: "src/components/dashboard/ExportModal.tsx",
} as const;

export type MarketShareExportPlaceholder = typeof marketShareExport;
