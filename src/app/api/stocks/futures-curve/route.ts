import { NextRequest } from "next/server";

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = "Mozilla/5.0";

/**
 * Brent futures contract ticker format on Yahoo: BZ{monthCode}{yy}.NYM
 * Month codes: F=Jan, G=Feb, H=Mar, J=Apr, K=May, M=Jun,
 *              N=Jul, Q=Aug, U=Sep, V=Oct, X=Nov, Z=Dec
 */
const MONTH_CODES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function generateContractTickers(count = 24): { ticker: string; label: string; monthIndex: number; year: number }[] {
  const now = new Date();
  let month = now.getMonth(); // 0-indexed
  let year = now.getFullYear();

  // Brent (ICE) front-month contract is typically M+2.
  // The nearby contract expires ~1 month before delivery, so by the 1st of
  // any month the M+1 contract is near expiry or already expired.
  // Start from M+2 to match CME/ICE convention (e.g. Apr 1 → Jun front).
  month += 2;
  if (month > 11) { month -= 12; year++; }

  const contracts: { ticker: string; label: string; monthIndex: number; year: number }[] = [];
  for (let i = 0; i < count; i++) {
    const yy = String(year).slice(-2);
    const code = MONTH_CODES[month];
    const ticker = `BZ${code}${yy}.NYM`;
    const label = `${MONTH_NAMES[month]} ${year}`;
    contracts.push({ ticker, label, monthIndex: month, year });

    month++;
    if (month > 11) { month = 0; year++; }
  }
  return contracts;
}

async function fetchPrice(ticker: string): Promise<number | null> {
  try {
    const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      next: { revalidate: 86400 }, // Cache for 24 hours
    });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    return meta?.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

export async function GET(_request: NextRequest) {
  const contracts = generateContractTickers(24);

  // Fetch all contract prices in parallel
  const prices = await Promise.all(contracts.map((c) => fetchPrice(c.ticker)));

  const curve = contracts
    .map((c, i) => ({
      contract: c.label,
      ticker: c.ticker,
      price: prices[i],
      month: c.monthIndex,
      year: c.year,
    }))
    .filter((c) => c.price !== null && c.price > 0);

  return Response.json({
    commodity: "Brent Crude Oil",
    currency: "USD",
    contracts: curve,
    updatedAt: new Date().toISOString(),
  });
}
