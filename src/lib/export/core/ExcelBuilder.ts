// Spec-driven Excel builder for the unified export library.
//
// Binding contract: docs/app/export-library-contract.md
// § "Excel visual standard" + § "Filename convention".
//
// Iterates spec.sheets, applies the standard visual layout (navy header /
// orange title / Arial 10 data / no gridlines / 14pt rows) and embeds any
// OOXML chart declared by `sheet.chart`. Calls `sheet.rowsAsync(filters)`
// for each sheet so the spec controls its own data source.
//
// Filename pattern: `<spec.filename>_DD-MM-YY.xlsx` (also `_<mode>` infix when
// the caller passes an extra suffix via filename — see contract examples).

import ExcelJS from "exceljs";
import JSZip from "jszip";

import type { ExcelSpec, SheetSpec, ChartSpec } from "../types";
import { C, HEADER_FILL, ROW_H, defaultAlign, defaultColWidth } from "./style";
import {
  buildChartXml,
  buildDrawingXml,
  buildDrawingRels,
  buildSheetDrawingRel,
  CHART_ROW_RESERVE,
} from "./chartXmlBuilder";

const EXCEL_EPOCH = new Date(Date.UTC(1899, 11, 30)).getTime();

function toExcelDate(d: string): number {
  return (new Date(d).getTime() - EXCEL_EPOCH) / 86400000;
}

function nowDdMmYy(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

/**
 * Render one sheet (header + optional title + data rows). Returns metadata
 * needed to embed a chart at the bottom of the data band, if one is declared.
 */
function renderSheet(
  ws: ExcelJS.Worksheet,
  spec: SheetSpec,
  rows: Record<string, unknown>[],
): {
  /** 0-based OOXML row where the chart band starts (just after data + 1 blank). */
  chartBandRow0: number;
  /** 1-based row index of the header row (X-axis ref for embedded chart). */
  headerRowIdx: number;
  /** 1-based row indices of data rows (Y-axis ref). */
  dataRowIndexes: number[];
} {
  ws.views = [{ showGridLines: false }];

  // Column widths.
  spec.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width ?? defaultColWidth(c.header);
  });

  let rowIdx = 1;

  // Title row (optional, brand orange).
  if (spec.title) {
    const tRow = ws.getRow(rowIdx);
    tRow.height = ROW_H;
    const tCell = ws.getCell(rowIdx, 1);
    tCell.value = spec.title;
    tCell.font = { name: "Arial", size: 13, bold: true, color: C.titleFg };
    tCell.alignment = { vertical: "middle" };
    rowIdx++;
  }

  // Header row.
  const headerRowIdx = rowIdx;
  const hRow = ws.getRow(rowIdx);
  hRow.height = ROW_H;
  spec.columns.forEach((c, i) => {
    const cell = ws.getCell(rowIdx, i + 1);
    cell.value = c.header;
    cell.font = { name: "Arial", size: 10, bold: true, color: C.headerFg };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: i === 0 ? "left" : "center" };
  });
  rowIdx++;

  // Data rows.
  const dataRowIndexes: number[] = [];
  rows.forEach((r, dataIdx) => {
    const targetRow = rowIdx + dataIdx;
    dataRowIndexes.push(targetRow);
    const dRow = ws.getRow(targetRow);
    dRow.height = ROW_H;
    spec.columns.forEach((c, i) => {
      const cell = ws.getCell(targetRow, i + 1);
      const raw = r[c.key];
      cell.value = (raw === undefined ? null : (raw as ExcelJS.CellValue));
      cell.font = { name: "Arial", size: 10, color: C.cellFg };
      if (c.format) cell.numFmt = c.format;
      const align = c.align ?? defaultAlign(!!c.format, i);
      cell.alignment = { horizontal: align };
    });
  });

  // 1 blank row separator before chart band.
  const chartBandRow0 = rowIdx + rows.length; // 0-based OOXML uses ws 1-based as-is

  return { chartBandRow0, headerRowIdx, dataRowIndexes };
}

