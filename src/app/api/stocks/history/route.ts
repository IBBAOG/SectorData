import { NextRequest } from "next/server";

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = "Mozilla/5.0";
const B3_RE = /^[A-Z]{4}\d{1,2}$/;

function toYahooSymbol(ticker: string): string {
  return B3_RE.test(ticker) ? `${ticker}.SA` : ticker;
}

/** Convert range string to period1 Unix timestamp */
function rangeToPeriod1(range: string): number {
  const now = Date.now();
  const ms: Record<string, number> = {
    "1d": 1 * 86400_000,
    "5d": 5 * 86400_000,
    "1mo": 30 * 86400_000,
    "3mo": 90 * 86400_000,
    "6mo": 180 * 86400_000,
    "1y": 365 * 86400_000,
    "2y": 730 * 86400_000,
    "5y": 1825 * 86400_000,
    "max": 20 * 365 * 86400_000,
  };
  const delta = ms[range] ?? ms["1y"];
  return Math.floor((now - delta) / 1000);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const ticker = searchParams.get("ticker");
  const range = searchParams.get("range") ?? "1y";

  if (!ticker) {
    return Response.json({ error: "Missing ticker parameter" }, { status: 400 });
  }

  const yahooSymbol = toYahooSymbol(ticker);
  const period1 = rangeToPeriod1(range);
  const period2 = Math.floor(Date.now() / 1000);

  const url = `${YAHOO_BASE}/${encodeURIComponent(yahooSymbol)}?period1=${period1}&period2=${period2}&interval=1d`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    return Response.json({ error: "Yahoo Finance request failed" }, { status: 502 });
  }

  const json = await res.json();
  const result = json?.chart?.result?.[0];

  if (!result) {
    return Response.json({ error: "No data returned" }, { status: 404 });
  }

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const opens: (number | null)[] = quote.open ?? [];
  const highs: (number | null)[] = quote.high ?? [];
  const lows: (number | null)[] = quote.low ?? [];
  const closes: (number | null)[] = quote.close ?? [];
  const volumes: (number | null)[] = quote.volume ?? [];

  const data = timestamps
    .map((ts: number, i: number) => ({
      date: ts,
      open: opens[i] ?? 0,
      high: highs[i] ?? 0,
      low: lows[i] ?? 0,
      close: closes[i] ?? 0,
      volume: volumes[i] ?? 0,
    }))
    .filter((d) => d.close > 0)
    .sort((a, b) => a.date - b.date);

  return Response.json(data);
}
