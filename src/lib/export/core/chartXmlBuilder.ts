// OOXML line-chart XML builder for embedded charts.
//
// Extracted from the legacy src/lib/exportExcel.ts so the unified library can
// reuse the same XML generators. Today only /market-share embeds charts; other
// dashboards (anp-cdp, anp-glp, etc.) ship sheet-only workbooks and don't
// invoke these helpers.
//
// Coordinate system reminder (EMUs):
//   1 inch  = 914 400 EMU
//   1 point = 12 700  EMU (so ROW_H * 12700 = row height in EMU)
//
// Helpers exported:
//   • colLetter(idx)                  — 1-based column index → A, B, ..., AA
//   • buildChartXml(...)              — one <c:chartSpace/> per segment
//   • buildDrawingXml(charts[])       — places charts side-by-side on a sheet
//   • buildDrawingRels(charts[])      — drawing.xml.rels entries (chart refs)
//   • buildSheetDrawingRel(file)      — bare sheet.xml.rels file content
//
// Constants exported:
//   • ARIAL10_TXPR                    — pre-built Arial 10 black txPr block
//   • CHART_W_EMU / CHART_H_EMU       — default chart dimensions (6 × 3 inches)
//   • CHART_GAP_EMU                   — horizontal gap between side-by-side charts
//   • CHART_ROW_RESERVE               — rows to reserve below data for chart area
//   • ROW_H_EMU                       — derived (ROW_H * 12700)

import { ROW_H } from "./style";

// ── Constants ────────────────────────────────────────────────────────────────

export const ROW_H_EMU = ROW_H * 12700; // 177800 EMU per row

/** Default chart dimensions in EMU (6 inches wide × 3 inches tall). */
export const CHART_W_EMU = 5_486_400;
export const CHART_H_EMU = 2_743_200;
/** Horizontal gap between side-by-side charts (0.25 inch). */
export const CHART_GAP_EMU = 228_600;
/** Rows reserved below data tables for the chart band (matches CHART_H_EMU). */
export const CHART_ROW_RESERVE = 17;

/**
 * Reusable Arial 10 black txPr block — used by axes and legend so chart text
 * matches data-cell text inside the workbook.
 */
export const ARIAL10_TXPR = `<c:txPr>
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p><a:pPr><a:defRPr b="0" sz="1000"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr></a:p>
      </c:txPr>`;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** 1-based column index → A, B, ..., Z, AA, AB, ... */