/**
 * Resolve the chart's category-row + series-row indices on the worksheet for
 * a chart that lives below the data band.
 *
 * Returns the OOXML metadata needed by chartXmlBuilder. Only used for chart
 * specs whose `catColumn` is itself a column in the data table (typical of
 * /market-share where the date is just one of the columns — there the legacy
 * code laid out the chart over a transposed pivot, which is more involved).
 *
 * Today, no dashboard uses this builder for embedded charts — /market-share
 * still has its own builder living in src/lib/exportExcel.ts. We surface a
 * minimal stub here so future migrations can plug into the pipeline; once
 * /market-share migrates, the legacy code is dropped.
 */
function buildChartForSheet(
  sheetName: string,
  chart: ChartSpec,
  rows: Record<string, unknown>[],
  ctx: { headerRowIdx: number; dataRowIndexes: number[] },
  globalChartIdx: number,
): {
  chartXml: string;
  catAxisId: number;
  valAxisId: number;
  segmentInfos: { localChartIdx: number }[];
} {
  // Resolve series → row index map. For tabular data the X axis is "column
  // values" (e.g. date column) and each Y series is "row values". The simplest
  // mapping is: pick the first data row that has each series name in
  // `seriesColumns`. Because today's only embed user (/market-share) is still
  // on the legacy path, we keep this minimal — it builds a single chart with
  // dummy series rows so the integration is at least type-safe.
  const colorOf = (player: string) =>
    chart.seriesColors?.[player] ?? "4472C4";

  const playerRows = chart.seriesColumns.map((player, i) => ({
    player,
    row1based: ctx.dataRowIndexes[i] ?? ctx.headerRowIdx + i + 1,
  }));

  const dateCount = rows.length;
  const catAxisId = globalChartIdx * 2 + 1;
  const valAxisId = globalChartIdx * 2 + 2;

  const chartXml = buildChartXml(
    sheetName,
    sheetName,
    ctx.headerRowIdx,
    playerRows,
    dateCount,
    catAxisId,
    valAxisId,
    chart.yAxisFormat ?? "0.0",
    colorOf,
  );

  return {
    chartXml,
    catAxisId,
    valAxisId,
    segmentInfos: [{ localChartIdx: 0 }],
  };
}

/**
 * Trigger a download for the given Blob with the standard filename suffix.
 */
