"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type NewsArticle = {
  url: string;
  domain: string;
  source_name: string;
  title: string;
  snippet: string;
  published_at: string;
  found_at: string;
  matched_keywords: string[];
};

interface NewsHunterContextValue {
  articles: NewsArticle[];
  justArrivedUrls: Set<string>;
  keywords: string[];
  setKeywords: React.Dispatch<React.SetStateAction<string[]>>;
  loading: boolean;
  error: string | null;
}

const POLL_INTERVAL_MS = 60_000;
const FLASH_DURATION_MS = 3_400;
const PAGE_LIMIT = 500;
// 7d covers all window selector options in the News Hunter page.
const INITIAL_HOURS = 168;

export const FALLBACK_KEYWORDS: string[] = [
  "petróleo", "petroleo", "Petrobras", "Vibra", "Brava", "Ultrapar",
  "Ipiranga", "PetroReconcavo", "PetroRecôncavo", "oil", "gasolina",
  "gás", "gas", "diesel", "combustível", "combustivel", "combustíveis",
  "combustiveis", "OceanPact", "Cosan", "Raízen", "Raizen", "Braskem",
  "Compass", "PRIO", "ANP", "refit",
];

const NewsHunterCtx = createContext<NewsHunterContextValue | null>(null);

export function useNewsHunter(): NewsHunterContextValue {
  const ctx = useContext(NewsHunterCtx);
  if (!ctx) throw new Error("useNewsHunter requires NewsHunterProvider");
  return ctx;
}

export function NewsHunterProvider({
  supabase,
  children,
}: {
  supabase: SupabaseClient | null;
  children: React.ReactNode;
}) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [justArrivedUrls, setJustArrivedUrls] = useState<Set<string>>(new Set());
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordsLoaded, setKeywordsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const lastFoundAtRef = useRef<string | null>(null);
  const seenUrlsRef = useRef<Set<string>>(new Set());
  const flashTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Load per-user keyword list; seed defaults on first visit.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await supabase
        .from("news_hunter_keywords")
        .select("keyword")
        .order("keyword");
      if (cancelled) return;
      if (err) {
        setKeywords(FALLBACK_KEYWORDS);
        setKeywordsLoaded(true);
        return;
      }
      if ((data ?? []).length === 0) {
        await supabase.rpc("seed_my_news_hunter_keywords");
        const seeded = await supabase
          .from("news_hunter_keywords")
          .select("keyword")
          .order("keyword");
        if (cancelled) return;
        const rows = (seeded.data ?? []) as { keyword: string }[];
        setKeywords(rows.length > 0 ? rows.map((r) => r.keyword) : FALLBACK_KEYWORDS);
      } else {
        setKeywords((data as { keyword: string }[]).map((r) => r.keyword));
      }
      setKeywordsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const mergeArticles = useCallback(
    (prev: NewsArticle[], incoming: NewsArticle[]): NewsArticle[] => {
      if (incoming.length === 0) return prev;
      const byUrl = new Map(prev.map((a) => [a.url, a]));
      for (const a of incoming) byUrl.set(a.url, a);
      return Array.from(byUrl.values()).sort(
        (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
      );
    },
    [],
  );

  const fetchInitial = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const cutoff = new Date(Date.now() - INITIAL_HOURS * 3600 * 1000).toISOString();
    const { data, error: err } = await supabase
      .from("news_articles")
      .select("*")
      .gte("published_at", cutoff)
      .order("published_at", { ascending: false })
      .limit(PAGE_LIMIT);
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const rows = (data as NewsArticle[]) ?? [];
    setArticles(rows);
    // Watermark on found_at (not published_at) — scanner refreshes found_at on
    // every upsert, so a published_at watermark would miss re-touched articles.
    const newestFoundAt =
      rows.length > 0
        ? rows.reduce((max, r) => (r.found_at > max ? r.found_at : max), rows[0].found_at)
        : null;
    lastFoundAtRef.current = newestFoundAt ?? new Date().toISOString();
    seenUrlsRef.current = new Set(rows.map((r) => r.url));
    setLoading(false);
  }, [supabase]);

  const fetchIncremental = useCallback(async () => {
    if (!supabase || !lastFoundAtRef.current) return;
    const { data, error: err } = await supabase
      .from("news_articles")
      .select("*")
      .gt("found_at", lastFoundAtRef.current)
      .order("found_at", { ascending: false })
      .limit(PAGE_LIMIT);
    if (err) { setError(err.message); return; }
    const rows = (data as NewsArticle[]) ?? [];
    setError(null);
    if (rows.length === 0) return;

    lastFoundAtRef.current = rows.reduce(
      (max, r) => (r.found_at > max ? r.found_at : max),
      lastFoundAtRef.current!,
    );

    const trulyNew = rows.filter((r) => !seenUrlsRef.current.has(r.url));
    if (trulyNew.length > 0) {
      setJustArrivedUrls((prev) => {
        const next = new Set(prev);
        for (const r of trulyNew) {
          next.add(r.url);
          seenUrlsRef.current.add(r.url);
          const existing = flashTimersRef.current.get(r.url);
          if (existing) clearTimeout(existing);
          const timer = setTimeout(() => {
            setJustArrivedUrls((cur) => {
              if (!cur.has(r.url)) return cur;
              const n = new Set(cur);
              n.delete(r.url);
              return n;
            });
            flashTimersRef.current.delete(r.url);
          }, FLASH_DURATION_MS);
          flashTimersRef.current.set(r.url, timer);
        }
        return next;
      });
    }

    setArticles((prev) => mergeArticles(prev, rows));
  }, [supabase, mergeArticles]);

  useEffect(() => {
    if (!keywordsLoaded) return;
    void fetchInitial();
  }, [keywordsLoaded, fetchInitial]);

  useEffect(() => {
    if (!keywordsLoaded) return;
    const id = setInterval(() => void fetchIncremental(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [keywordsLoaded, fetchIncremental]);

  useEffect(() => {
    const timers = flashTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return (
    <NewsHunterCtx.Provider
      value={{ articles, justArrivedUrls, keywords, setKeywords, loading, error }}
    >
      {children}
    </NewsHunterCtx.Provider>
  );
}
