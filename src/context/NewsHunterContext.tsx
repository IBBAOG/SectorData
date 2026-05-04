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
  currentPage: number;
  totalCount: number;
  goToPage: (page: number) => void;
}

const POLL_INTERVAL_MS = 60_000;
const FLASH_DURATION_MS = 3_400;
export const ARTICLES_PER_PAGE = 300;

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
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const lastFoundAtRef = useRef<string | null>(null);
  const seenUrlsRef = useRef<Set<string>>(new Set());
  const flashTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const currentPageRef = useRef(1);

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

  const fetchPage = useCallback(async (page: number) => {
    if (!supabase) return;
    const offset = (page - 1) * ARTICLES_PER_PAGE;
    const { data, error: err } = await supabase
      .from("news_articles")
      .select("*")
      .order("published_at", { ascending: false })
      .range(offset, offset + ARTICLES_PER_PAGE - 1);
    if (err) { setError(err.message); return; }
    const rows = (data as NewsArticle[]) ?? [];
    setArticles(rows);
    setCurrentPage(page);
    currentPageRef.current = page;
    for (const r of rows) seenUrlsRef.current.add(r.url);
  }, [supabase]);

  const goToPage = useCallback((page: number) => {
    setLoading(true);
    setError(null);
    void fetchPage(page).then(() => {
      setLoading(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, [fetchPage]);

  const fetchIncremental = useCallback(async () => {
    if (!supabase || !lastFoundAtRef.current) return;
    const { data, error: err } = await supabase
      .from("news_articles")
      .select("*")
      .gt("found_at", lastFoundAtRef.current)
      .order("found_at", { ascending: false })
      .limit(ARTICLES_PER_PAGE);
    if (err) { setError(err.message); return; }
    const rows = (data as NewsArticle[]) ?? [];
    setError(null);
    if (rows.length === 0) return;

    lastFoundAtRef.current = rows.reduce(
      (max, r) => (r.found_at > max ? r.found_at : max),
      lastFoundAtRef.current!,
    );

    const trulyNew = rows.filter((r) => !seenUrlsRef.current.has(r.url));
    if (trulyNew.length === 0) return;

    setTotalCount((prev) => prev + trulyNew.length);

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

    // Only prepend to display when on page 1 — avoids inserting articles
    // into the middle of historical pages while the user is browsing them.
    if (currentPageRef.current === 1) {
      setArticles((prev) => {
        const existingUrls = new Set(prev.map((a) => a.url));
        const toAdd = trulyNew.filter((r) => !existingUrls.has(r.url));
        if (toAdd.length === 0) return prev;
        return [...toAdd, ...prev].sort(
          (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
        );
      });
    }
  }, [supabase]);

  useEffect(() => {
    if (!keywordsLoaded || !supabase) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      await Promise.all([
        fetchPage(1),
        (async () => {
          const { count } = await supabase
            .from("news_articles")
            .select("*", { count: "exact", head: true });
          if (!cancelled) setTotalCount(count ?? 0);
        })(),
        (async () => {
          const { data } = await supabase
            .from("news_articles")
            .select("found_at")
            .order("found_at", { ascending: false })
            .limit(1);
          if (!cancelled) {
            lastFoundAtRef.current =
              (data as { found_at: string }[] | null)?.[0]?.found_at
              ?? new Date().toISOString();
          }
        })(),
      ]);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [keywordsLoaded, supabase, fetchPage]);

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
      value={{
        articles, justArrivedUrls, keywords, setKeywords,
        loading, error, currentPage, totalCount, goToPage,
      }}
    >
      {children}
    </NewsHunterCtx.Provider>
  );
}
