"use client";

import { useCallback } from "react";
import { useStockQuote } from "../../hooks/useStockQuote";
import { useAutoRefresh } from "../../hooks/useAutoRefresh";

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

  const fmt = (v: number, decimals = 2) =>
    v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  return (
    <div className="sd-card" style={{ padding: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, padding: "0 4px" }}>
        <span style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
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
        <table className="sd-table" style={{ fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "2px 4px" }}>ASSET</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>LAST</th>
              <th style={{ textAlign: "right", padding: "2px 4px" }}>CHG%</th>
              <th style={{ textAlign: "center", width: 18, padding: "2px 2px" }}></th>
            </tr>
          </thead>
          <tbody>
            {data.map((q) => {
              const positive = q.regularMarketChangePercent >= 0;
              const cls = positive ? "sd-green" : "sd-red";
              return (
                <tr key={q.symbol}>
                  <td style={{ fontWeight: 600, padding: "3px 4px", display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{
                      display: "inline-block", width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                      background: q.regularMarketTime && (Date.now() - new Date(q.regularMarketTime).getTime() < 30*60*1000) ? "#3fb950" : "#30363d",
                      boxShadow: q.regularMarketTime && (Date.now() - new Date(q.regularMarketTime).getTime() < 30*60*1000) ? "0 0 4px #3fb950" : "none",
                    }} />
                    {LABELS[q.symbol] ?? q.symbol}
                  </td>
                  <td style={{ textAlign: "right", padding: "3px 4px" }}>{fmt(q.regularMarketPrice)}</td>
                  <td style={{ textAlign: "right", padding: "3px 4px" }} className={cls}>
                    {positive ? "+" : ""}{fmt(q.regularMarketChangePercent)}%
                  </td>
                  <td style={{ textAlign: "center", padding: "3px 2px" }} className={cls}>
                    {positive ? "\u25B2" : "\u25BC"}
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
