"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";

import NavBar from "../../../../components/NavBar";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { useStockQuote } from "../../../../hooks/useStockQuote";
import { useStockHistory } from "../../../../hooks/useStockHistory";
import type { ChartMode, TimeRange } from "../../../../types/stocks";

const StockChart = dynamic(() => import("../../../../components/stocks/StockChart"), { ssr: false });

const RANGES: { label: string; value: TimeRange }[] = [
  { label: "1D", value: "1d" },
  { label: "5D", value: "5d" },
  { label: "1M", value: "1mo" },
  { label: "3M", value: "3mo" },
  { label: "6M", value: "6mo" },
  { label: "1Y", value: "1y" },
  { label: "2Y", value: "2y" },
  { label: "5Y", value: "5y" },
  { label: "MAX", value: "max" },
];

export default function TickerDetailPage() {
  const params = useParams();
  const ticker = (params?.ticker as string) ?? "";

  const { visible, loading: guardLoading } = useModuleVisibilityGuard("stocks");
  const [range, setRange] = useState<TimeRange>("1y");
  const [mode, setMode] = useState<ChartMode>("candlestick");

  const { data: quotes } = useStockQuote(ticker ? [ticker] : []);
  const { data: historyData, isLoading: historyLoading } = useStockHistory(ticker, range);

  if (guardLoading || !visible) return null;

  const quote = quotes[0] ?? null;
  const positive = (quote?.regularMarketChangePercent ?? 0) >= 0;
  const changeColor = positive ? "#3fb950" : "#f85149";

  const fmt = (v: number, d = 2) =>
    v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

  const fmtVol = (v: number) => {
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(v);
  };

  return (
    <>
      <NavBar />
      <div className="stocks-dark">
        <main style={{ padding: "16px 24px", maxWidth: 1200, margin: "0 auto" }}>
          {/* Breadcrumb */}
          <div style={{ marginBottom: 12, fontSize: 12 }}>
            <Link href="/stocks" style={{ color: "#ff5000", textDecoration: "none" }}>
              Stock Dashboard
            </Link>
            <span className="sd-muted" style={{ margin: "0 6px" }}>/</span>
            <span style={{ fontWeight: 600 }}>{ticker}</span>
          </div>

          {/* Header */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ margin: 0, fontWeight: 700 }}>{ticker}</h4>
            {quote && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 4 }}>
                <span style={{ fontSize: 24, fontWeight: 700 }}>
                  {fmt(quote.regularMarketPrice)}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: changeColor }}>
                  {positive ? "+" : ""}{fmt(quote.regularMarketChange)}{" "}
                  ({positive ? "+" : ""}{fmt(quote.regularMarketChangePercent)}%)
                </span>
                <span className="sd-muted" style={{ fontSize: 12 }}>
                  {quote.shortName}
                </span>
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 3 }}>
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  className={`sd-btn${range === r.value ? " sd-btn-active" : ""}`}
                  style={{ fontSize: 11, padding: "3px 8px" }}
                  onClick={() => setRange(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 3 }}>
              {(["candlestick", "line"] as ChartMode[]).map((m) => (
                <button
                  key={m}
                  className={`sd-btn${mode === m ? " sd-btn-active" : ""}`}
                  style={{ fontSize: 11, padding: "3px 8px" }}
                  onClick={() => setMode(m)}
                >
                  {m === "candlestick" ? "Candlestick" : "Line"}
                </button>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div className="sd-card" style={{ marginBottom: 16 }}>
            {historyLoading ? (
              <div style={{ textAlign: "center", padding: 40 }}>
                <span className="spinner-border spinner-border-sm" style={{ color: "#8b949e" }} />
              </div>
            ) : (
              <StockChart data={historyData} mode={mode} height={420} />
            )}
          </div>

          {/* Stats grid */}
          {quote && (
            <div className="row g-2">
              {[
                { label: "Open", value: fmt(quote.regularMarketOpen) },
                { label: "High", value: fmt(quote.regularMarketDayHigh) },
                { label: "Low", value: fmt(quote.regularMarketDayLow) },
                { label: "Prev Close", value: fmt(quote.regularMarketPreviousClose) },
                { label: "Volume", value: fmtVol(quote.regularMarketVolume) },
                { label: "Market Cap", value: quote.marketCap ? fmtVol(quote.marketCap) : "N/A" },
              ].map((stat) => (
                <div key={stat.label} className="col-6 col-md-4 col-lg-2">
                  <div className="sd-card" style={{ padding: "8px 12px" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }} className="sd-muted">
                      {stat.label}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
                      {stat.value}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
