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
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";
import { useNewsHunter } from "@/context/NewsHunterContext";
import type {
  KeywordEntry,
  KeywordMatchType,
  NewsArticle,
} from "@/context/NewsHunterContext";

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

/**
 * Returns true if a keyword (with its match_type) hits the text.
 *   - substring: case-insensitive, accent-stripped `.includes()` (legacy)
 *   - exact:     case-insensitive, accent-stripped regex `\b{kw}\b`
 *
 * The keyword and text are normalized identically (lowercased + accent-stripped)
 * so "saúde" and "Saude" both match "Agência Nacional de Saúde Suplementar".
 *
 * Multi-token keywords ("saúde suplementar"): `\b` falls between word characters
 * and non-word characters, so the regex spans the internal space normally.
 * Hyphens in keywords ("pré-sal") are word-character boundaries on both sides;
 * `\b` will match at the keyword edges — but a text containing "pré sal" (no
 * hyphen) will NOT match the keyword "pré-sal" under 'exact', because the
 * normalized escaped pattern still contains the literal `-`. That's the
 * intended semantics: 'exact' means "exactly this token".
 */
export function keywordHits(text: string, kw: string, mode: KeywordMatchType): boolean {
  const haystack = stripAccents(text.toLowerCase());
  const needle = stripAccents(kw.toLowerCase()).trim();
  return keywordHitsNormalized(haystack, needle, mode);
}

/**
 * Variant of keywordHits for pre-normalized haystacks.
 * The haystack must already be lowercased + accent-stripped.
 * Only the keyword (needle) is normalized here.
 */
export function keywordHitsNormalized(normalizedHaystack: string, kw: string, mode: KeywordMatchType): boolean {
  const needle = stripAccents(kw.toLowerCase()).trim();
  if (!needle) return false;
  if (mode === "substring") return normalizedHaystack.includes(needle);
  // Word boundary on both sides. RegExp.escape doesn't exist in older runtimes,
  // so escape inline.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(`\\b${escaped}\\b`, "i").test(normalizedHaystack);
  } catch {
    return normalizedHaystack.includes(needle);
  }
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

// ── Shared filter util ───────────────────────────────────────────────────────

/**
 * Builds a normalized (lowercase + accent-stripped) set from a list of
 * keywords. Used to scope the article feed to the viewer's relevant set
 * (anon → defaults; authed → defaults ∪ own).
 */
export function buildRelevantKeywordSet(keywords: string[]): Set<string> {
  const out = new Set<string>();
  for (const k of keywords) {
    const n = stripAccents(k.toLowerCase()).trim();
    if (n) out.add(n);
  }
  return out;
}

/**
 * Returns the subset of `matchedKeywords` that intersects `relevantSet`
 * (case + accent insensitive). Empty array → article has no tag the viewer
 * cares about; the caller should treat that as "drop this article".
 */
export function displayedTagsFor(
  matchedKeywords: string[],
  relevantSet: Set<string>,
): string[] {
  if (relevantSet.size === 0 || matchedKeywords.length === 0) return [];
  return matchedKeywords.filter((k) =>
    relevantSet.has(stripAccents(k.toLowerCase()).trim()),
  );
}

/**
 * Filters an article list by the viewer's relevant keyword set.
 *
 * Keeps an article ONLY if at least one of its `matched_keywords` (set by the
 * scanner at scan time) is in the viewer's relevant set. This makes the feed
 * private-by-default: a keyword added by another user does NOT pollute this
 * viewer's feed even though `news_articles` is a global table populated by
 * the scanner's UNION across all users' keywords.
 *
 * `relevantSet` MUST be pre-normalized (lowercase + accent-stripped — use
 * `buildRelevantKeywordSet`). Empty `relevantSet` → empty result (default-deny:
 * if the keyword load failed, show nothing rather than everything).
 *
 * Order is preserved from `articles` (the context already sorts
 * `published_at desc` on merge).
 *
 * Consumed by `/home NewsHunterPanel` for the same scope contract as the
 * dashboard's default landing state.
 */
export function filterArticlesByRelevantSet(
  articles: NewsArticle[],
  relevantSet: Set<string>,
): NewsArticle[] {
  if (relevantSet.size === 0) return [];
  return articles.filter((a) =>
    a.matched_keywords.some((k) =>
      relevantSet.has(stripAccents(k.toLowerCase()).trim()),
    ),
  );
}

/**
 * @deprecated content-based filter. Kept temporarily for callers that have
 * not migrated to `filterArticlesByRelevantSet`. New callers should use the
 * tag-based variant — feed scoping is now defined by `matched_keywords ∩
 * relevantSet`, not by substring-against-haystack.
 */
