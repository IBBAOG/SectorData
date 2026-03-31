"use client";

import { useCallback } from "react";
import { useStockQuote } from "../../hooks/useStockQuote";
import { useAutoRefresh } from "../../hooks/useAutoRefresh";

const MARKET_TICKERS = ["^BVSP", "USDBRL=X", "EURBRL=X", "BZ=F", "CL=F", "BTC-BRL"];
const LABELS: Record<string, string> = {
  "^BVSP": "IBOVESPA",
  "USDBRL=X": "USD/BRL",
  "EURBRL=X": "EUR/BRL",
  "BZ=F": "BRENT",
  "CL=F": "WTI",
  "BTC-BRL": "BTC/BRL",
};

export default function MarketOverview() {
  const { data, isLoading, refetch } = useStockQuote(MARKET_TICKERS);
  const { isMarketOpen } = useAutoRefresh(useCallback(() => refetch(), [refetch]));

  const fmt = (v: number, decimals = 2) =>
    v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  return (
    <div className="sd-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Market Overview
        </span>
        <span className={`sd-badge ${isMarketOpen ? "sd-badge-open" : "sd-badge-closed"}`}>
          {isMarketOpen ? "Open" : "Closed"}
        </span>
      </div>

      {isLoading && !data.length ? (
        <div style={{ textAlign: "center", padding: 16 }}>
          <span className="spinner-border spinner-border-sm" style={{ color: "#8b949e" }} />
        </div>
      ) : (
        <table className="sd-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>ASSET</th>
              <th style={{ textAlign: "right" }}>LAST</th>
              <th style={{ textAlign: "right" }}>CHG%</th>
              <th style={{ textAlign: "center", width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {data.map((q) => {
              const positive = q.regularMarketChangePercent >= 0;
              const cls = positive ? "sd-green" : "sd-red";
              return (
                <tr key={q.symbol}>
                  <td style={{ fontWeight: 600 }}>
                    {LABELS[q.symbol] ?? q.symbol}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmt(q.regularMarketPrice)}</td>
                  <td style={{ textAlign: "right" }} className={cls}>
                    {positive ? "+" : ""}{fmt(q.regularMarketChangePercent)}%
                  </td>
                  <td style={{ textAlign: "center" }} className={cls}>
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
