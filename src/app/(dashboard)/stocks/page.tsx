"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

import NavBar from "../../../components/NavBar";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useStockQuote } from "../../../hooks/useStockQuote";
import { useStockHistory } from "../../../hooks/useStockHistory";
import { useStockPortfolios } from "../../../hooks/useStockPortfolios";
import { useAutoRefresh } from "../../../hooks/useAutoRefresh";
import type { ChartMode } from "../../../types/stocks";

const StockChart = dynamic(() => import("../../../components/stocks/StockChart"), { ssr: false });
const MarketOverview = dynamic(() => import("../../../components/stocks/MarketOverview"), { ssr: false });

export default function StocksPage() {
  const { visible, loading: guardLoading } = useModuleVisibilityGuard("stocks");
  const { portfolios, activePortfolio, isLoading: portfolioLoading } = useStockPortfolios();
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("line");

  const tickers = activePortfolio?.tickers ?? [];
  const { data: quotes, refetch } = useStockQuote(tickers);
  const { isMarketOpen } = useAutoRefresh(useCallback(() => refetch(), [refetch]));

  // Chart ticker: selected or first in portfolio
  const chartTicker = selectedTicker ?? tickers[0] ?? null;
  const { data: historyData, isLoading: historyLoading } = useStockHistory(chartTicker ?? "", "6mo");

  if (guardLoading || !visible) return null;

  const fmt = (v: number, d = 2) =>
    v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

  const fmtVol = (v: number) => {
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(v);
  };

  return (
    <>
      <NavBar />
      <main className="container-fluid" style={{ padding: "24px 32px", maxWidth: 1440, margin: "0 auto" }}>
        {/* Top bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h4 style={{ margin: 0, fontWeight: 700 }}>
              {activePortfolio ? activePortfolio.name : "Dashboard de Acoes"}
            </h4>
            <span style={{ fontSize: 13, color: "#888" }}>
              {isMarketOpen ? "Mercado B3 aberto" : "Mercado B3 fechado"}
              {" \u2022 "}
              {new Intl.DateTimeFormat("pt-BR", {
                timeZone: "America/Sao_Paulo",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date())}{" "}
              SP
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link
              href="/stock-portfolios"
              className="btn btn-sm"
              style={{ background: "#ff5000", color: "#fff", fontWeight: 600, borderRadius: 8 }}
            >
              + Carteira
            </Link>
          </div>
        </div>

        {!activePortfolio && !portfolioLoading && (
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 40,
              textAlign: "center",
              color: "#888",
              marginBottom: 24,
            }}
          >
            <p style={{ fontSize: 16, marginBottom: 12 }}>Nenhuma carteira criada ainda.</p>
            <Link
              href="/stock-portfolios"
              style={{ color: "#ff5000", fontWeight: 600 }}
            >
              Criar minha primeira carteira
            </Link>
          </div>
        )}

        {/* Main grid */}
        <div className="row g-3">
          {/* Left: Portfolio table */}
          <div className="col-lg-7">
            {tickers.length > 0 && (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  padding: 16,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  marginBottom: 16,
                }}
              >
                <table className="table table-sm table-hover mb-0" style={{ fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "#888", fontWeight: 600 }}>
                      <th style={{ border: "none" }}>ATIVO</th>
                      <th style={{ border: "none", textAlign: "right" }}>ULT</th>
                      <th style={{ border: "none", textAlign: "right" }}>VAR%</th>
                      <th style={{ border: "none", textAlign: "center" }}>TND</th>
                      <th style={{ border: "none", textAlign: "right" }}>MIN</th>
                      <th style={{ border: "none", textAlign: "right" }}>MAX</th>
                      <th style={{ border: "none", textAlign: "right" }}>VOL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map((q) => {
                      const pos = q.regularMarketChangePercent >= 0;
                      const color = pos ? "#16a34a" : "#dc2626";
                      const isSelected = chartTicker === q.symbol;
                      return (
                        <tr
                          key={q.symbol}
                          style={{
                            cursor: "pointer",
                            background: isSelected ? "#fff7ed" : undefined,
                          }}
                          onClick={() => setSelectedTicker(q.symbol)}
                        >
                          <td style={{ border: "none", padding: "8px 4px" }}>
                            <Link
                              href={`/stocks/${q.symbol}`}
                              style={{ fontWeight: 700, color: "#1a1a1a", textDecoration: "none" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {q.symbol}
                            </Link>
                          </td>
                          <td style={{ textAlign: "right", border: "none", padding: "8px 4px" }}>
                            {fmt(q.regularMarketPrice)}
                          </td>
                          <td style={{ textAlign: "right", border: "none", padding: "8px 4px", color, fontWeight: 600 }}>
                            {pos ? "+" : ""}{fmt(q.regularMarketChangePercent)}%
                          </td>
                          <td style={{ textAlign: "center", border: "none", padding: "8px 4px" }}>
                            <span style={{ color }}>{pos ? "\u25B2" : "\u25BC"}</span>
                          </td>
                          <td style={{ textAlign: "right", border: "none", padding: "8px 4px" }}>
                            {fmt(q.regularMarketDayLow)}
                          </td>
                          <td style={{ textAlign: "right", border: "none", padding: "8px 4px" }}>
                            {fmt(q.regularMarketDayHigh)}
                          </td>
                          <td style={{ textAlign: "right", border: "none", padding: "8px 4px" }}>
                            {fmtVol(q.regularMarketVolume)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Chart */}
            {chartTicker && (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  padding: 16,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h6 style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
                    {chartTicker} — 6 meses
                  </h6>
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["candlestick", "line"] as ChartMode[]).map((m) => (
                      <button
                        key={m}
                        className="btn btn-sm"
                        style={{
                          background: chartMode === m ? "#ff5000" : "#f3f4f6",
                          color: chartMode === m ? "#fff" : "#666",
                          fontWeight: 600,
                          fontSize: 12,
                          borderRadius: 6,
                          border: "none",
                          padding: "4px 10px",
                        }}
                        onClick={() => setChartMode(m)}
                      >
                        {m === "candlestick" ? "Candle" : "Linha"}
                      </button>
                    ))}
                  </div>
                </div>
                {historyLoading ? (
                  <div className="text-center py-5">
                    <span className="spinner-border spinner-border-sm" />
                  </div>
                ) : (
                  <StockChart data={historyData} mode={chartMode} height={350} />
                )}
              </div>
            )}

            {/* Ticker shortcut buttons */}
            {tickers.length > 1 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                {tickers.map((t) => (
                  <button
                    key={t}
                    className="btn btn-sm"
                    style={{
                      background: chartTicker === t ? "#ff5000" : "#f3f4f6",
                      color: chartTicker === t ? "#fff" : "#333",
                      fontWeight: 600,
                      fontSize: 12,
                      borderRadius: 6,
                      border: "none",
                      padding: "4px 12px",
                    }}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        window.location.href = `/stocks/compare?tickers=${chartTicker},${t}`;
                      } else {
                        setSelectedTicker(t);
                      }
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Market Overview + secondary portfolio */}
          <div className="col-lg-5">
            <MarketOverview />

            {portfolios.length > 1 && (
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    background: "#fff",
                    borderRadius: 12,
                    padding: 16,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  }}
                >
                  <h6 style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
                    Outras Carteiras
                  </h6>
                  {portfolios
                    .filter((p) => p.id !== activePortfolio?.id)
                    .map((p) => (
                      <div
                        key={p.id}
                        style={{
                          padding: "8px 0",
                          borderBottom: "1px solid #f3f4f6",
                          fontSize: 13,
                        }}
                      >
                        <strong>{p.name}</strong>
                        <div style={{ color: "#888", marginTop: 2 }}>
                          {p.tickers.join(", ")}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
