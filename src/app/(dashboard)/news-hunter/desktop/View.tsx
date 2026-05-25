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

import { memo, useCallback, useMemo, useState } from "react";
import { List as VirtualList, type RowComponentProps } from "react-window";
import NavBar from "@/components/NavBar";
import { useUserProfile } from "@/context/UserProfileContext";
import AnonCTA from "@/components/AnonCTA";

import SelectionSidebar from "../_components/SelectionSidebar";
import ClippingModal from "../_components/ClippingModal";
import { useClippingSelection } from "../_hooks/useClippingSelection";
import type { ScrapeResult, ArticleSnapshot } from "@/lib/clipping/types";

import { useNewsHunterData, formatTimeLocal, humanizeAge } from "../useNewsHunterData";
import type { NewsArticle } from "@/context/NewsHunterContext";
import { getSupabaseClient } from "@/lib/supabaseClient";

import styles from "../page.module.css";

// ── Virtualized list constants ───────────────────────────────────────────────
// Desktop rows are single-line (white-space:nowrap + text-overflow:ellipsis),
// so height is fixed: padding-top(6) + line-height(14*1.45≈20) + padding-bottom(6)
// + 1px border = 33px. We cap the list at 600px before it starts scrolling.
const DESKTOP_ITEM_H = 33;
const DESKTOP_MAX_LIST_H = 600;

// ── DesktopArticleRow ────────────────────────────────────────────────────────
// Extracted and memoized so react-window v2 can recycle DOM nodes without
// re-rendering unchanged rows.
// react-window v2 passes rowProps directly into the row component alongside
// the reserved { ariaAttributes, index, style } props.

interface DesktopRowProps {
  articles: NewsArticle[];
  justArrivedUrls: Set<string>;
  isAdmin: boolean;
  selectionMode: boolean;
  isSelected: (url: string) => boolean;
  onToggle: (article: { url: string; title: string; source_name: string; published_at: string }) => void;
}

function _DesktopArticleRowInner({
  index,
  style,
  articles,
  justArrivedUrls,
  isAdmin,
  selectionMode,
  isSelected,
  onToggle,
}: RowComponentProps<DesktopRowProps>): React.ReactElement {
  const a = articles[index];
  const selected = isAdmin && selectionMode && isSelected(a.url);
  return (
    <div
      style={style}
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
          onChange={() => onToggle(a)}
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
    </div>
  );
}
// Cast is required because React.memo returns NamedExoticComponent whose
// return type is ReactNode (superset), but ListProps['rowComponent'] needs
// the narrower ReactElement | null. The runtime behaviour is identical.
const DesktopArticleRow = memo(_DesktopArticleRowInner) as unknown as (
  props: RowComponentProps<DesktopRowProps>,
) => React.ReactElement | null;

// ── VirtualizedDesktopList ───────────────────────────────────────────────────

function VirtualizedDesktopList({
  articles,
  justArrivedUrls,
  isAdmin,
  selectionMode,
  isSelected,
  onToggle,
}: {
  articles: NewsArticle[];
  justArrivedUrls: Set<string>;
  isAdmin: boolean;
  selectionMode: boolean;
  isSelected: (url: string) => boolean;
  onToggle: (article: { url: string; title: string; source_name: string; published_at: string }) => void;
}): React.ReactElement {
  // react-window v2 List sizes itself to fill its container (ResizeObserver).
  // We cap the container at DESKTOP_MAX_LIST_H px; for short lists it shrinks
  // to exactly the content height so there's no trailing whitespace.
  const listHeight = Math.min(articles.length * DESKTOP_ITEM_H, DESKTOP_MAX_LIST_H);
  const rowProps: DesktopRowProps = useMemo(
    () => ({ articles, justArrivedUrls, isAdmin, selectionMode, isSelected, onToggle }),
    [articles, justArrivedUrls, isAdmin, selectionMode, isSelected, onToggle],
  );
  return (
    // key={articles.length} resets scroll to top on filter changes.
    // defaultHeight is the SSR hint; the ResizeObserver overrides it on mount.
    <div
      key={articles.length}
      className={styles.headlines}
      style={{ height: listHeight, width: "100%", overflowY: "auto" }}
    >
      <VirtualList<DesktopRowProps>
        defaultHeight={listHeight}
        rowCount={articles.length}
        rowHeight={DESKTOP_ITEM_H}
        rowProps={rowProps}
        rowComponent={DesktopArticleRow}
      />
    </div>
  );
}

export default function DesktopView(): React.ReactElement {
  const {
    filteredArticles,
    articles,
    justArrivedUrls,
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

        {readOnly && (
          <div className={styles.anonCtaWrap}>
            <AnonCTA
              message="Sign in to personalize your keywords and create your own news feed."
              ctaText="Sign in"
              ctaHref="/login"
            />
          </div>
        )}

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>
              {readOnly ? "Default keywords" : "Keywords"}
            </h3>
          </div>
          <div className={styles.panelBody}>
            <ul className={styles.chips}>
              {keywordEntries.map((entry) => {
                const isExact = entry.match_type === "exact";
                return (
                  <li
                    key={entry.keyword}
                    className={`${styles.chip} ${isExact ? styles.chipExact : ""}`}
                    title={
                      isExact
                        ? "Exact match — only whole-word, case-insensitive."
                        : "Substring match — case-insensitive."
                    }
                  >
                    <span className={styles.chipLabel}>{entry.keyword}</span>
                    {isExact && (
                      <span className={styles.chipBadge} aria-label="Exact match">
                        EXACT
                      </span>
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        className={styles.chipRemove}
                        onClick={() => removeKeyword(entry.keyword)}
                        aria-label={`remove ${entry.keyword}`}
                      >
                        ×
                      </button>
                    )}
                  </li>
                );
              })}
              {keywordEntries.length === 0 && (
                <li className={styles.emptyKw}>
                  No active filter — all headlines are displayed.
                </li>
              )}
            </ul>
            {!readOnly && (
              <>
                <form
                  className={styles.addForm}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addKeyword(newKeyword, newKeywordMatchType);
                  }}
                >
                  <input
                    type="text"
                    className={styles.addInput}
                    placeholder="+ add keyword"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                  />
                  <label
                    className={styles.exactToggle}
                    title="Match only when the term appears as a standalone word (case-insensitive)."
                  >
                    <input
                      type="checkbox"
                      checked={newKeywordMatchType === "exact"}
                      onChange={(e) =>
                        setNewKeywordMatchType(e.target.checked ? "exact" : "substring")
                      }
                    />
                    <span>Exact match</span>
                  </label>
                  <button type="submit" className={styles.addBtn} aria-label="add">+</button>
                </form>
                <p className={styles.helpText}>
                  Default keywords match anywhere in the text. Turn on{" "}
                  <strong>Exact match</strong> to match only as a standalone word
                  (e.g. <code>ANS</code> exact won&apos;t hit <em>tr<strong>ANS</strong>porte</em>).
                </p>
              </>
            )}
            {readOnly && (
              <p className={styles.helpText}>
                These default keywords drive the public feed below. Sign in to
                add or remove your own.
              </p>
            )}
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
            <VirtualizedDesktopList
              articles={filteredArticles}
              justArrivedUrls={justArrivedUrls}
              isAdmin={isAdmin}
              selectionMode={selectionMode}
              isSelected={isSelected}
              onToggle={handleArticleToggle}
            />
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
