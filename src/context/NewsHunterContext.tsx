"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { rpcGetDefaultNewsKeywords } from "../lib/rpc";

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

/**
 * How a keyword should match article text.
 *   'substring' — case-insensitive substring (default; legacy behaviour).
 *   'exact'     — case-insensitive whole-word, regex `\b{keyword}\b`.
 *
 * Stored in `news_hunter_keywords.match_type` (text enum). The scanner reads
 * the column to route matching; the frontend uses it for local filtering.
 */
export type KeywordMatchType = "substring" | "exact";

export type KeywordEntry = {
  keyword: string;
  match_type: KeywordMatchType;
};

interface NewsHunterContextValue {
  articles: NewsArticle[];
  justArrivedUrls: Set<string>;
  /** Plain string list — used by legacy consumers and topic pills. */
  keywords: string[];
  /** Full entries with match_type — preferred for filtering / UI badges. */
  keywordEntries: KeywordEntry[];
  /**
   * Curated default keyword set (from `news_hunter_default_keywords` via
   * `get_default_news_keywords()`). Loaded for BOTH anon and authenticated
   * viewers — for anon this is also what `keywordEntries` holds; for authed
   * users this is separate from their per-user list and is used by the
   * dashboard to scope the feed (relevant set = defaults ∪ own keywords).
   *
   * Without this scoping, articles tagged by the scanner with another user's
   * keyword (the scanner aggregates keywords cross-user) would leak into
   * everyone's feed. See docs/app/news-hunter.md § "Feed scoping".
   */
  defaultKeywords: string[];
  setKeywords: React.Dispatch<React.SetStateAction<string[]>>;
  setKeywordEntries: React.Dispatch<React.SetStateAction<KeywordEntry[]>>;
  loading: boolean;
  error: string | null;
  /**
   * True when the current viewer has no Supabase session. In this mode the
   * keyword set is loaded from the curated default list (RPC
   * `get_default_news_keywords`) rather than the per-user table, and keyword
   * mutations should be a no-op (the UI hides Add/Remove controls).
   */
  readOnly: boolean;
}

const POLL_INTERVAL_MS = 60_000;
const FLASH_DURATION_MS = 3_400;
const PAGE_SIZE = 1000; // Supabase PostgREST max per request

// ── Local cache (IndexedDB) ───────────────────────────────────────────────────
//
// Historical articles are effectively static, so we persist them locally and
// only fetch rows newer than the stored watermark on each visit.
//
// Why IndexedDB (not localStorage): the feed already holds ~16,700 rows and
// grows ~491/day. Serializing the full set as JSON overflows the localStorage
// ~5 MB quota; the old implementation swallowed the QuotaExceededError, which
// froze the cache (and therefore the watermark) at the last save that fit —
// weeks in the past — silently widening the fetch gap forever. IndexedDB has
// no practical size limit, so we can persist the COMPLETE history and keep the
// watermark advancing. We store everything in a single record (one object
// store, one key) to keep the wrapper tiny — there is no per-row query need.
//
// The bump from v1 → v2 in the names also invalidates the stale, possibly
// truncated localStorage cache written by the previous implementation.
const DB_NAME = "nh_cache";
const DB_VERSION = 1;
const STORE_NAME = "feed";
// Bumped v2 → v3 to invalidate caches corrupted by the fetchIncremental
// snapshot bug (cacheSave was persisting only the current tick's delta because
// the setArticles functional updater runs asynchronously). Every client does
// one clean full reload on first load after this bump.
const CACHE_RECORD_KEY = "articles_v3";

// Legacy localStorage keys (pre-IndexedDB). Removed on first load so the old,
// quota-overflowing blob stops occupying space. See migration in cacheLoad().
const LEGACY_CACHE_KEY = "nh_articles_v1";
const LEGACY_WATERMARK_KEY = "nh_watermark_v1";

type CacheRecord = { articles: NewsArticle[]; watermark: string };

