// Excel visual standard constants for the unified export library.
//
// Binding source of truth: docs/app/export-library-contract.md
// § "Excel visual standard".
//
// • Header row    — Arial 10 bold, white text, navy fill (#000512 = NavBar).
// • Title row     — Arial 13 bold, brand orange (#FF5000), no fill.
// • Data row      — Arial 10, near-black text (#1A1A1A).
// • All rows      — uniform 14pt height.
// • Workbook      — gridlines OFF per worksheet (ws.views = [{ showGridLines: false }]).
//
// Reused (in spirit) by the chart XML builder via ARIAL10_TXPR.

import type { Fill } from "exceljs";

// ARGB tokens — ExcelJS expects 8-hex format (FF prefix = full opacity).
// Legacy `exportExcel.ts` typed these as plain `{ argb: string }` (no `theme`
// field). We keep the same shape so callers stay backward compatible; the
// ExcelJS types are happy because the assignment site is loosely typed.
export const C = {
  headerBg: { argb: "FF000512" } as const, // navy NavBar
  headerFg: { argb: "FFFFFFFF" } as const, // white
  titleFg:  { argb: "FFFF5000" } as const, // brand orange
  cellFg:   { argb: "FF1A1A1A" } as const, // near black
};

/** Uniform row height (pt). Applies to header, title and data rows. */
export const ROW_H = 14;

/** Convenience pre-built fill for header cells. */
export const HEADER_FILL: Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: C.headerBg,
};

/**
 * Numeric font block reused inside chart axes/legend (OOXML). Keeps Arial 10
 * black consistent between cell text and chart labels so embedded charts
 * read as part of the worksheet.
 *
 * Centralised here so changes to font/size happen in one place.
 */
export const ARIAL_NUMS = `<c:txPr>
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p><a:pPr><a:defRPr b="0" sz="1000"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr></a:p>
      </c:txPr>`;

/** Helper: default Excel column width derivation from header text. */
export function defaultColWidth(header: string): number {
  return Math.max(header.length + 2, 12);
}

/** Helper: default cell alignment given a numFmt and column index. */
export function defaultAlign(
  hasNumFmt: boolean,
  colIndex0: number,
): "left" | "center" {
  if (hasNumFmt) return "center";
  return colIndex0 === 0 ? "left" : "center";
}
