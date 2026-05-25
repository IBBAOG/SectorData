// Heuristic size estimates for export downloads.
//
// Used by `useExportSize` + `ExportModal` to show the user a real-time
// preview of how large the resulting file will be before clicking Excel/CSV.
// The numbers are *empirical* averages — they will be refined as each
// dash-* measures real download sizes in production.
//
// Add a new dataset key when onboarding a new dashboard whose row footprint
// differs noticeably from the default. If unsure, leave `default` and
// recalibrate after the first batch of real exports.

export type ExportSizeEstimate = {
  rows: number;
  bytesXlsx: number;
  bytesCsv: number;
};

/**
 * Average bytes per row, per output format, keyed by dataset.
 *
 * The `default` entry is intentionally conservative — better to overshoot
 * the estimate than to under-promise on a download that ends up failing
 * in the browser.
 */
export const AVG_BYTES_PER_ROW: Record<string, { xlsx: number; csv: number }> = {
  // Fuel sales (vendas) — used by /market-share, /sales-volumes
  vendas: { xlsx: 220, csv: 110 },
  // ANP CDP producao — narrower (numeric heavy)
  anp_cdp_producao: { xlsx: 200, csv: 100 },
  // ANP CDP Diária — daily by campo×bacia (5 cols: data, campo, bacia, petroleo, gas)
  anp_cdp_diaria: { xlsx: 180, csv: 90 },
  // ANP CDP Diária por instalação — adds installation column (5 cols: data, campo, instalacao, petroleo, gas)
  anp_cdp_diaria_instalacao: { xlsx: 200, csv: 100 },
  // ANP CDP Diária por poço — deepest level (6 cols: data, campo, bacia, poco, petroleo, gas)
  anp_cdp_diaria_poco: { xlsx: 220, csv: 110 },
  // ANP Prices (consolidated supply-chain survey) — 5 cols:
  // data + fonte + local + preco + unidade. Producer/Distribution/Retail merged.
  anp_prices: { xlsx: 200, csv: 100 },
  // Vessel positions — compact (mmsi, lat, lon, timestamp)
  vessel_positions: { xlsx: 180, csv: 90 },
  // Fallback — used whenever no specific entry exists
  default: { xlsx: 200, csv: 100 },
};

export function estimateSize(rows: number, datasetKey: string): ExportSizeEstimate {
  const safeRows = Math.max(0, Math.floor(rows));
  const avg = AVG_BYTES_PER_ROW[datasetKey] ?? AVG_BYTES_PER_ROW.default;
  return {
    rows: safeRows,
    bytesXlsx: safeRows * avg.xlsx,
    bytesCsv: safeRows * avg.csv,
  };
}

/**
 * Format raw byte counts into human-readable strings.
 * Examples: `0 B`, `850 KB`, `1.2 MB`, `12.4 MB`, `2.1 GB`.
 */
export function formatBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return "0 B";
  if (b < 1024) return `${Math.round(b)} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}
