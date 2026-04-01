"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
// Types inlined to avoid SSR-triggered module evaluation
interface LayoutItem { i: string; x: number; y: number; w: number; h: number; }

import NavBar from "../../../components/NavBar";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useStockQuote } from "../../../hooks/useStockQuote";
import { useStockHistory } from "../../../hooks/useStockHistory";
import { useStockPortfolios } from "../../../hooks/useStockPortfolios";
import { useAutoRefresh } from "../../../hooks/useAutoRefresh";
import type { ChartMode, PortfolioGroup, StockQuote, TimeRange, HistoricalDataPoint } from "../../../types/stocks";
// TimeRange used for auto-range selection

const StockChart = dynamic(() => import("../../../components/stocks/StockChart"), { ssr: false });
const ComparisonChart = dynamic(() => import("../../../components/stocks/ComparisonChart"), { ssr: false });
const MarketOverview = dynamic(() => import("../../../components/stocks/MarketOverview"), { ssr: false });
const StockSearch = dynamic(() => import("../../../components/stocks/StockSearch"), { ssr: false });
const FuturesCurveChart = dynamic(() => import("../../../components/stocks/FuturesCurveChart"), { ssr: false });
const GridLayout = dynamic(
  () => import("react-grid-layout").then((mod) => mod.ResponsiveGridLayout),
  { ssr: false },
);


/* ── Helpers ──────────────────────────────────────────────────────────────── */

const THEME_KEY = "stocks-theme";
const CARDS_KEY = "stocks-dash-cards-v2";
const LAYOUT_KEY = "stocks-dash-layout-v2";

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);
  return { theme, isDark: theme === "dark", toggle };
}

const fmt = (v: number, d = 2) =>
  v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Check if a quote is actively trading (updated within last 30 min) */
function isTrading(marketTime: string): boolean {
  if (!marketTime) return false;
  const diff = Date.now() - new Date(marketTime).getTime();
  return diff < 30 * 60 * 1000; // 30 minutes
}

/** Green dot if trading, dim dot if not */
function TradingDot({ active }: { active: boolean }) {
  return (
    <span style={{
      display: "inline-block",
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: active ? "#3fb950" : "#30363d",
      boxShadow: active ? "0 0 4px #3fb950" : "none",
      marginRight: 4,
      flexShrink: 0,
    }} />
  );
}

const fmtVol = (v: number) => {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
};

/* ── Card types ──────────────────────────────────────────────────────────── */

type DashCard =
  | { id: string; type: "portfolio" }
  | { id: string; type: "market" }
  | { id: string; type: "chart"; ticker: string }
  | { id: string; type: "watchlist"; tickers: string[]; title: string }
  | { id: string; type: "compare"; tickers: string[]; mode: "percent" | "base100"; range: string; baseDate: string; endDate: string }
  | { id: string; type: "futures" };

const DEFAULT_CARDS: DashCard[] = [
  { id: "portfolio", type: "portfolio" },
  { id: "market", type: "market" },
  { id: "chart", type: "chart", ticker: "" },
];

function defaultLayout(): Record<string, LayoutItem[]> {
  return {
    lg: [
      { i: "portfolio", x: 0, y: 0, w: 4, h: 8 },
      { i: "market", x: 4, y: 0, w: 4, h: 8 },
      { i: "chart", x: 8, y: 0, w: 4, h: 8 },
    ],
  };
}

let _cardCounter = 0;
function nextId() { return `card-${Date.now()}-${_cardCounter++}`; }

/* ── Icons ────────────────────────────────────────────────────────────────── */

function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
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

function DragIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.4 }}>
      <circle cx="5" cy="3" r="1.5" /><circle cx="11" cy="3" r="1.5" />
      <circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" />
      <circle cx="5" cy="13" r="1.5" /><circle cx="11" cy="13" r="1.5" />
    </svg>
  );
}

/* ── Card Header ─────────────────────────────────────────────────────────── */

