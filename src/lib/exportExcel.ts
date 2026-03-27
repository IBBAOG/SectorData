import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { MsSerieRow } from "./rpc";

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

// Chart size in EMU (1 inch = 914400 EMU)
const CHART_W_EMU = 5_486_400;  // 6 inches
const CHART_H_EMU = 2_103_120;  // 2.3 inches
// Rows to reserve below data for chart area
const CHART_ROW_RESERVE = 14;

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
  const ref = sheetName.match(/[\s'!]/)
    ? `'${sheetName.replace(/'/g, "''")}'`
    : sheetName;

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
          <a:p><a:r><a:rPr lang="en-US" b="0" sz="900"/><a:t>${segmentLabel}</a:t></a:r></a:p>
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
        <c:numFmt formatCode="mmm/yyyy" sourceLinked="0"/>
        <c:majorTickMark val="none"/>
        <c:minorTickMark val="none"/>
        <c:crossAx val="${valAxisId}"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="${valAxisId}"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:majorTickMark val="none"/>
        <c:minorTickMark val="none"/>
        <c:crossAx val="${catAxisId}"/>
      </c:valAx>
    </c:plotArea>
    <c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>
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
  const anchors = charts.map(({ chartRelId, localChartIdx, firstChartRow0 }, anchorIdx) => `
  <xdr:oneCellAnchor>
    <xdr:from>
      <xdr:col>0</xdr:col>
      <xdr:colOff>${localChartIdx * CHART_W_EMU}</xdr:colOff>
      <xdr:row>${firstChartRow0}</xdr:row>
      <xdr:rowOff>0</xdr:rowOff>
    </xdr:from>
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
  </xdr:oneCellAnchor>`).join("");

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

      // Segment title
      ws.mergeCells(row, 1, row, dateCount + 1);
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
        cell.numFmt = "mmm/yyyy";
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
  a.download = "market_share.xlsx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