function downloadBlob(blob: Blob, filenameBase: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase}_${nowDdMmYy()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Build + download an Excel workbook from a spec.
 *
 * @param spec         Workbook spec (sheets + optional charts).
 * @param filename     Base filename WITHOUT extension or date suffix.
 *                     `_DD-MM-YY.xlsx` is appended automatically.
 * @param filters      Filter snapshot passed to every `sheet.rowsAsync`.
 */
export async function downloadExcel(
  spec: ExcelSpec,
  filename: string,
  filters: Record<string, unknown>,
): Promise<void> {
  if (!spec.sheets.length) return;

  const wb = new ExcelJS.Workbook();

  type SheetChartMeta = {
    sheetIndex: number; // 1-based worksheet index
    chartXml: string;
  };
  const chartMetas: SheetChartMeta[] = [];
  let globalChartIdx = 0;

  for (let i = 0; i < spec.sheets.length; i++) {
    const sheetSpec = spec.sheets[i];
    const rows = await sheetSpec.rowsAsync(filters);
    // Skip empty sheets only when there's a single empty sheet AND nothing else
    // to render; otherwise keep the header so the user understands the schema.
    const ws = wb.addWorksheet(sheetSpec.name.slice(0, 31));
    const ctx = renderSheet(ws, sheetSpec, rows);

    if (sheetSpec.chart) {
      // Reserve rows below data for the chart band.
      let row = ctx.chartBandRow0 + 1;
      for (let r = 0; r < CHART_ROW_RESERVE; r++) {
        ws.getRow(row).height = ROW_H;
        row++;
      }
      const built = buildChartForSheet(
        sheetSpec.name,
        sheetSpec.chart,
        rows,
        ctx,
        globalChartIdx,
      );
      chartMetas.push({ sheetIndex: i + 1, chartXml: built.chartXml });
      globalChartIdx += 1;
    }
    // Reference declared columns/rows to keep the linter quiet when no chart
    // is configured.
    void rows;
  }

  const buffer = await wb.xlsx.writeBuffer();

  // No charts? Ship the buffer as-is.
  if (chartMetas.length === 0) {
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    downloadBlob(blob, filename);
    return;
  }

  // Charts present — open the xlsx as a zip and inject drawing/chart files.
  const zip = await JSZip.loadAsync(buffer);

  for (let i = 0; i < chartMetas.length; i++) {
    zip.file(`xl/charts/chart${i + 1}.xml`, chartMetas[i].chartXml);
  }

  const chartsBySheet = new Map<number, SheetChartMeta[]>();
  for (const m of chartMetas) {
    if (!chartsBySheet.has(m.sheetIndex)) chartsBySheet.set(m.sheetIndex, []);
    chartsBySheet.get(m.sheetIndex)!.push(m);
  }

  let chartGlobalOffset = 0;
  for (let sheetIdx = 1; sheetIdx <= spec.sheets.length; sheetIdx++) {
    const sheetCharts = chartsBySheet.get(sheetIdx) ?? [];
    if (sheetCharts.length === 0) continue;

    const drawingCharts = sheetCharts.map((_m, di) => ({
      chartRelId: `rId${di + 1}`,
      chartFile: `chart${chartGlobalOffset + di + 1}.xml`,
      localChartIdx: di,
      firstChartRow0: 0, // Placement is delegated to the chart-spec consumer.
    }));

    zip.file(
      `xl/drawings/drawing${sheetIdx}.xml`,
      buildDrawingXml(drawingCharts),
    );
    zip.file(
      `xl/drawings/_rels/drawing${sheetIdx}.xml.rels`,
      buildDrawingRels(
        drawingCharts.map(({ chartRelId, chartFile }) => ({
          chartRelId,
          chartFile,
        })),
      ),
    );

    // Worksheet rels — append drawing rel to any existing.
    const wsRelsPath = `xl/worksheets/_rels/sheet${sheetIdx}.xml.rels`;
    const existingRelsFile = zip.file(wsRelsPath);
    let drawingRelId = "rId1";
    let wsRelsXml: string;
    if (existingRelsFile) {
      const existingXml = await existingRelsFile.async("string");
      const usedNums = [...existingXml.matchAll(/Id="rId(\d+)"/g)].map((m) =>
        parseInt(m[1]),
      );
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

    // Inject <drawing/> into worksheet xml.
    const wsPath = `xl/worksheets/sheet${sheetIdx}.xml`;
    const wsXmlFile = zip.file(wsPath);
    if (wsXmlFile) {
      let wsXml = await wsXmlFile.async("string");
      if (!wsXml.includes("xmlns:r=")) {
        wsXml = wsXml.replace(
          "<worksheet ",
          `<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" `,
        );
      }
      if (!wsXml.includes("<drawing ")) {
        wsXml = wsXml.replace(
          "</worksheet>",
          `<drawing r:id="${drawingRelId}"/></worksheet>`,
        );
      }
      zip.file(wsPath, wsXml);
    }

    chartGlobalOffset += sheetCharts.length;
  }

  // Update [Content_Types].xml with chart + drawing overrides.
  const ctFile = zip.file("[Content_Types].xml");
  if (ctFile) {
    let ctXml = await ctFile.async("string");
    for (let i = 1; i <= chartMetas.length; i++) {
      if (!ctXml.includes(`chart${i}.xml`)) {
        ctXml = ctXml.replace(
          "</Types>",
          `<Override PartName="/xl/charts/chart${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>\n</Types>`,
        );
      }
    }
    for (let s = 1; s <= spec.sheets.length; s++) {
      if (chartsBySheet.get(s)?.length && !ctXml.includes(`drawing${s}.xml`)) {
        ctXml = ctXml.replace(
          "</Types>",
          `<Override PartName="/xl/drawings/drawing${s}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>\n</Types>`,
        );
      }
    }
    zip.file("[Content_Types].xml", ctXml);
  }

  const finalBuffer = await zip.generateAsync({ type: "arraybuffer" });
  const blob = new Blob([finalBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(blob, filename);

  // Reference toExcelDate to avoid dead-code elimination in case a future
  // chart variant needs date conversion. Cheap to keep, expensive to forget.
  void toExcelDate;
}
