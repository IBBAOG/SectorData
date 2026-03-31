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
    v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        padding: 16,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h6 style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Visao Geral do Mercado</h6>
        <span
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 12,
            background: isMarketOpen ? "#dcfce7" : "#f3f4f6",
            color: isMarketOpen ? "#16a34a" : "#888",
            fontWeight: 600,
          }}
        >
          {isMarketOpen ? "Mercado Aberto" : "Mercado Fechado"}
        </span>
      </div>

      {isLoading && !data.length ? (
        <div className="text-center py-3">
          <span className="spinner-border spinner-border-sm" />
        </div>
      ) : (
        <table className="table table-sm mb-0" style={{ fontSize: 13 }}>
          <thead>
            <tr style={{ color: "#888", fontWeight: 600 }}>
              <th style={{ border: "none", paddingBottom: 4 }}>ATIVO</th>
              <th style={{ border: "none", paddingBottom: 4, textAlign: "right" }}>ULT</th>
              <th style={{ border: "none", paddingBottom: 4, textAlign: "right" }}>VAR%</th>
              <th style={{ border: "none", paddingBottom: 4, textAlign: "center" }}>TND</th>
            </tr>
          </thead>
          <tbody>
            {data.map((q) => {
              const positive = q.regularMarketChangePercent >= 0;
              const color = positive ? "#16a34a" : "#dc2626";
              return (
                <tr key={q.symbol} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ fontWeight: 600, border: "none", padding: "6px 4px" }}>
                    {LABELS[q.symbol] ?? q.symbol}
                  </td>
                  <td style={{ textAlign: "right", border: "none", padding: "6px 4px" }}>
                    {fmt(q.regularMarketPrice)}
                  </td>
                  <td style={{ textAlign: "right", border: "none", padding: "6px 4px", color, fontWeight: 600 }}>
                    {positive ? "+" : ""}
                    {fmt(q.regularMarketChangePercent)}%
                  </td>
                  <td style={{ textAlign: "center", border: "none", padding: "6px 4px", fontSize: 16 }}>
                    <span style={{ color }}>{positive ? "\u25B2" : "\u25BC"}</span>
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
