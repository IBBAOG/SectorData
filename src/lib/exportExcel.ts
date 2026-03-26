import XLSX from "xlsx-js-style";
import type { MsSerieRow } from "./rpc";
import { fmtData } from "./filterUtils";

const BIG3_MEMBERS = ["Vibra", "Ipiranga", "Raizen"];

const PRODUCTS: { dbName: string; sheetName: string; segments: (string | null)[] }[] = [
  { dbName: "Diesel B",         sheetName: "Diesel B",        segments: ["Retail", "B2B", "TRR", null] },
  { dbName: "Gasolina C",       sheetName: "Gasoline C",      segments: ["Retail", "B2B", null] },
  { dbName: "Etanol Hidratado", sheetName: "Hydrous Ethanol", segments: ["Retail", "B2B", null] },
];

const ARIAL10      = { name: "Arial", sz: 10 };
const ARIAL10_BOLD = { name: "Arial", sz: 10, bold: true };

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

export function downloadMarketShareExcel(
  serieRows: MsSerieRow[],
  players: string[],
  big3: boolean,
) {
  if (!serieRows || serieRows.length === 0) return;

  const allDates = Array.from(new Set(serieRows.map((r) => r.date))).sort();
  const dateHeaders = allDates.map(fmtData);
  const dateCount = allDates.length;

  const wb = XLSX.utils.book_new();

  for (const product of PRODUCTS) {
    const aoa: (string | number | null)[][] = [];
    // addr -> xlsx-js-style cell style object
    const styleMap: Record<string, object> = {};

    const enc = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });

    // ── Row 0: date header ──────────────────────────────────────────────
    aoa.push(["", ...dateHeaders]);
    styleMap[enc(0, 0)] = { font: ARIAL10 };
    for (let c = 1; c <= dateCount; c++) {
      styleMap[enc(0, c)] = {
        font: { ...ARIAL10_BOLD, color: { rgb: "FFFFFF" } },
        fill: { patternType: "solid", fgColor: { rgb: "000000" } },
      };
    }

    let rowIdx = 1;

    for (const seg of product.segments) {
      const segLabel = seg ?? "Total";

      // ── Section header row (light gray, bold) ────────────────────────
      aoa.push([segLabel]);
      for (let c = 0; c <= dateCount; c++) {
        styleMap[enc(rowIdx, c)] = {
          font: ARIAL10_BOLD,
          fill: { patternType: "solid", fgColor: { rgb: "D9D9D9" } },
        };
      }
      rowIdx++;

      // ── Player rows (Arial 10) ───────────────────────────────────────
      const msMap = computeMarketShare(serieRows, product.dbName, seg, players, big3);
      for (const player of players) {
        const row: (string | number | null)[] = [player];
        for (const date of allDates) {
          const pct = msMap.get(date)?.get(player);
          row.push(pct !== undefined ? Math.round(pct * 10) / 10 : null);
        }
        aoa.push(row);
        for (let c = 0; c <= dateCount; c++) {
          styleMap[enc(rowIdx, c)] = { font: ARIAL10 };
        }
        rowIdx++;
      }

      // ── Empty separator ──────────────────────────────────────────────
      aoa.push([]);
      rowIdx++;
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Apply styles
    for (const [addr, style] of Object.entries(styleMap)) {
      if (!ws[addr]) ws[addr] = { t: "s", v: "" };
      (ws[addr] as Record<string, unknown>).s = style;
    }

    ws["!cols"] = [{ wch: 14 }, ...allDates.map(() => ({ wch: 9 }))];
    XLSX.utils.book_append_sheet(wb, ws, product.sheetName);
  }

  XLSX.writeFile(wb, "market_share.xlsx");
}
