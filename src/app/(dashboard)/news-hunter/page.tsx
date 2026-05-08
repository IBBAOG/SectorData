"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import NavBar from "../../../components/NavBar";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useNewsHunter } from "../../../context/NewsHunterContext";

import styles from "./page.module.css";

const AGE_TICK_MS = 15_000;
const THEME_STORAGE_KEY = "news-hunter-theme";

function humanizeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  return `${Math.floor(secs / 86400)} d ago`;
}

function formatTimeLocal(iso: string): string {
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

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}


export default function NewsHunterPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("news-hunter");
  const supabase = useMemo(() => getSupabaseClient(), []);

  // Shared fetch/polling state lives in NewsHunterContext (mounted at layout level).
  const { articles, justArrivedUrls, keywords, setKeywords, loading, error } = useNewsHunter();

  const [newKeyword, setNewKeyword] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  // Triggers re-render so "X min ago" labels stay fresh without re-fetching.
  const [, setAgeTick] = useState(0);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "dark" || stored === "light") { setTheme(stored); return; }
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) setTheme("dark");
    } catch { /* no localStorage */ }
  }, []);

  useEffect(() => {
    const id = setInterval(() => setAgeTick((t) => t + 1), AGE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next: "light" | "dark" = t === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* ignore */ }
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

  const filtered = useMemo(() => {
    let result = articles;
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
    const q = stripAccents(searchTerm.toLowerCase().trim());
    if (q) {
      result = result.filter((a) => {
        const hay = stripAccents(`${a.title} ${a.source_name}`.toLowerCase());
        return hay.includes(q);
      });
    }
    return result;
  }, [articles, keywords, searchTerm]);

  if (visLoading || !visible) return null;

  // "latest headline X ago" uses the newest published_at — not found_at, which
  // advances on every scanner re-upsert regardless of actual new content.
  const lastPublishedAt = filtered[0]?.published_at ?? null;
  const lastScanLabel = lastPublishedAt
    ? `latest headline ${humanizeAge(lastPublishedAt)}`
    : "";

  return (
    <>
      <NavBar />
      <div className={styles.page} data-nh-theme={theme}>
        <div className={styles.topRow}>
          <div className={styles.topLabel}>
            <h1 className={styles.title}>News Hunter</h1>
            <span className={styles.subMuted}>
              {loading ? "⏳ loading…" : lastScanLabel}
            </span>
          </div>
          <div className={styles.topActions}>
            <button
              type="button"
              className={styles.themeBtn}
              onClick={toggleTheme}
              aria-pressed={theme === "dark"}
            >
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <span
              className={styles.autoNote}
              title="Scanner runs on GitHub Actions every ~5 min; the panel revalidates every 60s."
            >
              scanner ~5 min · refresh 60s
            </span>
          </div>
        </div>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Keywords</h3>
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
                    aria-label={`remove ${kw}`}
                  >
                    ×
                  </button>
                </li>
              ))}
              {keywords.length === 0 && (
                <li className={styles.emptyKw}>
                  No active filter — all headlines are displayed.
                </li>
              )}
            </ul>
            <form
              className={styles.addForm}
              onSubmit={(e) => { e.preventDefault(); addKeyword(newKeyword); }}
            >
              <input
                type="text"
                className={styles.addInput}
                placeholder="+ add keyword"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
              />
              <button type="submit" className={styles.addBtn} aria-label="add">+</button>
            </form>
          </div>
        </section>

        <div className={styles.searchBar}>
          <div className={styles.searchWrap}>
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search by title or source…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search news"
            />
            {searchTerm && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => setSearchTerm("")}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <section className={styles.headlinesSection}>
          <div className={styles.headlinesMeta}>
            <span className={styles.metaCount}>
              {filtered.length} headline{filtered.length === 1 ? "" : "s"}
            </span>
            {lastPublishedAt && (
              <>
                <span className={styles.metaSep}>·</span>
                <span className={styles.metaMuted}>{lastScanLabel}</span>
              </>
            )}
          </div>

          {error && <div className={styles.error}>Failed to load: {error}</div>}

          {!loading && filtered.length === 0 && (
            <div className={styles.empty}>
              <p>
                {articles.length === 0
                  ? "No headlines yet."
                  : "No news matches the selected filters."}
              </p>
              {articles.length === 0 && (
                <p className={styles.metaMuted}>
                  The scanner runs on GitHub Actions every ~5 min and writes
                  new articles to Supabase. This page revalidates itself as
                  new headlines arrive.
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
                  <span className={styles.htime}>{formatTimeLocal(a.published_at)}</span>
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
