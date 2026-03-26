import * as XLSX from "xlsx";
import type { MsSerieRow } from "./rpc";
import { fmtData } from "./filterUtils";

const BIG3_MEMBERS = ["Vibra", "Ipiranga", "Raizen"];

const PRODUCTS: { dbName: string; sheetName: string; segments: (string | null)[] }[] = [
  { dbName: "Diesel B",         sheetName: "Diesel B",         segments: ["Retail", "B2B", "TRR", null] },
  { dbName: "Gasolina C",       sheetName: "Gasoline C",       segments: ["Retail", "B2B", null] },
  { dbName: "Etanol Hidratado", sheetName: "Hydrated Ethanol", segments: ["Retail", "B2B", null] },
];

/**
 * For a given product + segment, compute market share % per (date, player).
 * Returns a Map<date, Map<player, pct>>.
 */
function computeMarketShare(
  rows: MsSerieRow[],
  produto: string,
  segmento: string | null,
  players: string[],
  big3: boolean,
): Map<string, Map<string, number>> {
  let filtered = rows.filter((r) => r.nome_produto === produto);
  if (segmento) filtered = filtered.filter((r) => r.segmento === segmento);

  // Group by (date, classificacao) summing quantidade
  const groupMap = new Map<string, number>();
  for (const r of filtered) {
    let cls = r.classificacao;
    if (big3) cls = BIG3_MEMBERS.includes(cls) ? "Big-3" : cls;
    const key = `${r.date}|${cls}`;
    groupMap.set(key, (groupMap.get(key) ?? 0) + Number(r.quantidade ?? 0));
  }

  // Total per date
  const totalByDate = new Map<string, number>();
  for (const [key, qty] of groupMap) {
    const date = key.split("|")[0];
    totalByDate.set(date, (totalByDate.get(date) ?? 0) + qty);
  }

  // Build result: date -> player -> pct
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

  // All unique sorted dates across entire dataset
  const allDates = Array.from(new Set(serieRows.map((r) => r.date))).sort();
  const dateHeaders = allDates.map(fmtData);

  const wb = XLSX.utils.book_new();

  for (const product of PRODUCTS) {
    // aoa = array of arrays
    const aoa: (string | number | null)[][] = [];

    // Row 1: timeline header
    aoa.push(["", ...dateHeaders]);

    for (const seg of product.segments) {
      const segLabel = seg ?? "Total";

      // Subsection header row
      aoa.push([segLabel]);

      const msMap = computeMarketShare(serieRows, product.dbName, seg, players, big3);

      for (const player of players) {
        const row: (string | number | null)[] = [player];
        for (const date of allDates) {
          const pct = msMap.get(date)?.get(player);
          row.push(pct !== undefined ? Math.round(pct * 10) / 10 : null);
        }
        aoa.push(row);
      }

      // Empty separator row between subsections
      aoa.push([]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Column widths: first col wider, rest narrow
    ws["!cols"] = [{ wch: 14 }, ...allDates.map(() => ({ wch: 9 }))];

    XLSX.utils.book_append_sheet(wb, ws, product.sheetName);
  }

  XLSX.writeFile(wb, "market_share.xlsx");
}
