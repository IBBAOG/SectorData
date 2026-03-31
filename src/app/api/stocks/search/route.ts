import { NextRequest } from "next/server";

const YAHOO_SEARCH = "https://query1.finance.yahoo.com/v1/finance/search";
const UA = "Mozilla/5.0";

const KNOWN_NON_SA = new Set([
  "^BVSP", "BZ=F", "CL=F", "GC=F", "SI=F",
  "USDBRL=X", "EURBRL=X", "BTC-BRL", "ETH-BRL",
]);

function stripSA(symbol: string): string {
  return symbol.replace(/\.SA$/, "");
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return Response.json({ error: "Query must be at least 2 characters" }, { status: 400 });
  }

  const url = `${YAHOO_SEARCH}?q=${encodeURIComponent(q)}&lang=en-US&region=BR&quotesCount=10&newsCount=0`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    return Response.json({ error: "Yahoo Finance search failed" }, { status: 502 });
  }

  const json = await res.json();
  const quotes: Array<{
    symbol?: string;
    shortname?: string;
    exchange?: string;
    quoteType?: string;
  }> = json?.quotes ?? [];

  const results = quotes
    .filter((item) => {
      const sym = item.symbol ?? "";
      return sym.endsWith(".SA") || KNOWN_NON_SA.has(sym);
    })
    .map((item) => ({
      symbol: stripSA(item.symbol ?? ""),
      shortName: item.shortname ?? stripSA(item.symbol ?? ""),
      exchange: item.exchange ?? "",
      type: item.quoteType ?? "",
    }));

  return Response.json(results);
}
