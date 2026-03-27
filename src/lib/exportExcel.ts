import ExcelJS from "exceljs";
import type { MsSerieRow } from "./rpc";

const BIG3_MEMBERS = ["Vibra", "Ipiranga", "Raizen"];

const PRODUCTS: { dbName: string; sheetName: string; segments: (string | null)[] }[] = [
  { dbName: "Diesel B",         sheetName: "Diesel B",        segments: ["Retail", "B2B", "TRR", null] },
  { dbName: "Gasolina C",       sheetName: "Gasoline C",      segments: ["Retail", "B2B", null] },
  { dbName: "Etanol Hidratado", sheetName: "Hydrous Ethanol", segments: ["Retail", "B2B", null] },
  { dbName: "Otto-Cycle",       sheetName: "Otto-Cycle",      segments: ["Retail", "B2B", null] },
];

// Maps (product dbName, segLabel) to the chartImages key used in page.tsx
const CHART_KEY: Record<string, Record<string, string>> = {
  "Diesel B":         { Retail: "dieselRetail", B2B: "dieselB2B", TRR: "dieselTrR",   Total: "dieselTotal" },
  "Gasolina C":       { Retail: "gasRetail",    B2B: "gasB2B",                         Total: "gasTotal"    },
  "Etanol Hidratado": { Retail: "ethRetail",    B2B: "ethB2B",                         Total: "ethTotal"    },
  "Otto-Cycle":       { Retail: "ottoRetail",   B2B: "ottoB2B",                        Total: "ottoTotal"   },
};

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

// Chart image dimensions
const CHART_IMG_W = 780;   // px — must match Plotly export width in page.tsx
const CHART_IMG_H = 280;   // px — must match Plotly export height in page.tsx
// Each chart row height in points (1 pt ≈ 1.333 px at 96 DPI)
// 280px / 1.333 ≈ 210pt → spread across 14 rows of 15pt each
const CHART_ROW_COUNT  = 14;
const CHART_ROW_HEIGHT = 15; // pt

export async function downloadMarketShareExcel(
  serieRows: MsSerieRow[],
  players: string[],
  big3: boolean,
  chartImages: Record<string, string> = {},
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

  for (const product of PRODUCTS) {
    const ws = wb.addWorksheet(product.sheetName);

    // Column widths
    ws.getColumn(1).width = 14;
    for (let c = 2; c <= dateCount + 1; c++) {
      ws.getColumn(c).width = 9;
    }

    let row = 1; // 1-based row index

    for (const seg of product.segments) {
      const segLabel = seg ?? "Total";
      const chartKey = CHART_KEY[product.dbName]?.[segLabel];
      const imgBase64 = chartKey ? chartImages[chartKey] : undefined;

      // ── Segment title ──────────────────────────────────────────────────
      ws.mergeCells(row, 1, row, dateCount + 1);
      const titleCell = ws.getCell(row, 1);
      titleCell.value = segLabel;
      titleCell.font = { name: "Arial", size: 13, bold: true, color: C.titleFg };
      titleCell.alignment = { vertical: "middle" };
      ws.getRow(row).height = 18;
      row++;

      // ── Chart image (if available) ─────────────────────────────────────
      if (imgBase64) {
        const imgId = wb.addImage({ base64: imgBase64, extension: "png" });
        ws.addImage(imgId, {
          tl: { col: 0, row: row - 1 },   // 0-indexed
          br: { col: dateCount + 1, row: row - 1 + CHART_ROW_COUNT },
          editAs: "twoCell",
        } as Parameters<typeof ws.addImage>[1]);
      }
      // Reserve rows for chart image
      for (let i = 0; i < CHART_ROW_COUNT; i++) {
        ws.getRow(row).height = CHART_ROW_HEIGHT;
        row++;
      }

      // ── Date header ────────────────────────────────────────────────────
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
        row++;
      }

      // ── Empty separator ────────────────────────────────────────────────
      row++;
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
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
