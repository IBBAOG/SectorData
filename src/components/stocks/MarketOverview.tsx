"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useStockQuote } from "../../hooks/useStockQuote";
import { useAutoRefresh } from "../../hooks/useAutoRefresh";
import { useStockPeriodReturns } from "../../hooks/useStockPeriodReturns";

const MARKET_TICKERS = ["^BVSP", "USDBRL=X", "EURBRL=X", "BZ=F", "CL=F", "BTC-BRL"];
const LABELS: Record<string, string> = {
  "^BVSP": "IBOV",
  "USDBRL=X": "USD/BRL",
  "EURBRL=X": "EUR/BRL",
  "BZ=F": "BRENT",
  "CL=F": "WTI",
  "BTC-BRL": "BTC",
};

export default function MarketOverview() {
  const { data, isLoading, refetch } = useStockQuote(MARKET_TICKERS);
  const { isMarketOpen } = useAutoRefresh(useCallback(() => refetch(), [refetch]));
  const { data: periodReturns } = useStockPeriodReturns(MARKET_TICKERS);

  // Blink tracking
  const prevPricesRef = useRef<Map<string, number>>(new Map());
  const [blinkMap, setBlinkMap] = useState<Map<string, "up" | "down">>(new Map());

  useEffect(() => {
    if (!data.length) return;
    const newBlinks = new Map<string, "up" | "down">();
    const prev = prevPricesRef.current;
    for (const q of data) {
      const old = prev.get(q.symbol);
      if (old !== undefined && old !== q.regularMarketPrice) {
        newBlinks.set(q.symbol, q.regularMarketPrice > old ? "up" : "down");
      }
      prev.set(q.symbol, q.regularMarketPrice);
    }
    if (newBlinks.size > 0) {
      setBlinkMap(newBlinks);
      const timer = setTimeout(() => setBlinkMap(new Map()), 1200);
      return () => clearTimeout(timer);
    }
  }, [data]);

  const fmt = (v: number, decimals = 2) =>
    v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const fmtPct = (v: number | null | undefined) => {
    if (v == null) return "—";
    return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
  };

  return (
    <div className="sd-card" style={{ padding: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, padding: "0 4px" }}>
        <span style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Market Overview
        </span>
        <span className={`sd-badge ${isMarketOpen ? "sd-badge-open" : "sd-badge-closed"}`} style={{ fontSize: 9, padding: "1px 6px" }}>
          {isMarketOpen ? "Open" : "Closed"}
        </span>
      </div>

      {isLoading && !data.length ? (
        <div style={{ textAlign: "center", padding: 12 }}>
          <span className="spinner-border spinner-border-sm" style={{ color: "#8b949e", width: 12, height: 12 }} />
        </div>
      ) : (
        <table className="sd-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "2px 4px" }}>ASSET</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>LAST</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>CHG%</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>YTD%</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>MTD%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((q) => {
              const positive = q.regularMarketChangePercent >= 0;
              const cls = positive ? "sd-green" : "sd-red";
              const blink = blinkMap.get(q.symbol);
              const pr = periodReturns.get(q.symbol);
              const p = q.regularMarketPrice;
              const ytdPct = pr?.ytdRefPrice ? (p - pr.ytdRefPrice) / pr.ytdRefPrice * 100 : null;
              const mtdPct = pr?.mtdRefPrice ? (p - pr.mtdRefPrice) / pr.mtdRefPrice * 100 : null;
              return (
                <tr key={q.symbol} className={blink ? `stock-blink-${blink}` : undefined}>
                  <td style={{ fontWeight: 600, padding: "3px 4px", display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{
                      display: "inline-block", width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                      background: q.regularMarketTime && (Date.now() - new Date(q.regularMarketTime).getTime() < 30*60*1000) ? "#3fb950" : "#30363d",
                      boxShadow: q.regularMarketTime && (Date.now() - new Date(q.regularMarketTime).getTime() < 30*60*1000) ? "0 0 4px #3fb950" : "none",
                    }} />
                    {LABELS[q.symbol] ?? q.symbol}
                  </td>
                  <td style={{ textAlign: "right", padding: "3px 4px" }} className={blink ? `price-flash-${blink}` : undefined}>
                    {fmt(q.regularMarketPrice)}
                  </td>
                  <td style={{ textAlign: "right", padding: "3px 4px" }} className={cls}>
                    {positive ? "\u25B2" : "\u25BC"} {positive ? "+" : ""}{fmt(q.regularMarketChangePercent)}%
                  </td>
                  <td style={{ textAlign: "right", padding: "3px 4px" }} className={ytdPct != null ? (ytdPct >= 0 ? "sd-green" : "sd-red") : undefined}>
                    {ytdPct != null ? `${ytdPct >= 0 ? "\u25B2" : "\u25BC"} ${fmtPct(ytdPct)}` : "\u2014"}
                  </td>
                  <td style={{ textAlign: "right", padding: "3px 4px" }} className={mtdPct != null ? (mtdPct >= 0 ? "sd-green" : "sd-red") : undefined}>
                    {mtdPct != null ? `${mtdPct >= 0 ? "\u25B2" : "\u25BC"} ${fmtPct(mtdPct)}` : "\u2014"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