function CardHeader({ title, children, onRemove }: { title: React.ReactNode; children?: React.ReactNode; onRemove?: () => void }) {
  return (
    <div className="sd-drag-handle" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0 6px", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <DragIcon />
        <span style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {children}
        {onRemove && (
          <button className="sd-btn" style={{ padding: "1px 5px", fontSize: 9, lineHeight: 1, opacity: 0.5 }} onClick={onRemove}>x</button>
        )}
      </div>
    </div>
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

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) onClose();
    }
    const timer = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
    return () => { clearTimeout(timer); document.removeEventListener("mousedown", handleClick); };
  }, [isOpen, onClose]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSave(name.trim(), groups.filter((g) => g.tickers.length > 0 || g.name !== ""));
    setSaving(false);
    onClose();
  };

  const updateGroup = (idx: number, update: Partial<PortfolioGroup>) => setGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, ...update } : g)));
  const addTickerToGroup = (idx: number, symbol: string) => setGroups((prev) => prev.map((g, i) => i === idx && !g.tickers.includes(symbol) ? { ...g, tickers: [...g.tickers, symbol] } : g));
  const removeTickerFromGroup = (idx: number, symbol: string) => setGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, tickers: g.tickers.filter((t) => t !== symbol) } : g)));
  const addGroup = () => setGroups((prev) => [...prev, { name: "", tickers: [] }]);
  const removeGroup = (idx: number) => setGroups((prev) => prev.filter((_, i) => i !== idx));

  if (!isOpen) return null;

  return (
    <div className={themeClass}>
      <div className="modal-backdrop show" style={{ zIndex: 1040, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} />
      <div className="modal d-block" style={{ zIndex: 1050, pointerEvents: "none" }}>
        <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 560, pointerEvents: "auto" }} ref={dialogRef}>
          <div className="sd-modal-glass">
            <div className="sd-modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h6 style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>{isEdit ? "Edit Portfolio" : "New Portfolio"}</h6>
              <button type="button" className="btn-close" onClick={onClose} />
            </div>
            <div className="sd-modal-body">
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "block", opacity: 0.6 }}>Portfolio Name</label>
                <input type="text" className="sd-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My B3 Portfolio" style={{ borderRadius: 10, padding: "8px 12px" }} />
              </div>
              {groups.map((group, gi) => (
                <div key={gi} className="sd-modal-group">
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <input type="text" className="sd-input" value={group.name} onChange={(e) => updateGroup(gi, { name: e.target.value })} placeholder="Group name (e.g. Energy)" style={{ flex: 1, fontSize: 12, padding: "6px 10px", borderRadius: 8 }} />
                    {groups.length > 1 && <button className="sd-btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => removeGroup(gi)}>Remove</button>}
                  </div>
                  <StockSearch onSelect={(sym) => addTickerToGroup(gi, sym)} placeholder="Add stock to this group..." />
                  {group.tickers.length > 0 && (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                      {group.tickers.map((t) => (
                        <span key={t} className="sd-btn" style={{ padding: "3px 8px", fontSize: 11, borderRadius: 10, display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {t}
                          <button onClick={() => removeTickerFromGroup(gi, t)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1, opacity: 0.6 }}>x</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <button className="sd-btn" style={{ fontSize: 12, width: "100%", borderRadius: 10, padding: "8px 0" }} onClick={addGroup}>+ Add Group</button>
            </div>
            <div className="sd-modal-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                {isEdit && onDelete && (
                  confirmDelete ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="sd-btn sd-btn-active" style={{ fontSize: 12, borderRadius: 10 }} onClick={async () => { await onDelete(); onClose(); }}>Confirm</button>
                      <button className="sd-btn" style={{ fontSize: 12, borderRadius: 10 }} onClick={() => setConfirmDelete(false)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="sd-btn" style={{ fontSize: 12, borderRadius: 10, opacity: 0.7 }} onClick={() => setConfirmDelete(true)}>Delete Portfolio</button>
                  )
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="sd-btn" style={{ fontSize: 12, borderRadius: 10, padding: "6px 16px" }} onClick={onClose}>Cancel</button>
                <button className="sd-btn sd-btn-active" style={{ fontSize: 12, borderRadius: 10, padding: "6px 20px" }} onClick={handleSave} disabled={saving || !name.trim()}>
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

/* ── Watchlist Card Content ───────────────────────────────────────────────── */

function WatchlistCardContent({ card, isDark, onUpdate }: { card: DashCard & { type: "watchlist" }; isDark: boolean; onUpdate: (c: DashCard) => void }) {
  const [editing, setEditing] = useState(false);
  const { data: watchQuotes } = useStockQuote(card.tickers);

  // Blink tracking for watchlist
  const wPrevRef = useRef<Map<string, number>>(new Map());
  const [wBlinks, setWBlinks] = useState<Map<string, "up" | "down">>(new Map());
  useEffect(() => {
    if (!watchQuotes.length) return;
    const nb = new Map<string, "up" | "down">();
    const prev = wPrevRef.current;
    for (const q of watchQuotes) {
      const old = prev.get(q.symbol);
      if (old !== undefined && old !== q.regularMarketPrice) nb.set(q.symbol, q.regularMarketPrice > old ? "up" : "down");
      prev.set(q.symbol, q.regularMarketPrice);
    }
    if (nb.size > 0) { setWBlinks(nb); const t = setTimeout(() => setWBlinks(new Map()), 1200); return () => clearTimeout(t); }
  }, [watchQuotes]);

  return (
    <>
      <CardHeader
        title={card.title || "Watchlist"}
        onRemove={() => onUpdate({ ...card, type: "watchlist", tickers: [], title: "__REMOVE__" })}
      >
        <button className="sd-btn" style={{ padding: "2px 5px", fontSize: 9 }} onClick={() => setEditing((v) => !v)}>
          <GearIcon size={10} />
        </button>
      </CardHeader>
      {editing && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ marginBottom: 4 }}>
            <input
              type="text"
              className="sd-input"
              value={card.title}
              onChange={(e) => onUpdate({ ...card, title: e.target.value })}
              placeholder="Watchlist name"
              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, marginBottom: 4 }}
            />
          </div>
          <StockSearch
            onSelect={(sym) => {
              if (!card.tickers.includes(sym)) onUpdate({ ...card, tickers: [...card.tickers, sym] });
            }}
            placeholder="Add ticker..."
          />
          {card.tickers.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
              {card.tickers.map((t) => (
                <span key={t} className="sd-btn" style={{ padding: "2px 6px", fontSize: 10, borderRadius: 8, display: "inline-flex", alignItems: "center", gap: 3 }}>
                  {t}
                  <button onClick={() => onUpdate({ ...card, tickers: card.tickers.filter((x) => x !== t) })} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1, opacity: 0.6 }}>x</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {!editing && card.tickers.length === 0 && (
        <div className="sd-muted" style={{ textAlign: "center", padding: 12, fontSize: 11 }}>Click gear to add tickers</div>
      )}
      {card.tickers.length > 0 && (
        <table className="sd-table" style={{ fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "2px 3px" }}>ASSET</th>
              <th style={{ textAlign: "right", padding: "2px 3px" }}>LAST</th>
              <th style={{ textAlign: "right", padding: "2px 3px" }}>CHG%</th>
              <th style={{ textAlign: "center", width: 16, padding: "2px 1px" }}></th>
            </tr>
          </thead>
          <tbody>
            {watchQuotes.map((q) => {
              const pos = q.regularMarketChangePercent >= 0;
              const cls = pos ? "sd-green" : "sd-red";
              const wb = wBlinks.get(q.symbol);
              return (
                <tr key={q.symbol} className={wb ? `stock-blink-${wb}` : undefined}>
                  <td style={{ fontWeight: 600, padding: "2px 3px", display: "flex", alignItems: "center" }}>
                    <TradingDot active={isTrading(q.regularMarketTime)} />
                    <Link href={`/stocks/${q.symbol}`} style={{ color: "inherit", textDecoration: "none" }}>{q.symbol}</Link>
                  </td>
                  <td style={{ textAlign: "right", padding: "2px 3px" }} className={wb ? `price-flash-${wb}` : undefined}>{fmt(q.regularMarketPrice)}</td>
                  <td style={{ textAlign: "right", padding: "2px 3px" }} className={`${cls}${wb ? ` price-flash-${wb}` : ""}`}>{pos ? "+" : ""}{fmt(q.regularMarketChangePercent)}%</td>
                  <td style={{ textAlign: "center", padding: "2px 1px" }} className={cls}>{pos ? "\u25B2" : "\u25BC"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ── Extra Chart Card ────────────────────────────────────────────────────── */

const INTERVALS = [
  { label: "15m", value: "15m" }, { label: "30m", value: "30m" }, { label: "1H", value: "60m" },
  { label: "1D", value: "1d" }, { label: "1W", value: "1wk" },
];

const CHART_RANGES: { label: string; value: TimeRange }[] = [
  { label: "1D", value: "1d" }, { label: "5D", value: "5d" }, { label: "1M", value: "1mo" },
  { label: "3M", value: "3mo" }, { label: "6M", value: "6mo" }, { label: "1Y", value: "1y" },
  { label: "2Y", value: "2y" }, { label: "MAX", value: "max" },
];

// Max range Yahoo allows per interval
const MAX_RANGE: Record<string, string> = {
  "15m": "5d", "30m": "1mo", "60m": "3mo", "1d": "max", "1wk": "max",
};
const RANGE_ORDER = ["1d","3d","5d","1mo","3mo","6mo","1y","2y","5y","max"];

const INTRADAY_INTERVALS = new Set(["15m", "30m", "60m"]);

const CHART_SHORTCUTS = [
  { label: "BRENT", value: "BZ=F" },
  { label: "IBOV", value: "^BVSP" },
  { label: "USD/BRL", value: "USDBRL=X" },
];

function ChartCardContent({ card, isDark, tickers, onUpdate, quoteMap }: { card: DashCard & { type: "chart" }; isDark: boolean; tickers: string[]; onUpdate: (c: DashCard) => void; quoteMap: Map<string, StockQuote> }) {
  const [mode, setMode] = useState<ChartMode>("line");
  const [interval, setInterval] = useState("1d");
  const [range, setRange] = useState<TimeRange>("6mo");

  // Combine portfolio tickers + shortcuts for the dropdown
  const allTickers = [...tickers];
  for (const s of CHART_SHORTCUTS) { if (!allTickers.includes(s.value)) allTickers.push(s.value); }

  const effectiveTicker = card.ticker && allTickers.includes(card.ticker) ? card.ticker : tickers[0] ?? "";
  const isIntraday = INTRADAY_INTERVALS.has(interval);

  const maxIdx = RANGE_ORDER.indexOf(MAX_RANGE[interval] ?? "max");
  const rangeIdx = RANGE_ORDER.indexOf(range);
  const effectiveRange = (rangeIdx > maxIdx ? MAX_RANGE[interval] ?? "6mo" : range) as TimeRange;

  const { data, isLoading } = useStockHistory(effectiveTicker, effectiveRange, interval);
  // Use shared quote from parent — same source as Market Overview table
  const chartLivePrice = quoteMap.get(effectiveTicker)?.regularMarketPrice;

  // Find display label for current ticker
  const tickerLabel = CHART_SHORTCUTS.find((s) => s.value === effectiveTicker)?.label ?? effectiveTicker;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <CardHeader title="Chart" onRemove={card.id !== "chart" ? () => onUpdate({ ...card, ticker: "__REMOVE__" }) : undefined}>
        <select className="sd-select" style={{ fontSize: 11, padding: "2px 20px 2px 6px", fontWeight: 600 }} value={effectiveTicker} onChange={(e) => onUpdate({ ...card, ticker: e.target.value })}>
          {tickers.length > 0 && <optgroup label="Portfolio">
            {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
          </optgroup>}
          <optgroup label="Indices & FX">
            {CHART_SHORTCUTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </optgroup>
        </select>
      </CardHeader>
      {/* Controls row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0 6px", gap: 6, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 2 }}>
          {CHART_RANGES.map((r) => {
            const rIdx = RANGE_ORDER.indexOf(r.value);
            const disabled = rIdx > maxIdx;
            return (
              <button key={r.value} className={`sd-btn${range === r.value ? " sd-btn-active" : ""}`}
                style={{ fontSize: 11, padding: "3px 6px", opacity: disabled ? 0.3 : 1 }}
                onClick={() => !disabled && setRange(r.value)} disabled={disabled}>
                {r.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {INTERVALS.map((iv) => (
            <button key={iv.value} className={`sd-btn${interval === iv.value ? " sd-btn-active" : ""}`} style={{ fontSize: 11, padding: "3px 6px" }} onClick={() => setInterval(iv.value)}>
              {iv.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {(["candlestick", "line"] as ChartMode[]).map((m) => (
            <button key={m} className={`sd-btn${mode === m ? " sd-btn-active" : ""}`} style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setMode(m)}>
              {m === "candlestick" ? "Candle" : "Line"}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {isLoading ? (
          <div style={{ textAlign: "center", padding: 30 }}><span className="spinner-border spinner-border-sm" style={{ color: "#8b949e" }} /></div>
        ) : (
          <StockChart data={data} mode={mode} dark={isDark} intraday={isIntraday} livePrice={chartLivePrice} />
        )}
      </div>
    </div>
  );
}

/* ── Multi-history hook for compare card ──────────────────────────────────── */

const COMPARE_COLORS = ["#2962FF", "#FF6D00", "#00C853", "#AA00FF", "#FF1744"];

const COMPARE_RANGES: { label: string; value: TimeRange }[] = [
  { label: "1M", value: "1mo" }, { label: "3M", value: "3mo" }, { label: "6M", value: "6mo" },
  { label: "1Y", value: "1y" }, { label: "2Y", value: "2y" }, { label: "5Y", value: "5y" }, { label: "MAX", value: "max" },
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
      color: COMPARE_COLORS[i % COMPARE_COLORS.length],
    }));
  }, [tickers, h0, h1, h2, h3, h4]);
}

/* ── Compare Card Content ────────────────────────────────────────────────── */

function CompareCardContent({ card, isDark, onUpdate }: {
  card: DashCard & { type: "compare" };
  isDark: boolean;
  onUpdate: (c: DashCard) => void;
}) {
  const range = (card.range || "1y") as TimeRange;
  const seriesData = useMultiHistory(card.tickers, card.mode === "base100" ? "max" : range);
  const isLoading = seriesData.some((s) => s.data.length === 0) && card.tickers.length > 0;

  const addTicker = useCallback((sym: string) => {
    if (card.tickers.length >= 5 || card.tickers.includes(sym)) return;
    onUpdate({ ...card, tickers: [...card.tickers, sym] });
  }, [card, onUpdate]);

  const removeTicker = useCallback((sym: string) => {
    onUpdate({ ...card, tickers: card.tickers.filter((t) => t !== sym) });
  }, [card, onUpdate]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <CardHeader title="Compare Assets" onRemove={() => onUpdate({ ...card, tickers: ["__REMOVE__"] })} />

      {/* Search + ticker chips */}
      <div style={{ marginBottom: 4 }}>
        <StockSearch onSelect={addTicker} placeholder="Add asset..." />
      </div>
      {card.tickers.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
          {card.tickers.map((t, i) => (
            <span key={t} style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              padding: "2px 8px", borderRadius: 0, fontSize: 10, fontWeight: 600,
              background: `${COMPARE_COLORS[i % COMPARE_COLORS.length]}18`,
              color: COMPARE_COLORS[i % COMPARE_COLORS.length],
              border: `1px solid ${COMPARE_COLORS[i % COMPARE_COLORS.length]}40`,
            }}>
              {t}
              <button onClick={() => removeTicker(t)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}>x</button>
            </span>
          ))}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 4 }}>
        <div style={{ display: "flex", gap: 2 }}>
          <button className={`sd-btn${card.mode === "percent" ? " sd-btn-active" : ""}`} style={{ fontSize: 9, padding: "1px 6px" }}
            onClick={() => onUpdate({ ...card, mode: "percent" })}>Change %</button>
          <button className={`sd-btn${card.mode === "base100" ? " sd-btn-active" : ""}`} style={{ fontSize: 9, padding: "1px 6px" }}
            onClick={() => onUpdate({ ...card, mode: "base100" })}>Base 100</button>
        </div>

        {card.mode === "percent" && (
          <div style={{ display: "flex", gap: 2 }}>
            {COMPARE_RANGES.map((r) => (
              <button key={r.value} className={`sd-btn${range === r.value ? " sd-btn-active" : ""}`}
                style={{ fontSize: 9, padding: "1px 5px" }}
                onClick={() => onUpdate({ ...card, range: r.value })}>
                {r.label}
              </button>
            ))}
          </div>
        )}

        {card.mode === "base100" && (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <label className="sd-muted" style={{ fontSize: 9 }}>From:</label>
            <input type="date" className="sd-input" style={{ width: 110, fontSize: 10, padding: "2px 4px" }}
              value={card.baseDate} onChange={(e) => onUpdate({ ...card, baseDate: e.target.value })} />
            <label className="sd-muted" style={{ fontSize: 9 }}>To:</label>
            <input type="date" className="sd-input" style={{ width: 110, fontSize: 10, padding: "2px 4px" }}
              value={card.endDate} onChange={(e) => onUpdate({ ...card, endDate: e.target.value })} />
          </div>
        )}
      </div>

      {/* Chart — fills remaining space */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {card.tickers.length === 0 ? (
          <div className="sd-muted" style={{ textAlign: "center", padding: 20, fontSize: 11 }}>Add assets to compare</div>
        ) : isLoading ? (
          <div style={{ textAlign: "center", padding: 20 }}><span className="spinner-border spinner-border-sm" style={{ color: "#8b949e" }} /></div>
        ) : (
          <ComparisonChart
            key={card.tickers.join(",") + card.mode}
            series={seriesData}
            mode={card.mode}
            baseDate={card.baseDate || undefined}
            endDate={card.endDate || undefined}
            dark={isDark}
          />
        )}
      </div>
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────────── */

function StocksPageInner() {
  const { visible, loading: guardLoading } = useModuleVisibilityGuard("stocks");
  const { isDark, toggle } = useTheme();
  const themeClass = isDark ? "stocks-dark" : "stocks-light";
  const {
    portfolios, activePortfolio, isLoading: portfolioLoading,
    createPortfolio, updatePortfolio, deletePortfolio, setActivePortfolio,
  } = useStockPortfolios();

  const [modalOpen, setModalOpen] = useState(false);
  const [modalEdit, setModalEdit] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Close add menu on click outside
  useEffect(() => {
    if (!showAddMenu) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setShowAddMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAddMenu]);

  // ── Cards state (persisted to localStorage) ──
  const [cards, setCards] = useState<DashCard[]>(DEFAULT_CARDS);
  const [layouts, setLayouts] = useState<Record<string, LayoutItem[]>>(defaultLayout);
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noCompactorRef = useRef<any>(null);

  useEffect(() => {
    try {
      const savedCards = localStorage.getItem(CARDS_KEY);
      const savedLayouts = localStorage.getItem(LAYOUT_KEY);
      if (savedCards) {
        const parsed = JSON.parse(savedCards);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.id && parsed[0]?.type) {
          setCards(parsed);
        }
      }
      if (savedLayouts) {
        const parsed = JSON.parse(savedLayouts);
        if (parsed && typeof parsed === "object") setLayouts(parsed);
      }
    } catch {
      // Clear corrupted data
      localStorage.removeItem(CARDS_KEY);
      localStorage.removeItem(LAYOUT_KEY);
    }
    // Dynamically load noCompactor at runtime (SSR-safe)
    import("react-grid-layout").then((mod) => {
      noCompactorRef.current = mod.noCompactor;
      setMounted(true);
    }).catch(() => setMounted(true));
  }, []);

  const persistCards = useCallback((c: DashCard[]) => {
    setCards(c);
    localStorage.setItem(CARDS_KEY, JSON.stringify(c));
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleLayoutChange = useCallback((_layout: any, allLayouts: any) => {
    const serializable = Object.fromEntries(
      Object.entries(allLayouts).map(([k, v]) => [k, Array.isArray(v) ? [...v] : []])
    ) as Record<string, LayoutItem[]>;
    setLayouts(serializable);
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(serializable));
  }, []);

  const updateCard = useCallback((updated: DashCard) => {
    if ((updated.type === "watchlist" && updated.title === "__REMOVE__") ||
        (updated.type === "chart" && updated.ticker === "__REMOVE__") ||
        (updated.type === "compare" && updated.tickers[0] === "__REMOVE__")) {
      persistCards(cards.filter((c) => c.id !== updated.id));
      return;
    }
    persistCards(cards.map((c) => c.id === updated.id ? updated : c));
  }, [cards, persistCards]);

  const addCard = useCallback((type: "chart" | "watchlist" | "compare" | "futures") => {
    const id = nextId();
    const newCard: DashCard = type === "chart"
      ? { id, type: "chart", ticker: "" }
      : type === "compare"
      ? { id, type: "compare", tickers: [], mode: "percent", range: "1y", baseDate: "", endDate: "" }
      : type === "futures"
      ? { id, type: "futures" }
      : { id, type: "watchlist", tickers: [], title: "Watchlist" };
    const newCards = [...cards, newCard];
    persistCards(newCards);

    // Add layout entry for the new card
    const maxY = (layouts.lg ?? []).reduce((max, l) => Math.max(max, l.y + l.h), 0);
    const col = ((newCards.length - 1) % 3) * 4;
    const newLayout: LayoutItem = { i: id, x: col, y: maxY, w: 4, h: 8 };
    const updated = { ...layouts, lg: [...(layouts.lg ?? []), newLayout] };
    setLayouts(updated);
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(updated));
    setShowAddMenu(false);
  }, [cards, layouts, persistCards]);

  // ── Portfolio data + shortcut tickers (shared quote source for all cards) ──
  const tickers = activePortfolio?.tickers ?? [];
  const allQuoteTickers = useMemo(() => {
    const combined = [...tickers];
    for (const s of CHART_SHORTCUTS) { if (!combined.includes(s.value)) combined.push(s.value); }
    return combined;
  }, [tickers]);
  const { data: quotes, refetch } = useStockQuote(allQuoteTickers);
  const { isMarketOpen } = useAutoRefresh(useCallback(() => refetch(), [refetch]));

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

  const groups = activePortfolio?.groups ?? [];
  const quoteMap = useMemo(() => {
    const m = new Map<string, StockQuote>();
    for (const q of quotes) m.set(q.symbol, q);
    return m;
  }, [quotes]);

  // Container width — simple ref-based measurement (no external hook)
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ensure layout has entries for all cards — MUST be before any conditional return
  const effectiveLayouts = useMemo(() => {
    const lgLayouts = layouts.lg ?? [];
    const cardIds = new Set(cards.map((c) => c.id));
    const layoutIds = new Set(lgLayouts.map((l) => l.i));
    const missing = cards.filter((c) => !layoutIds.has(c.id));
    if (missing.length === 0) return layouts;
    const maxY = lgLayouts.reduce((max, l) => Math.max(max, l.y + l.h), 0);
    const extra = missing.map((c, i) => ({ i: c.id, x: (i % 3) * 4, y: maxY, w: 4, h: 8 }));
    // Also filter out layouts for cards that no longer exist
    const filtered = lgLayouts.filter((l) => cardIds.has(l.i));
    return { ...layouts, lg: [...filtered, ...extra] };
  }, [layouts, cards]);

  if (guardLoading || !visible) return null;

  const openCreate = () => { setModalEdit(false); setModalOpen(true); };
  const openEdit = () => { setModalEdit(true); setModalOpen(true); };

  return (
    <>
      <NavBar />
      <div className={themeClass}>
        <main style={{ padding: "12px 6px", maxWidth: "100%", margin: "0 auto" }}>

          {/* ── Top bar ── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, position: "relative", zIndex: 100 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {portfolios.length > 1 ? (
                <select className="sd-select" value={activePortfolio?.id ?? ""} onChange={(e) => setActivePortfolio(e.target.value)}>
                  {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ) : (
                <span style={{ fontWeight: 700, fontSize: 16 }}>{activePortfolio?.name ?? "Stock Dashboard"}</span>
              )}
              {activePortfolio && (
                <button className="sd-btn" style={{ padding: "4px 8px" }} onClick={openEdit} title="Edit portfolio"><GearIcon /></button>
              )}
              <button className="sd-btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={openCreate}>+ New</button>

              {/* Add card */}
              <div ref={addMenuRef} style={{ position: "relative" }}>
                <button className="sd-btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setShowAddMenu((v) => !v)}>+ Card</button>
                {showAddMenu && (
                  <div className="sd-card" style={{ position: "absolute", top: "100%", left: 0, zIndex: 9999, marginTop: 4, padding: 4, minWidth: 160 }}>
                    <button className="sd-btn" style={{ width: "100%", fontSize: 11, padding: "5px 8px", marginBottom: 2, textAlign: "left" }} onClick={() => addCard("chart")}>Chart</button>
                    <button className="sd-btn" style={{ width: "100%", fontSize: 11, padding: "5px 8px", marginBottom: 2, textAlign: "left" }} onClick={() => addCard("watchlist")}>Watchlist</button>
                    <button className="sd-btn" style={{ width: "100%", fontSize: 11, padding: "5px 8px", marginBottom: 2, textAlign: "left" }} onClick={() => addCard("compare")}>Compare Assets</button>
                    <button className="sd-btn" style={{ width: "100%", fontSize: 11, padding: "5px 8px", textAlign: "left" }} onClick={() => addCard("futures")}>Brent Futures Curve</button>
                  </div>
                )}
              </div>

              {/* B3 market status — prominent placement */}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                <span className={`sd-badge ${isMarketOpen ? "sd-badge-open" : "sd-badge-closed"}`} style={{ fontSize: 11, padding: "3px 10px" }}>
                  {isMarketOpen ? "B3 OPEN" : "B3 CLOSED"}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date())} SP
                </span>
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="sd-theme-toggle" onClick={toggle} title={isDark ? "Switch to light mode" : "Switch to dark mode"}>
                {isDark ? <SunIcon /> : <MoonIcon />}
              </button>
            </div>
          </div>

          {/* ── Empty state ── */}
          {!activePortfolio && !portfolioLoading && (
            <div className="sd-card" style={{ textAlign: "center", padding: 40 }}>
              <p className="sd-muted" style={{ fontSize: 14, marginBottom: 12 }}>No portfolios yet.</p>
              <button className="sd-btn sd-btn-active" onClick={openCreate}>Create your first portfolio</button>
            </div>
          )}

          {/* ── Draggable Grid ── */}
          <div ref={containerRef} style={{ minHeight: 1 }} />
          {mounted && activePortfolio && containerWidth > 0 && (
            <GridLayout
              className="layout"
              width={containerWidth}
              layouts={effectiveLayouts}
              breakpoints={{ lg: 1000, md: 700, sm: 0 }}
              cols={{ lg: 12, md: 8, sm: 4 }}
              rowHeight={30}
              onLayoutChange={handleLayoutChange}
              dragConfig={{ enabled: true, bounded: false, handle: ".sd-drag-handle", threshold: 3 }}
              resizeConfig={{ enabled: true, handles: ["se"] }}
              compactor={noCompactorRef.current}
              margin={[0, 0] as const}
              containerPadding={[0, 0] as const}
            >
              {cards.map((card) => (
                <div key={card.id}>
                  <div className="sd-card" style={{ padding: 8, height: "100%", overflow: "auto" }}>
                    {/* Portfolio table */}
                    {card.type === "portfolio" && (
                      <>
                        <CardHeader title="Portfolio" />
                        {groups.length > 0 && (
                          <table className="sd-table" style={{ fontSize: 11 }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", padding: "2px 3px" }}>ASSET</th>
                                <th style={{ textAlign: "right", padding: "2px 3px" }}>LAST</th>
                                <th style={{ textAlign: "right", padding: "2px 3px" }}>CHG%</th>
                                <th style={{ textAlign: "center", width: 16, padding: "2px 1px" }}></th>
                                <th style={{ textAlign: "right", padding: "2px 3px" }}>VOL</th>
                              </tr>
                            </thead>
                            <tbody>
                              {groups.map((group) => (
                                <>
                                  {groups.length > 1 && (
                                    <tr key={`hdr-${group.name}`}>
                                      <td colSpan={5} className="sd-group-header" style={{ padding: "5px 3px 2px" }}>{group.name}</td>
                                    </tr>
                                  )}
                                  {group.tickers.map((ticker) => {
                                    const q = quoteMap.get(ticker);
                                    if (!q) return (
                                      <tr key={ticker}>
                                        <td style={{ fontWeight: 600, padding: "2px 3px" }}>{ticker}</td>
                                        <td colSpan={4} className="sd-muted" style={{ textAlign: "center", fontSize: 10, padding: "2px 3px" }}>Loading...</td>
                                      </tr>
                                    );
                                    const pos = q.regularMarketChangePercent >= 0;
                                    const cls = pos ? "sd-green" : "sd-red";
                                    const blink = blinkMap.get(q.symbol);
                                    return (
                                      <tr key={q.symbol} className={blink ? `stock-blink-${blink}` : undefined}>
                                        <td style={{ padding: "2px 3px", display: "flex", alignItems: "center" }}>
                                          <TradingDot active={isTrading(q.regularMarketTime)} />
                                          <Link href={`/stocks/${q.symbol}`} style={{ fontWeight: 700, color: "inherit", textDecoration: "none" }}>{q.symbol}</Link>
                                        </td>
                                        <td style={{ textAlign: "right", padding: "2px 3px" }} className={blink ? `price-flash-${blink}` : undefined}>{fmt(q.regularMarketPrice)}</td>
                                        <td style={{ textAlign: "right", padding: "2px 3px" }} className={`${cls}${blink ? ` price-flash-${blink}` : ""}`}>{pos ? "+" : ""}{fmt(q.regularMarketChangePercent)}%</td>
                                        <td style={{ textAlign: "center", padding: "2px 1px" }} className={cls}>{pos ? "\u25B2" : "\u25BC"}</td>
                                        <td style={{ textAlign: "right", padding: "2px 3px" }}>{fmtVol(q.regularMarketVolume)}</td>
                                      </tr>
                                    );
                                  })}
                                </>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </>
                    )}

                    {/* Market Overview */}
                    {card.type === "market" && (
                      <>
                        <div className="sd-drag-handle" style={{ padding: "4px 0 2px", display: "flex", alignItems: "center", gap: 6 }}>
                          <DragIcon />
                        </div>
                        <MarketOverview />
                      </>
                    )}

                    {/* Chart */}
                    {card.type === "chart" && (
                      <ChartCardContent card={card as DashCard & { type: "chart" }} isDark={isDark} tickers={tickers} onUpdate={updateCard} quoteMap={quoteMap} />
                    )}

                    {/* Watchlist */}
                    {card.type === "watchlist" && (
                      <WatchlistCardContent card={card as DashCard & { type: "watchlist" }} isDark={isDark} onUpdate={updateCard} />
                    )}

                    {/* Compare */}
                    {card.type === "compare" && (
                      <CompareCardContent card={card as DashCard & { type: "compare" }} isDark={isDark} onUpdate={updateCard} />
                    )}

                    {/* Futures Curve */}
                    {card.type === "futures" && (
                      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                        <CardHeader title="Brent Futures Curve" onRemove={() => {
                          persistCards(cards.filter((c) => c.id !== card.id));
                        }} />
                        <div style={{ flex: 1, minHeight: 0 }}>
                          <FuturesCurveChart dark={isDark} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </GridLayout>
          )}
        </main>
      </div>

      <PortfolioModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        isEdit={modalEdit}
        themeClass={themeClass}
        initialName={modalEdit ? (activePortfolio?.name ?? "") : ""}
        initialGroups={modalEdit ? (activePortfolio?.groups ?? []) : [{ name: "General", tickers: [] }]}
        onSave={async (n, g) => {
          if (modalEdit && activePortfolio) await updatePortfolio(activePortfolio.id, { name: n, groups: g });
          else await createPortfolio(n, g);
        }}
        onDelete={modalEdit && activePortfolio ? async () => { await deletePortfolio(activePortfolio.id); } : undefined}
      />
    </>
  );
}

export default StocksPageInner;
