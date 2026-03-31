"use client";

import { useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";

import NavBar from "../../../../components/NavBar";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { useStockHistory } from "../../../../hooks/useStockHistory";
import type { HistoricalDataPoint, TimeRange } from "../../../../types/stocks";

const ComparisonChart = dynamic(() => import("../../../../components/stocks/ComparisonChart"), { ssr: false });
const StockSearch = dynamic(() => import("../../../../components/stocks/StockSearch"), { ssr: false });

const COLORS = ["#2962FF", "#FF6D00", "#00C853", "#AA00FF", "#FF1744"];

const SHORTCUTS = [
  { label: "+ Brent", ticker: "BZ=F" },
  { label: "+ WTI", ticker: "CL=F" },
  { label: "+ IBOV", ticker: "^BVSP" },
  { label: "+ Ouro", ticker: "GC=F" },
];

const RANGES: { label: string; value: TimeRange }[] = [
  { label: "1M", value: "1mo" },
  { label: "3M", value: "3mo" },
  { label: "6M", value: "6mo" },
  { label: "1A", value: "1y" },
  { label: "2A", value: "2y" },
  { label: "5A", value: "5y" },
  { label: "MAX", value: "max" },
];

// Hook that fetches history for multiple tickers
function useMultiHistory(tickers: string[], range: TimeRange) {
  const h0 = useStockHistory(tickers[0] ?? "", range);
  const h1 = useStockHistory(tickers[1] ?? "", range);
  const h2 = useStockHistory(tickers[2] ?? "", range);
  const h3 = useStockHistory(tickers[3] ?? "", range);
  const h4 = useStockHistory(tickers[4] ?? "", range);

  return useMemo(() => {
    const all = [h0, h1, h2, h3, h4];
    return tickers.map((t, i) => ({
      ticker: t,
      data: all[i]?.data ?? [] as HistoricalDataPoint[],
      color: COLORS[i % COLORS.length],
    }));
  }, [tickers, h0, h1, h2, h3, h4]);
}

export default function ComparePage() {
  const { visible, loading: guardLoading } = useModuleVisibilityGuard("stocks");

  const [tickers, setTickers] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tickers");
    return t ? t.split(",").filter(Boolean).slice(0, 5) : [];
  });

  const [mode, setMode] = useState<"percent" | "base100">("percent");
  const [range, setRange] = useState<TimeRange>("1y");
  const [baseDate, setBaseDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const seriesData = useMultiHistory(tickers, mode === "base100" ? "max" : range);
  const isLoading = seriesData.some((s) => s.data.length === 0) && tickers.length > 0;

  const handleAddTicker = useCallback(
    (symbol: string) => {
      if (tickers.length >= 5 || tickers.includes(symbol)) return;
      setTickers((prev) => [...prev, symbol]);
    },
    [tickers],
  );

  const handleRemove = useCallback((symbol: string) => {
    setTickers((prev) => prev.filter((t) => t !== symbol));
  }, []);

  if (guardLoading || !visible) return null;

  return (
    <>
      <NavBar />
      <main className="container-fluid" style={{ padding: "24px 32px", maxWidth: 1200, margin: "0 auto" }}>
        <h4 style={{ fontWeight: 700, marginBottom: 20 }}>Comparar Ativos</h4>

        {/* Search + Shortcuts */}
        <div className="row g-3 mb-3">
          <div className="col-md-6">
            <StockSearch
              onSelect={(sym) => handleAddTicker(sym)}
              placeholder="Buscar acao para comparar..."
            />
          </div>
          <div className="col-md-6 d-flex align-items-center gap-2 flex-wrap">
            {SHORTCUTS.map((s) => (
              <button
                key={s.ticker}
                className="btn btn-sm"
                style={{
                  background: tickers.includes(s.ticker) ? "#e5e7eb" : "#f3f4f6",
                  color: "#333",
                  fontWeight: 600,
                  fontSize: 12,
                  borderRadius: 6,
                  border: "none",
                  padding: "4px 12px",
                }}
                onClick={() => handleAddTicker(s.ticker)}
                disabled={tickers.includes(s.ticker) || tickers.length >= 5}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Ticker chips */}
        {tickers.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {tickers.map((t, i) => (
              <span
                key={t}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 12px",
                  borderRadius: 20,
                  fontSize: 13,
                  fontWeight: 600,
                  background: `${COLORS[i % COLORS.length]}18`,
                  color: COLORS[i % COLORS.length],
                  border: `1px solid ${COLORS[i % COLORS.length]}40`,
                }}
              >
                {t}
                <button
                  onClick={() => handleRemove(t)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Controls */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              className="btn btn-sm"
              style={{
                background: mode === "percent" ? "#ff5000" : "#f3f4f6",
                color: mode === "percent" ? "#fff" : "#666",
                fontWeight: 600,
                fontSize: 12,
                borderRadius: 6,
                border: "none",
                padding: "4px 12px",
              }}
              onClick={() => setMode("percent")}
            >
              Variacao %
            </button>
            <button
              className="btn btn-sm"
              style={{
                background: mode === "base100" ? "#ff5000" : "#f3f4f6",
                color: mode === "base100" ? "#fff" : "#666",
                fontWeight: 600,
                fontSize: 12,
                borderRadius: 6,
                border: "none",
                padding: "4px 12px",
              }}
              onClick={() => setMode("base100")}
            >
              Base 100
            </button>
          </div>

          {/* Range selector (hidden in base100 mode) */}
          {mode === "percent" && (
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
          )}

          {/* Date pickers (only in base100 mode) */}
          {mode === "base100" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ fontSize: 12, color: "#888" }}>De:</label>
              <input
                type="date"
                className="form-control form-control-sm"
                style={{ width: 150, fontSize: 12 }}
                value={baseDate}
                onChange={(e) => setBaseDate(e.target.value)}
              />
              <label style={{ fontSize: 12, color: "#888" }}>Ate:</label>
              <input
                type="date"
                className="form-control form-control-sm"
                style={{ width: 150, fontSize: 12 }}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Chart */}
        <div
          style={{
            background: "#fff",
            borderRadius: 12,
            padding: 16,
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          }}
        >
          {tickers.length === 0 ? (
            <div className="text-center py-5" style={{ color: "#888" }}>
              Adicione ativos para comparar
            </div>
          ) : isLoading ? (
            <div className="text-center py-5">
              <span className="spinner-border spinner-border-sm" />
            </div>
          ) : (
            <ComparisonChart
              key={tickers.join(",") + mode}
              series={seriesData}
              mode={mode}
              height={450}
              baseDate={baseDate || undefined}
              endDate={endDate || undefined}
            />
          )}
        </div>
      </main>
    </>
  );
}
