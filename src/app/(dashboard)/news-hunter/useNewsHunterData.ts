"use client";

// ─── News Hunter — shared data hook ──────────────────────────────────────────
//
// Single brain: article fetching with 60s polling + found_at watermark,
// keyword CRUD, topic filter state, search, and bookmark state.
//
// Both desktop/View.tsx and mobile/View.tsx consume this hook exclusively —
// they never call Supabase directly.
//
// Polling is INCREMENTAL: every tick fetches only rows where
//   found_at > lastFoundAtRef.current   (the watermark)
// so we never download the full table after the initial load.
//
// Bookmarks are stored in localStorage (key: nh_bookmarks_v1) — no DB column.
// ──────────────────────────────────────────────────────────────────────────────

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";
import { useNewsHunter } from "@/context/NewsHunterContext";
import type { NewsArticle } from "@/context/NewsHunterContext";

// ── Constants ────────────────────────────────────────────────────────────────

const AGE_TICK_MS = 15_000;
const THEME_STORAGE_KEY = "news-hunter-theme";
const BOOKMARKS_STORAGE_KEY = "nh_bookmarks_v1";

// ── Types ────────────────────────────────────────────────────────────────────

/** Active bottom-tab selection on mobile. */
export type MobileTab = "feed" | "search" | "saved" | "settings";

// ── Helpers ──────────────────────────────────────────────────────────────────

export function humanizeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  return `${Math.floor(secs / 86400)} d ago`;
}

