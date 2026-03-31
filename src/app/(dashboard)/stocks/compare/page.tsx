"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
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
  { label: "+ Gold", ticker: "GC=F" },
];

const RANGES: { label: string; value: TimeRange }[] = [
  { label: "1M", value: "1mo" },
  { label: "3M", value: "3mo" },
  { label: "6M", value: "6mo" },
  { label: "1Y", value: "1y" },
  { label: "2Y", value: "2y" },
  { label: "5Y", value: "5y" },
  { label: "MAX", value: "max" },
];

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
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("stocks-theme");
    if (saved === "light") setIsDark(false);
  }, []);

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

  const themeClass = isDark ? "stocks-dark" : "stocks-light";

  return (
    <>
      <NavBar />
      <div className={themeClass}>
        <main style={{ padding: "16px 24px", maxWidth: 1200, margin: "0 auto" }}>
          <h5 style={{ fontWeight: 700, marginBottom: 16 }}>Compare Assets</h5>

          <div className="row g-3 mb-3">
            <div className="col-md-6">
              <StockSearch onSelect={(sym) => handleAddTicker(sym)} placeholder="Search stock to compare..." />
            </div>
            <div className="col-md-6 d-flex align-items-center gap-2 flex-wrap">
              {SHORTCUTS.map((s) => (
                <button
                  key={s.ticker}
                  className={`sd-btn${tickers.includes(s.ticker) ? " sd-btn-active" : ""}`}
                  style={{ fontSize: 11, padding: "3px 10px" }}
                  onClick={() => handleAddTicker(s.ticker)}
                  disabled={tickers.includes(s.ticker) || tickers.length >= 5}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {tickers.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {tickers.map((t, i) => (
                <span
                  key={t}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "3px 10px", borderRadius: 16, fontSize: 12, fontWeight: 600,
                    background: `${COLORS[i % COLORS.length]}18`,
                    color: COLORS[i % COLORS.length],
                    border: `1px solid ${COLORS[i % COLORS.length]}40`,
                  }}
                >
                  {t}
                  <button
                    onClick={() => handleRemove(t)}
                    style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1 }}
                  >x</button>
                </span>
              ))}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", gap: 3 }}>
              <button className={`sd-btn${mode === "percent" ? " sd-btn-active" : ""}`} style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => setMode("percent")}>Change %</button>
              <button className={`sd-btn${mode === "base100" ? " sd-btn-active" : ""}`} style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => setMode("base100")}>Base 100</button>
            </div>

            {mode === "percent" && (
              <div style={{ display: "flex", gap: 3 }}>
                {RANGES.map((r) => (
                  <button key={r.value} className={`sd-btn${range === r.value ? " sd-btn-active" : ""}`} style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setRange(r.value)}>{r.label}</button>
                ))}
              </div>
            )}

            {mode === "base100" && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <label className="sd-muted" style={{ fontSize: 11 }}>From:</label>
                <input type="date" className="sd-input" style={{ width: 140, fontSize: 11, padding: "3px 8px" }} value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
                <label className="sd-muted" style={{ fontSize: 11 }}>To:</label>
                <input type="date" className="sd-input" style={{ width: 140, fontSize: 11, padding: "3px 8px" }} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            )}
          </div>

          <div className="sd-card">
            {tickers.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40 }} className="sd-muted">Add assets to compare</div>
            ) : isLoading ? (
              <div style={{ textAlign: "center", padding: 40 }}>
                <span className="spinner-border spinner-border-sm" style={{ color: "#8b949e" }} />
              </div>
            ) : (
              <ComparisonChart
                key={tickers.join(",") + mode}
                series={seriesData}
                mode={mode}
                height={420}
                baseDate={baseDate || undefined}
                endDate={endDate || undefined}
                dark={isDark}
              />
            )}
          </div>
        </main>
      </div>
    </>
  );
}
