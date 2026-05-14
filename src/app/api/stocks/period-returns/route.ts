import { NextRequest } from "next/server";
import { stocksLimiter, enforceLimit, rateLimitResponse, getClientIp } from "@/lib/rateLimit";

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = "Mozilla/5.0";
const B3_RE = /^[A-Z]{4}\d{1,2}$/;

function toYahooSymbol(ticker: string): string {
  return B3_RE.test(ticker) ? `${ticker}.SA` : ticker;
}

function stripSA(symbol: string): string {
  return symbol.replace(/\.SA$/, "");
}

async function fetchPeriodReturns(ticker: string) {
  const yahooSymbol = toYahooSymbol(ticker);

  // ~13 months back ensures Jan 1 of the current year is always included
  const now = Date.now();
  const period1 = Math.floor((now - 400 * 86400_000) / 1000);
  const period2 = Math.floor(now / 1000);

  const url = `${YAHOO_BASE}/${encodeURIComponent(yahooSymbol)}?period1=${period1}&period2=${period2}&interval=1d`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    next: { revalidate: 3600 },
  });

  if (!res.ok) return null;

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return null;

  const meta = result.meta ?? {};
  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

  const points = timestamps
    .map((ts, i) => ({ ts, close: closes[i] ?? 0 }))
    .filter((p) => p.close > 0)
    .sort((a, b) => a.ts - b.ts);

  if (points.length === 0) return null;

  const today = new Date();
  const ytdStart = Date.UTC(today.getFullYear(), 0, 1) / 1000;
  const mtdStart = Date.UTC(today.getFullYear(), today.getMonth(), 1) / 1000;

  const ytdPoint = points.find((p) => p.ts >= ytdStart);
  const mtdPoint = points.find((p) => p.ts >= mtdStart);

  return {
    symbol: stripSA(meta.symbol ?? yahooSymbol),
    ytdRefPrice: ytdPoint?.close ?? null,
    mtdRefPrice: mtdPoint?.close ?? null,
  };
}

export async function GET(request: NextRequest) {
  if (stocksLimiter) {
    const ip = getClientIp(request);
    const result = await enforceLimit(stocksLimiter, ip);
    if (!result.success) {
      return rateLimitResponse(result.limit, result.remaining, result.reset);
    }
  }

  const { searchParams } = request.nextUrl;
  const tickersParam = searchParams.get("tickers");

  if (!tickersParam) {
    return Response.json({ error: "Missing tickers parameter" }, { status: 400 });
  }

  const tickers = tickersParam.split(",").slice(0, 20);
  const results = await Promise.all(tickers.map(fetchPeriodReturns));

  return Response.json(results.filter(Boolean));
}