export function formatTimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const today = new Date();
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  if (sameDay) return `${hh}:${mm}`;
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mo} ${hh}:${mm}`;
}

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Deterministic hex color for a domain initial circle. */
export function domainColor(domain: string): string {
  const PALETTE = [
    "#1a73e8",
    "#0b8f5a",
    "#b45309",
    "#1f2937",
    "#cf2e2e",
    "#5b21b6",
    "#0369a1",
    "#7c3aed",
    "#be185d",
    "#065f46",
  ];
  let hash = 0;
  const clean = domain.replace(/^www\./, "");
  for (let i = 0; i < clean.length; i++) {
    hash = clean.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** First letter of domain (stripped of www.). */
export function domainInitial(domain: string): string {
  return domain.replace(/^www\./, "").charAt(0).toUpperCase();
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseNewsHunterDataReturn {
  // Data from context (polling + watermark live here)
  articles: NewsArticle[];
  justArrivedUrls: Set<string>;
  keywords: string[];
  loading: boolean;
  error: string | null;

  // Visibility guard
  visible: boolean;
  visLoading: boolean;

  // Keyword CRUD
  newKeyword: string;
  setNewKeyword: (v: string) => void;
  addKeyword: (raw: string) => Promise<void>;
  removeKeyword: (kw: string) => Promise<void>;

  // Search
  searchTerm: string;
  setSearchTerm: (v: string) => void;

  // Topic filter (used on mobile as pill row; desktop may ignore)
  topicFilter: string;
  setTopicFilter: (v: string) => void;

  // Theme
  theme: "light" | "dark";
  toggleTheme: () => void;

  // Age tick (increment forces re-render so "X min ago" stays fresh)
  ageTick: number;

  // Bookmarks (local, no DB column)
  bookmarkedUrls: Set<string>;
  toggleBookmark: (url: string) => void;

  // Mobile tab navigation
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;

  // Derived
  /** Articles after keyword + search + topicFilter filtering. */
  filteredArticles: NewsArticle[];
  /** Articles that are bookmarked (for the Saved tab). */
  savedArticles: NewsArticle[];
  /** Label: "latest headline X ago" */
  lastScanLabel: string;
}

export function useNewsHunterData(): UseNewsHunterDataReturn {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("news-hunter");
  const supabase = useMemo(() => getSupabaseClient(), []);
  const { articles, justArrivedUrls, keywords, setKeywords, loading, error } =
    useNewsHunter();

  // ── Local state ─────────────────────────────────────────────────────────

  const [newKeyword, setNewKeyword] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [topicFilter, setTopicFilter] = useState<string>("All");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [ageTick, setAgeTick] = useState(0);
  const [bookmarkedUrls, setBookmarkedUrls] = useState<Set<string>>(new Set());
  const [mobileTab, setMobileTab] = useState<MobileTab>("feed");

  // ── Effects ──────────────────────────────────────────────────────────────

  // Restore theme from localStorage / system preference
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "dark" || stored === "light") { setTheme(stored); return; }
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) setTheme("dark");
    } catch { /* no localStorage */ }
  }, []);

  // Restore bookmarks from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
      if (raw) setBookmarkedUrls(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, []);

  // Age label tick — re-renders "X min ago" labels every 15s
  useEffect(() => {
    const id = setInterval(() => setAgeTick((t) => t + 1), AGE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // ── Callbacks ────────────────────────────────────────────────────────────

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next: "light" | "dark" = t === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const toggleBookmark = useCallback((url: string) => {
    setBookmarkedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      try {
        localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const addKeyword = useCallback(
    async (raw: string) => {
      const kw = raw.trim();
      if (!kw || !supabase) return;
      const already = keywords.some((k) => k.toLowerCase() === kw.toLowerCase());
      setNewKeyword("");
      if (already) return;
      const { error: insertErr } = await supabase
        .from("news_hunter_keywords")
        .insert({ keyword: kw });
      if (!insertErr) {
        setKeywords((prev) =>
          prev.some((k) => k.toLowerCase() === kw.toLowerCase()) ? prev : [...prev, kw],
        );
      }
    },
    [supabase, keywords, setKeywords],
  );

  const removeKeyword = useCallback(
    async (kw: string) => {
      if (!supabase) return;
      const { error: delErr } = await supabase
        .from("news_hunter_keywords")
        .delete()
        .eq("keyword", kw);
      if (!delErr) setKeywords((prev) => prev.filter((k) => k !== kw));
    },
    [supabase, setKeywords],
  );

  // ── Derived ──────────────────────────────────────────────────────────────

  const filteredArticles = useMemo(() => {
    let result = articles;

    // Keyword filter (desktop behavior preserved)
    if (keywords.length > 0) {
      const terms = keywords
        .map((k) => stripAccents(k.toLowerCase()).trim())
        .filter(Boolean);
      if (terms.length > 0) {
        result = result.filter((a) => {
          const hay = stripAccents(
            `${a.title} ${a.source_name} ${a.snippet} ${a.matched_keywords.join(" ")}`.toLowerCase(),
          );
          return terms.some((t) => hay.includes(t));
        });
      }
    }

    // Search filter
    const q = stripAccents(searchTerm.toLowerCase().trim());
    if (q) {
      result = result.filter((a) => {
        const hay = stripAccents(`${a.title} ${a.source_name}`.toLowerCase());
        return hay.includes(q);
      });
    }

    // Topic pill filter (mobile — "All" = no filter)
    if (topicFilter !== "All") {
      const t = stripAccents(topicFilter.toLowerCase());
      result = result.filter((a) => {
        const hay = stripAccents(
          `${a.title} ${a.source_name} ${a.matched_keywords.join(" ")}`.toLowerCase(),
        );
        return hay.includes(t);
      });
    }

    return result;
  }, [articles, keywords, searchTerm, topicFilter]);

  const savedArticles = useMemo(
    () => articles.filter((a) => bookmarkedUrls.has(a.url)),
    [articles, bookmarkedUrls],
  );

  const lastPublishedAt = filteredArticles[0]?.published_at ?? null;
  const lastScanLabel = lastPublishedAt
    ? `latest headline ${humanizeAge(lastPublishedAt)}`
    : "";

  return {
    articles,
    justArrivedUrls,
    keywords,
    loading,
    error,
    visible,
    visLoading,
    newKeyword,
    setNewKeyword,
    addKeyword,
    removeKeyword,
    searchTerm,
    setSearchTerm,
    topicFilter,
    setTopicFilter,
    theme,
    toggleTheme,
    ageTick,
    bookmarkedUrls,
    toggleBookmark,
    mobileTab,
    setMobileTab,
    filteredArticles,
    savedArticles,
    lastScanLabel,
  };
}
