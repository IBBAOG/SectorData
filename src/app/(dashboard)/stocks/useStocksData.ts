"use client";

/**
 * useStocksData — single brain for /stocks dual-view.
 *
 * Both desktop/View.tsx and mobile/View.tsx consume THIS hook. Neither View
 * ever calls Yahoo Finance proxy directly, manages portfolio CRUD, or
 * derives quote data on its own.
 *
 * Special notes for /stocks:
 * - Portfolios are stored in Supabase (stock_portfolios) via PostgREST —
 *   NOT via RPC. This is an approved exception for simple per-user CRUD.
 * - Quote polling uses useStockQuote + useAutoRefresh (Yahoo Finance proxy).
 * - History is loaded on demand by each view (chart-level concern) via
 *   useStockHistory — exposed here as pass-through so both views use the
 *   same ticker/range state.
 * - No tabular export — /stocks has no export by design.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStockQuote } from "../../../hooks/useStockQuote";
import { useStockPortfolios } from "../../../hooks/useStockPortfolios";
import { useStockPeriodReturns } from "../../../hooks/useStockPeriodReturns";
import { useAutoRefresh } from "../../../hooks/useAutoRefresh";
import type {
  StockPortfolio,
  PortfolioGroup,
  StockQuote,
} from "../../../types/stocks";
import type { TimeRange } from "../../../types/stocks";

// ─── Re-export types consumed by both views ───────────────────────────────────

export type { TimeRange };
export type { StockQuote, StockPortfolio, PortfolioGroup };

// ─── Card / layout types (desktop only — but defined here so the hook
//     can expose card state for the desktop view to persist/restore) ─────────

export interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DashCard =
  | { id: string; type: "portfolio" }
  | { id: string; type: "market" }
  | { id: string; type: "chart"; ticker: string }
  | {
      id: string;
      type: "watchlist";
      tickers: string[];
      title: string;
    }
  | {
      id: string;
      type: "compare";
      tickers: string[];
      mode: "percent" | "base100";
      range: string;
      baseDate: string;
      endDate: string;
    }
  | { id: string; type: "futures" }
  | { id: string; type: "news" };

// ─── Mobile tab keys ─────────────────────────────────────────────────────────

export type MobileTab = "portfolios" | "watch" | "compare";

// ─── Shortcut tickers shared by both views ───────────────────────────────────

export const CHART_SHORTCUTS: { label: string; value: string }[] = [
  { label: "BRENT", value: "BZ=F" },
  { label: "IBOV", value: "^BVSP" },
  { label: "USD/BRL", value: "USDBRL=X" },
];

// ─── Time range config (chart range pills) ───────────────────────────────────

export const CHART_RANGES: { label: string; value: TimeRange }[] = [
  { label: "1D", value: "1d" },
  { label: "5D", value: "5d" },
  { label: "1M", value: "1mo" },
  { label: "3M", value: "3mo" },
  { label: "6M", value: "6mo" },
  { label: "1Y", value: "1y" },
  { label: "2Y", value: "2y" },
  { label: "MAX", value: "max" },
];

// ─── Persistence keys ────────────────────────────────────────────────────────

const THEME_KEY = "stocks-theme";
const CARDS_KEY = "stocks-dash-cards-v2";
const LAYOUT_KEY = "stocks-dash-layout-v2";

// ─── Helper: default layout ───────────────────────────────────────────────────

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
function nextId() {
  return `card-${Date.now()}-${_cardCounter++}`;
}

// ─── Hook interface ───────────────────────────────────────────────────────────

export interface UseStocksData {
  // --- Theme ---
  theme: "dark" | "light";
  isDark: boolean;
  toggleTheme: () => void;

  // --- Portfolios ---
  portfolios: StockPortfolio[];
  activePortfolio: StockPortfolio | null;
  portfolioLoading: boolean;
  createPortfolio: (name: string, groups: PortfolioGroup[]) => Promise<void>;
  updatePortfolio: (
    id: string,
    updates: { name?: string; groups?: PortfolioGroup[] },
  ) => Promise<void>;
  deletePortfolio: (id: string) => Promise<void>;
  setActivePortfolio: (id: string) => void;

  // --- Quotes (shared across all cards) ---
  quotes: StockQuote[];
  quoteMap: Map<string, StockQuote>;
  quotesLoading: boolean;
  refetchQuotes: () => void;
  isMarketOpen: boolean;

  // --- Period returns (YTD / MTD) ---
  periodReturns: Map<string, { symbol: string; ytdRefPrice: number | null; mtdRefPrice: number | null }>;

  // --- Blink tracking ---
  blinkMap: Map<string, "up" | "down">;

  // --- Cards (desktop drag-and-drop grid state, persisted to localStorage) ---
  cards: DashCard[];
  layouts: Record<string, LayoutItem[]>;
  addCard: (type: "chart" | "watchlist" | "compare" | "futures" | "news") => void;
  updateCard: (updated: DashCard) => void;
  handleLayoutChange: (
    _layout: unknown,
    allLayouts: unknown,
  ) => void;
  persistCards: (c: DashCard[]) => void;

  // --- Mobile tab navigation ---
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;

  // --- Mobile comparison ticker set ---
  compareTickers: string[];
  addCompareTicker: (sym: string) => void;
  removeCompareTicker: (sym: string) => void;

  // --- Mobile chart range ---
  mobileRange: TimeRange;
  setMobileRange: (r: TimeRange) => void;

  // --- Mobile expanded ticker ---
  expandedTicker: string | null;
  setExpandedTicker: (sym: string | null) => void;

  // --- Derived portfolio data ---
  tickers: string[];
  groups: PortfolioGroup[];
}

// ─── Hook implementation ──────────────────────────────────────────────────────

export function useStocksData(): UseStocksData {
  // --- Theme ---
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);
  const isDark = theme === "dark";

  // --- Portfolios ---
  const {
    portfolios,
    activePortfolio,
    isLoading: portfolioLoading,
    createPortfolio,
    updatePortfolio,
    deletePortfolio,
    setActivePortfolio: setActivePortfolioBase,
  } = useStockPortfolios();

  const setActivePortfolio = useCallback(
    (id: string) => {
      void setActivePortfolioBase(id);
    },
    [setActivePortfolioBase],
  );

  // --- Derived tickers and groups ---
  const tickers = activePortfolio?.tickers ?? [];
  const groups = activePortfolio?.groups ?? [];

  const allQuoteTickers = useMemo(() => {
    const combined = [...tickers];
    for (const s of CHART_SHORTCUTS) {
      if (!combined.includes(s.value)) combined.push(s.value);
    }
    return combined;
  }, [tickers]);

  // --- Quotes ---
  const {
    data: quotes,
    isLoading: quotesLoading,
    refetch: refetchQuotes,
  } = useStockQuote(allQuoteTickers);

  const { isMarketOpen } = useAutoRefresh(
    useCallback(() => refetchQuotes(), [refetchQuotes]),
  );

  const quoteMap = useMemo(() => {
    const m = new Map<string, StockQuote>();
    for (const q of quotes) m.set(q.symbol, q);
    return m;
  }, [quotes]);

  // --- Period returns ---
  const { data: periodReturns } = useStockPeriodReturns(tickers);

  // --- Blink tracking ---
  const prevPricesRef = useRef<Map<string, number>>(new Map());
  const [blinkMap, setBlinkMap] = useState<Map<string, "up" | "down">>(
    new Map(),
  );

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

  // --- Cards (desktop, persisted) ---
  const [cards, setCards] = useState<DashCard[]>(DEFAULT_CARDS);
  const [layouts, setLayouts] = useState<Record<string, LayoutItem[]>>(
    defaultLayout,
  );

  useEffect(() => {
    try {
      const savedCards = localStorage.getItem(CARDS_KEY);
      const savedLayouts = localStorage.getItem(LAYOUT_KEY);
      if (savedCards) {
        const parsed = JSON.parse(savedCards);
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed[0]?.id &&
          parsed[0]?.type
        ) {
          setCards(parsed);
        }
      }
      if (savedLayouts) {
        const parsed = JSON.parse(savedLayouts);
        if (parsed && typeof parsed === "object") setLayouts(parsed);
      }
    } catch {
      localStorage.removeItem(CARDS_KEY);
      localStorage.removeItem(LAYOUT_KEY);
    }
  }, []);

  const persistCards = useCallback((c: DashCard[]) => {
    setCards(c);
    localStorage.setItem(CARDS_KEY, JSON.stringify(c));
  }, []);

  const handleLayoutChange = useCallback(
    (_layout: unknown, allLayouts: unknown) => {
      const serializable = Object.fromEntries(
        Object.entries(allLayouts as Record<string, unknown>).map(([k, v]) => [
          k,
          Array.isArray(v) ? [...v] : [],
        ]),
      ) as Record<string, LayoutItem[]>;
      setLayouts(serializable);
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(serializable));
    },
    [],
  );

  const updateCard = useCallback(
    (updated: DashCard) => {
      if (
        (updated.type === "watchlist" && updated.title === "__REMOVE__") ||
        (updated.type === "chart" && updated.ticker === "__REMOVE__") ||
        (updated.type === "compare" && updated.tickers[0] === "__REMOVE__")
      ) {
        persistCards(cards.filter((c) => c.id !== updated.id));
        return;
      }
      persistCards(cards.map((c) => (c.id === updated.id ? updated : c)));
    },
    [cards, persistCards],
  );

  const addCard = useCallback(
    (type: "chart" | "watchlist" | "compare" | "futures" | "news") => {
      const id = nextId();
      const newCard: DashCard =
        type === "chart"
          ? { id, type: "chart", ticker: "" }
          : type === "compare"
            ? {
                id,
                type: "compare",
                tickers: [],
                mode: "percent",
                range: "1y",
                baseDate: "",
                endDate: "",
              }
            : type === "futures"
              ? { id, type: "futures" }
              : type === "news"
                ? { id, type: "news" }
                : { id, type: "watchlist", tickers: [], title: "Watchlist" };

      const newCards = [...cards, newCard];
      persistCards(newCards);

      const maxY = (layouts.lg ?? []).reduce(
        (max, l) => Math.max(max, l.y + l.h),
        0,
      );
      const col = ((newCards.length - 1) % 3) * 4;
      const newLayout: LayoutItem = { i: id, x: col, y: maxY, w: 4, h: 8 };
      const updated = { ...layouts, lg: [...(layouts.lg ?? []), newLayout] };
      setLayouts(updated);
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(updated));
    },
    [cards, layouts, persistCards],
  );

  // --- Mobile-specific state ---
  const [mobileTab, setMobileTab] = useState<MobileTab>("portfolios");
  const [compareTickers, setCompareTickers] = useState<string[]>([]);
  const [mobileRange, setMobileRange] = useState<TimeRange>("1mo");
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  const addCompareTicker = useCallback((sym: string) => {
    setCompareTickers((prev) => {
      if (prev.includes(sym) || prev.length >= 5) return prev;
      return [...prev, sym];
    });
  }, []);

  const removeCompareTicker = useCallback((sym: string) => {
    setCompareTickers((prev) => prev.filter((t) => t !== sym));
  }, []);

  return {
    // Theme
    theme,
    isDark,
    toggleTheme,

    // Portfolios
    portfolios,
    activePortfolio,
    portfolioLoading,
    createPortfolio,
    updatePortfolio,
    deletePortfolio,
    setActivePortfolio,

    // Quotes
    quotes,
    quoteMap,
    quotesLoading,
    refetchQuotes,
    isMarketOpen,

    // Period returns
    periodReturns,

    // Blink
    blinkMap,

    // Cards (desktop)
    cards,
    layouts,
    addCard,
    updateCard,
    handleLayoutChange,
    persistCards,

    // Mobile
    mobileTab,
    setMobileTab,
    compareTickers,
    addCompareTicker,
    removeCompareTicker,
    mobileRange,
    setMobileRange,
    expandedTicker,
    setExpandedTicker,

    // Derived
    tickers,
    groups,
  };
}
