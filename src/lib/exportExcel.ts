import ExcelJS from "exceljs";
import JSZip from "jszip";
import type {
  MsSerieRow,
  DgMarginsRow,
  PriceBandsRow,
  MdicComexSerieRow,
  MdicComexRawRow,
  MdicComexAggregatedRow,
  MdicComexGroupBy,
  AnpCdpSeriePonto,
  AnpCdpRawRow,
  AnpCdpAggregatedRow,
  AnpCdpGroupBy,
  AnpLpcSerieRow,
  AnpPdistSerieRow,
} from "./rpc";

const BIG3_MEMBERS = ["Vibra", "Ipiranga", "Raizen"];

const PRODUCTS: { dbName: string; sheetName: string; segments: (string | null)[] }[] = [
  { dbName: "Diesel B",         sheetName: "Diesel B",        segments: ["Retail", "B2B", "TRR", null] },
  { dbName: "Gasolina C",       sheetName: "Gasoline C",      segments: ["Retail", "B2B", null] },
  { dbName: "Etanol Hidratado", sheetName: "Hydrous Ethanol", segments: ["Retail", "B2B", null] },
  { dbName: "Otto-Cycle",       sheetName: "Otto-Cycle",      segments: ["Retail", "B2B", null] },
];

const PLAYER_COLORS: Record<string, string> = {
  "Vibra":    "f26522",
  "Raizen":   "1a1a1a",
  "Ipiranga": "73C6A1",
  "Others":   "A9A9A9",
  "Big-3":    "FF5000",
};
const DEFAULT_COLOR = "4472C4";

function getPlayerColor(player: string): string {
  return PLAYER_COLORS[player] ?? DEFAULT_COLOR;
}

function computeMarketShare(
  rows: MsSerieRow[],
  produto: string,
  segmento: string | null,
  players: string[],
  big3: boolean,
): Map<string, Map<string, number>> {
  let filtered = rows.filter((r) => r.nome_produto === produto);
  if (segmento) filtered = filtered.filter((r) => r.segmento === segmento);

  const groupMap = new Map<string, number>();
  for (const r of filtered) {
    let cls = r.classificacao;
    if (big3) cls = BIG3_MEMBERS.includes(cls) ? "Big-3" : cls;
    const key = `${r.date}|${cls}`;
    groupMap.set(key, (groupMap.get(key) ?? 0) + Number(r.quantidade ?? 0));
  }

  const totalByDate = new Map<string, number>();
  for (const [key, qty] of groupMap) {
    const date = key.split("|")[0];
    totalByDate.set(date, (totalByDate.get(date) ?? 0) + qty);
  }

  const result = new Map<string, Map<string, number>>();
  for (const [key, qty] of groupMap) {
    const [date, cls] = key.split("|");
    if (!players.includes(cls)) continue;
    const total = totalByDate.get(date) ?? 0;
    if (total <= 0) continue;
    if (!result.has(date)) result.set(date, new Map());
    result.get(date)!.set(cls, (qty / total) * 100);
  }
  return result;
}

const EXCEL_EPOCH = new Date(Date.UTC(1899, 11, 30)).getTime();
function toExcelDate(d: string): number {
  return (new Date(d).getTime() - EXCEL_EPOCH) / 86400000;
}

const C = {
  headerBg: { argb: "FF000512" },
  headerFg: { argb: "FFFFFFFF" },
  titleFg:  { argb: "FFFF5000" },
  cellFg:   { argb: "FF1A1A1A" },
};

// All rows uniform height
const ROW_H = 14; // pt
const ROW_H_EMU = ROW_H * 12700; // 177800 EMU per row (1pt = 12700 EMU)

// Chart size in EMU (1 inch = 914400 EMU)
const CHART_W_EMU = 5_486_400;   // 6 inches
const CHART_H_EMU = 2_743_200;   // 3 inches
const CHART_GAP_EMU = 228_600;   // 0.25 inch gap between charts
// Rows to reserve below data for chart area
const CHART_ROW_RESERVE = 17;

// ── OOXML helpers ─────────────────────────────────────────────────────────────

