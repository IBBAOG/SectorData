import { NextRequest } from "next/server";

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = "Mozilla/5.0";

/** B3 tickers like PETR4, VALE3, BBAS3 — need .SA suffix */
const B3_RE = /^[A-Z]{4}\d{1,2}$/;

function toYahooSymbol(ticker: string): string {
  return B3_RE.test(ticker) ? `${ticker}.SA` : ticker;
}

function stripSA(symbol: string): string {
  return symbol.replace(/\.SA$/, "");
}

interface YahooMeta {
  symbol?: string;
  shortName?: string;
  longName?: string;
  currency?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  regularMarketTime?: number;
  [key: string]: unknown;
}

async function fetchQuote(ticker: string) {
  const yahooSymbol = toYahooSymbol(ticker);
  const url = `${YAHOO_BASE}/${encodeURIComponent(yahooSymbol)}?range=1d&interval=5m`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    next: { revalidate: 60 },
  });

  if (!res.ok) return null;

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return null;

  const meta: YahooMeta = result.meta ?? {};
  const indicators = result.indicators?.quote?.[0] ?? {};

  const price = meta.regularMarketPrice ?? 0;
  const prevClose = meta.chartPreviousClose ?? 0;
  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;

  // Extract day high/low from intraday data if not in meta
  const highs: number[] = (indicators.high ?? []).filter((v: number | null) => v != null);
  const lows: number[] = (indicators.low ?? []).filter((v: number | null) => v != null);
  const volumes: number[] = (indicators.volume ?? []).filter((v: number | null) => v != null);

  const dayHigh = meta.regularMarketDayHigh ?? (highs.length ? Math.max(...highs) : 0);
  const dayLow = meta.regularMarketDayLow ?? (lows.length ? Math.min(...lows) : 0);
  const dayVolume = meta.regularMarketVolume ?? volumes.reduce((a: number, b: number) => a + b, 0);

  // Try to find open from first valid data point
  const opens: number[] = (indicators.open ?? []).filter((v: number | null) => v != null);
  const dayOpen = opens.length ? opens[0] : prevClose;

  return {
    symbol: stripSA(meta.symbol ?? yahooSymbol),
    shortName: meta.shortName ?? stripSA(yahooSymbol),
    longName: meta.longName ?? meta.shortName ?? "",
    currency: meta.currency ?? "BRL",
    regularMarketPrice: price,
    regularMarketDayHigh: dayHigh,
    regularMarketDayLow: dayLow,
    regularMarketOpen: dayOpen,
    regularMarketPreviousClose: prevClose,
    regularMarketChange: Math.round(change * 100) / 100,
    regularMarketChangePercent: Math.round(changePct * 100) / 100,
    regularMarketTime: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString(),
    regularMarketVolume: dayVolume,
    marketCap: 0, // Not available from chart endpoint
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tickersParam = searchParams.get("tickers");

  if (!tickersParam) {
    return Response.json({ error: "Missing tickers parameter" }, { status: 400 });
  }

  const tickers = tickersParam.split(",").slice(0, 20);
  const results = await Promise.all(tickers.map(fetchQuote));
  const quotes = results.filter(Boolean);

  return Response.json(quotes);
}
