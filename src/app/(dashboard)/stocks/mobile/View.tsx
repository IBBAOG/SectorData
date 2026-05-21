"use client";

/**
 * Mobile view for /stocks (Market Watch).
 *
 * Implements mockups/stocks-mobile.html:
 *   - MobileTopBar (liquid glass, theme toggle, avatar)
 *   - Portfolio pills (snap-scroll, orange active)
 *   - Inline search bar (sticky)
 *   - Ticker card list with inline sparklines (MobileDataCard)
 *   - Tap-to-expand: time-range pills + MobileChart + stats grid + collapse
 *   - MobileBottomTabBar (Portfolios / Watch / Compare / Profile)
 *   - Compare tab: chip set + MobileChart (same data, no border-radius on
 *     controls — standard mobile tokens apply, NOT trading terminal theme)
 *
 * Token notes: mobile uses standard mobile CSS vars (--mobile-*), NOT the
 * trading-terminal .stocks-dark / .stocks-light scoped classes. This is the
 * approved decision from the dual-view spec: "Mobile uses standard mobile
 * tokens from the mockup (orange #ff5000 + Arial + liquid glass)."
 *
 * Binding sync rule: any meaningful content change here must land in
 * desktop/View.tsx in the SAME commit, or commit must declare [mobile-only].
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  MobileTopBar,
  MobileBottomTabBar,
  MobileDataCard,
  BottomSheet,
  ChevronUpIcon,
  TrendingUpIcon,
  UserIcon,
  SearchIcon,
  CloseIcon,
} from "../../../../components/dashboard/mobile";
import MobileTabBar from "../../../../components/dashboard/mobile/MobileTabBar";
import {
  useStocksData,
  CHART_RANGES,
  type MobileTab,
} from "../useStocksData";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { useStockHistory } from "../../../../hooks/useStockHistory";
import { useStockPortfolios } from "../../../../hooks/useStockPortfolios";
import { useUserProfile } from "../../../../context/UserProfileContext";
import type { TimeRange, PortfolioGroup } from "../../../../types/stocks";

const MobileChart = dynamic(
  () => import("../../../../components/dashboard/mobile/MobileChart"),
  { ssr: false },
);
const StockSearch = dynamic(
  () => import("../../../../components/stocks/StockSearch"),
  { ssr: false },
);

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const fmt = (v: number, d = 2) =>
  v.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

const fmtVol = (v: number) => {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
};

const COMPARE_COLORS = [
  "#ff5000",
  "#2962FF",
  "#00C853",
  "#AA00FF",
  "#FF1744",
];

/* ── Ticker detail panel (expanded inline) ───────────────────────────────── */

