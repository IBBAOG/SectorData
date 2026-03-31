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

const STORAGE_KEY = "stocks-theme";

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);
  return { theme, isDark: theme === "dark", toggle };
}

const fmt = (v: number, d = 2) =>
  v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtVol = (v: number) => {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
};

/* ── Icons ────────────────────────────────────────────────────────────────── */

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
      <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.421-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

/* ── Portfolio Modal (Liquid Glass) ───────────────────────────────────────── */

function PortfolioModal({
  isOpen, onClose, initialName, initialGroups, onSave, onDelete, isEdit, themeClass,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialName: string;
  initialGroups: PortfolioGroup[];
  onSave: (name: string, groups: PortfolioGroup[]) => Promise<void>;
  onDelete?: () => Promise<void>;
  isEdit: boolean;
  themeClass: string;
}) {
  const [name, setName] = useState(initialName);
  const [groups, setGroups] = useState<PortfolioGroup[]>(initialGroups);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setName(initialName);
    setGroups(initialGroups.length ? initialGroups : [{ name: "General", tickers: [] }]);
    setConfirmDelete(false);
  }, [initialName, initialGroups, isOpen]);

  // Close on click outside the dialog (using mousedown to fire before dropdown click)
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Use a timeout so the opening click doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [isOpen, onClose]);

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
        i === idx && !g.tickers.includes(symbol) ? { ...g, tickers: [...g.tickers, symbol] } : g,
      ),
    );
  };

  const removeTickerFromGroup = (idx: number, symbol: string) => {
    setGroups((prev) =>
      prev.map((g, i) => (i === idx ? { ...g, tickers: g.tickers.filter((t) => t !== symbol) } : g)),
    );
  };

  const addGroup = () => setGroups((prev) => [...prev, { name: "", tickers: [] }]);
  const removeGroup = (idx: number) => setGroups((prev) => prev.filter((_, i) => i !== idx));

  if (!isOpen) return null;

  return (
    <div className={themeClass}>
      <div
        className="modal-backdrop show"
        style={{ zIndex: 1040, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      />
      <div className="modal d-block" style={{ zIndex: 1050, pointerEvents: "none" }}>
        <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 560, pointerEvents: "auto" }} ref={dialogRef}>
          <div className="sd-modal-glass">
            {/* Header */}
            <div className="sd-modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h6 style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>
                {isEdit ? "Edit Portfolio" : "New Portfolio"}
              </h6>
              <button type="button" className="btn-close" onClick={onClose} />
            </div>

            {/* Body */}
            <div className="sd-modal-body">
              {/* Portfolio Name */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "block", opacity: 0.6 }}>
                  Portfolio Name
                </label>
                <input
                  type="text"
                  className="sd-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. My B3 Portfolio"
                  style={{ borderRadius: 10, padding: "8px 12px" }}
                />
              </div>

              {/* Groups */}
              {groups.map((group, gi) => (
                <div key={gi} className="sd-modal-group">
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <input
                      type="text"
                      className="sd-input"
                      value={group.name}
                      onChange={(e) => updateGroup(gi, { name: e.target.value })}
                      placeholder="Group name (e.g. Energy)"
                      style={{ flex: 1, fontSize: 12, padding: "6px 10px", borderRadius: 8 }}
                    />
                    {groups.length > 1 && (
                      <button className="sd-btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => removeGroup(gi)}>
                        Remove
                      </button>
                    )}
                  </div>
                  <StockSearch onSelect={(sym) => addTickerToGroup(gi, sym)} placeholder="Add stock to this group..." />
                  {group.tickers.length > 0 && (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                      {group.tickers.map((t) => (
                        <span key={t} className="sd-btn" style={{ padding: "3px 8px", fontSize: 11, borderRadius: 10, display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {t}
                          <button
                            onClick={() => removeTickerFromGroup(gi, t)}
                            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1, opacity: 0.6 }}
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              <button className="sd-btn" style={{ fontSize: 12, width: "100%", borderRadius: 10, padding: "8px 0" }} onClick={addGroup}>
                + Add Group
              </button>
            </div>

            {/* Footer */}
            <div className="sd-modal-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                {isEdit && onDelete && (
                  confirmDelete ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="sd-btn sd-btn-active" style={{ fontSize: 12, borderRadius: 10 }} onClick={async () => { await onDelete(); onClose(); }}>
                        Confirm
                      </button>
                      <button className="sd-btn" style={{ fontSize: 12, borderRadius: 10 }} onClick={() => setConfirmDelete(false)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="sd-btn" style={{ fontSize: 12, borderRadius: 10, opacity: 0.7 }} onClick={() => setConfirmDelete(true)}>
                      Delete Portfolio
                    </button>
                  )
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="sd-btn" style={{ fontSize: 12, borderRadius: 10, padding: "6px 16px" }} onClick={onClose}>Cancel</button>
                <button
                  className="sd-btn sd-btn-active"
                  style={{ fontSize: 12, borderRadius: 10, padding: "6px 20px" }}
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
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────────── */

export default function StocksPage() {
  const { visible, loading: guardLoading } = useModuleVisibilityGuard("stocks");
  const { theme, isDark, toggle } = useTheme();
  const themeClass = isDark ? "stocks-dark" : "stocks-light";
  const {
    portfolios, activePortfolio, isLoading: portfolioLoading,
    createPortfolio, updatePortfolio, deletePortfolio, setActivePortfolio,
  } = useStockPortfolios();

  const [chartTicker, setChartTicker] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("line");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalEdit, setModalEdit] = useState(false);

  const tickers = activePortfolio?.tickers ?? [];
  const { data: quotes, refetch } = useStockQuote(tickers);
  const { isMarketOpen } = useAutoRefresh(useCallback(() => refetch(), [refetch]));

  // Default chart ticker to first in portfolio
  const effectiveChartTicker = chartTicker && tickers.includes(chartTicker) ? chartTicker : tickers[0] ?? null;
  const { data: historyData, isLoading: historyLoading } = useStockHistory(effectiveChartTicker ?? "", "6mo");

  // ── Blink tracking ──
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
  const quoteMap = new Map<string, StockQuote>();
  for (const q of quotes) quoteMap.set(q.symbol, q);

  const openCreate = () => { setModalEdit(false); setModalOpen(true); };
  const openEdit = () => { setModalEdit(true); setModalOpen(true); };

  return (
    <>
      <NavBar />
      <div className={themeClass}>
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
              {/* Theme toggle */}
              <button className="sd-theme-toggle" onClick={toggle} title={isDark ? "Switch to light mode" : "Switch to dark mode"}>
                {isDark ? <SunIcon /> : <MoonIcon />}
              </button>
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
                <div className="sd-card" style={{ marginBottom: 12, padding: 8 }}>
                  <table className="sd-table" style={{ fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "3px 4px" }}>ASSET</th>
                        <th style={{ textAlign: "right", padding: "3px 4px" }}>LAST</th>
                        <th style={{ textAlign: "right", padding: "3px 4px" }}>CHG%</th>
                        <th style={{ textAlign: "center", width: 20, padding: "3px 2px" }}></th>
                        <th style={{ textAlign: "right", padding: "3px 4px" }}>LOW</th>
                        <th style={{ textAlign: "right", padding: "3px 4px" }}>HIGH</th>
                        <th style={{ textAlign: "right", padding: "3px 4px" }}>VOL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((group) => (
                        <>
                          {groups.length > 1 && (
                            <tr key={`hdr-${group.name}`}>
                              <td colSpan={7} className="sd-group-header" style={{ padding: "6px 4px 2px" }}>{group.name}</td>
                            </tr>
                          )}
                          {group.tickers.map((ticker) => {
                            const q = quoteMap.get(ticker);
                            if (!q) return (
                              <tr key={ticker}>
                                <td style={{ fontWeight: 600, padding: "3px 4px" }}>{ticker}</td>
                                <td colSpan={6} className="sd-muted" style={{ textAlign: "center", fontSize: 10, padding: "3px 4px" }}>Loading...</td>
                              </tr>
                            );
                            const pos = q.regularMarketChangePercent >= 0;
                            const cls = pos ? "sd-green" : "sd-red";
                            const blink = blinkMap.get(q.symbol);
                            return (
                              <tr
                                key={q.symbol}
                                className={blink ? `stock-blink-${blink}` : undefined}
                              >
                                <td style={{ padding: "3px 4px" }}>
                                  <Link
                                    href={`/stocks/${q.symbol}`}
                                    style={{ fontWeight: 700, color: "inherit", textDecoration: "none" }}
                                  >
                                    {q.symbol}
                                  </Link>
                                </td>
                                <td style={{ textAlign: "right", padding: "3px 4px" }}>{fmt(q.regularMarketPrice)}</td>
                                <td style={{ textAlign: "right", padding: "3px 4px" }} className={cls}>
                                  {pos ? "+" : ""}{fmt(q.regularMarketChangePercent)}%
                                </td>
                                <td style={{ textAlign: "center", padding: "3px 2px" }} className={cls}>
                                  {pos ? "\u25B2" : "\u25BC"}
                                </td>
                                <td style={{ textAlign: "right", padding: "3px 4px" }}>{fmt(q.regularMarketDayLow)}</td>
                                <td style={{ textAlign: "right", padding: "3px 4px" }}>{fmt(q.regularMarketDayHigh)}</td>
                                <td style={{ textAlign: "right", padding: "3px 4px" }}>{fmtVol(q.regularMarketVolume)}</td>
                              </tr>
                            );
                          })}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Right: Market Overview first, then Chart */}
            <div className="col-lg-5">
              <div style={{ marginBottom: 12 }}>
                <MarketOverview />
              </div>

              {tickers.length > 0 && (
                <div className="sd-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {tickers.length > 1 ? (
                        <select
                          className="sd-select"
                          style={{ fontSize: 12, padding: "2px 20px 2px 6px" }}
                          value={effectiveChartTicker ?? ""}
                          onChange={(e) => setChartTicker(e.target.value)}
                        >
                          {tickers.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontWeight: 700, fontSize: 12 }}>{effectiveChartTicker}</span>
                      )}
                      <span className="sd-muted" style={{ fontSize: 10 }}>6M</span>
                    </div>
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
                    <StockChart data={historyData} mode={chartMode} height={280} dark={isDark} />
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Portfolio Modal */}
      <PortfolioModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        isEdit={modalEdit}
        themeClass={themeClass}
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