export function colLetter(colIdx: number): string {
  let result = "";
  let n = colIdx;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/** Quote a sheet name when it contains chars Excel disallows in an unquoted ref. */
function escapeSheetRef(sheetName: string): string {
  return /^[A-Za-z0-9_]+$/.test(sheetName)
    ? sheetName
    : `'${sheetName.replace(/'/g, "''")}'`;
}

// ── Chart XML ────────────────────────────────────────────────────────────────

export type ChartSeriesInput = {
  /** Display name in the legend (typically the player/series label). */
  player: string;
  /** 1-based row in the worksheet that holds this series' values. */
  row1based: number;
};

/**
 * Build OOXML line-chart XML for one segment.
 *
 * Categories (X axis) come from the date header row; values (Y axis) come
 * from each series' row. Colours per series are resolved by `colorOf`.
 *
 * @param sheetName       Worksheet name (will be quoted if needed)
 * @param segmentLabel    Chart title text
 * @param dateHeaderRow   1-based row holding the X-axis labels (dates)
 * @param playerRows      Series row metadata
 * @param dateCount       Number of date columns
 * @param catAxisId       Unique categorical axis id (avoid collision across charts)
 * @param valAxisId       Unique value axis id
 * @param valAxisNumFmt   Y-axis numFmt (e.g. '0"%"' or '0.0')
 * @param colorOf         Hex (without `#`) per series name
 */
export function buildChartXml(
  sheetName: string,
  segmentLabel: string,
  dateHeaderRow: number,
  playerRows: ChartSeriesInput[],
  dateCount: number,
  catAxisId: number,
  valAxisId: number,
  valAxisNumFmt: string,
  colorOf: (player: string) => string,
): string {
  const firstCol = colLetter(2);
  const lastCol = colLetter(dateCount + 1);
  const ref = escapeSheetRef(sheetName);

  const seriesXml = playerRows
    .map(({ player, row1based }, idx) => {
      const color = colorOf(player);
      return [
        `<c:ser>`,
        `  <c:idx val="${idx}"/><c:order val="${idx}"/>`,
        `  <c:tx><c:strRef><c:f>${ref}!$A$${row1based}</c:f></c:strRef></c:tx>`,
        `  <c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr>`,
        `  <c:marker><c:symbol val="none"/></c:marker>`,
        `  <c:cat><c:numRef><c:f>${ref}!$${firstCol}$${dateHeaderRow}:$${lastCol}$${dateHeaderRow}</c:f></c:numRef></c:cat>`,
        `  <c:val><c:numRef><c:f>${ref}!$${firstCol}$${row1based}:$${lastCol}$${row1based}</c:f></c:numRef></c:val>`,
        `  <c:smooth val="0"/>`,
        `</c:ser>`,
      ].join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:roundedCorners val="0"/>
  <c:chart>
    <c:title>
      <c:tx>
        <c:rich>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="en-US" b="0" sz="1000"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${segmentLabel}</a:t></a:r></a:p>
        </c:rich>
      </c:tx>
      <c:overlay val="0"/>
    </c:title>
    <c:plotArea>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
        ${seriesXml}
        <c:axId val="${catAxisId}"/>
        <c:axId val="${valAxisId}"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="${catAxisId}"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:numFmt formatCode="mmm-yy" sourceLinked="0"/>
        <c:majorTickMark val="none"/>
        <c:minorTickMark val="none"/>
        ${ARIAL10_TXPR}
        <c:crossAx val="${valAxisId}"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="${valAxisId}"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:numFmt formatCode='${valAxisNumFmt.replace(/'/g, "&apos;")}' sourceLinked="0"/>
        <c:majorTickMark val="none"/>
        <c:minorTickMark val="none"/>
        ${ARIAL10_TXPR}
        <c:crossAx val="${catAxisId}"/>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
      ${ARIAL10_TXPR}
    </c:legend>
    <c:plotVisOnly val="1"/>
  </c:chart>
  <c:spPr>
    <a:noFill/>
    <a:ln><a:noFill/></a:ln>
  </c:spPr>
</c:chartSpace>`;
}

// ── Drawing XML (placement on the worksheet) ─────────────────────────────────

export type DrawingChartAnchor = {
  chartRelId: string;
  localChartIdx: number;
  firstChartRow0: number;
};

/**
 * Build the per-sheet drawing XML (oneCellAnchor placement).
 *
 * Charts are placed side-by-side at `firstChartRow0` (0-indexed row), each
 * offset horizontally by `(CHART_W_EMU + CHART_GAP_EMU) * localChartIdx`.
 */
export function buildDrawingXml(charts: DrawingChartAnchor[]): string {
  const anchors = charts
    .map(({ chartRelId, localChartIdx, firstChartRow0 }, anchorIdx) => {
      const xPos = localChartIdx * (CHART_W_EMU + CHART_GAP_EMU);
      const yPos = firstChartRow0 * ROW_H_EMU;
      return `
  <xdr:absoluteAnchor>
    <xdr:pos x="${xPos}" y="${yPos}"/>
    <xdr:ext cx="${CHART_W_EMU}" cy="${CHART_H_EMU}"/>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="${anchorIdx + 2}" name="Chart ${localChartIdx + 1}"/>
        <xdr:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></xdr:cNvGraphicFramePr>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                   xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                   r:id="${chartRelId}"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:absoluteAnchor>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${anchors}
</xdr:wsDr>`;
}

/**
 * Build drawing-rels XML linking each chart anchor to its chart XML file.
 */
export function buildDrawingRels(
  charts: { chartRelId: string; chartFile: string }[],
): string {
  const rels = charts
    .map(
      ({ chartRelId, chartFile }) =>
        `  <Relationship Id="${chartRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/${chartFile}"/>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels}
</Relationships>`;
}

/**
 * Build a bare sheet.xml.rels that points to the drawing file (single drawing).
 * Used when the worksheet has no existing rels file to merge into.
 */
export function buildSheetDrawingRel(drawingFile: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingFile}"/>
</Relationships>`;
}