export function filterArticlesByKeywords(
  articles: NewsArticle[],
  keywordEntries: KeywordEntry[],
): NewsArticle[] {
  if (keywordEntries.length === 0) return articles;
  return articles.filter((a) => {
    const haystack = stripAccents(
      `${a.title} ${a.source_name} ${a.snippet} ${a.matched_keywords.join(" ")}`.toLowerCase(),
    );
    return keywordEntries.some((e) =>
      keywordHitsNormalized(haystack, e.keyword, e.match_type),
    );
  });
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseNewsHunterDataReturn {
  // Data from context (polling + watermark live here)
  articles: NewsArticle[];
  justArrivedUrls: Set<string>;
  /** Plain string list — kept for legacy consumers and topic pills. */
  keywords: string[];
  /** Full entries with match_type — preferred for filter logic + UI badges. */
  keywordEntries: KeywordEntry[];
  loading: boolean;
  error: string | null;

  /**
   * True for anonymous visitors (no Supabase session). The Views use this to
   * hide keyword add/remove controls and to render the `AnonCTA` banner.
   * Mutations (`addKeyword`, `removeKeyword`) are no-ops while `readOnly` is
   * true, even if a caller bypasses the UI.
   */
  readOnly: boolean;

  // Visibility guard
  visible: boolean;
  visLoading: boolean;

  // Keyword CRUD
  newKeyword: string;
  setNewKeyword: (v: string) => void;
  /** Match type chosen for the next keyword to be added (form state). */
  newKeywordMatchType: KeywordMatchType;
  setNewKeywordMatchType: (v: KeywordMatchType) => void;
  /** Adds a keyword with the given match_type (defaults to 'substring'). */
  addKeyword: (raw: string, matchType?: KeywordMatchType) => Promise<void>;
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
  /**
   * Articles after relevant-set scoping + search + topicFilter filtering.
   *
   * Scoping rule (privacy):
   *   - Anon  → keep only articles whose `matched_keywords` intersects the
   *             curated defaults (`defaultKeywords` from context).
   *   - Authed → keep only articles whose `matched_keywords` intersects
   *              `defaults ∪ own keywords`.
   *   - Empty relevant set → empty feed (default-deny).
   *
   * This prevents keyword pollution from cross-user scanner aggregation:
   * a keyword added by another user does NOT make their tagged articles
   * leak into this viewer's feed.
   */
  filteredArticles: NewsArticle[];
  /** Articles that are bookmarked (for the Saved tab). */
  savedArticles: NewsArticle[];
  /** Label: "latest headline X ago" */
  lastScanLabel: string;
  /**
   * Returns the subset of an article's `matched_keywords` that the viewer
   * actually tracks (defaults ∪ own keywords, case + accent insensitive).
   * Use this — NOT `article.matched_keywords` directly — when rendering
   * keyword pills, so foreign-user keywords don't leak into the UI.
   */
  visibleTagsFor: (article: NewsArticle) => string[];
}

export function useNewsHunterData(): UseNewsHunterDataReturn {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("news-hunter");
  const supabase = useMemo(() => getSupabaseClient(), []);
  const {
    articles,
    justArrivedUrls,
    keywords,
    keywordEntries,
    defaultKeywords,
    setKeywordEntries,
    loading,
    error,
    readOnly,
  } = useNewsHunter();

  // ── Local state ─────────────────────────────────────────────────────────

  const [newKeyword, setNewKeyword] = useState<string>("");
  const [newKeywordMatchType, setNewKeywordMatchType] = useState<KeywordMatchType>("substring");
  // searchDraft: updated on every keystroke (no lag in the input).
  // deferredSearch: React 19 schedules this update at lower priority,
  // so heavy filter re-renders don't block the input from feeling instant.
  const [searchDraft, setSearchDraft] = useState<string>("");
  const deferredSearch = useDeferredValue(searchDraft);
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
    async (raw: string, matchType: KeywordMatchType = "substring") => {
      // Defense in depth: the UI hides Add controls for anon visitors, but if
      // a caller bypasses the UI the mutation must still no-op (the INSERT
      // would fail at RLS anyway, but we surface a cleaner contract).
      if (readOnly) return;
      const kw = raw.trim();
      if (!kw || !supabase) return;
      const already = keywordEntries.some(
        (e) => e.keyword.toLowerCase() === kw.toLowerCase(),
      );
      setNewKeyword("");
      // Reset the toggle back to the safe default after each add so users don't
      // accidentally create several 'exact' keywords in a row.
      setNewKeywordMatchType("substring");
      if (already) return;
      const { error: insertErr } = await supabase
        .from("news_hunter_keywords")
        .insert({ keyword: kw, match_type: matchType });
      if (!insertErr) {
        setKeywordEntries((prev) =>
          prev.some((e) => e.keyword.toLowerCase() === kw.toLowerCase())
            ? prev
            : [...prev, { keyword: kw, match_type: matchType }],
        );
      }
    },
    [supabase, keywordEntries, setKeywordEntries, readOnly],
  );

  const removeKeyword = useCallback(
    async (kw: string) => {
      // Defense in depth: see comment on addKeyword.
      if (readOnly) return;
      if (!supabase) return;
      const { error: delErr } = await supabase
        .from("news_hunter_keywords")
        .delete()
        .eq("keyword", kw);
      if (!delErr) setKeywordEntries((prev) => prev.filter((e) => e.keyword !== kw));
    },
    [supabase, setKeywordEntries, readOnly],
  );

  // ── Derived ──────────────────────────────────────────────────────────────

  // Relevant keyword set — union of curated defaults and the viewer's own
  // keywords, normalized (lowercase + accent-stripped). The set scopes the
  // feed: anon → defaults only; authed → defaults ∪ own. For matched_keyword
  // strings stored by the scanner with original casing/diacritics, lookup
  // happens against the normalized form on both sides.
  const relevantKeywordSet = useMemo(() => {
    const all: string[] = [];
    for (const k of defaultKeywords) all.push(k);
    for (const e of keywordEntries) all.push(e.keyword);
    return buildRelevantKeywordSet(all);
  }, [defaultKeywords, keywordEntries]);

  // Pre-compute normalized haystacks once per articles change. Reused by the
  // search filter and topic-pill filter below.
  const normalizedHaystacks = useMemo(() => {
    return articles.map((a) => {
      const full = `${a.title} ${a.source_name} ${a.snippet} ${a.matched_keywords.join(" ")}`;
      const titleSource = `${a.title} ${a.source_name}`;
      return {
        full: stripAccents(full.toLowerCase()),
        titleSource: stripAccents(titleSource.toLowerCase()),
      };
    });
  }, [articles]);

  // Pre-compute the normalized matched_keywords for each article so the
  // relevant-set intersection runs in O(matched_keywords) per article without
  // repeated NFD work on every render.
  const normalizedMatchedKeywords = useMemo(() => {
    return articles.map((a) =>
      a.matched_keywords.map((k) => stripAccents(k.toLowerCase()).trim()),
    );
  }, [articles]);

  const filteredArticles = useMemo(() => {
    let indices = Array.from({ length: articles.length }, (_, i) => i);

    // Stage 1 — Relevant-set scoping (privacy / anti-pollution).
    //
    // Keep ONLY articles whose `matched_keywords` intersects the relevant set.
    // This drops articles tagged exclusively with another user's keywords
    // (the scanner aggregates keywords cross-user when populating
    // `news_articles.matched_keywords`, so without this filter a foreign
    // keyword like "ANS" would surface its hits to every viewer).
    //
    // Default-deny: empty relevantKeywordSet → empty feed. This guards
    // against a transient load failure leaking the unscoped table.
    if (relevantKeywordSet.size === 0) {
      return [];
    }
    indices = indices.filter((idx) =>
      normalizedMatchedKeywords[idx].some((k) => relevantKeywordSet.has(k)),
    );

    // Stage 2 — Search filter (consumes useDeferredValue).
    const q = stripAccents(deferredSearch.toLowerCase().trim());
    if (q) {
      indices = indices.filter((idx) =>
        normalizedHaystacks[idx].titleSource.includes(q),
      );
    }

    // Stage 3 — Topic-pill filter (mobile — "All" = no filter).
    // Pills are derived from the user's own keyword labels; we honor the
    // keyword's match_type when filtering against the full haystack.
    if (topicFilter !== "All") {
      const entry = keywordEntries.find(
        (e) => e.keyword.toLowerCase() === topicFilter.toLowerCase(),
      );
      const mode = entry?.match_type ?? "substring";
      indices = indices.filter((idx) =>
        keywordHitsNormalized(normalizedHaystacks[idx].full, topicFilter, mode),
      );
    }

    return indices.map((idx) => articles[idx]);
  }, [
    articles,
    normalizedHaystacks,
    normalizedMatchedKeywords,
    relevantKeywordSet,
    keywordEntries,
    deferredSearch,
    topicFilter,
  ]);

  // visibleTagsFor — returns matched_keywords scoped to the relevant set.
  // Use this instead of article.matched_keywords when rendering pills so
  // foreign-user keywords (e.g. "ANS" from another user) don't leak.
  const visibleTagsFor = useCallback(
    (article: NewsArticle): string[] => {
      if (relevantKeywordSet.size === 0 || article.matched_keywords.length === 0) {
        return [];
      }
      return article.matched_keywords.filter((k) =>
        relevantKeywordSet.has(stripAccents(k.toLowerCase()).trim()),
      );
    },
    [relevantKeywordSet],
  );

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
    keywordEntries,
    loading,
    error,
    readOnly,
    visible,
    visLoading,
    newKeyword,
    setNewKeyword,
    newKeywordMatchType,
    setNewKeywordMatchType,
    addKeyword,
    removeKeyword,
    // Option A: expose draft state under the original public API names so
    // Views don't need to change. The input updates searchDraft (instant);
    // filteredArticles consumes deferredSearch (lower-priority).
    searchTerm: searchDraft,
    setSearchTerm: setSearchDraft,
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
    visibleTagsFor,
  };
}
