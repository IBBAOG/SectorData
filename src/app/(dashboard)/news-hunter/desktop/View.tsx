"use client";

// Desktop view — /news-hunter (≥769px).
//
// This is the presentation layer for desktop. All data and state live in
// useNewsHunterData (the shared hook). The admin clipping flow is desktop-only
// in this wave — it is NOT ported to mobile/View.tsx.
// [mobile-only-deferred-clipping]
//
// Binding sync rule (CLAUDE.md § Dual-view policy):
//   Any meaningful change here (new filter, new chart, new KPI) must land in
//   mobile/View.tsx in the SAME commit, OR the commit message must declare
//   `[desktop-only]` with an explicit reason.

import { useCallback, useMemo, useState } from "react";
import NavBar from "@/components/NavBar";
import { useUserProfile } from "@/context/UserProfileContext";

import SelectionSidebar from "../_components/SelectionSidebar";
import ClippingModal from "../_components/ClippingModal";
import { useClippingSelection } from "../_hooks/useClippingSelection";
import type { ScrapeResult, ArticleSnapshot } from "@/lib/clipping/types";

import { useNewsHunterData, formatTimeLocal, humanizeAge } from "../useNewsHunterData";
import { getSupabaseClient } from "@/lib/supabaseClient";

import styles from "../page.module.css";

export default function DesktopView(): React.ReactElement {
  const {
    filteredArticles,
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
    theme,
    toggleTheme,
    lastScanLabel,
  } = useNewsHunterData();

  const { profile } = useUserProfile();
  const isAdmin = profile?.role === "Admin";
  const supabase = useMemo(() => getSupabaseClient(), []);

  // ── Admin-only: clipping state ───────────────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  const { selection, isSelected, toggle, remove, clear, moveUp, moveDown } =
    useClippingSelection();
  const [generating, setGenerating] = useState(false);
  const [clippingResults, setClippingResults] = useState<ScrapeResult[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [openGeneration, setOpenGeneration] = useState(0);
  const [regenerating, setRegenerating] = useState(false);

  const runScrape = useCallback(
    async (urls: string[], manualBodies: Record<string, string> = {}) => {
      if (!supabase) return null;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const resp = await fetch("/api/clipping/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ urls, manualBodies }),
      });
      if (!resp.ok) return null;
      const json = (await resp.json()) as { results: ScrapeResult[] };
      return json.results;
    },
    [supabase],
  );

  const handleGenerate = useCallback(async () => {
    if (selection.length === 0) return;
    setGenerating(true);
    try {
      const urls = selection.map((a) => a.url);
      const results = await runScrape(urls);
      if (results) {
        setClippingResults(results);
        setOpenGeneration((g) => g + 1);
        setModalOpen(true);
      }
    } finally {
      setGenerating(false);
    }
  }, [selection, runScrape]);

  const handleRegenerate = useCallback(
    async (manualBodies: Record<string, string>) => {
      if (!clippingResults) return;
      setRegenerating(true);
      try {
        const urls = selection.map((a) => a.url);
        const results = await runScrape(urls, manualBodies);
        if (results) setClippingResults(results);
      } finally {
        setRegenerating(false);
      }
    },
    [clippingResults, selection, runScrape],
  );

  const handleArticleToggle = useCallback(
    (article: { url: string; title: string; source_name: string; published_at: string }) => {
      const snapshot: ArticleSnapshot = {
        url: article.url,
        title: article.title,
        source_name: article.source_name,
        published_at: article.published_at,
      };
      toggle(snapshot);
    },
    [toggle],
  );

  if (visLoading || !visible) return <></>;

  const sidebarWidth = isAdmin && selectionMode ? 280 : 0;

  return (
    <>
      <NavBar />
      <div
        className={styles.page}
        data-nh-theme={theme}
        style={sidebarWidth ? { paddingRight: sidebarWidth } : undefined}
      >
        <div className={styles.topRow}>
          <div className={styles.topLabel}>
            <h1 className={styles.title}>News Hunter</h1>
            <span className={styles.subMuted}>
              {loading ? "⏳ loading…" : lastScanLabel}
            </span>
          </div>
          <div className={styles.topActions}>
            {isAdmin && (
              <button
                type="button"
                className={`${styles.themeBtn} ${selectionMode ? styles.themeBtnActive : ""}`}
                onClick={() => setSelectionMode((v) => !v)}
                aria-pressed={selectionMode}
              >
                {selectionMode ? "Exit Selection Mode" : "Selection Mode"}
              </button>
            )}
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
              onSubmit={(e) => { e.preventDefault(); void addKeyword(newKeyword); }}
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
              {filteredArticles.length} headline{filteredArticles.length === 1 ? "" : "s"}
            </span>
            {filteredArticles[0]?.published_at && (
              <>
                <span className={styles.metaSep}>·</span>
                <span className={styles.metaMuted}>{lastScanLabel}</span>
              </>
            )}
            {isAdmin && selectionMode && selection.length > 0 && (
              <>
                <span className={styles.metaSep}>·</span>
                <span className={styles.metaFilter}>
                  {selection.length} selected
                </span>
              </>
            )}
          </div>

          {error && <div className={styles.error}>Failed to load: {error}</div>}

          {!loading && filteredArticles.length === 0 && (
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

          {filteredArticles.length > 0 && (
            <ul className={styles.headlines}>
              {filteredArticles.map((a) => {
                const selected = isAdmin && selectionMode && isSelected(a.url);
                return (
                  <li
                    key={a.url}
                    className={`${styles.headline} ${
                      justArrivedUrls.has(a.url) ? styles.justArrived : ""
                    } ${selected ? styles.selected : ""}`}
                    data-url={a.url}
                  >
                    {isAdmin && selectionMode && (
                      <input
                        type="checkbox"
                        className={styles.checkbox}
                        checked={selected}
                        onChange={() => handleArticleToggle(a)}
                        aria-label={`Select article: ${a.title}`}
                      />
                    )}
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
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {isAdmin && selectionMode && (
        <SelectionSidebar
          selection={selection}
          onRemove={remove}
          onClear={clear}
          onMoveUp={moveUp}
          onMoveDown={moveDown}
          onGenerate={() => void handleGenerate()}
          generating={generating}
        />
      )}

      {isAdmin && clippingResults && (
        <ClippingModal
          key={openGeneration}
          open={modalOpen}
          results={clippingResults}
          onClose={() => setModalOpen(false)}
          onRegenerate={handleRegenerate}
          regenerating={regenerating}
        />
      )}
    </>
  );
}