let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * Opens (and memoizes) the IndexedDB connection. Resolves to null when
 * IndexedDB is unavailable (SSR, private-mode quirks, very old browsers) so
 * callers can degrade gracefully — a null DB simply means "no local cache",
 * which the always-paginating fetch logic handles by doing a full reload.
 */
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function cacheLoad(): Promise<{
  articles: NewsArticle[];
  watermark: string | null;
}> {
  // One-time cleanup of the legacy localStorage cache (best-effort).
  try {
    localStorage.removeItem(LEGACY_CACHE_KEY);
    localStorage.removeItem(LEGACY_WATERMARK_KEY);
  } catch {
    /* no localStorage — ignore */
  }

  const db = await openDb();
  if (!db) return { articles: [], watermark: null };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(CACHE_RECORD_KEY);
      req.onsuccess = () => {
        const rec = req.result as CacheRecord | undefined;
        if (rec && Array.isArray(rec.articles) && typeof rec.watermark === "string") {
          resolve({ articles: rec.articles, watermark: rec.watermark });
        } else {
          resolve({ articles: [], watermark: null });
        }
      };
      req.onerror = () => resolve({ articles: [], watermark: null });
    } catch {
      resolve({ articles: [], watermark: null });
    }
  });
}

async function cacheSave(articles: NewsArticle[], watermark: string): Promise<void> {
  const db = await openDb();
  if (!db) return; // No cache backend — Fix #1's always-paginate path re-fetches the gap next visit.
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.oncomplete = () => resolve();
      // IndexedDB has no practical quota for this payload size, but never let a
      // write error freeze the caller — on failure we simply skip persisting
      // this round; the gap is re-paginated on the next load (Fix #1).
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
      const rec: CacheRecord = { articles, watermark };
      tx.objectStore(STORE_NAME).put(rec, CACHE_RECORD_KEY);
    } catch {
      resolve();
    }
  });
}

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
  const [keywordEntries, setKeywordEntries] = useState<KeywordEntry[]>([]);
  // Curated default keyword list (mirror of news_hunter_default_keywords).
  // Loaded for both anon and authenticated users so the dashboard can compute
  // the relevant feed scope: anon → defaults; authed → defaults ∪ own.
  const [defaultKeywords, setDefaultKeywords] = useState<string[]>([]);
  const [keywordsLoaded, setKeywordsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // True when there is no Supabase session — the dashboard is rendered for an
  // anonymous visitor. Determined once during keyword bootstrap and stable for
  // the lifetime of the provider (anon → signed-in transitions force a full
  // page reload anyway via the login route).
  const [readOnly, setReadOnly] = useState(false);

  // Derived string-only list — kept for legacy consumers (topic pills, etc.).
  const keywords = useMemo(() => keywordEntries.map((e) => e.keyword), [keywordEntries]);

  // Adapter so callers using the old setKeywords(string[]) signature still work
  // (treats every keyword as 'substring' — caller should switch to setKeywordEntries
  // when it needs match_type-aware updates).
  const setKeywords: React.Dispatch<React.SetStateAction<string[]>> = useCallback((updater) => {
    setKeywordEntries((prev) => {
      const prevList = prev.map((e) => e.keyword);
      const nextList = typeof updater === "function" ? updater(prevList) : updater;
      const prevByKw = new Map(prev.map((e) => [e.keyword, e]));
      return nextList.map((kw) => prevByKw.get(kw) ?? { keyword: kw, match_type: "substring" as const });
    });
  }, []);

  // Synchronous mirror of the `articles` state. The setArticles functional
  // updater does NOT run synchronously (React applies it on the next render),
  // so it cannot be used as the source of truth for merging/caching inside the
  // same async tick. articlesRef is updated alongside every setArticles call
  // and read by fetchIncremental to build the snapshot persisted to IndexedDB.
  const articlesRef = useRef<NewsArticle[]>([]);
  const lastFoundAtRef = useRef<string | null>(null);
  const seenUrlsRef = useRef<Set<string>>(new Set());
  const flashTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Load the keyword list. Two paths:
  //
  //   - Authenticated  → select rows from `news_hunter_keywords` filtered by
  //                      auth.uid() (RLS). Seed defaults on the first visit
  //                      via `seed_my_news_hunter_keywords()`.
  //   - Anonymous      → call `get_default_news_keywords()` (anon-grantable
  //                      SECURITY DEFINER RPC) which returns the curated
  //                      default list. Skip the per-user table and the seed
  //                      RPC entirely — both require auth.uid.
  //
  // Always selects `match_type` alongside `keyword` so the filter logic and
  // UI badges can distinguish substring vs exact (whole-word) matching. Anon
  // defaults are always `substring`.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const fallbackEntries: KeywordEntry[] = FALLBACK_KEYWORDS.map((k) => ({
      keyword: k,
      match_type: "substring",
    }));
    void (async () => {
      // Detect anon vs authenticated before any query — the per-user table
      // returns 0 rows for anon (RLS), which is indistinguishable from a
      // brand-new authed user. Branching on session up front keeps the two
      // paths cleanly separated.
      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      const isAnon = !sessionData.session;
      setReadOnly(isAnon);

      // Load curated defaults for BOTH anon and authenticated users. For anon
      // these double as the keyword entries; for authed users they're kept
      // separate from per-user keywords and used by the dashboard to compute
      // the relevant feed scope (defaults ∪ own).
      //
      // We do this in parallel with the per-user fetch (authed path) to avoid
      // serializing two round trips on first load.
      const defaultsPromise = rpcGetDefaultNewsKeywords(supabase);

      if (isAnon) {
        // Anon path: defaults from RPC; fall back to hardcoded list on failure.
        const defaults = await defaultsPromise;
        if (cancelled) return;
        const effective = defaults.length > 0 ? defaults : FALLBACK_KEYWORDS;
        setDefaultKeywords(effective);
        const entries: KeywordEntry[] = effective.map((k) => ({
          keyword: k,
          match_type: "substring" as const,
        }));
        setKeywordEntries(entries);
        setKeywordsLoaded(true);
        return;
      }

      // Authenticated path.
      const [{ data, error: err }, defaults] = await Promise.all([
        supabase.from("news_hunter_keywords").select("keyword, match_type").order("keyword"),
        defaultsPromise,
      ]);
      if (cancelled) return;
      // Store defaults regardless of per-user fetch outcome — the dashboard
      // needs them to scope the feed (anon-equivalent baseline coverage).
      setDefaultKeywords(defaults.length > 0 ? defaults : FALLBACK_KEYWORDS);
      if (err) {
        setKeywordEntries(fallbackEntries);
        setKeywordsLoaded(true);
        return;
      }
      const toEntry = (r: { keyword: string; match_type?: string | null }): KeywordEntry => ({
        keyword: r.keyword,
        match_type: r.match_type === "exact" ? "exact" : "substring",
      });
      if ((data ?? []).length === 0) {
        await supabase.rpc("seed_my_news_hunter_keywords");
        const seeded = await supabase
          .from("news_hunter_keywords")
          .select("keyword, match_type")
          .order("keyword");
        if (cancelled) return;
        const rows = (seeded.data ?? []) as { keyword: string; match_type?: string | null }[];
        setKeywordEntries(rows.length > 0 ? rows.map(toEntry) : fallbackEntries);
      } else {
        setKeywordEntries((data as { keyword: string; match_type?: string | null }[]).map(toEntry));
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

    // 1. Load the local cache immediately — history shows with no request.
    const { articles: cached, watermark: cachedWatermark } = await cacheLoad();
    if (cached.length > 0) {
      articlesRef.current = cached;
      setArticles(cached);
      seenUrlsRef.current = new Set(cached.map((r) => r.url));
    }

    if (cachedWatermark && cached.length > 0) {
      // 2a. Cache exists: fetch ONLY rows newer than the watermark — but
      // paginate to exhaustion. The previous implementation capped this at a
      // single PAGE_SIZE page, so whenever more than PAGE_SIZE articles had
      // been ingested since the watermark (~every 2 days), the middle rows
      // fell into a hole: not in the old cache and beyond the single page, so
      // they never reached the browser. We now loop until a short page.
      //
      // We page with .range() ordered by `found_at DESC` rather than a
      // `found_at > cursor` keyset. A single scan writes many rows with an
      // IDENTICAL found_at (e.g. 2026-06-02T21:35:43.088307+00:00), so a naive
      // `gt(cursor)` keyset would SKIP rows tied with the cursor. Offset
      // paging cannot skip ties; combined with mergeArticles' url-dedup,
      // overlap across pages is harmless. We keep the `> cachedWatermark`
      // server-side filter constant across all pages so the result window is
      // stable while we walk it.
      //
      // Initialize the watermark immediately so polling works even if the
      // query below fails on a transient error (without this the ref stays
      // null forever).
      lastFoundAtRef.current = cachedWatermark;
      const newRows: NewsArticle[] = [];
      let offset = 0;
      for (;;) {
        const { data, error: err } = await supabase
          .from("news_articles")
          .select("*")
          .gt("found_at", cachedWatermark)
          .order("found_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (err) { setError(err.message); setLoading(false); return; }
        const rows = (data as NewsArticle[]) ?? [];
        if (rows.length === 0) break;
        for (const r of rows) newRows.push(r);
        if (rows.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      const merged = mergeArticles(cached, newRows);
      const newWatermark = merged.reduce(
        (max, r) => (r.found_at > max ? r.found_at : max), cachedWatermark,
      );
      articlesRef.current = merged;
      setArticles(merged);
      seenUrlsRef.current = new Set(merged.map((r) => r.url));
      lastFoundAtRef.current = newWatermark;
      await cacheSave(merged, newWatermark);
    } else {
      // 2b. No cache: fetch the full history by paging (first visit only).
      const allRows: NewsArticle[] = [];
      let offset = 0;
      for (;;) {
        const { data, error: err } = await supabase
          .from("news_articles")
          .select("*")
          .order("published_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (err) { setError(err.message); setLoading(false); return; }
        const rows = (data as NewsArticle[]) ?? [];
        if (rows.length === 0) break;
        for (const r of rows) {
          allRows.push(r);
          // Update watermark incrementally so polling works even if we break
          // mid-pagination due to a transient error on a subsequent page.
          if (!lastFoundAtRef.current || r.found_at > lastFoundAtRef.current) {
            lastFoundAtRef.current = r.found_at;
          }
        }
        setArticles((prev) => mergeArticles(prev, rows));
        if (rows.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      const watermark = allRows.length > 0
        ? allRows.reduce((max, r) => (r.found_at > max ? r.found_at : max), allRows[0].found_at)
        : new Date().toISOString();
      lastFoundAtRef.current = watermark;
      articlesRef.current = allRows;
      seenUrlsRef.current = new Set(allRows.map((r) => r.url));
      await cacheSave(allRows, watermark);
    }

    setLoading(false);
  }, [supabase, mergeArticles]);

  const fetchIncremental = useCallback(async () => {
    if (!supabase || !lastFoundAtRef.current) return;
    // Hold the watermark constant while paging so the server-side window is
    // stable as we walk it (we advance lastFoundAtRef only after draining).
    const startWatermark = lastFoundAtRef.current;
    const rows: NewsArticle[] = [];
    let offset = 0;
    for (;;) {
      const { data, error: err } = await supabase
        .from("news_articles")
        .select("*")
        .gt("found_at", startWatermark)
        .order("found_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (err) { setError(err.message); return; }
      const batch = (data as NewsArticle[]) ?? [];
      if (batch.length === 0) break;
      for (const r of batch) rows.push(r);
      // If a tick returns a FULL page, keep paging until a short page — a tab
      // resuming from background suspension can have >PAGE_SIZE rows queued,
      // and stopping at one page would re-open the same data-loss hole as
      // fetchInitial. Offset paging + url-dedup tolerates found_at ties.
      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    setError(null);
    if (rows.length === 0) return;

    lastFoundAtRef.current = rows.reduce(
      (max, r) => (r.found_at > max ? r.found_at : max),
      startWatermark,
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

    // Merge against the synchronous articlesRef snapshot (NOT a functional
    // setArticles updater — that runs on the next render, so reading its result
    // here would yield only the current tick's delta and overwrite the cache
    // with a tiny handful of rows on every poll). articlesRef.current always
    // mirrors the full article set, so the merged snapshot is complete.
    const merged = mergeArticles(articlesRef.current, rows);
    articlesRef.current = merged;
    setArticles(merged);
    await cacheSave(merged, lastFoundAtRef.current!);
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
      value={{
        articles,
        justArrivedUrls,
        keywords,
        keywordEntries,
        defaultKeywords,
        setKeywords,
        setKeywordEntries,
        loading,
        error,
        readOnly,
      }}
    >
      {children}
    </NewsHunterCtx.Provider>
  );
}
