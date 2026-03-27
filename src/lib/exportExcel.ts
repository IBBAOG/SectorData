import XLSX from "xlsx-js-style";
import type { MsSerieRow } from "./rpc";

const BIG3_MEMBERS = ["Vibra", "Ipiranga", "Raizen"];

const PRODUCTS: { dbName: string; sheetName: string; segments: (string | null)[] }[] = [
  { dbName: "Diesel B",         sheetName: "Diesel B",        segments: ["Retail", "B2B", "TRR", null] },
  { dbName: "Gasolina C",       sheetName: "Gasoline C",      segments: ["Retail", "B2B", null] },
  { dbName: "Etanol Hidratado", sheetName: "Hydrous Ethanol", segments: ["Retail", "B2B", null] },
  { dbName: "Otto-Cycle",       sheetName: "Otto-Cycle",      segments: ["Retail", "B2B", null] },
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

  // Build Otto-Cycle rows (Gasoline C + Ethanol Hidratado * 0.7)
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

  // Convert "YYYY-MM-DD" strings to Excel date serial numbers (days since 1899-12-30)
  const EXCEL_EPOCH = new Date(Date.UTC(1899, 11, 30)).getTime();
  function toExcelDate(d: string): number {
    return (new Date(d).getTime() - EXCEL_EPOCH) / 86400000;
  }

  const wb = XLSX.utils.book_new();

  for (const product of PRODUCTS) {
    const aoa: (string | number | null)[][] = [];
    // addr -> xlsx-js-style cell style object
    const styleMap: Record<string, object> = {};

    const enc = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });

    // ── Row 0: date header ──────────────────────────────────────────────
    // Use placeholder values in aoa; we'll overwrite cells with proper date types below
    aoa.push(["", ...allDates]);
    const blackFill = { patternType: "solid", fgColor: { rgb: "000000" } };
    styleMap[enc(0, 0)] = {
      font: { ...ARIAL10_BOLD, color: { rgb: "FFFFFF" } },
      fill: blackFill,
    };
    for (let c = 1; c <= dateCount; c++) {
      styleMap[enc(0, c)] = {
        font: { ...ARIAL10_BOLD, color: { rgb: "FFFFFF" } },
        fill: blackFill,
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
      const msMap = computeMarketShare(rows, product.dbName, seg, players, big3);
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

    // Overwrite date cells in row 0 (cols 1+) as real Excel dates
    for (let c = 1; c <= dateCount; c++) {
      const addr = enc(0, c);
      const serial = toExcelDate(allDates[c - 1]);
      ws[addr] = {
        t: "n",
        v: serial,
        z: "mmm/yyyy",
        s: styleMap[addr],
      };
    }

    ws["!cols"] = [{ wch: 14 }, ...allDates.map(() => ({ wch: 9 }))];
    XLSX.utils.book_append_sheet(wb, ws, product.sheetName);
  }

  XLSX.writeFile(wb, "market_share.xlsx");
}
