"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import NavBar from "../../../components/NavBar";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useNewsHunter } from "../../../context/NewsHunterContext";

import styles from "./page.module.css";

const WINDOW_PRESETS = [1, 3, 6, 12, 24, 48, 72, 168] as const;
const AGE_TICK_MS = 15_000;
const THEME_STORAGE_KEY = "news-hunter-theme";

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
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export default function NewsHunterPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("news-hunter");
  const supabase = useMemo(() => getSupabaseClient(), []);

  // Shared fetch/polling state lives in NewsHunterContext (mounted at layout level).
  const { articles, justArrivedUrls, keywords, setKeywords, loading, error } = useNewsHunter();

  const [windowHours, setWindowHours] = useState<number>(24);
  const [newKeyword, setNewKeyword] = useState<string>("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  // Triggers re-render so "há X min" labels stay fresh without re-fetching.
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

  // "última manchete há X" uses the newest published_at — not found_at, which
  // advances on every scanner re-upsert regardless of actual new content.
  const lastPublishedAt = filtered[0]?.published_at ?? null;
  const lastScanLabel = lastPublishedAt
    ? `última manchete ${humanizeAge(lastPublishedAt)}`
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
                  <option key={h} value={h}>{labelForWindow(h)}</option>
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
            <span
              className={styles.autoNote}
              title="Scanner roda no GitHub Actions a cada ~5 min; o painel revalida a cada 60s."
            >
              scanner ~5 min · refresh 60s
            </span>
          </div>
        </div>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Palavras-chave</h3>
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
              onSubmit={(e) => { e.preventDefault(); addKeyword(newKeyword); }}
            >
              <input
                type="text"
                className={styles.addInput}
                placeholder="+ adicionar palavra-chave"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
              />
              <button type="submit" className={styles.addBtn} aria-label="adicionar">+</button>
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
            {lastPublishedAt && (
              <>
                <span className={styles.metaSep}>·</span>
                <span className={styles.metaMuted}>{lastScanLabel}</span>
              </>
            )}
          </div>

          {error && <div className={styles.error}>Erro ao carregar: {error}</div>}

          {!loading && filtered.length === 0 && (
            <div className={styles.empty}>
              <p>
                {articles.length === 0
                  ? "Ainda sem manchetes nesta janela."
                  : "Nenhuma notícia corresponde aos filtros selecionados."}
              </p>
              {articles.length === 0 && (
                <p className={styles.metaMuted}>
                  O scanner roda no GitHub Actions a cada ~5 min e grava
                  artigos novos no Supabase. Esta página revalida sozinha
                  conforme novas manchetes chegam.
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
