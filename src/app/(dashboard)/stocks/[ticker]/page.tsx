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
  { label: "1A", value: "1y" },
  { label: "2A", value: "2y" },
  { label: "5A", value: "5y" },
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
  const changeColor = positive ? "#16a34a" : "#dc2626";

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
      <main className="container-fluid" style={{ padding: "24px 32px", maxWidth: 1200, margin: "0 auto" }}>
        {/* Breadcrumb */}
        <div style={{ marginBottom: 16, fontSize: 13 }}>
          <Link href="/stocks" style={{ color: "#ff5000", textDecoration: "none" }}>
            Dashboard de Acoes
          </Link>
          <span style={{ color: "#888", margin: "0 6px" }}>/</span>
          <span style={{ color: "#333", fontWeight: 600 }}>{ticker}</span>
        </div>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontWeight: 700 }}>{ticker}</h3>
          {quote && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 700 }}>
                {fmt(quote.regularMarketPrice)}
              </span>
              <span style={{ fontSize: 16, fontWeight: 600, color: changeColor }}>
                {positive ? "+" : ""}{fmt(quote.regularMarketChange)}{" "}
                ({positive ? "+" : ""}{fmt(quote.regularMarketChangePercent)}%)
              </span>
              <span style={{ fontSize: 13, color: "#888" }}>
                {quote.shortName}
              </span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          {/* Range selector */}
          <div style={{ display: "flex", gap: 4 }}>
            {RANGES.map((r) => (
              <button
                key={r.value}
                className="btn btn-sm"
                style={{
                  background: range === r.value ? "#ff5000" : "#f3f4f6",
                  color: range === r.value ? "#fff" : "#666",
                  fontWeight: 600,
                  fontSize: 12,
                  borderRadius: 6,
                  border: "none",
                  padding: "4px 10px",
                }}
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Mode toggle */}
          <div style={{ display: "flex", gap: 4 }}>
            {(["candlestick", "line"] as ChartMode[]).map((m) => (
              <button
                key={m}
                className="btn btn-sm"
                style={{
                  background: mode === m ? "#ff5000" : "#f3f4f6",
                  color: mode === m ? "#fff" : "#666",
                  fontWeight: 600,
                  fontSize: 12,
                  borderRadius: 6,
                  border: "none",
                  padding: "4px 10px",
                }}
                onClick={() => setMode(m)}
              >
                {m === "candlestick" ? "Candlestick" : "Linha"}
              </button>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div
          style={{
            background: "#fff",
            borderRadius: 12,
            padding: 16,
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            marginBottom: 24,
          }}
        >
          {historyLoading ? (
            <div className="text-center py-5">
              <span className="spinner-border spinner-border-sm" />
            </div>
          ) : (
            <StockChart data={historyData} mode={mode} height={450} />
          )}
        </div>

        {/* Stats grid */}
        {quote && (
          <div className="row g-3">
            {[
              { label: "Abertura", value: fmt(quote.regularMarketOpen) },
              { label: "Maxima", value: fmt(quote.regularMarketDayHigh) },
              { label: "Minima", value: fmt(quote.regularMarketDayLow) },
              { label: "Fech. Anterior", value: fmt(quote.regularMarketPreviousClose) },
              { label: "Volume", value: fmtVol(quote.regularMarketVolume) },
              { label: "Market Cap", value: quote.marketCap ? fmtVol(quote.marketCap) : "N/D" },
            ].map((stat) => (
              <div key={stat.label} className="col-6 col-md-4 col-lg-2">
                <div
                  style={{
                    background: "#fff",
                    borderRadius: 10,
                    padding: "12px 16px",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "#888", fontWeight: 600, textTransform: "uppercase" }}>
                    {stat.label}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                    {stat.value}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
