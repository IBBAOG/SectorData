"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

import NavBar from "../../../components/NavBar";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useStockQuote } from "../../../hooks/useStockQuote";
import { useStockHistory } from "../../../hooks/useStockHistory";
import { useStockPortfolios } from "../../../hooks/useStockPortfolios";
import { useAutoRefresh } from "../../../hooks/useAutoRefresh";
import type { ChartMode, PortfolioGroup, StockQuote } from "../../../types/stocks";

const StockChart = dynamic(() => import("../../../components/stocks/StockChart"), { ssr: false });
const MarketOverview = dynamic(() => import("../../../components/stocks/MarketOverview"), { ssr: false });
const StockSearch = dynamic(() => import("../../../components/stocks/StockSearch"), { ssr: false });

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const fmt = (v: number, d = 2) =>
  v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtVol = (v: number) => {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
};

/* ── Gear Icon SVG ────────────────────────────────────────────────────────── */

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
      <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.421-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z" />
    </svg>
  );
}

/* ── Portfolio Modal ──────────────────────────────────────────────────────── */

function PortfolioModal({
  isOpen,
  onClose,
  initialName,
  initialGroups,
  onSave,
  onDelete,
  isEdit,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialName: string;
  initialGroups: PortfolioGroup[];
  onSave: (name: string, groups: PortfolioGroup[]) => Promise<void>;
  onDelete?: () => Promise<void>;
  isEdit: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [groups, setGroups] = useState<PortfolioGroup[]>(initialGroups);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(initialName);
    setGroups(initialGroups.length ? initialGroups : [{ name: "General", tickers: [] }]);
    setConfirmDelete(false);
  }, [initialName, initialGroups, isOpen]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSave(name.trim(), groups.filter((g) => g.tickers.length > 0 || g.name !== ""));
    setSaving(false);
    onClose();
  };

  const updateGroup = (idx: number, update: Partial<PortfolioGroup>) => {
    setGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, ...update } : g)));
  };

  const addTickerToGroup = (idx: number, symbol: string) => {
    setGroups((prev) =>
      prev.map((g, i) =>
        i === idx && !g.tickers.includes(symbol)
          ? { ...g, tickers: [...g.tickers, symbol] }
          : g,
      ),
    );
  };

  const removeTickerFromGroup = (idx: number, symbol: string) => {
    setGroups((prev) =>
      prev.map((g, i) => (i === idx ? { ...g, tickers: g.tickers.filter((t) => t !== symbol) } : g)),
    );
  };

  const addGroup = () => {
    setGroups((prev) => [...prev, { name: "", tickers: [] }]);
  };

  const removeGroup = (idx: number) => {
    setGroups((prev) => prev.filter((_, i) => i !== idx));
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="modal-backdrop show" style={{ zIndex: 1040 }} onClick={onClose} />
      <div className="modal d-block" style={{ zIndex: 1050 }} onClick={onClose}>
        <div className="modal-dialog modal-dialog-centered modal-lg" onClick={(e) => e.stopPropagation()}>
          <div className="modal-content" style={{ borderRadius: 12 }}>
            <div className="modal-header" style={{ padding: "12px 16px" }}>
              <h6 className="modal-title" style={{ fontWeight: 700, fontSize: 14 }}>
                {isEdit ? "Edit Portfolio" : "New Portfolio"}
              </h6>
              <button type="button" className="btn-close" onClick={onClose} />
            </div>
            <div className="modal-body" style={{ padding: 16, maxHeight: "60vh", overflowY: "auto" }}>
              {/* Portfolio Name */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#8b949e", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "block" }}>
                  Portfolio Name
                </label>
                <input
                  type="text"
                  className="sd-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. My B3 Portfolio"
                />
              </div>

              {/* Groups */}
              {groups.map((group, gi) => (
                <div key={gi} style={{ marginBottom: 16, padding: 12, background: "#0d1117", borderRadius: 8, border: "1px solid #21262d" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <input
                      type="text"
                      className="sd-input"
                      value={group.name}
                      onChange={(e) => updateGroup(gi, { name: e.target.value })}
                      placeholder="Group name (e.g. Energy)"
                      style={{ flex: 1, fontSize: 12, padding: "4px 8px" }}
                    />
                    {groups.length > 1 && (
                      <button
                        className="sd-btn"
                        style={{ padding: "4px 8px", fontSize: 11, color: "#f85149", borderColor: "#f8514930" }}
                        onClick={() => removeGroup(gi)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <StockSearch
                    onSelect={(sym) => addTickerToGroup(gi, sym)}
                    placeholder="Add stock to this group..."
                  />
                  {group.tickers.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
                      {group.tickers.map((t) => (
                        <span
                          key={t}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            background: "#21262d",
                            padding: "3px 8px",
                            borderRadius: 10,
                            color: "#e6edf3",
                          }}
                        >
                          {t}
                          <button
                            onClick={() => removeTickerFromGroup(gi, t)}
                            style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1 }}
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              <button className="sd-btn" style={{ fontSize: 12, width: "100%" }} onClick={addGroup}>
                + Add Group
              </button>
            </div>
            <div className="modal-footer" style={{ padding: "10px 16px", justifyContent: "space-between" }}>
              <div>
                {isEdit && onDelete && (
                  confirmDelete ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="sd-btn" style={{ color: "#f85149", borderColor: "#f8514930" }} onClick={async () => { await onDelete(); onClose(); }}>
                        Confirm Delete
                      </button>
                      <button className="sd-btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="sd-btn" style={{ color: "#f85149", borderColor: "#f8514930" }} onClick={() => setConfirmDelete(true)}>
                      Delete Portfolio
                    </button>
                  )
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="sd-btn" onClick={onClose}>Cancel</button>
                <button
                  className="sd-btn sd-btn-active"
                  onClick={handleSave}
                  disabled={saving || !name.trim()}
                >
                  {saving ? <span className="spinner-border spinner-border-sm" /> : isEdit ? "Save" : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────────── */

export default function StocksPage() {
  const { visible, loading: guardLoading } = useModuleVisibilityGuard("stocks");
  const {
    portfolios,
    activePortfolio,
    isLoading: portfolioLoading,
    createPortfolio,
    updatePortfolio,
    deletePortfolio,
    setActivePortfolio,
  } = useStockPortfolios();

  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("line");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalEdit, setModalEdit] = useState(false);

  const tickers = activePortfolio?.tickers ?? [];
  const { data: quotes, refetch } = useStockQuote(tickers);
  const { isMarketOpen } = useAutoRefresh(useCallback(() => refetch(), [refetch]));

  const chartTicker = selectedTicker ?? tickers[0] ?? null;
  const { data: historyData, isLoading: historyLoading } = useStockHistory(chartTicker ?? "", "6mo");

  // ── Blink animation tracking ──
  const prevPricesRef = useRef<Map<string, number>>(new Map());
  const [blinkMap, setBlinkMap] = useState<Map<string, "up" | "down">>(new Map());

  useEffect(() => {
    if (!quotes.length) return;
    const newBlinks = new Map<string, "up" | "down">();
    const prev = prevPricesRef.current;

    for (const q of quotes) {
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
  }, [quotes]);

  if (guardLoading || !visible) return null;

  const groups = activePortfolio?.groups ?? [];

  // Build a map from symbol to quote for fast lookup
  const quoteMap = new Map<string, StockQuote>();
  for (const q of quotes) quoteMap.set(q.symbol, q);

  const openCreate = () => { setModalEdit(false); setModalOpen(true); };
  const openEdit = () => { setModalEdit(true); setModalOpen(true); };

  return (
    <>
      <NavBar />
      <div className="stocks-dark">
        <main style={{ padding: "16px 24px", maxWidth: 1440, margin: "0 auto" }}>

          {/* ── Top bar ── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {portfolios.length > 1 ? (
                <select
                  className="sd-select"
                  value={activePortfolio?.id ?? ""}
                  onChange={(e) => setActivePortfolio(e.target.value)}
                >
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              ) : (
                <span style={{ fontWeight: 700, fontSize: 16 }}>
                  {activePortfolio?.name ?? "Stock Dashboard"}
                </span>
              )}
              {activePortfolio && (
                <button className="sd-btn" style={{ padding: "4px 8px" }} onClick={openEdit} title="Edit portfolio">
                  <GearIcon />
                </button>
              )}
              <button className="sd-btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={openCreate}>
                + New
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`sd-badge ${isMarketOpen ? "sd-badge-open" : "sd-badge-closed"}`}>
                {isMarketOpen ? "B3 Open" : "B3 Closed"}
              </span>
              <span className="sd-muted" style={{ fontSize: 12 }}>
                {new Intl.DateTimeFormat("en-US", {
                  timeZone: "America/Sao_Paulo",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }).format(new Date())} SP
              </span>
            </div>
          </div>

          {/* ── Empty state ── */}
          {!activePortfolio && !portfolioLoading && (
            <div className="sd-card" style={{ textAlign: "center", padding: 40 }}>
              <p className="sd-muted" style={{ fontSize: 14, marginBottom: 12 }}>No portfolios yet.</p>
              <button className="sd-btn sd-btn-active" onClick={openCreate}>
                Create your first portfolio
              </button>
            </div>
          )}

          {/* ── Main grid ── */}
          <div className="row g-3">
            {/* Left: Portfolio table */}
            <div className="col-lg-7">
              {groups.length > 0 && (
                <div className="sd-card" style={{ marginBottom: 12 }}>
                  <table className="sd-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>ASSET</th>
                        <th style={{ textAlign: "right" }}>LAST</th>
                        <th style={{ textAlign: "right" }}>CHG%</th>
                        <th style={{ textAlign: "center", width: 24 }}></th>
                        <th style={{ textAlign: "right" }}>LOW</th>
                        <th style={{ textAlign: "right" }}>HIGH</th>
                        <th style={{ textAlign: "right" }}>VOL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((group) => (
                        <>
                          {groups.length > 1 && (
                            <tr key={`hdr-${group.name}`}>
                              <td colSpan={7} className="sd-group-header">{group.name}</td>
                            </tr>
                          )}
                          {group.tickers.map((ticker) => {
                            const q = quoteMap.get(ticker);
                            if (!q) return (
                              <tr key={ticker}>
                                <td style={{ fontWeight: 600 }}>{ticker}</td>
                                <td colSpan={6} className="sd-muted" style={{ textAlign: "center", fontSize: 11 }}>Loading...</td>
                              </tr>
                            );
                            const pos = q.regularMarketChangePercent >= 0;
                            const cls = pos ? "sd-green" : "sd-red";
                            const isSelected = chartTicker === q.symbol;
                            const blink = blinkMap.get(q.symbol);
                            return (
                              <tr
                                key={q.symbol}
                                className={`${isSelected ? "sd-selected" : ""}${blink ? ` stock-blink-${blink}` : ""}`}
                                style={{ cursor: "pointer" }}
                                onClick={() => setSelectedTicker(q.symbol)}
                              >
                                <td>
                                  <Link
                                    href={`/stocks/${q.symbol}`}
                                    style={{ fontWeight: 700, color: "#e6edf3", textDecoration: "none" }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {q.symbol}
                                  </Link>
                                </td>
                                <td style={{ textAlign: "right" }}>{fmt(q.regularMarketPrice)}</td>
                                <td style={{ textAlign: "right" }} className={cls}>
                                  {pos ? "+" : ""}{fmt(q.regularMarketChangePercent)}%
                                </td>
                                <td style={{ textAlign: "center" }} className={cls}>
                                  {pos ? "\u25B2" : "\u25BC"}
                                </td>
                                <td style={{ textAlign: "right" }}>{fmt(q.regularMarketDayLow)}</td>
                                <td style={{ textAlign: "right" }}>{fmt(q.regularMarketDayHigh)}</td>
                                <td style={{ textAlign: "right" }}>{fmtVol(q.regularMarketVolume)}</td>
                              </tr>
                            );
                          })}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Ticker shortcut buttons */}
              {tickers.length > 1 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                  {tickers.map((t) => (
                    <button
                      key={t}
                      className={`sd-btn${chartTicker === t ? " sd-btn-active" : ""}`}
                      style={{ fontSize: 11, padding: "3px 10px" }}
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

            {/* Right: Chart + Market Overview */}
            <div className="col-lg-5">
              {/* Chart */}
              {chartTicker && (
                <div className="sd-card" style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 12 }}>
                      {chartTicker} — 6M
                    </span>
                    <div style={{ display: "flex", gap: 3 }}>
                      {(["candlestick", "line"] as ChartMode[]).map((m) => (
                        <button
                          key={m}
                          className={`sd-btn${chartMode === m ? " sd-btn-active" : ""}`}
                          style={{ fontSize: 10, padding: "2px 8px" }}
                          onClick={() => setChartMode(m)}
                        >
                          {m === "candlestick" ? "Candle" : "Line"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {historyLoading ? (
                    <div style={{ textAlign: "center", padding: 40 }}>
                      <span className="spinner-border spinner-border-sm" style={{ color: "#8b949e" }} />
                    </div>
                  ) : (
                    <StockChart data={historyData} mode={chartMode} height={280} />
                  )}
                </div>
              )}

              {/* Market Overview */}
              <MarketOverview />
            </div>
          </div>
        </main>
      </div>

      {/* Portfolio Modal */}
      <PortfolioModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        isEdit={modalEdit}
        initialName={modalEdit ? (activePortfolio?.name ?? "") : ""}
        initialGroups={modalEdit ? (activePortfolio?.groups ?? []) : [{ name: "General", tickers: [] }]}
        onSave={async (n, g) => {
          if (modalEdit && activePortfolio) {
            await updatePortfolio(activePortfolio.id, { name: n, groups: g });
          } else {
            await createPortfolio(n, g);
          }
        }}
        onDelete={
          modalEdit && activePortfolio
            ? async () => { await deletePortfolio(activePortfolio.id); }
            : undefined
        }
      />
    </>
  );
}