function TickerDetail({
  symbol,
  range,
  onRangeChange,
  onCollapse,
}: {
  symbol: string;
  range: TimeRange;
  onRangeChange: (r: TimeRange) => void;
  onCollapse: () => void;
}) {
  const { data, isLoading } = useStockHistory(symbol, range);

  const chartData = useMemo(() => {
    if (!data.length) return [];
    const accent = "#ff5000";
    const closes = data.map((d) => d.close);
    const dates = data.map((d) => new Date(d.date * 1000));
    const minY = Math.min(...closes) * 0.998;
    const maxY = Math.max(...closes) * 1.002;
    return [
      {
        type: "scatter" as const,
        mode: "lines" as const,
        x: dates,
        y: closes,
        line: { color: accent, width: 2, shape: "spline" as const, smoothing: 0.6 },
        fill: "tozeroy" as const,
        fillcolor: "rgba(255, 80, 0, 0.10)",
        hovertemplate: "<b>%{y:.2f}</b><br>%{x|%b %d}<extra></extra>",
        yaxis: { range: [minY, maxY] },
      },
    ];
  }, [data]);

  // Pull last data point for stats
  const last = data[data.length - 1];
  const quote = last
    ? {
        open: last.open,
        high: last.high,
        low: last.low,
        volume: last.volume,
      }
    : null;

  return (
    <section
      style={{
        background: "var(--mobile-surface)",
        borderTop: "1px solid var(--mobile-divider)",
        borderBottom: "1px solid var(--mobile-divider)",
        padding: "4px 16px 18px",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
      aria-label={`${symbol} details`}
    >
      {/* Time range pills */}
      <MobileTabBar
        tabs={CHART_RANGES.map((r) => ({ key: r.value, label: r.label }))}
        activeKey={range}
        onChange={(k) => onRangeChange(k as TimeRange)}
        variant="container"
        ariaLabel="Time range"
      />
      <div style={{ height: 12 }} />

      {/* Chart */}
      {isLoading ? (
        <div
          style={{
            height: 280,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--mobile-text-muted)",
            fontSize: 13,
          }}
        >
          Loading chart…
        </div>
      ) : (
        <MobileChart
          data={chartData as unknown as import("plotly.js").PlotData[]}
          height={280}
          layout={{
            xaxis: { tickformat: "%b %d", nticks: 4 },
            yaxis: { side: "right", nticks: 3 },
          }}
        />
      )}

      {/* Stats grid */}
      {quote && (
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 1,
            background: "var(--mobile-divider)",
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid var(--mobile-divider)",
          }}
          role="list"
        >
          {[
            { label: "Open", value: fmt(quote.open) },
            { label: "High", value: fmt(quote.high) },
            { label: "Low", value: fmt(quote.low) },
            { label: "Volume", value: fmtVol(quote.volume) },
          ].map((s) => (
            <div
              key={s.label}
              role="listitem"
              style={{
                background: "var(--mobile-surface)",
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--mobile-text-muted)",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--mobile-text)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Collapse button */}
      <button
        onClick={onCollapse}
        aria-label={`Collapse ${symbol} details`}
        style={{
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          width: "100%",
          minHeight: 44,
          background: "transparent",
          border: 0,
          color: "var(--mobile-text-muted)",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          borderRadius: 10,
        }}
      >
        <ChevronUpIcon size={14} strokeWidth={2.5} />
        Collapse
      </button>
    </section>
  );
}

/* ── Portfolio tab ───────────────────────────────────────────────────────── */

function PortfolioTab({
  searchQuery,
}: {
  searchQuery: string;
}) {
  const {
    portfolios,
    activePortfolio,
    setActivePortfolio,
    quoteMap,
    mobileRange,
    setMobileRange,
    expandedTicker,
    setExpandedTicker,
    tickers,
    groups,
  } = useStocksData();

  // Compute sparkline values from quoteMap (use regularMarketPrice as single point placeholder)
  // Full sparklines would require history per ticker — for the list we use
  // the 30-day close series if already loaded, else a single-point fallback.
  const getSparklineColor = (sym: string) => {
    const q = quoteMap.get(sym);
    if (!q) return "#ff5000";
    return q.regularMarketChangePercent >= 0 ? "#16a34a" : "#dc2626";
  };

  const filteredTickers = useMemo(() => {
    if (!searchQuery.trim()) return tickers;
    const q = searchQuery.toLowerCase();
    return tickers.filter((t) => t.toLowerCase().includes(q));
  }, [tickers, searchQuery]);

  return (
    <div>
      {/* Portfolio pills */}
      {portfolios.length > 0 && (
        <nav
          aria-label="Portfolios"
          style={{
            position: "sticky",
            top: "calc(var(--mobile-topbar-h) + 48px)", // topbar + search
            zIndex: 25,
            height: 52,
            background: "var(--mobile-glass-bg)",
            WebkitBackdropFilter: "var(--mobile-glass-blur)",
            backdropFilter: "var(--mobile-glass-blur)",
            borderBottom: "1px solid var(--mobile-glass-border)",
            display: "flex",
            alignItems: "center",
            overflowX: "auto",
            overflowY: "hidden",
            gap: 8,
            padding: "0 16px",
            scrollSnapType: "x mandatory",
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "none",
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          {portfolios.map((p) => {
            const active = p.id === activePortfolio?.id;
            return (
              <button
                key={p.id}
                onClick={() => setActivePortfolio(p.id)}
                style={{
                  flex: "0 0 auto",
                  minHeight: 36,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: `1px solid ${active ? "var(--mobile-accent)" : "var(--mobile-border)"}`,
                  background: active ? "var(--mobile-accent)" : "var(--mobile-surface)",
                  color: active ? "#fff" : "var(--mobile-text)",
                  fontSize: 13,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  whiteSpace: "nowrap",
                  scrollSnapAlign: "start",
                  cursor: "pointer",
                  transition:
                    "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
                  boxShadow: active
                    ? "0 2px 8px rgba(255, 80, 0, 0.25)"
                    : "none",
                  fontFamily: "Arial, Helvetica, sans-serif",
                }}
              >
                {p.name}
              </button>
            );
          })}
        </nav>
      )}

      {/* Ticker list */}
      {filteredTickers.length === 0 && (
        <div
          style={{
            padding: "48px 24px",
            textAlign: "center",
            color: "var(--mobile-text-muted)",
            fontSize: 14,
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          {tickers.length === 0
            ? "No tickers in this portfolio yet."
            : "No results for your search."}
        </div>
      )}

      {filteredTickers.map((sym) => {
        const q = quoteMap.get(sym);
        const isExpanded = expandedTicker === sym;
        const pos = (q?.regularMarketChangePercent ?? 0) >= 0;
        const changeColor = pos ? "#16a34a" : "#dc2626";

        return (
          <div key={sym}>
            <MobileDataCard
              title={sym}
              subtitle={q?.shortName ?? q?.longName ?? ""}
              onClick={() => setExpandedTicker(isExpanded ? null : sym)}
              sparkline={
                q
                  ? [
                      q.regularMarketOpen,
                      q.regularMarketDayLow,
                      (q.regularMarketOpen + q.regularMarketDayHigh) / 2,
                      q.regularMarketDayHigh,
                      q.regularMarketPrice,
                    ]
                  : undefined
              }
              sparklineColor={getSparklineColor(sym)}
              rightSlot={
                q ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 4,
                      fontFamily: "Arial, Helvetica, sans-serif",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        color: "var(--mobile-text)",
                        lineHeight: 1.1,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {fmt(q.regularMarketPrice)}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: changeColor,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {pos ? "+" : ""}
                      {fmt(q.regularMarketChangePercent)}%
                    </span>
                  </div>
                ) : (
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--mobile-text-faint)",
                      fontFamily: "Arial, Helvetica, sans-serif",
                    }}
                  >
                    Loading…
                  </span>
                )
              }
            />
            {isExpanded && (
              <TickerDetail
                symbol={sym}
                range={mobileRange}
                onRangeChange={setMobileRange}
                onCollapse={() => setExpandedTicker(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Compare tab ─────────────────────────────────────────────────────────── */

function CompareTab() {
  const {
    compareTickers,
    addCompareTicker,
    removeCompareTicker,
    mobileRange,
    setMobileRange,
    quoteMap,
  } = useStocksData();

  // Load history for each compare ticker (max 5)
  const h0 = useStockHistory(compareTickers[0] ?? "", mobileRange);
  const h1 = useStockHistory(compareTickers[1] ?? "", mobileRange);
  const h2 = useStockHistory(compareTickers[2] ?? "", mobileRange);
  const h3 = useStockHistory(compareTickers[3] ?? "", mobileRange);
  const h4 = useStockHistory(compareTickers[4] ?? "", mobileRange);

  const allHistory = [h0, h1, h2, h3, h4];

  const chartTraces = useMemo(() => {
    if (!compareTickers.length) return [];
    return compareTickers.map((sym, i) => {
      const hist = allHistory[i];
      const color = COMPARE_COLORS[i % COMPARE_COLORS.length];
      if (!hist?.data.length) return null;

      // Base-100 normalisation
      const basePrice = hist.data[0].close;
      const normalized = hist.data.map((d) => ({
        x: new Date(d.date * 1000),
        y: ((d.close - basePrice) / basePrice) * 100,
      }));

      // Append live price
      const quote = quoteMap.get(sym);
      if (quote?.regularMarketPrice) {
        normalized.push({
          x: new Date(),
          y: ((quote.regularMarketPrice - basePrice) / basePrice) * 100,
        });
      }

      return {
        type: "scatter" as const,
        mode: "lines" as const,
        name: sym,
        x: normalized.map((p) => p.x),
        y: normalized.map((p) => p.y),
        line: { color, width: 2 },
        hovertemplate: `<b>${sym}</b> %{y:+.2f}%<br>%{x|%b %d}<extra></extra>`,
      };
    }).filter(Boolean);
  }, [compareTickers, allHistory, quoteMap]);

  return (
    <div
      style={{
        padding: "16px 0 0",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* Ticker chip input */}
      <div style={{ padding: "0 16px 12px" }}>
        <StockSearch
          onSelect={addCompareTicker}
          placeholder="Add asset to compare..."
        />
        {compareTickers.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 10,
            }}
          >
            {compareTickers.map((sym, i) => (
              <span
                key={sym}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  background: `${COMPARE_COLORS[i % COMPARE_COLORS.length]}18`,
                  color: COMPARE_COLORS[i % COMPARE_COLORS.length],
                  border: `1px solid ${COMPARE_COLORS[i % COMPARE_COLORS.length]}40`,
                  minHeight: 36,
                }}
              >
                {sym}
                <button
                  onClick={() => removeCompareTicker(sym)}
                  aria-label={`Remove ${sym}`}
                  style={{
                    background: "none",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 16,
                    lineHeight: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20,
                    height: 20,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Time range pills */}
      <div style={{ padding: "0 0 12px" }}>
        <MobileTabBar
          tabs={CHART_RANGES.filter((r) =>
            ["1mo", "3mo", "6mo", "1y", "2y", "max"].includes(r.value),
          ).map((r) => ({ key: r.value, label: r.label }))}
          activeKey={mobileRange}
          onChange={(k) => setMobileRange(k as TimeRange)}
          variant="container"
          ariaLabel="Time range"
        />
      </div>

      {/* Chart or empty state */}
      {compareTickers.length === 0 ? (
        <div
          style={{
            padding: "48px 24px",
            textAlign: "center",
            color: "var(--mobile-text-muted)",
            fontSize: 14,
          }}
        >
          Add up to 5 assets to compare their relative performance.
        </div>
      ) : (
        <MobileChart
          data={
            chartTraces as unknown as import("plotly.js").PlotData[]
          }
          height={300}
          layout={{
            showlegend: true,
            legend: {
              orientation: "h",
              x: 0,
              y: -0.1,
              font: { size: 11 },
            },
            yaxis: { tickformat: "+.1f", ticksuffix: "%" },
          }}
        />
      )}
    </div>
  );
}

/* ── Watchlist tab ───────────────────────────────────────────────────────── */

function WatchlistTab({ searchQuery }: { searchQuery: string }) {
  const {
    quoteMap,
    mobileRange,
    setMobileRange,
    expandedTicker,
    setExpandedTicker,
  } = useStocksData();

  // Use a fixed watchlist from the portfolio's tickers but filter by search
  const { portfolios, activePortfolio } = useStockPortfolios();
  // All unique tickers across all portfolios
  const allTickers = useMemo(() => {
    const set = new Set<string>();
    for (const p of portfolios) {
      for (const t of p.tickers) set.add(t);
    }
    return [...set];
  }, [portfolios]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return allTickers;
    const q = searchQuery.toLowerCase();
    return allTickers.filter((t) => t.toLowerCase().includes(q));
  }, [allTickers, searchQuery]);

  return (
    <div>
      {filtered.length === 0 && (
        <div
          style={{
            padding: "48px 24px",
            textAlign: "center",
            color: "var(--mobile-text-muted)",
            fontSize: 14,
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          {allTickers.length === 0
            ? "Create a portfolio to start tracking assets."
            : "No results for your search."}
        </div>
      )}
      {filtered.map((sym) => {
        const q = quoteMap.get(sym);
        const isExpanded = expandedTicker === sym;
        const pos = (q?.regularMarketChangePercent ?? 0) >= 0;
        const changeColor = pos ? "#16a34a" : "#dc2626";
        return (
          <div key={sym}>
            <MobileDataCard
              title={sym}
              subtitle={q?.shortName ?? q?.longName ?? ""}
              onClick={() => setExpandedTicker(isExpanded ? null : sym)}
              sparkline={
                q
                  ? [
                      q.regularMarketOpen,
                      q.regularMarketDayLow,
                      (q.regularMarketOpen + q.regularMarketDayHigh) / 2,
                      q.regularMarketDayHigh,
                      q.regularMarketPrice,
                    ]
                  : undefined
              }
              sparklineColor={pos ? "#16a34a" : "#dc2626"}
              rightSlot={
                q ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 4,
                      fontFamily: "Arial, Helvetica, sans-serif",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        color: "var(--mobile-text)",
                        lineHeight: 1.1,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {fmt(q.regularMarketPrice)}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: changeColor,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {pos ? "+" : ""}
                      {fmt(q.regularMarketChangePercent)}%
                    </span>
                  </div>
                ) : (
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--mobile-text-faint)",
                      fontFamily: "Arial, Helvetica, sans-serif",
                    }}
                  >
                    Loading…
                  </span>
                )
              }
            />
            {isExpanded && (
              <TickerDetail
                symbol={sym}
                range={mobileRange}
                onRangeChange={setMobileRange}
                onCollapse={() => setExpandedTicker(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Portfolio editor BottomSheet ────────────────────────────────────────── */

function PortfolioEditorSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    portfolios,
    activePortfolio,
    createPortfolio,
    updatePortfolio,
    deletePortfolio,
  } = useStocksData();
  const [name, setName] = useState(activePortfolio?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(activePortfolio?.name ?? "");
    setConfirmDelete(false);
  }, [activePortfolio, open]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    if (activePortfolio) {
      await updatePortfolio(activePortfolio.id, { name: name.trim() });
    } else {
      await createPortfolio(name.trim(), [{ name: "General", tickers: [] }]);
    }
    setSaving(false);
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={activePortfolio ? "Edit Portfolio" : "New Portfolio"}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            style={{
              width: "100%",
              minHeight: 48,
              borderRadius: 12,
              border: 0,
              background: "var(--mobile-accent)",
              color: "#fff",
              fontSize: 15,
              fontWeight: 700,
              cursor: saving || !name.trim() ? "default" : "pointer",
              opacity: saving || !name.trim() ? 0.6 : 1,
              fontFamily: "Arial, Helvetica, sans-serif",
            }}
          >
            {saving ? "Saving…" : activePortfolio ? "Save" : "Create"}
          </button>
          {activePortfolio &&
            (confirmDelete ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={async () => {
                    await deletePortfolio(activePortfolio.id);
                    onClose();
                  }}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 12,
                    border: "1px solid #dc2626",
                    background: "#dc2626",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "Arial, Helvetica, sans-serif",
                  }}
                >
                  Confirm Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 12,
                    border: "1px solid var(--mobile-border)",
                    background: "transparent",
                    color: "var(--mobile-text)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "Arial, Helvetica, sans-serif",
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  width: "100%",
                  minHeight: 44,
                  borderRadius: 12,
                  border: "1px solid var(--mobile-border)",
                  background: "transparent",
                  color: "#dc2626",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "Arial, Helvetica, sans-serif",
                }}
              >
                Delete Portfolio
              </button>
            ))}
        </div>
      }
    >
      <div style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
        <label
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--mobile-text-muted)",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            display: "block",
            marginBottom: 8,
          }}
        >
          Portfolio Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My B3 Portfolio"
          style={{
            width: "100%",
            height: 48,
            borderRadius: 12,
            border: "1px solid var(--mobile-border)",
            background: "var(--mobile-surface-2)",
            color: "var(--mobile-text)",
            fontSize: 15,
            padding: "0 14px",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        {portfolios.length > 1 && (
          <p
            style={{
              marginTop: 12,
              fontSize: 12,
              color: "var(--mobile-text-faint)",
            }}
          >
            To manage tickers, use the desktop view.
          </p>
        )}
      </div>
    </BottomSheet>
  );
}

/* ── Tab icons ───────────────────────────────────────────────────────────── */

const TAB_ICONS: Record<MobileTab | "profile", React.ReactNode> = {
  portfolios: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="22"
      height="22"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 4v6" />
    </svg>
  ),
  watch: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="22"
      height="22"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  compare: <TrendingUpIcon size={22} />,
  profile: <UserIcon size={22} />,
};

/* ── Mobile View ─────────────────────────────────────────────────────────── */

export default function MobileView(): React.ReactElement {
  const { visible, loading: guardLoading } =
    useModuleVisibilityGuard("stocks");
  const { profile } = useUserProfile();
  const { mobileTab, setMobileTab, isDark, toggleTheme } = useStocksData();

  const [searchQuery, setSearchQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const avatarInitials = useMemo(() => {
    if (!profile?.full_name) return "?";
    const parts = profile.full_name.trim().split(" ");
    if (parts.length >= 2)
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }, [profile]);

  if (guardLoading || !visible) return <></>;

  const BOTTOM_TAB_KEYS = ["portfolios", "watch", "compare", "profile"] as const;
  type BottomTabKey = (typeof BOTTOM_TAB_KEYS)[number];
  const bottomTabs = BOTTOM_TAB_KEYS.map((key) => ({
    key,
    label:
      key === "portfolios"
        ? "Portfolios"
        : key === "watch"
          ? "Watch"
          : key === "compare"
            ? "Compare"
            : "Profile",
    icon: TAB_ICONS[key],
    // "profile" key never matches mobileTab (MobileTab doesn't include "profile")
    // — that's intentional: tapping it opens the editor sheet instead.
    active: (key as string) === (mobileTab as string),
  }));

  return (
    <div
      style={{
        background: "var(--mobile-bg)",
        minHeight: "100dvh",
        paddingBottom: "calc(var(--mobile-tabbar-h) + var(--mobile-safe-bottom))",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* Top bar */}
      <MobileTopBar
        title={
          <span>
            SECTORDATA
            <span style={{ color: "var(--mobile-accent)" }}>.</span>
          </span>
        }
        showThemeToggle={true}
        onToggleTheme={toggleTheme}
        showAvatar={true}
        avatarInitials={avatarInitials}
        avatarLabel={profile?.full_name ?? "User profile"}
      />

      {/* Search bar (sticky below top bar) */}
      <div
        style={{
          position: "sticky",
          top: "var(--mobile-topbar-h)",
          zIndex: 20,
          height: 48,
          padding: "6px 16px",
          background: "var(--mobile-bg)",
          borderBottom: "1px solid var(--mobile-border-soft)",
        }}
      >
        <div style={{ position: "relative", height: 36 }}>
          <SearchIcon
            size={18}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--mobile-text-faint)",
              pointerEvents: "none",
            }}
          />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search ticker or company..."
            aria-label="Search ticker or company"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              height: 36,
              borderRadius: 10,
              border: "1px solid var(--mobile-border)",
              background: "var(--mobile-surface)",
              color: "var(--mobile-text)",
              fontFamily: "inherit",
              fontSize: 14,
              padding: "0 36px 0 36px",
              outline: "none",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                width: 24,
                height: 24,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                background: "var(--mobile-row-press)",
                border: 0,
                color: "var(--mobile-text-muted)",
                cursor: "pointer",
              }}
            >
              <CloseIcon size={12} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* Tab content */}
      <main>
        {mobileTab === "portfolios" && (
          <PortfolioTab searchQuery={searchQuery} />
        )}
        {mobileTab === "watch" && (
          <WatchlistTab searchQuery={searchQuery} />
        )}
        {mobileTab === "compare" && <CompareTab />}
      </main>

      {/* Bottom tab bar */}
      <MobileBottomTabBar
        tabs={bottomTabs}
        onChange={(key) => {
          if (key === "profile") {
            setEditorOpen(true);
            return;
          }
          setMobileTab(key as MobileTab);
        }}
      />

      {/* Portfolio editor sheet */}
      <PortfolioEditorSheet
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
      />
    </div>
  );
}
