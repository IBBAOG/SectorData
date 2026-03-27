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

// Player hex colors (no #)
const PLAYER_COLORS: Record<string, string> = {
  "Vibra":   "f26522",
  "Raizen":  "1a1a1a",
  "Ipiranga":"73C6A1",
  "Others":  "A9A9A9",
  "Big-3":   "FF5000",
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

// Colors (ARGB for exceljs)
const C = {
  headerBg: { argb: "FF000512" },
  headerFg: { argb: "FFFFFFFF" },
  titleFg:  { argb: "FFFF5000" },
  cellFg:   { argb: "FF1A1A1A" },
};

// Chart dimensions in rows
const CHART_ROW_COUNT  = 14;
const CHART_ROW_HEIGHT = 15; // pt

// ── OOXML helpers ─────────────────────────────────────────────────────────────

/**
 * Build a c:lineChart XML for one segment.
 * sheetName: the Excel sheet name (for cell references)
 * dateHeaderRow: 1-based exceljs row of the date header
 * playerRows: array of { player, row1based }
 * dateCount: number of date columns
 * chartId: unique integer for axId values (must differ per chart on a sheet)
 */
function buildChartXml(
  sheetName: string,
  dateHeaderRow: number,
  playerRows: { player: string; row1based: number }[],
  dateCount: number,
  catAxisId: number,
  valAxisId: number,
): string {
  // Column letters: B = col 2, up to col (dateCount+1)
  function colLetter(colIdx: number): string {
    // colIdx is 1-based
    let result = "";
    let n = colIdx;
    while (n > 0) {
      const rem = (n - 1) % 26;
      result = String.fromCharCode(65 + rem) + result;
      n = Math.floor((n - 1) / 26);
    }
    return result;
  }
  const firstDataCol = colLetter(2);           // B
  const lastDataCol  = colLetter(dateCount + 1);
  const safeSheet = sheetName.replace(/'/g, "''");

  const seriesXml = playerRows.map(({ player, row1based }, idx) => {
    const color = getPlayerColor(player);
    return `
    <c:ser>
      <c:idx val="${idx}"/>
      <c:order val="${idx}"/>
      <c:tx>
        <c:strRef>
          <c:f>'${safeSheet}'!$A$${row1based}</c:f>
          <c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${player}</c:v></c:pt></c:strCache>
        </c:strRef>
      </c:tx>
      <c:spPr>
        <a:ln w="19050">
          <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
        </a:ln>
      </c:spPr>
      <c:marker><c:symbol val="none"/></c:marker>
      <c:cat>
        <c:numRef>
          <c:f>'${safeSheet}'!$${firstDataCol}$${dateHeaderRow}:$${lastDataCol}$${dateHeaderRow}</c:f>
        </c:numRef>
      </c:cat>
      <c:val>
        <c:numRef>
          <c:f>'${safeSheet}'!$${firstDataCol}$${row1based}:$${lastDataCol}$${row1based}</c:f>
        </c:numRef>
      </c:val>
      <c:smooth val="0"/>
    </c:ser>`.trim();
  }).join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:roundedCorners val="0"/>
  <c:chart>
    <c:autoTitleDeleted val="1"/>
    <c:plotArea>
      <c:layout/>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
        ${seriesXml}
        <c:marker><c:symbol val="none"/></c:marker>
        <c:smooth val="0"/>
        <c:axId val="${catAxisId}"/>
        <c:axId val="${valAxisId}"/>
      </c:lineChart>
      <c:dateAx>
        <c:axId val="${catAxisId}"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:numFmt formatCode="mmm/yyyy" sourceLinked="0"/>
        <c:tickLblPos val="nextTo"/>
        <c:spPr>
          <a:ln><a:noFill/></a:ln>
        </c:spPr>
        <c:txPr>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:pPr><a:defRPr sz="800" b="0"/></a:pPr></a:p>
        </c:txPr>
        <c:crossAx val="${valAxisId}"/>
        <c:auto val="1"/>
        <c:baseTimeUnit val="months"/>
      </c:dateAx>
      <c:valAx>
        <c:axId val="${valAxisId}"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:numFmt formatCode="0.0&quot;%&quot;" sourceLinked="0"/>
        <c:tickLblPos val="nextTo"/>
        <c:spPr>
          <a:ln><a:noFill/></a:ln>
        </c:spPr>
        <c:txPr>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:pPr><a:defRPr sz="800" b="0"/></a:pPr></a:p>
        </c:txPr>
        <c:crossAx val="${catAxisId}"/>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
  </c:chart>
  <c:spPr>
    <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
    <a:ln><a:noFill/></a:ln>
  </c:spPr>
</c:chartSpace>`;
}

/**
 * Build the drawing XML for one worksheet.
 * charts: array of { chartRelId, fromRow, toRow } — all 0-indexed
 * fromCol/toCol span the full data area (0 to dateCount+1)
 */
function buildDrawingXml(
  charts: { chartRelId: string; fromRow: number; toRow: number; dateCount: number }[],
): string {
  const anchors = charts.map(({ chartRelId, fromRow, toRow, dateCount }, anchorIdx) => `
  <xdr:twoCellAnchor editAs="twoCell">
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>${dateCount + 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="${anchorIdx + 2}" name="Chart ${anchorIdx + 1}"/>
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
  </xdr:twoCellAnchor>`).join("");

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

  // Build Otto-Cycle rows (Gasoline C + Ethanol × 0.7)
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

  // Track chart metadata for OOXML injection
  // Each entry: { sheetIndex (1-based), sheetName, chartXml, fromRow (0-indexed), toRow (0-indexed), dateHeaderRow (1-indexed), playerRows }
  type ChartMeta = {
    sheetIndex: number;
    sheetName: string;
    chartXml: string;
    fromRow: number;
    toRow: number;
  };
  const chartMetas: ChartMeta[] = [];
  let globalChartIdx = 0; // 0-based counter for chart IDs

  for (let sheetIdx = 0; sheetIdx < PRODUCTS.length; sheetIdx++) {
    const product = PRODUCTS[sheetIdx];
    const ws = wb.addWorksheet(product.sheetName);

    // Column widths
    ws.getColumn(1).width = 14;
    for (let c = 2; c <= dateCount + 1; c++) {
      ws.getColumn(c).width = 9;
    }

    let row = 1; // 1-based row index

    for (const seg of product.segments) {
      const segLabel = seg ?? "Total";

      // ── Segment title ──────────────────────────────────────────────────
      ws.mergeCells(row, 1, row, dateCount + 1);
      const titleCell = ws.getCell(row, 1);
      titleCell.value = segLabel;
      titleCell.font = { name: "Arial", size: 13, bold: true, color: C.titleFg };
      titleCell.alignment = { vertical: "middle" };
      ws.getRow(row).height = 18;
      row++;

      // ── Chart placeholder rows (will hold native chart) ─────────────────
      const chartFromRow = row - 1; // 0-indexed (for OOXML drawing anchor)
      for (let i = 0; i < CHART_ROW_COUNT; i++) {
        ws.getRow(row).height = CHART_ROW_HEIGHT;
        row++;
      }
      const chartToRow = row - 1; // 0-indexed

      // ── Date header ────────────────────────────────────────────────────
      const dateHeaderRow = row; // 1-based
      {
        const hRow = ws.getRow(row);
        hRow.height = 14;
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
      }

      // ── Player rows ────────────────────────────────────────────────────
      const msMap = computeMarketShare(rows, product.dbName, seg, players, big3);
      const playerRows: { player: string; row1based: number }[] = [];
      for (const player of players) {
        const pRow = ws.getRow(row);
        pRow.height = 13;
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
        playerRows.push({ player, row1based: row });
        row++;
      }

      // ── Build chart XML for this segment ───────────────────────────────
      const catAxisId = globalChartIdx * 2 + 1;
      const valAxisId = globalChartIdx * 2 + 2;
      const chartXml = buildChartXml(
        product.sheetName,
        dateHeaderRow,
        playerRows,
        dateCount,
        catAxisId,
        valAxisId,
      );
      chartMetas.push({
        sheetIndex: sheetIdx + 1,
        sheetName: product.sheetName,
        chartXml,
        fromRow: chartFromRow,
        toRow: chartToRow,
      });
      globalChartIdx++;

      // ── Empty separator ────────────────────────────────────────────────
      row++;
    }
  }

  // ── Generate initial xlsx buffer via exceljs ──────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();

  // ── Open xlsx zip with JSZip ──────────────────────────────────────────────
  const zip = await JSZip.loadAsync(buffer);

  // ── Inject chart XML files ────────────────────────────────────────────────
  for (let i = 0; i < chartMetas.length; i++) {
    zip.file(`xl/charts/chart${i + 1}.xml`, chartMetas[i].chartXml);
  }

  // ── Build per-sheet drawing files ─────────────────────────────────────────
  // Group charts by sheetIndex
  const chartsBySheet = new Map<number, typeof chartMetas>();
  for (const meta of chartMetas) {
    if (!chartsBySheet.has(meta.sheetIndex)) chartsBySheet.set(meta.sheetIndex, []);
    chartsBySheet.get(meta.sheetIndex)!.push(meta);
  }

  // Chart global index by sheetIndex order
  let chartGlobalOffset = 0;
  for (let sheetIdx = 1; sheetIdx <= PRODUCTS.length; sheetIdx++) {
    const sheetCharts = chartsBySheet.get(sheetIdx) ?? [];

    // Build drawing XML
    const drawingCharts = sheetCharts.map((meta, localIdx) => ({
      chartRelId: `rId${localIdx + 1}`,
      chartFile: `chart${chartGlobalOffset + localIdx + 1}.xml`,
      fromRow: meta.fromRow,
      toRow: meta.toRow,
      dateCount,
    }));
    const drawingXml = buildDrawingXml(drawingCharts);
    zip.file(`xl/drawings/drawing${sheetIdx}.xml`, drawingXml);

    // Build drawing rels
    const drawingRelsXml = buildDrawingRels(
      drawingCharts.map(({ chartRelId, chartFile }) => ({ chartRelId, chartFile }))
    );
    zip.file(`xl/drawings/_rels/drawing${sheetIdx}.xml.rels`, drawingRelsXml);

    // Build worksheet rels file
    const wsRelsXml = buildSheetDrawingRel(`drawing${sheetIdx}.xml`);
    zip.file(`xl/worksheets/_rels/sheet${sheetIdx}.xml.rels`, wsRelsXml);

    // Inject <drawing r:id="rId1"/> into the worksheet XML
    const wsPath = `xl/worksheets/sheet${sheetIdx}.xml`;
    const wsXmlFile = zip.file(wsPath);
    if (wsXmlFile) {
      let wsXml = await wsXmlFile.async("string");
      // Add xmlns:r if not present
      if (!wsXml.includes('xmlns:r=')) {
        wsXml = wsXml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
      }
      // Inject <drawing r:id="rId1"/> before </worksheet>
      if (!wsXml.includes('<drawing ')) {
        wsXml = wsXml.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>');
      }
      zip.file(wsPath, wsXml);
    }

    chartGlobalOffset += sheetCharts.length;
  }

  // ── Update [Content_Types].xml ────────────────────────────────────────────
  const ctFile = zip.file("[Content_Types].xml");
  if (ctFile) {
    let ctXml = await ctFile.async("string");

    // Add chart content types
    for (let i = 1; i <= chartMetas.length; i++) {
      const override = `<Override PartName="/xl/charts/chart${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
      if (!ctXml.includes(`chart${i}.xml`)) {
        ctXml = ctXml.replace("</Types>", `${override}\n</Types>`);
      }
    }

    // Add drawing content types
    for (let i = 1; i <= PRODUCTS.length; i++) {
      const override = `<Override PartName="/xl/drawings/drawing${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
      if (!ctXml.includes(`drawing${i}.xml`)) {
        ctXml = ctXml.replace("</Types>", `${override}\n</Types>`);
      }
    }

    zip.file("[Content_Types].xml", ctXml);
  }

  // ── Generate final xlsx buffer ────────────────────────────────────────────
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
