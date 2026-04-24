"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import NavBar from "../../../components/NavBar";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";

import styles from "./page.module.css";

type NewsArticle = {
  url: string;
  domain: string;
  source_name: string;
  title: string;
  snippet: string;
  published_at: string;
  found_at: string;
  matched_keywords: string[];
};

const WINDOW_PRESETS = [1, 3, 6, 12, 24, 48, 72, 168] as const;
const POLL_INTERVAL_MS = 30_000;
const AGE_TICK_MS = 15_000;
const PAGE_LIMIT = 500;
const FLASH_DURATION_MS = 3400;
const THEME_STORAGE_KEY = "news-hunter-theme";
const KEYWORDS_STORAGE_KEY = "news-hunter-keywords";

// Mirrors Clipinator's default search keyword list so the UI lands with
// the same filter surface out of the box. Users can add/remove freely.
const DEFAULT_KEYWORDS: string[] = [
  "petróleo",
  "petroleo",
  "Petrobras",
  "Vibra",
  "Brava",
  "Ultrapar",
  "Ipiranga",
  "PetroReconcavo",
  "PetroRecôncavo",
  "oil",
  "gasolina",
  "gás",
  "gas",
  "diesel",
  "combustível",
  "combustivel",
  "combustíveis",
  "combustiveis",
  "OceanPact",
  "Cosan",
  "Raízen",
  "Raizen",
  "Braskem",
  "Compass",
  "PRIO",
  "ANP",
  "refit",
];

function labelForWindow(h: number): string {
  if (h < 24) return `${h}h`;
  if (h === 24) return "24h (1d)";
  if (h === 168) return "7d";
  return `${h}h (${Math.floor(h / 24)}d)`;
}

function humanizeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "agora";
  if (secs < 3600) return `há ${Math.floor(secs / 60)} min`;
  if (secs < 86400) return `há ${Math.floor(secs / 3600)} h`;
  return `há ${Math.floor(secs / 86400)} d`;
}

function formatTimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export default function NewsHunterPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("news-hunter");
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [windowHours, setWindowHours] = useState<number>(24);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordsLoaded, setKeywordsLoaded] = useState<boolean>(false);
  const [newKeyword, setNewKeyword] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [justArrivedUrls, setJustArrivedUrls] = useState<Set<string>>(new Set());
  // Triggers re-render so "há X min" labels stay fresh without re-fetching.
  const [, setAgeTick] = useState(0);

  const lastFoundAtRef = useRef<string | null>(null);
  const seenUrlsRef = useRef<Set<string>>(new Set());
  const flashTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Load persisted theme (or system preference fallback)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "dark" || stored === "light") {
        setTheme(stored);
        return;
      }
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
        setTheme("dark");
      }
    } catch {
      /* ignore — no localStorage available */
    }
  }, []);

  // Load persisted keyword filter list, or fall back to defaults on first use.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEYWORDS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
          setKeywords(parsed as string[]);
          setKeywordsLoaded(true);
          return;
        }
      }
    } catch {
      /* ignore — fall through to defaults */
    }
    setKeywords(DEFAULT_KEYWORDS);
    setKeywordsLoaded(true);
  }, []);

  // Persist keyword list whenever it changes (after the initial load).
  useEffect(() => {
    if (!keywordsLoaded) return;
    try {
      localStorage.setItem(KEYWORDS_STORAGE_KEY, JSON.stringify(keywords));
    } catch {
      /* ignore */
    }
  }, [keywords, keywordsLoaded]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next: "light" | "dark" = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const addKeyword = useCallback((raw: string) => {
    const kw = raw.trim();
    if (!kw) return;
    setKeywords((prev) => {
      const exists = prev.some((k) => k.toLowerCase() === kw.toLowerCase());
      if (exists) return prev;
      return [...prev, kw];
    });
    setNewKeyword("");
  }, []);

  const removeKeyword = useCallback((kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  }, []);

  const restoreDefaultKeywords = useCallback(() => {
    setKeywords(DEFAULT_KEYWORDS);
  }, []);

  const mergeArticles = useCallback(
    (prev: NewsArticle[], incoming: NewsArticle[]): NewsArticle[] => {
      if (incoming.length === 0) return prev;
      const byUrl = new Map(prev.map((a) => [a.url, a]));
      for (const a of incoming) byUrl.set(a.url, a);
      return Array.from(byUrl.values()).sort(
        (a, b) =>
          new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
      );
    },
    [],
  );

  const fetchInitial = useCallback(
    async (hours: number) => {
      if (!supabase) return;
      setLoading(true);
      setError(null);
      const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
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
      setLastUpdate(new Date());
      lastFoundAtRef.current =
        rows.length > 0
          ? rows.reduce((max, r) => (r.found_at > max ? r.found_at : max), rows[0].found_at)
          : new Date().toISOString();
      // Seed seen-set so the initial load doesn't flash as "just arrived".
      seenUrlsRef.current = new Set(rows.map((r) => r.url));
      setLoading(false);
    },
    [supabase],
  );

  const fetchIncremental = useCallback(async () => {
    if (!supabase || !lastFoundAtRef.current) return;
    const { data, error: err } = await supabase
      .from("news_articles")
      .select("*")
      .gt("found_at", lastFoundAtRef.current)
      .order("found_at", { ascending: false })
      .limit(PAGE_LIMIT);
    if (err) {
      setError(err.message);
      return;
    }
    const rows = (data as NewsArticle[]) ?? [];
    setLastUpdate(new Date());
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

    setArticles((prev) => {
      const merged = mergeArticles(prev, rows);
      const cutoff = Date.now() - windowHours * 3600 * 1000;
      return merged.filter((a) => new Date(a.published_at).getTime() >= cutoff);
    });
  }, [supabase, mergeArticles, windowHours]);

  useEffect(() => {
    void fetchInitial(windowHours);
  }, [fetchInitial, windowHours]);

  useEffect(() => {
    const id = setInterval(() => {
      void fetchIncremental();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchIncremental]);

  useEffect(() => {
    const id = setInterval(() => setAgeTick((t) => t + 1), AGE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const timers = flashTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const filtered = useMemo(() => {
    const cutoff = Date.now() - windowHours * 3600 * 1000;
    const inWindow = articles.filter(
      (a) => new Date(a.published_at).getTime() >= cutoff,
    );
    if (keywords.length === 0) return inWindow;
    const terms = keywords
      .map((k) => stripAccents(k.toLowerCase()).trim())
      .filter(Boolean);
    if (terms.length === 0) return inWindow;
    return inWindow.filter((a) => {
      const hay = stripAccents(
        `${a.title} ${a.source_name} ${a.snippet} ${a.matched_keywords.join(" ")}`.toLowerCase(),
      );
      return terms.some((t) => hay.includes(t));
    });
  }, [articles, windowHours, keywords]);

  if (visLoading || !visible) return null;

  const lastScanLabel = lastUpdate
    ? `último scan ${humanizeAge(lastUpdate.toISOString())}`
    : "";

  return (
    <>
      <NavBar />
      <div className={styles.page} data-nh-theme={theme}>
        <div className={styles.topRow}>
          <div className={styles.topLabel}>
            <h1 className={styles.title}>News Hunter</h1>
            <span className={styles.subMuted}>
              {loading ? "⏳ carregando…" : lastScanLabel}
            </span>
          </div>
          <div className={styles.topActions}>
            <label className={styles.windowLabel}>
              Janela:
              <select
                className={styles.windowSelect}
                value={windowHours}
                onChange={(e) => setWindowHours(Number(e.target.value))}
              >
                {WINDOW_PRESETS.map((h) => (
                  <option key={h} value={h}>
                    {labelForWindow(h)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={styles.themeBtn}
              onClick={toggleTheme}
              aria-pressed={theme === "dark"}
            >
              {theme === "dark" ? "Modo claro" : "Modo escuro"}
            </button>
            <span className={styles.autoNote}>auto-refresh: 30s</span>
          </div>
        </div>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Palavras-chave</h3>
            <button
              type="button"
              className={styles.restoreBtn}
              onClick={restoreDefaultKeywords}
              title="Restaurar lista padrão"
            >
              restaurar padrão
            </button>
          </div>
          <div className={styles.panelBody}>
            <ul className={styles.chips}>
              {keywords.map((kw) => (
                <li key={kw} className={styles.chip}>
                  <span className={styles.chipLabel}>{kw}</span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    onClick={() => removeKeyword(kw)}
                    aria-label={`remover ${kw}`}
                  >
                    ×
                  </button>
                </li>
              ))}
              {keywords.length === 0 && (
                <li className={styles.emptyKw}>
                  Nenhum filtro ativo — todas as manchetes são exibidas.
                </li>
              )}
            </ul>
            <form
              className={styles.addForm}
              onSubmit={(e) => {
                e.preventDefault();
                addKeyword(newKeyword);
              }}
            >
              <input
                type="text"
                className={styles.addInput}
                placeholder="+ adicionar palavra-chave"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
              />
              <button type="submit" className={styles.addBtn} aria-label="adicionar">
                +
              </button>
            </form>
          </div>
        </section>

        <section className={styles.headlinesSection}>
          <div className={styles.headlinesMeta}>
            <span className={styles.metaCount}>
              {filtered.length} manchete{filtered.length === 1 ? "" : "s"}
            </span>
            <span className={styles.metaSep}>·</span>
            <span className={styles.metaMuted}>últimas {windowHours}h</span>
            {lastUpdate && (
              <>
                <span className={styles.metaSep}>·</span>
                <span className={styles.metaMuted}>{lastScanLabel}</span>
              </>
            )}
          </div>

          {error && (
            <div className={styles.error}>Erro ao carregar: {error}</div>
          )}

          {!loading && filtered.length === 0 && (
            <div className={styles.empty}>
              <p>
                {articles.length === 0
                  ? "Ainda sem manchetes nesta janela."
                  : "Nenhuma notícia corresponde aos filtros selecionados."}
              </p>
              {articles.length === 0 && (
                <p className={styles.metaMuted}>
                  Verifique se o scanner local está rodando.
                </p>
              )}
            </div>
          )}

          {filtered.length > 0 && (
            <ul className={styles.headlines}>
              {filtered.map((a) => (
                <li
                  key={a.url}
                  className={`${styles.headline} ${
                    justArrivedUrls.has(a.url) ? styles.justArrived : ""
                  }`}
                  data-url={a.url}
                >
                  <span className={styles.htime}>
                    {formatTimeLocal(a.published_at)}
                  </span>
                  <a
                    className={styles.hlink}
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className={styles.hsrc}>{a.source_name}:</span>
                    <span className={styles.htitle}>{a.title}</span>
                  </a>
                  <time className={styles.hage} dateTime={a.published_at}>
                    {humanizeAge(a.published_at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