function colLetter(colIdx: number): string {
  let result = "";
  let n = colIdx;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/**
 * Build OOXML chart XML for one segment.
 * Charts are placed side by side below all data tables.
 * segmentLabel is shown as the chart title.
 */
// Reusable Arial 10 black txPr block for axes and legend
const ARIAL10_TXPR = `<c:txPr>
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p><a:pPr><a:defRPr b="0" sz="1000"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr></a:p>
      </c:txPr>`;

function buildChartXml(
  sheetName: string,
  segmentLabel: string,
  dateHeaderRow: number,
  playerRows: { player: string; row1based: number }[],
  dateCount: number,
  catAxisId: number,
  valAxisId: number,
): string {
  const firstCol = colLetter(2);
  const lastCol  = colLetter(dateCount + 1);
  // Always quote sheet names that aren't pure alphanumeric/underscore
  // This fixes "Otto-Cycle" (hyphen) and any name with spaces
  const ref = /^[A-Za-z0-9_]+$/.test(sheetName)
    ? sheetName
    : `'${sheetName.replace(/'/g, "''")}'`;

  const seriesXml = playerRows.map(({ player, row1based }, idx) => {
    const color = getPlayerColor(player);
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
  }).join("\n");

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
        <c:numFmt formatCode='0"%"' sourceLinked="0"/>
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

/**
 * Build drawing XML for one worksheet.
 * Charts are placed side by side using oneCellAnchor with EMU-based horizontal offset.
 * localChartIdx: 0-based position within the row of charts (0 = leftmost)
 * firstChartRow0: 0-indexed row where all charts on this sheet start
 */
function buildDrawingXml(
  charts: { chartRelId: string; localChartIdx: number; firstChartRow0: number }[],
): string {
  const anchors = charts.map(({ chartRelId, localChartIdx, firstChartRow0 }, anchorIdx) => {
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
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${anchors}
</xdr:wsDr>`;
}

function buildDrawingRels(
  charts: { chartRelId: string; chartFile: string }[],
): string {
  const rels = charts.map(({ chartRelId, chartFile }) =>
    `  <Relationship Id="${chartRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/${chartFile}"/>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels}
</Relationships>`;
}

function buildSheetDrawingRel(drawingFile: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingFile}"/>
</Relationships>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function downloadMarketShareExcel(
  serieRows: MsSerieRow[],
  players: string[],
  big3: boolean,
) {
  if (!serieRows || serieRows.length === 0) return;

  // Build Otto-Cycle rows
  const ottoCycleRows: MsSerieRow[] = [];
  for (const r of serieRows) {
    if (r.nome_produto === "Gasolina C") {
      ottoCycleRows.push({ ...r, nome_produto: "Otto-Cycle" });
    } else if (r.nome_produto === "Etanol Hidratado") {
      ottoCycleRows.push({
        ...r,
        nome_produto: "Otto-Cycle",
        quantidade: r.quantidade != null ? Number(r.quantidade) * 0.7 : r.quantidade,
      });
    }
  }
  const rows = [...serieRows, ...ottoCycleRows];

  const allDates = Array.from(new Set(rows.map((r) => r.date))).sort();
  const dateCount = allDates.length;

  const wb = new ExcelJS.Workbook();

  type ChartMeta = {
    sheetIndex: number;
    chartXml: string;
    localChartIdx: number;
    firstChartRow0: number; // 0-indexed OOXML row
  };
  const chartMetas: ChartMeta[] = [];
  let globalChartIdx = 0;

  for (let sheetIdx = 0; sheetIdx < PRODUCTS.length; sheetIdx++) {
    const product = PRODUCTS[sheetIdx];
    const ws = wb.addWorksheet(product.sheetName);

    // Disable grid lines
    ws.views = [{ showGridLines: false }];

    ws.getColumn(1).width = 14;
    for (let c = 2; c <= dateCount + 1; c++) {
      ws.getColumn(c).width = 9;
    }

    let row = 1;

    // Collect per-segment info needed to build chart XML (after all data is written)
    const segmentInfos: {
      segmentLabel: string;
      dateHeaderRow: number;
      playerRows: { player: string; row1based: number }[];
      localChartIdx: number;
    }[] = [];
    let localChartIdx = 0;

    // ── Phase 1: write all data tables ───────────────────────────────────────
    for (const seg of product.segments) {
      const segLabel = seg ?? "Total";

      // Segment title (no merge)
      const titleCell = ws.getCell(row, 1);
      titleCell.value = segLabel;
      titleCell.font = { name: "Arial", size: 13, bold: true, color: C.titleFg };
      titleCell.alignment = { vertical: "middle" };
      ws.getRow(row).height = ROW_H;
      row++;

      // Date header
      const dateHeaderRow = row;
      const hRow = ws.getRow(row);
      hRow.height = ROW_H;
      const lbl = ws.getCell(row, 1);
      lbl.value = "Market Share (%)";
      lbl.font = { name: "Arial", size: 10, bold: true, color: C.headerFg };
      lbl.fill = { type: "pattern", pattern: "solid", fgColor: C.headerBg };
      lbl.alignment = { horizontal: "left" };
      for (let c = 0; c < dateCount; c++) {
        const cell = ws.getCell(row, c + 2);
        cell.value = toExcelDate(allDates[c]);
        cell.numFmt = "mmm-yy";
        cell.font = { name: "Arial", size: 10, bold: true, color: C.headerFg };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: C.headerBg };
        cell.alignment = { horizontal: "center" };
      }
      row++;

      // Player rows
      const msMap = computeMarketShare(rows, product.dbName, seg, players, big3);
      const playerRowInfos: { player: string; row1based: number }[] = [];
      for (const player of players) {
        const pRow = ws.getRow(row);
        pRow.height = ROW_H;
        const nameCell = ws.getCell(row, 1);
        nameCell.value = player;
        nameCell.font = { name: "Arial", size: 10, color: C.cellFg };
        for (let c = 0; c < dateCount; c++) {
          const pct = msMap.get(allDates[c])?.get(player);
          const cell = ws.getCell(row, c + 2);
          cell.value = pct !== undefined ? Math.round(pct * 10) / 10 : null;
          cell.numFmt = '0"%"';
          cell.font = { name: "Arial", size: 10, color: C.cellFg };
          cell.alignment = { horizontal: "center" };
        }
        playerRowInfos.push({ player, row1based: row });
        row++;
      }

      // Separator
      ws.getRow(row).height = ROW_H;
      row++;

      segmentInfos.push({
        segmentLabel: segLabel,
        dateHeaderRow,
        playerRows: playerRowInfos,
        localChartIdx: localChartIdx++,
      });
    }

    // ── Phase 2: chart section below all data ────────────────────────────────
    // firstChartRow0 is the current row (0-indexed for OOXML)
    const firstChartRow0 = row - 1; // exceljs is 1-based, OOXML is 0-based

    // Reserve rows for chart height
    for (let i = 0; i < CHART_ROW_RESERVE; i++) {
      ws.getRow(row).height = ROW_H;
      row++;
    }

    // Build chart XMLs for this sheet
    for (const info of segmentInfos) {
      const catAxisId = globalChartIdx * 2 + 1;
      const valAxisId = globalChartIdx * 2 + 2;
      const chartXml = buildChartXml(
        product.sheetName,
        info.segmentLabel,
        info.dateHeaderRow,
        info.playerRows,
        dateCount,
        catAxisId,
        valAxisId,
      );
      chartMetas.push({
        sheetIndex: sheetIdx + 1,
        chartXml,
        localChartIdx: info.localChartIdx,
        firstChartRow0,
      });
      globalChartIdx++;
    }
  }

  // ── Generate xlsx buffer ──────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(buffer);

  // ── Inject chart XML files ────────────────────────────────────────────────
  for (let i = 0; i < chartMetas.length; i++) {
    zip.file(`xl/charts/chart${i + 1}.xml`, chartMetas[i].chartXml);
  }

  // ── Build per-sheet drawing files ─────────────────────────────────────────
  const chartsBySheet = new Map<number, typeof chartMetas>();
  for (const meta of chartMetas) {
    if (!chartsBySheet.has(meta.sheetIndex)) chartsBySheet.set(meta.sheetIndex, []);
    chartsBySheet.get(meta.sheetIndex)!.push(meta);
  }

  let chartGlobalOffset = 0;
  for (let sheetIdx = 1; sheetIdx <= PRODUCTS.length; sheetIdx++) {
    const sheetCharts = chartsBySheet.get(sheetIdx) ?? [];

    const drawingCharts = sheetCharts.map((meta, di) => ({
      chartRelId: `rId${di + 1}`,
      chartFile:  `chart${chartGlobalOffset + di + 1}.xml`,
      localChartIdx: meta.localChartIdx,
      firstChartRow0: meta.firstChartRow0,
    }));

    zip.file(`xl/drawings/drawing${sheetIdx}.xml`,
      buildDrawingXml(drawingCharts));

    zip.file(`xl/drawings/_rels/drawing${sheetIdx}.xml.rels`,
      buildDrawingRels(drawingCharts.map(({ chartRelId, chartFile }) => ({ chartRelId, chartFile }))));

    // Worksheet rels — append drawing rel to any existing rels
    const wsRelsPath = `xl/worksheets/_rels/sheet${sheetIdx}.xml.rels`;
    const existingRelsFile = zip.file(wsRelsPath);
    let drawingRelId = "rId1";
    let wsRelsXml: string;
    if (existingRelsFile) {
      const existingXml = await existingRelsFile.async("string");
      const usedNums = [...existingXml.matchAll(/Id="rId(\d+)"/g)].map((m) => parseInt(m[1]));
      const nextNum = usedNums.length > 0 ? Math.max(...usedNums) + 1 : 1;
      drawingRelId = `rId${nextNum}`;
      wsRelsXml = existingXml.replace(
        "</Relationships>",
        `  <Relationship Id="${drawingRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${sheetIdx}.xml"/>\n</Relationships>`,
      );
    } else {
      wsRelsXml = buildSheetDrawingRel(`drawing${sheetIdx}.xml`);
    }
    zip.file(wsRelsPath, wsRelsXml);

    // Inject <drawing r:id="..."/> into worksheet XML
    const wsPath = `xl/worksheets/sheet${sheetIdx}.xml`;
    const wsXmlFile = zip.file(wsPath);
    if (wsXmlFile) {
      let wsXml = await wsXmlFile.async("string");
      if (!wsXml.includes("xmlns:r=")) {
        wsXml = wsXml.replace("<worksheet ", `<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" `);
      }
      if (!wsXml.includes("<drawing ")) {
        wsXml = wsXml.replace("</worksheet>", `<drawing r:id="${drawingRelId}"/></worksheet>`);
      }
      zip.file(wsPath, wsXml);
    }

    chartGlobalOffset += sheetCharts.length;
  }

  // ── Update [Content_Types].xml ────────────────────────────────────────────
  const ctFile = zip.file("[Content_Types].xml");
  if (ctFile) {
    let ctXml = await ctFile.async("string");
    for (let i = 1; i <= chartMetas.length; i++) {
      if (!ctXml.includes(`chart${i}.xml`)) {
        ctXml = ctXml.replace("</Types>",
          `<Override PartName="/xl/charts/chart${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>\n</Types>`);
      }
    }
    for (let i = 1; i <= PRODUCTS.length; i++) {
      if (!ctXml.includes(`drawing${i}.xml`)) {
        ctXml = ctXml.replace("</Types>",
          `<Override PartName="/xl/drawings/drawing${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>\n</Types>`);
      }
    }
    zip.file("[Content_Types].xml", ctXml);
  }

  // ── Finalise ──────────────────────────────────────────────────────────────
  const finalBuffer = await zip.generateAsync({ type: "arraybuffer" });
  const blob = new Blob([finalBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  a.download = `FD Market Share ${dd}-${mm}-${yy}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Generic Excel export (Tier 1 dashboards) ─────────────────────────────────
//
// Pragmatic, uniform XLSX builder used by the "leve" dashboards (small datasets,
// no chart embedding needed). Produces a single workbook with a single sheet:
//   - optional title row in brand orange (Arial 13 bold)
//   - bold black/white header row
//   - data rows in Arial 10 dark grey
// Filename gets " DD-MM-YY.xlsx" appended automatically.
//
// Usage:
//   await downloadGenericExcel({
//     rows,
//     filename: "ANP LPG",
//     title:    "ANP — LPG Sales",
//     columns:  [
//       { key: "ano",           header: "Year" },
//       { key: "mes",           header: "Month" },
//       { key: "distribuidora", header: "Distributor" },
//       { key: "vendas_kg",     header: "Sales (kg)", format: "#,##0" },
//     ],
//   });
//
// If `columns` is omitted the helper falls back to `Object.keys(rows[0])`,
// useful for "all-columns" dumps.

/**
 * Column definition for `downloadGenericExcel`.
 *
 * Provide **either** `key` (lookup `row[key]`) **or** `value` (extractor function).
 * If both are provided, `value` wins. Exactly one is required.
 *
 * `format` is the canonical name for the ExcelJS `numFmt` string; `numFmt` is
 * accepted as an alias to ease migration from the old `downloadSimpleSheet` API.
 * If both are set, `format` wins.
 */
export type GenericExcelColumn<T> = {
  header: string;
  /** Column width in characters. Defaults to max(header.length+2, 12). */
  width?: number;
  /** Cell alignment for the data column. Defaults to "center" for numeric formats, "left" otherwise. */
  align?: "left" | "center" | "right";
  /** ExcelJS numFmt string applied to data cells (e.g. "0.00", "#,##0", "yyyy-mm-dd"). */
  format?: string;
  /** Alias for `format`. Kept for backwards compat with the legacy `downloadSimpleSheet` callers. */
  numFmt?: string;
} & (
  | { key: keyof T; value?: never }
  | { key?: never;  value: (row: T) => unknown }
  | { key: keyof T; value: (row: T) => unknown } // both — `value` wins
);

export type GenericExcelOptions<T extends Record<string, unknown>> = {
  rows: T[];
  /** Filename without extension — `.xlsx` and ` DD-MM-YY` are appended automatically. */
  filename: string;
  /** Optional title shown on row 1 in brand orange. When omitted, the header row is row 1. */
  title?: string;
  /** Worksheet name. Defaults to "Data". */
  sheetName?: string;
  /** Explicit column order + headers + formatting. When omitted, falls back to `Object.keys(rows[0])`. */
  columns?: GenericExcelColumn<T>[];
  /** When true, merge the title row across all columns (Tier 2 banner style). Default: false. */
  mergeTitleCells?: boolean;
};

export async function downloadGenericExcel<T extends Record<string, unknown>>(
  opts: GenericExcelOptions<T>,
): Promise<void> {
  const { rows, filename, title, sheetName = "Data", columns, mergeTitleCells = false } = opts;
  if (!rows || rows.length === 0) return;

  const cols: GenericExcelColumn<T>[] = columns ?? (
    Object.keys(rows[0]).map((k) => ({ key: k as keyof T, header: k }))
  );

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.views = [{ showGridLines: false }];

  // Column widths
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width ?? Math.max(c.header.length + 2, 12);
  });

  let rowIdx = 1;

  // Title row (optional)
  if (title) {
    const tRow = ws.getRow(rowIdx);
    tRow.height = ROW_H;
    const tCell = ws.getCell(rowIdx, 1);
    tCell.value = title;
    tCell.font = { name: "Arial", size: 13, bold: true, color: C.titleFg };
    tCell.alignment = { vertical: "middle" };
    if (mergeTitleCells && cols.length > 1) {
      ws.mergeCells(rowIdx, 1, rowIdx, cols.length);
    }
    rowIdx++;
  }

  // Header row
  const hRow = ws.getRow(rowIdx);
  hRow.height = ROW_H;
  cols.forEach((c, i) => {
    const cell = ws.getCell(rowIdx, i + 1);
    cell.value = c.header;
    cell.font = { name: "Arial", size: 10, bold: true, color: C.headerFg };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: C.headerBg };
    cell.alignment = { horizontal: i === 0 ? "left" : "center" };
  });
  rowIdx++;

  // Data rows
  rows.forEach((r, dataIdx) => {
    const dRow = ws.getRow(rowIdx + dataIdx);
    dRow.height = ROW_H;
    cols.forEach((c, i) => {
      const cell = ws.getCell(rowIdx + dataIdx, i + 1);
      // `value` extractor wins over `key` lookup (when both provided).
      const v = c.value !== undefined
        ? c.value(r)
        : (c.key !== undefined ? r[c.key as keyof T] : undefined);
      cell.value = (v === undefined ? null : v) as ExcelJS.CellValue;
      cell.font = { name: "Arial", size: 10, color: C.cellFg };
      const numFmt = c.format ?? c.numFmt;
      if (numFmt) cell.numFmt = numFmt;
      const isNumeric = typeof v === "number" || numFmt !== undefined;
      const align = c.align ?? (isNumeric ? "center" : i === 0 ? "left" : "center");
      cell.alignment = { horizontal: align };
    });
  });

  // ── Finalise ──────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  a.download = `${filename} ${dd}-${mm}-${yy}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── D&G Margins export ────────────────────────────────────────────────────────

const DG_FUEL_TYPES = ["Diesel B", "Gasoline C"];

export async function downloadDgMarginsExcel(rows: DgMarginsRow[]): Promise<void> {
  if (!rows || rows.length === 0) return;

  const wb = new ExcelJS.Workbook();

  for (const fuelType of DG_FUEL_TYPES) {
    const sheetRows = rows.filter((r) => r.fuel_type === fuelType);
    if (sheetRows.length === 0) continue;

    const ws = wb.addWorksheet(fuelType);
    ws.views = [{ showGridLines: false }];

    // Column widths
    ws.getColumn(1).width = 12; // Week
    ws.getColumn(2).width = 22; // Dist. & Resale Margin
    ws.getColumn(3).width = 14; // State Tax
    ws.getColumn(4).width = 14; // Federal Tax
    ws.getColumn(5).width = 18; // Biofuel
    ws.getColumn(6).width = 14; // Base Fuel
    ws.getColumn(7).width = 12; // Total

    // Header row
    const headers = [
      "Week",
      "Dist. & Resale Margin",
      "State Tax",
      "Federal Tax",
      fuelType === "Diesel B" ? "Biodiesel" : "Anhydrous Ethanol",
      fuelType === "Diesel B" ? "Diesel A" : "Gasoline A",
      "Total",
    ];
    const hRow = ws.getRow(1);
    hRow.height = ROW_H;
    headers.forEach((h, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value = h;
      cell.font = { name: "Arial", size: 10, bold: true, color: C.headerFg };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: C.headerBg };
      cell.alignment = { horizontal: i === 0 ? "left" : "center" };
    });

    // Data rows
    sheetRows.forEach((r, idx) => {
      const row = ws.getRow(idx + 2);
      row.height = ROW_H;
      const values = [
        r.week,
        r.distribution_and_resale_margin,
        r.state_tax,
        r.federal_tax,
        r.biofuel_component,
        r.base_fuel,
        r.total,
      ];
      values.forEach((v, i) => {
        const cell = ws.getCell(idx + 2, i + 1);
        cell.value = v ?? null;
        cell.font = { name: "Arial", size: 10, color: C.cellFg };
        if (i > 0) {
          cell.numFmt = "0.00";
          cell.alignment = { horizontal: "center" };
        }
      });
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  a.download = `D&G Margins ${dd}-${mm}-${yy}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Price Bands export ────────────────────────────────────────────────────────

export async function downloadPriceBandsExcel(rows: PriceBandsRow[]): Promise<void> {
  if (!rows || rows.length === 0) return;

  const wb = new ExcelJS.Workbook();

  const sheets: { product: "Gasoline" | "Diesel"; sheetName: string }[] = [
    { product: "Gasoline", sheetName: "Gasoline" },
    { product: "Diesel",   sheetName: "Diesel"   },
  ];

  for (const { product, sheetName } of sheets) {
    const sheetRows = rows
      .filter((r) => r.product === product)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (sheetRows.length === 0) continue;

    const ws = wb.addWorksheet(sheetName);
    ws.views = [{ showGridLines: false }];

    const isDiesel = product === "Diesel";
    const headers = isDiesel
      ? ["Date", "BBA Import Parity", "BBA Import Parity w/ Subsidy", "BBA Export Parity", "Petrobras Price", "Petrobras Price w/ Subsidy"]
      : ["Date", "Import Parity", "Export Parity", "Petrobras Price"];

    ws.getColumn(1).width = 12;
    for (let c = 2; c <= headers.length; c++) ws.getColumn(c).width = 24;

    // Header
    const hRow = ws.getRow(1);
    hRow.height = ROW_H;
    headers.forEach((h, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value = h;
      cell.font = { name: "Arial", size: 10, bold: true, color: C.headerFg };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: C.headerBg };
      cell.alignment = { horizontal: i === 0 ? "left" : "center" };
    });

    // Data rows
    sheetRows.forEach((r, idx) => {
      const row = ws.getRow(idx + 2);
      row.height = ROW_H;
      const values: (string | number | null)[] = isDiesel
        ? [r.date, r.bba_import_parity, r.bba_import_parity_w_subsidy, r.bba_export_parity, r.petrobras_price, r.petrobras_price_w_subsidy]
        : [r.date, r.bba_import_parity, r.bba_export_parity, r.petrobras_price];
      values.forEach((v, i) => {
        const cell = ws.getCell(idx + 2, i + 1);
        cell.value = v ?? null;
        cell.font = { name: "Arial", size: 10, color: C.cellFg };
        if (i > 0) {
          cell.numFmt = "0.00";
          cell.alignment = { horizontal: "center" };
        }
      });
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  a.download = `Price Bands ${dd}-${mm}-${yy}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Sales Volumes export ──────────────────────────────────────────────────────

/**
 * Compute absolute volume per (date, player) for a given product/segment.
 * Analogous to computeMarketShare but without the percentage conversion.
 */
function computeSalesVolumes(
  rows: MsSerieRow[],
  produto: string,
  segmento: string | null,
  players: string[],
  big3: boolean,
): Map<string, Map<string, number>> {
  let filtered = rows.filter((r) => r.nome_produto === produto);
  if (segmento) filtered = filtered.filter((r) => r.segmento === segmento);

  const groupMap = new Map<string, number>();
  for (const r of filtered) {
    let cls = r.classificacao;
    if (big3) cls = BIG3_MEMBERS.includes(cls) ? "Big-3" : cls;
    const key = `${r.date}|${cls}`;
    groupMap.set(key, (groupMap.get(key) ?? 0) + Number(r.quantidade ?? 0));
  }

  const result = new Map<string, Map<string, number>>();
  for (const [key, qty] of groupMap) {
    const [date, cls] = key.split("|");
    if (!players.includes(cls)) continue;
    if (!result.has(date)) result.set(date, new Map());
    result.get(date)!.set(cls, qty);
  }
  return result;
}

function buildSvChartXml(
  sheetName: string,
  segmentLabel: string,
  dateHeaderRow: number,
  playerRows: { player: string; row1based: number }[],
  dateCount: number,
  catAxisId: number,
  valAxisId: number,
): string {
  const firstCol = colLetter(2);
  const lastCol  = colLetter(dateCount + 1);
  const ref = /^[A-Za-z0-9_]+$/.test(sheetName)
    ? sheetName
    : `'${sheetName.replace(/'/g, "''")}'`;

  const seriesXml = playerRows.map(({ player, row1based }, idx) => {
    const color = getPlayerColor(player);
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
  }).join("\n");

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
        <c:numFmt formatCode="0.0" sourceLinked="0"/>
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

export async function downloadSalesVolumesExcel(
  serieRows: MsSerieRow[],
  players: string[],
  big3: boolean,
) {
  if (!serieRows || serieRows.length === 0) return;

  // Build Otto-Cycle rows (Gasolina C + Etanol Hidratado × 0.7)
  const ottoCycleRows: MsSerieRow[] = [];
  for (const r of serieRows) {
    if (r.nome_produto === "Gasolina C") {
      ottoCycleRows.push({ ...r, nome_produto: "Otto-Cycle" });
    } else if (r.nome_produto === "Etanol Hidratado") {
      ottoCycleRows.push({
        ...r,
        nome_produto: "Otto-Cycle",
        quantidade: r.quantidade != null ? Number(r.quantidade) * 0.7 : r.quantidade,
      });
    }
  }
  const rows = [...serieRows, ...ottoCycleRows];

  const allDates = Array.from(new Set(rows.map((r) => r.date))).sort();
  const dateCount = allDates.length;

  const wb = new ExcelJS.Workbook();

  type SvChartMeta = {
    sheetIndex: number;
    chartXml: string;
    localChartIdx: number;
    firstChartRow0: number;
  };
  const chartMetas: SvChartMeta[] = [];
  let globalChartIdx = 0;

  for (let sheetIdx = 0; sheetIdx < PRODUCTS.length; sheetIdx++) {
    const product = PRODUCTS[sheetIdx];
    const ws = wb.addWorksheet(product.sheetName);

    ws.views = [{ showGridLines: false }];
    ws.getColumn(1).width = 14;
    for (let c = 2; c <= dateCount + 1; c++) ws.getColumn(c).width = 9;

    let row = 1;

    const segmentInfos: {
      segmentLabel: string;
      dateHeaderRow: number;
      playerRows: { player: string; row1based: number }[];
      localChartIdx: number;
    }[] = [];
    let localChartIdx = 0;

    // ── Phase 1: write all data tables ───────────────────────────────────
    for (const seg of product.segments) {
      const segLabel = seg ?? "Total";

      const titleCell = ws.getCell(row, 1);
      titleCell.value = segLabel;
      titleCell.font = { name: "Arial", size: 13, bold: true, color: C.titleFg };
      titleCell.alignment = { vertical: "middle" };
      ws.getRow(row).height = ROW_H;
      row++;

      const dateHeaderRow = row;
      const hRow = ws.getRow(row);
      hRow.height = ROW_H;
      const lbl = ws.getCell(row, 1);
      lbl.value = "Volume (thousand m³)";
      lbl.font = { name: "Arial", size: 10, bold: true, color: C.headerFg };
      lbl.fill = { type: "pattern", pattern: "solid", fgColor: C.headerBg };
      lbl.alignment = { horizontal: "left" };
      for (let c = 0; c < dateCount; c++) {
        const cell = ws.getCell(row, c + 2);
        cell.value = toExcelDate(allDates[c]);
        cell.numFmt = "mmm-yy";
        cell.font = { name: "Arial", size: 10, bold: true, color: C.headerFg };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: C.headerBg };
        cell.alignment = { horizontal: "center" };
      }
      row++;

      const volMap = computeSalesVolumes(rows, product.dbName, seg, players, big3);
      const playerRowInfos: { player: string; row1based: number }[] = [];
      for (const player of players) {
        const pRow = ws.getRow(row);
        pRow.height = ROW_H;
        const nameCell = ws.getCell(row, 1);
        nameCell.value = player;
        nameCell.font = { name: "Arial", size: 10, color: C.cellFg };
        for (let c = 0; c < dateCount; c++) {
          const vol = volMap.get(allDates[c])?.get(player);
          const cell = ws.getCell(row, c + 2);
          cell.value = vol !== undefined ? Math.round(vol * 10) / 10 : null;
          cell.numFmt = "0.0";
          cell.font = { name: "Arial", size: 10, color: C.cellFg };
          cell.alignment = { horizontal: "center" };
        }
        playerRowInfos.push({ player, row1based: row });
        row++;
      }

      ws.getRow(row).height = ROW_H;
      row++;

      segmentInfos.push({
        segmentLabel: segLabel,
        dateHeaderRow,
        playerRows: playerRowInfos,
        localChartIdx: localChartIdx++,
      });
    }

    // ── Phase 2: chart section below all data ────────────────────────────
    const firstChartRow0 = row - 1;
    for (let i = 0; i < CHART_ROW_RESERVE; i++) {
      ws.getRow(row).height = ROW_H;
      row++;
    }

    for (const info of segmentInfos) {
      const catAxisId = globalChartIdx * 2 + 1;
      const valAxisId = globalChartIdx * 2 + 2;
      const chartXml = buildSvChartXml(
        product.sheetName,
        info.segmentLabel,
        info.dateHeaderRow,
        info.playerRows,
        dateCount,
        catAxisId,
        valAxisId,
      );
      chartMetas.push({
        sheetIndex: sheetIdx + 1,
        chartXml,
        localChartIdx: info.localChartIdx,
        firstChartRow0,
      });
      globalChartIdx++;
    }
  }

  // ── Generate xlsx buffer ────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(buffer);

  for (let i = 0; i < chartMetas.length; i++) {
    zip.file(`xl/charts/chart${i + 1}.xml`, chartMetas[i].chartXml);
  }

  const chartsBySheet = new Map<number, typeof chartMetas>();
  for (const meta of chartMetas) {
    if (!chartsBySheet.has(meta.sheetIndex)) chartsBySheet.set(meta.sheetIndex, []);
    chartsBySheet.get(meta.sheetIndex)!.push(meta);
  }

  let chartGlobalOffset = 0;
  for (let sheetIdx = 1; sheetIdx <= PRODUCTS.length; sheetIdx++) {
    const sheetCharts = chartsBySheet.get(sheetIdx) ?? [];

    const drawingCharts = sheetCharts.map((meta, di) => ({
      chartRelId: `rId${di + 1}`,
      chartFile:  `chart${chartGlobalOffset + di + 1}.xml`,
      localChartIdx: meta.localChartIdx,
      firstChartRow0: meta.firstChartRow0,
    }));

    zip.file(`xl/drawings/drawing${sheetIdx}.xml`, buildDrawingXml(drawingCharts));
    zip.file(`xl/drawings/_rels/drawing${sheetIdx}.xml.rels`,
      buildDrawingRels(drawingCharts.map(({ chartRelId, chartFile }) => ({ chartRelId, chartFile }))));

    const wsRelsPath = `xl/worksheets/_rels/sheet${sheetIdx}.xml.rels`;
    const existingRelsFile = zip.file(wsRelsPath);
    let drawingRelId = "rId1";
    let wsRelsXml: string;
    if (existingRelsFile) {
      const existingXml = await existingRelsFile.async("string");
      const usedNums = [...existingXml.matchAll(/Id="rId(\d+)"/g)].map((m) => parseInt(m[1]));
      const nextNum = usedNums.length > 0 ? Math.max(...usedNums) + 1 : 1;
      drawingRelId = `rId${nextNum}`;
      wsRelsXml = existingXml.replace(
        "</Relationships>",
        `  <Relationship Id="${drawingRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${sheetIdx}.xml"/>\n</Relationships>`,
      );
    } else {
      wsRelsXml = buildSheetDrawingRel(`drawing${sheetIdx}.xml`);
    }
    zip.file(wsRelsPath, wsRelsXml);

    const wsPath = `xl/worksheets/sheet${sheetIdx}.xml`;
    const wsXmlFile = zip.file(wsPath);
    if (wsXmlFile) {
      let wsXml = await wsXmlFile.async("string");
      if (!wsXml.includes("xmlns:r=")) {
        wsXml = wsXml.replace("<worksheet ", `<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" `);
      }
      if (!wsXml.includes("<drawing ")) {
        wsXml = wsXml.replace("</worksheet>", `<drawing r:id="${drawingRelId}"/></worksheet>`);
      }
      zip.file(wsPath, wsXml);
    }

    chartGlobalOffset += sheetCharts.length;
  }

  const ctFile = zip.file("[Content_Types].xml");
  if (ctFile) {
    let ctXml = await ctFile.async("string");
    for (let i = 1; i <= chartMetas.length; i++) {
      if (!ctXml.includes(`chart${i}.xml`)) {
        ctXml = ctXml.replace("</Types>",
          `<Override PartName="/xl/charts/chart${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>\n</Types>`);
      }
    }
    for (let i = 1; i <= PRODUCTS.length; i++) {
      if (!ctXml.includes(`drawing${i}.xml`)) {
        ctXml = ctXml.replace("</Types>",
          `<Override PartName="/xl/drawings/drawing${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>\n</Types>`);
      }
    }
    zip.file("[Content_Types].xml", ctXml);
  }

  const finalBuffer = await zip.generateAsync({ type: "arraybuffer" });
  const svBlob = new Blob([finalBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const svUrl = URL.createObjectURL(svBlob);
  const svA = document.createElement("a");
  svA.href = svUrl;
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  svA.download = `FD Sales Volumes ${dd}-${mm}-${yy}.xlsx`;
  document.body.appendChild(svA);
  svA.click();
  document.body.removeChild(svA);
  URL.revokeObjectURL(svUrl);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 2 single-sheet wrappers (mdic-comex, anp-cdp, anp-lpc).
//
// Mirror the Tier 1 path exactly: `downloadGenericExcel` with `key:` lookups
// and **no** `mergeTitleCells`. Earlier these wrappers used `value:` extractors
// + `mergeTitleCells:true` to reproduce the legacy `downloadSimpleSheet` banner,
// but that combination produced XLSX files that Excel reported as "file format
// or file extension is not valid", while Tier 1 dashboards (anp-glp, anp-daie,
// etc.) using the same helper without those features kept working. Aligning
// the Tier 2 wrappers to the Tier 1 path eliminates the regression vector.
// ─────────────────────────────────────────────────────────────────────────────

// ── MDIC Comex export ────────────────────────────────────────────────────────

export async function downloadMdicComexExcel(rows: MdicComexSerieRow[]): Promise<void> {
  await downloadGenericExcel<MdicComexSerieRow>({
    rows,
    sheetName: "MDIC Comex",
    title: "MDIC Comex Stat — Imports and Exports",
    filename: "MDIC Comex",
    columns: [
      { key: "ano",           header: "Year",             width: 8 },
      { key: "mes",           header: "Month",             width: 6 },
      { key: "flow",          header: "Flow",            width: 12 },
      { key: "ncm_codigo",    header: "NCM",             width: 14 },
      { key: "ncm_nome",      header: "NCM Description", width: 36, align: "left" },
      { key: "volume_kg",     header: "Volume (kg)",     width: 18, format: "#,##0" },
      { key: "valor_fob_usd", header: "FOB Value (US$)", width: 20, format: "#,##0.00" },
    ],
  });
}

// ── ANP CDP export ───────────────────────────────────────────────────────────

export async function downloadAnpCdpExcel(rows: AnpCdpSeriePonto[]): Promise<void> {
  await downloadGenericExcel<AnpCdpSeriePonto>({
    rows,
    sheetName: "ANP CDP",
    title: "ANP CDP — Production by Well",
    filename: "ANP CDP",
    columns: [
      { key: "ano",                          header: "Year",                     width: 8 },
      { key: "mes",                          header: "Month",                     width: 6 },
      { key: "petroleo_bbl_dia",             header: "Petroleum (bbl/day)",      width: 18, format: "#,##0.00" },
      { key: "oleo_bbl_dia",                 header: "Oil (bbl/day)",          width: 18, format: "#,##0.00" },
      { key: "condensado_bbl_dia",           header: "Condensate (bbl/day)",    width: 20, format: "#,##0.00" },
      { key: "gas_total_mm3_dia",            header: "Total Gas (Mm³/day)",     width: 20, format: "#,##0.00" },
      { key: "gas_natural_assoc_mm3_dia",    header: "Assoc. Gas (Mm³/day)",    width: 22, format: "#,##0.00" },
      { key: "gas_natural_n_assoc_mm3_dia",  header: "Non-Assoc. Gas (Mm³/day)",  width: 22, format: "#,##0.00" },
      { key: "gas_royalties",                header: "Gas Royalties",           width: 18, format: "#,##0.00" },
      { key: "agua_bbl_dia",                 header: "Water (bbl/day)",          width: 16, format: "#,##0.00" },
      { key: "tempo_prod_hs_mes",            header: "Production Time (hrs/month)", width: 22, format: "#,##0.00" },
    ],
  });
}

// ── ANP CDP raw export (1 row per poço × mês × demais dimensões) ─────────────
//
// Default export path for /anp-cdp. Mirrors the columns of `anp_cdp_producao`
// 1:1 (do not invent fields). Uses `key:` lookups (NOT `value:` extractors)
// because the `value` + `mergeTitleCells:true` combo is known-broken in the
// browser bundle (see commit ee640e53). Title is set but not merged here, so
// we are within the safe path.

export async function downloadAnpCdpRawExcel(rows: AnpCdpRawRow[]): Promise<void> {
  await downloadGenericExcel<AnpCdpRawRow>({
    rows,
    sheetName: "ANP CDP — Raw",
    title: "ANP CDP — Production by Well (raw)",
    filename: "ANP CDP raw",
    columns: [
      { key: "ano",                          header: "Year",                     width: 8 },
      { key: "mes",                          header: "Month",                     width: 6 },
      { key: "estado",                       header: "State",                  width: 10 },
      { key: "bacia",                        header: "Basin",                   width: 18, align: "left" },
      { key: "campo",                        header: "Field",                   width: 22, align: "left" },
      { key: "poco",                         header: "Well",                    width: 18, align: "left" },
      { key: "operador",                     header: "Operator",                width: 22, align: "left" },
      { key: "nome_poco_operador",           header: "Well Name (Operator)",    width: 22, align: "left" },
      { key: "num_contrato",                 header: "Contract No.",            width: 16, align: "left" },
      { key: "instalacao_destino",           header: "Destination Facility",    width: 22, align: "left" },
      { key: "tipo_instalacao",              header: "Facility Type",           width: 18, align: "left" },
      { key: "local",                        header: "Environment",             width: 12 },
      { key: "petroleo_bbl_dia",             header: "Petroleum (bbl/day)",     width: 18, format: "#,##0.00" },
      { key: "oleo_bbl_dia",                 header: "Oil (bbl/day)",           width: 18, format: "#,##0.00" },
      { key: "condensado_bbl_dia",           header: "Condensate (bbl/day)",    width: 20, format: "#,##0.00" },
      { key: "gas_total_mm3_dia",            header: "Total Gas (Mm³/day)",     width: 20, format: "#,##0.00" },
      { key: "gas_natural_assoc_mm3_dia",    header: "Assoc. Gas (Mm³/day)",    width: 22, format: "#,##0.00" },
      { key: "gas_natural_n_assoc_mm3_dia",  header: "Non-Assoc. Gas (Mm³/day)", width: 22, format: "#,##0.00" },
      { key: "gas_royalties",                header: "Gas Royalties",           width: 18, format: "#,##0.00" },
      { key: "agua_bbl_dia",                 header: "Water (bbl/day)",         width: 16, format: "#,##0.00" },
      { key: "tempo_prod_hs_mes",            header: "Production Time (hrs/month)", width: 22, format: "#,##0.00" },
    ],
  });
}

// ── ANP Distribution Prices export ───────────────────────────────────────────

export async function downloadAnpPdistExcel(rows: AnpPdistSerieRow[]): Promise<void> {
  await downloadGenericExcel<AnpPdistSerieRow>({
    rows,
    sheetName: "ANP Distrib. Prices",
    title: "ANP — Fuel Distribution Prices",
    filename: "ANP Distribution Prices",
    columns: [
      { key: "data_referencia", header: "Reference Date",  width: 16 },
      { key: "local",           header: "Location",        width: 26, align: "left" },
      { key: "preco_medio",     header: "Avg. Price",      width: 14, format: "0.0000" },
      { key: "preco_minimo",    header: "Min. Price",      width: 14, format: "0.0000" },
      { key: "preco_maximo",    header: "Max. Price",      width: 14, format: "0.0000" },
      { key: "unidade",         header: "Unit",            width: 10 },
    ],
  });
}

// ── ANP LPC export ───────────────────────────────────────────────────────────

export async function downloadAnpLpcExcel(rows: AnpLpcSerieRow[]): Promise<void> {
  await downloadGenericExcel<AnpLpcSerieRow>({
    rows,
    sheetName: "ANP LPC",
    title: "ANP LPC — Fuel Price Survey",
    filename: "ANP LPC",
    columns: [
      { key: "data_fim",           header: "End Date",          width: 12 },
      { key: "produto",            header: "Product",           width: 22, align: "left" },
      { key: "estado",             header: "State",             width: 8 },
      { key: "preco_medio_venda",  header: "Avg. Sale Price",   width: 18, format: "0.000" },
      { key: "preco_medio_compra", header: "Avg. Purchase Price", width: 20, format: "0.000" },
      { key: "n_postos",           header: "Stations",          width: 12, format: "#,##0" },
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 2 aggregated exports (anp-cdp + mdic-comex)
//
// The user picks a granularity in the export modal (e.g. "Por campo" → groupBy
// = ['ano','mes','campo']). Page calls `rpcGet*Aggregated(filters, groupBy)`
// then routes the rows here. The Excel only includes columns for the requested
// dimensions plus all metric columns.
//
// Constraints (see anti-pattern note in section above):
//   • `key:` lookups only — never `value:` extractors
//   • no `mergeTitleCells` (not passed = false default)
//   • Title row simple on row 1
// ─────────────────────────────────────────────────────────────────────────────

// ── ANP CDP aggregated dimension dictionary ─────────────────────────────────
//
// Maps each AnpCdpGroupBy key → its column metadata (header, width, align).
// `local` is presented as "Ambiente" to match the dashboard label.

type AnpCdpDimColumn = {
  header: string;
  width: number;
  align?: "left" | "center" | "right";
};

const ANP_CDP_DIM_COLS: Record<AnpCdpGroupBy, AnpCdpDimColumn> = {
  ano:                { header: "Year",               width: 8 },
  mes:                { header: "Month",              width: 6 },
  campo:              { header: "Field",              width: 22, align: "left" },
  bacia:              { header: "Basin",              width: 18, align: "left" },
  operador:           { header: "Operator",           width: 22, align: "left" },
  estado:             { header: "State",              width: 10 },
  local:              { header: "Environment",        width: 12 },
  instalacao_destino: { header: "Destination Facility", width: 22, align: "left" },
  tipo_instalacao:    { header: "Facility Type",      width: 18, align: "left" },
};

const ANP_CDP_METRIC_COLS: Array<{
  key: keyof AnpCdpAggregatedRow;
  header: string;
  width: number;
  format: string;
}> = [
  { key: "petroleo_bbl_dia",            header: "Petroleum (bbl/day)",      width: 18, format: "#,##0.00" },
  { key: "oleo_bbl_dia",                header: "Oil (bbl/day)",          width: 18, format: "#,##0.00" },
  { key: "condensado_bbl_dia",          header: "Condensate (bbl/day)",    width: 20, format: "#,##0.00" },
  { key: "gas_total_mm3_dia",           header: "Total Gas (Mm³/day)",     width: 20, format: "#,##0.00" },
  { key: "gas_natural_assoc_mm3_dia",   header: "Assoc. Gas (Mm³/day)",    width: 22, format: "#,##0.00" },
  { key: "gas_natural_n_assoc_mm3_dia", header: "Non-Assoc. Gas (Mm³/day)",  width: 22, format: "#,##0.00" },
  { key: "gas_royalties",               header: "Gas Royalties",           width: 18, format: "#,##0.00" },
  { key: "agua_bbl_dia",                header: "Water (bbl/day)",          width: 16, format: "#,##0.00" },
  { key: "tempo_prod_hs_mes",           header: "Production Time (hrs/month)", width: 22, format: "#,##0.00" },
];

export async function downloadAnpCdpAggregatedExcel(
  rows: AnpCdpAggregatedRow[],
  groupBy: AnpCdpGroupBy[],
): Promise<void> {
  // Build columns: only dimensions in `groupBy` (in the order given) + all
  // metrics. `key:` lookup, no value extractor.
  const dimCols = groupBy.map((g) => {
    const meta = ANP_CDP_DIM_COLS[g];
    return {
      key:    g as keyof AnpCdpAggregatedRow,
      header: meta.header,
      width:  meta.width,
      align:  meta.align,
    } as const;
  });

  const filenameBase = `ANP-CDP_${groupBy.join("-")}`;

  await downloadGenericExcel<AnpCdpAggregatedRow>({
    rows,
    sheetName: "ANP CDP",
    title: `ANP CDP — Aggregated (${groupBy.join(", ")})`,
    filename: filenameBase,
    columns: [
      ...dimCols,
      ...ANP_CDP_METRIC_COLS.map((c) => ({
        key:    c.key,
        header: c.header,
        width:  c.width,
        format: c.format,
      })),
    ],
  });
}

// ── MDIC Comex aggregated dimension dictionary ──────────────────────────────

type MdicComexDimColumn = {
  header: string;
  width: number;
  align?: "left" | "center" | "right";
};

const MDIC_COMEX_DIM_COLS: Record<MdicComexGroupBy, MdicComexDimColumn> = {
  ano:        { header: "Year",         width: 8 },
  mes:        { header: "Month",        width: 6 },
  flow:       { header: "Flow",         width: 12 },
  ncm_codigo: { header: "NCM",          width: 14 },
  ncm_nome:   { header: "NCM Description", width: 36, align: "left" },
  pais:       { header: "Country",      width: 22, align: "left" },
};

const MDIC_COMEX_METRIC_COLS: Array<{
  key: keyof MdicComexAggregatedRow;
  header: string;
  width: number;
  format: string;
}> = [
  { key: "volume_kg",     header: "Volume (kg)",     width: 18, format: "#,##0" },
  { key: "valor_fob_usd", header: "FOB Value (US$)", width: 20, format: "#,##0.00" },
];

export async function downloadMdicComexAggregatedExcel(
  rows: MdicComexAggregatedRow[],
  groupBy: MdicComexGroupBy[],
): Promise<void> {
  const dimCols = groupBy.map((g) => {
    const meta = MDIC_COMEX_DIM_COLS[g];
    return {
      key:    g as keyof MdicComexAggregatedRow,
      header: meta.header,
      width:  meta.width,
      align:  meta.align,
    } as const;
  });

  const filenameBase = `MDIC-Comex_${groupBy.join("-")}`;

  await downloadGenericExcel<MdicComexAggregatedRow>({
    rows,
    sheetName: "MDIC Comex",
    title: `MDIC Comex — Aggregated (${groupBy.join(", ")})`,
    filename: filenameBase,
    columns: [
      ...dimCols,
      ...MDIC_COMEX_METRIC_COLS.map((c) => ({
        key:    c.key,
        header: c.header,
        width:  c.width,
        format: c.format,
      })),
    ],
  });
}

// ── MDIC Comex raw export (1 row per ano × mes × flow × ncm × pais) ──────────
//
// Default export path for /mdic-comex granularity = "raw". Mirrors columns of
// `mdic_comex` 1:1.

export async function downloadMdicComexRawExcel(rows: MdicComexRawRow[]): Promise<void> {
  await downloadGenericExcel<MdicComexRawRow>({
    rows,
    sheetName: "MDIC Comex — Raw",
    title: "MDIC Comex — Imports and Exports (raw)",
    filename: "MDIC Comex raw",
    columns: [
      { key: "ano",           header: "Year",             width: 8 },
      { key: "mes",           header: "Month",             width: 6 },
      { key: "flow",          header: "Flow",            width: 12 },
      { key: "ncm_codigo",    header: "NCM",             width: 14 },
      { key: "ncm_nome",      header: "NCM Description", width: 36, align: "left" },
      { key: "pais",          header: "Country",         width: 22, align: "left" },
      { key: "volume_kg",     header: "Volume (kg)",     width: 18, format: "#,##0" },
      { key: "valor_fob_usd", header: "FOB Value (US$)", width: 20, format: "#,##0.00" },
    ],
  });
}
