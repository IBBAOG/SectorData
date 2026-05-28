"use client";

// ─── Mobile View — /news-hunter (≤768px) ────────────────────────────────────
//
// Spec: docs/app/news-hunter.md § "Dual-view structure" + § "Mobile tab
// navigation". This file is the long-missing presentation layer for mobile
// news-hunter — until now `page.tsx` mounted <MobileExcludedRedirect />, but
// the shared hook (useNewsHunterData) already exposes the full mobile API
// (`mobileTab`, `topicFilter`, `bookmarkedUrls`, `savedArticles`, etc.), so
// this file is purely presentation.
//
// Layout (top → bottom, the global mobile chrome — MobileTopBar / MobileHomePill
// / MobileKebabMenu / MobileToastHost — is mounted by (dashboard)/layout.tsx;
// this View only renders the content area):
//
//   1. Sticky in-page header        — page title "News Hunter" + scan status
//   2. Sticky 4-tab segmented bar    — Feed / Search / Saved / Settings
//   3. Tab body (one of):
//        Feed     — topic pill row (keywords as filter pills) + virtualized
//                   ArticleCard list. Anon visitors see an AnonCTA above the
//                   list.
//        Search   — search input + virtualized ArticleCard list
//        Saved    — bookmarked-only ArticleCard list (localStorage source)
//        Settings — keyword CRUD (add form with Exact match toggle, chip
//                   list, remove ×). Anon visitors see AnonCTA + a read-only
//                   list of default keywords.
//
// Mobile-only divergences vs desktop/View.tsx (declared per § Dual-view
// policy):
//   • NO export buttons / FAB                — mobile is no-export by design
//   • NO admin clipping flow                  — desktop-only (tagged
//                                               [mobile-only-deferred-clipping])
//   • NO virtualization library (`react-window`) — list is sliced to MAX_VISIBLE
//     entries server-side from the hook's already-sorted output to keep DOM
//     cheap; deeper paging is deferred (mobile feed is monitoring-only).
//   • NO theme toggle                          — mobile is light-only (Mobile
//     reform 2026-05-27).
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes here
// must land in desktop/View.tsx in the SAME commit, OR the commit message
// must declare [mobile-only] with an explicit reason.

import { useCallback } from "react";

import {
  BookmarkIcon,
  CloseIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/dashboard/mobile";
import MobileTabBar from "@/components/dashboard/mobile/MobileTabBar";
import BarrelLoading from "@/components/dashboard/BarrelLoading";

import {
  useNewsHunterData,
  humanizeAge,
  domainColor,
  domainInitial,
  type MobileTab,
} from "../useNewsHunterData";
import type { NewsArticle } from "@/context/NewsHunterContext";

// Cap the number of cards in DOM at any time. The mobile feed is
// monitoring-only; users are not expected to scroll through thousands of
// stories on a phone (export + deep paging is the desktop view's job).
const MAX_VISIBLE = 60;

// ─── AnonCTA — login nudge banner ───────────────────────────────────────────
function AnonCTA({ message }: { message: string }): React.ReactElement {
  return (
    <div
      style={{
        margin: "12px 16px",
        padding: "14px 16px",
        background: "var(--mobile-accent-soft)",
        border: "1px solid var(--mobile-accent-glow)",
        borderRadius: "var(--mobile-radius-lg)",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        lineHeight: 1.5,
        color: "var(--mobile-text)",
      }}
    >
      {message}{" "}
      <a
        href="/login"
        style={{
          color: "var(--mobile-accent)",
          fontWeight: 700,
          textDecoration: "none",
        }}
      >
        Log in
      </a>
    </div>
  );
}

// ─── ArticleCard ────────────────────────────────────────────────────────────
//
// One row in the feed. Tap the card body → opens the article URL in a new
// tab. Tap the bookmark icon → toggles bookmark (handled via onClick guard
// since the icon sits inside the same <a>).

interface ArticleCardProps {
  article: NewsArticle;
  bookmarked: boolean;
  onToggleBookmark: (url: string) => void;
  isNew: boolean;
}

function ArticleCard({
  article,
  bookmarked,
  onToggleBookmark,
  isNew,
}: ArticleCardProps): React.ReactElement {
  const initial = domainInitial(article.domain);
  const color = domainColor(article.domain);
  return (
    <article
      style={{
        padding: "14px 16px",
        background: "var(--mobile-surface)",
        borderBottom: "1px solid var(--mobile-divider)",
        position: "relative",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* "Just arrived" left rail */}
      {isNew && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: "var(--mobile-accent)",
          }}
        />
      )}

      {/* Header row: domain badge + source/time + bookmark */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: color,
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initial}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            color: "var(--mobile-text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <strong
            style={{ color: "var(--mobile-text)", fontWeight: 600 }}
          >
            {article.source_name}
          </strong>
          <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
          <time dateTime={article.published_at}>
            {humanizeAge(article.published_at)}
          </time>
        </span>
        <button
          type="button"
          onClick={() => onToggleBookmark(article.url)}
          aria-label={bookmarked ? "Remove bookmark" : "Save article"}
          aria-pressed={bookmarked}
          style={{
            width: 32,
            height: 32,
            border: 0,
            background: "transparent",
            color: bookmarked
              ? "var(--mobile-accent)"
              : "var(--mobile-text-faint)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <BookmarkIcon
            size={18}
            // Filled when bookmarked — the shared icon is stroke-only, so
            // we toggle the `fill` attribute via style override.
            style={{ fill: bookmarked ? "currentColor" : "none" }}
          />
        </button>
      </div>

      {/* Title — tappable link */}
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: "var(--mobile-text)",
          textDecoration: "none",
          fontSize: 15,
          fontWeight: 600,
          lineHeight: 1.3,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          marginBottom: article.snippet ? 6 : 8,
        }}
      >
        {article.title}
      </a>

      {/* Snippet — 2-line clamp */}
      {article.snippet && (
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 13,
            lineHeight: 1.4,
            color: "var(--mobile-text-muted)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {article.snippet}
        </p>
      )}

      {/* Matched keyword pills */}
      {article.matched_keywords.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          {article.matched_keywords.slice(0, 4).map((kw) => (
            <span
              key={kw}
              style={{
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: "var(--mobile-radius-full)",
                background: "var(--mobile-accent-soft)",
                color: "var(--mobile-accent)",
                fontSize: 10,
                fontWeight: 700,
                textTransform: "lowercase",
                letterSpacing: "0.02em",
              }}
            >
              {kw}
            </span>
          ))}
          {article.matched_keywords.length > 4 && (
            <span
              style={{
                fontSize: 10,
                color: "var(--mobile-text-faint)",
                alignSelf: "center",
                fontWeight: 600,
              }}
            >
              +{article.matched_keywords.length - 4}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

// ─── Topic pill row — keywords as filter pills ──────────────────────────────
function TopicPillRow({
  keywords,
  active,
  onPick,
}: {
  keywords: string[];
  active: string;
  onPick: (kw: string) => void;
}): React.ReactElement {
  const all = ["All", ...keywords];
  return (
    <div
      role="tablist"
      aria-label="Filter by keyword"
      style={{
        display: "flex",
        gap: 8,
        padding: "12px 16px",
        overflowX: "auto",
        overflowY: "hidden",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
        background: "var(--mobile-bg)",
        borderBottom: "1px solid var(--mobile-divider)",
      }}
    >
      {all.map((kw) => {
        const isActive = kw === active;
        return (
          <button
            key={kw}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onPick(kw)}
            style={{
              flex: "0 0 auto",
              padding: "6px 14px",
              minHeight: 32,
              borderRadius: "var(--mobile-radius-full)",
              border: isActive
                ? "1px solid var(--mobile-accent)"
                : "1px solid var(--mobile-divider)",
              background: isActive
                ? "var(--mobile-accent)"
                : "var(--mobile-surface)",
              color: isActive ? "#fff" : "var(--mobile-text)",
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
              cursor: "pointer",
              transition: "background 0.12s ease, color 0.12s ease",
            }}
          >
            {kw}
          </button>
        );
      })}
    </div>
  );
}

// ─── ArticleList — empty/loading/list shell ─────────────────────────────────
function ArticleList({
  articles,
  loading,
  justArrivedUrls,
  bookmarkedUrls,
  onToggleBookmark,
  emptyMessage,
}: {
  articles: NewsArticle[];
  loading: boolean;
  justArrivedUrls: Set<string>;
  bookmarkedUrls: Set<string>;
  onToggleBookmark: (url: string) => void;
  emptyMessage: string;
}): React.ReactElement {
  if (loading && articles.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 16px",
        }}
      >
        <BarrelLoading size={96} bare />
      </div>
    );
  }
  if (articles.length === 0) {
    return (
      <div
        style={{
          padding: "32px 24px",
          textAlign: "center",
          color: "var(--mobile-text-muted)",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        {emptyMessage}
      </div>
    );
  }
  const visible = articles.slice(0, MAX_VISIBLE);
  return (
    <div role="feed" aria-label="News articles">
      {visible.map((article) => (
        <ArticleCard
          key={article.url}
          article={article}
          bookmarked={bookmarkedUrls.has(article.url)}
          onToggleBookmark={onToggleBookmark}
          isNew={justArrivedUrls.has(article.url)}
        />
      ))}
      {articles.length > MAX_VISIBLE && (
        <p
          style={{
            margin: 0,
            padding: "16px 24px 24px",
            textAlign: "center",
            color: "var(--mobile-text-faint)",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 12,
          }}
        >
          Showing the {MAX_VISIBLE} most recent headlines. Refine your
          filters to drill down.
        </p>
      )}
    </div>
  );
}

// ─── SearchBar ──────────────────────────────────────────────────────────────
function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <div
      style={{
        position: "relative",
        margin: "12px 16px",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 12,
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--mobile-text-faint)",
          display: "inline-flex",
        }}
      >
        <SearchIcon size={16} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by title or source"
        aria-label="Search news"
        style={{
          width: "100%",
          minHeight: 44,
          padding: "0 38px 0 38px",
          borderRadius: "var(--mobile-radius-full)",
          border: "1px solid var(--mobile-divider)",
          background: "var(--mobile-surface)",
          color: "var(--mobile-text)",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 14,
          outline: "none",
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            width: 28,
            height: 28,
            border: 0,
            background: "var(--mobile-divider)",
            color: "var(--mobile-text-muted)",
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  );
}

// ─── SettingsPanel — keyword CRUD ───────────────────────────────────────────
function SettingsPanel(): React.ReactElement {
  const {
    keywordEntries,
    readOnly,
    newKeyword,
    setNewKeyword,
    newKeywordMatchType,
    setNewKeywordMatchType,
    addKeyword,
    removeKeyword,
  } = useNewsHunterData();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void addKeyword(newKeyword, newKeywordMatchType);
    },
    [addKeyword, newKeyword, newKeywordMatchType],
  );

  return (
    <div
      style={{
        padding: "0 0 32px",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {readOnly && (
        <AnonCTA message="Log in to add your own keywords. These are the default tracked terms." />
      )}

      <section style={{ padding: "16px 16px 0" }}>
        <h2
          style={{
            margin: "0 0 4px",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--mobile-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {readOnly ? "Default keywords" : "Your keywords"}
        </h2>
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 12,
            color: "var(--mobile-text-faint)",
            lineHeight: 1.45,
          }}
        >
          {readOnly
            ? "These keywords are tracked for all anonymous visitors. Sign in to customize."
            : "Articles must match at least one keyword to appear in your feed."}
        </p>

        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          {keywordEntries.map((entry) => {
            const isExact = entry.match_type === "exact";
            return (
              <li
                key={entry.keyword}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: "var(--mobile-radius-full)",
                  background: isExact
                    ? "var(--mobile-accent-soft)"
                    : "var(--mobile-divider)",
                  color: "var(--mobile-text)",
                  fontSize: 13,
                  fontWeight: 600,
                  border: isExact
                    ? "1px solid var(--mobile-accent-glow)"
                    : "1px solid transparent",
                }}
              >
                <span>{entry.keyword}</span>
                {isExact && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      color: "var(--mobile-accent)",
                      textTransform: "uppercase",
                    }}
                  >
                    EXACT
                  </span>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => void removeKeyword(entry.keyword)}
                    aria-label={`Remove keyword ${entry.keyword}`}
                    style={{
                      width: 20,
                      height: 20,
                      border: 0,
                      background: "transparent",
                      color: "var(--mobile-text-muted)",
                      borderRadius: "50%",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <CloseIcon size={12} strokeWidth={2.5} />
                  </button>
                )}
              </li>
            );
          })}
          {keywordEntries.length === 0 && (
            <li
              style={{
                fontSize: 13,
                color: "var(--mobile-text-faint)",
                fontWeight: 500,
              }}
            >
              No keywords yet.
            </li>
          )}
        </ul>
      </section>

      {!readOnly && (
        <section
          style={{
            padding: "20px 16px 0",
          }}
        >
          <h2
            style={{
              margin: "0 0 12px",
              fontSize: 13,
              fontWeight: 700,
              color: "var(--mobile-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Add keyword
          </h2>
          <form onSubmit={handleSubmit}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="e.g. petroleo"
                aria-label="New keyword"
                style={{
                  flex: 1,
                  minHeight: 44,
                  padding: "0 14px",
                  borderRadius: "var(--mobile-radius-md)",
                  border: "1px solid var(--mobile-divider)",
                  background: "var(--mobile-surface)",
                  color: "var(--mobile-text)",
                  fontFamily: "inherit",
                  fontSize: 14,
                  outline: "none",
                }}
              />
              <button
                type="submit"
                aria-label="Add keyword"
                disabled={!newKeyword.trim()}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  padding: "0 14px",
                  border: 0,
                  borderRadius: "var(--mobile-radius-md)",
                  background: newKeyword.trim()
                    ? "var(--mobile-accent)"
                    : "var(--mobile-divider)",
                  color: newKeyword.trim() ? "#fff" : "var(--mobile-text-faint)",
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: newKeyword.trim() ? "pointer" : "default",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <PlusIcon size={18} strokeWidth={2.5} />
              </button>
            </div>

            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 0",
                fontSize: 13,
                color: "var(--mobile-text)",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={newKeywordMatchType === "exact"}
                onChange={(e) =>
                  setNewKeywordMatchType(
                    e.target.checked ? "exact" : "substring",
                  )
                }
                style={{
                  width: 18,
                  height: 18,
                  accentColor: "var(--mobile-accent)",
                  cursor: "pointer",
                }}
              />
              <span>
                Exact match
                <span
                  style={{
                    display: "block",
                    fontSize: 11,
                    color: "var(--mobile-text-faint)",
                    fontWeight: 400,
                    lineHeight: 1.4,
                    marginTop: 2,
                  }}
                >
                  Match the term only as a standalone word (e.g.{" "}
                  <code>ANS</code> won&apos;t hit <em>transporte</em>).
                </span>
              </span>
            </label>
          </form>
        </section>
      )}
    </div>
  );
}

// ─── MobileView — top-level component ───────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const {
    filteredArticles,
    savedArticles,
    articles,
    justArrivedUrls,
    keywords,
    loading,
    error,
    visible,
    visLoading,
    readOnly,
    searchTerm,
    setSearchTerm,
    topicFilter,
    setTopicFilter,
    bookmarkedUrls,
    toggleBookmark,
    mobileTab,
    setMobileTab,
    lastScanLabel,
  } = useNewsHunterData();

  if (visLoading || !visible) return <></>;

  const tabs: { key: MobileTab; label: string; badge?: number }[] = [
    { key: "feed", label: "Feed" },
    { key: "search", label: "Search" },
    {
      key: "saved",
      label: "Saved",
      badge: savedArticles.length > 0 ? savedArticles.length : undefined,
    },
    { key: "settings", label: "Settings" },
  ];

  const tabItems = tabs.map((t) => ({
    key: t.key,
    label: (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {t.label}
        {t.badge !== undefined && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 9,
              background: "var(--mobile-accent)",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {t.badge}
          </span>
        )}
      </span>
    ),
  }));

  return (
    <div
      style={{
        background: "var(--mobile-bg)",
        minHeight: "calc(100dvh - var(--mobile-topbar-h))",
        paddingBottom: 96,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* In-page header — title + scan status. Sticky just under the global
          MobileTopBar (56px). */}
      <header
        style={{
          position: "sticky",
          top: "var(--mobile-topbar-h)",
          zIndex: 20,
          padding: "14px 16px 10px",
          background: "var(--mobile-glass-bg)",
          WebkitBackdropFilter: "var(--mobile-glass-blur)",
          backdropFilter: "var(--mobile-glass-blur)",
          borderBottom: "1px solid var(--mobile-glass-border)",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: "var(--mobile-accent)",
            letterSpacing: "0.2px",
          }}
        >
          News Hunter
        </h1>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 12,
            color: "var(--mobile-text-muted)",
          }}
        >
          {loading
            ? "Loading headlines…"
            : lastScanLabel || "Scanner runs every ~5 min · refresh every 60s"}
        </p>
      </header>

      {/* Top tab bar — sticky under the in-page header */}
      <div
        style={{
          position: "sticky",
          // Header (paddingY 14+10 + line-height 22*1.2 + 4 + 12 ≈ ~70px).
          // Using a calc keeps it pinned even when the header height changes.
          top: `calc(var(--mobile-topbar-h) + 70px)`,
          zIndex: 19,
          background: "var(--mobile-bg)",
          padding: "8px 16px",
          borderBottom: "1px solid var(--mobile-divider)",
        }}
      >
        <MobileTabBar
          tabs={tabItems}
          activeKey={mobileTab}
          onChange={(k) => setMobileTab(k as MobileTab)}
          variant="container"
          ariaLabel="News Hunter sections"
        />
      </div>

      {/* Error banner (shared across tabs) */}
      {error && (
        <div
          role="alert"
          style={{
            margin: "12px 16px",
            padding: "10px 12px",
            background: "#fff0e6",
            border: "1px solid #ffb38a",
            borderRadius: "var(--mobile-radius-md)",
            color: "#a13d00",
            fontSize: 13,
          }}
        >
          Failed to load articles: {error}
        </div>
      )}

      {/* ── Feed tab ── */}
      {mobileTab === "feed" && (
        <>
          {readOnly && (
            <AnonCTA message="Log in to customize the keywords tracked for you." />
          )}
          {keywords.length > 0 && (
            <TopicPillRow
              keywords={keywords}
              active={topicFilter}
              onPick={setTopicFilter}
            />
          )}
          <ArticleList
            articles={filteredArticles}
            loading={loading}
            justArrivedUrls={justArrivedUrls}
            bookmarkedUrls={bookmarkedUrls}
            onToggleBookmark={toggleBookmark}
            emptyMessage={
              articles.length === 0
                ? "No headlines yet. The scanner runs every ~5 min and new articles will appear here automatically."
                : "No articles match your filters yet."
            }
          />
        </>
      )}

      {/* ── Search tab ── */}
      {mobileTab === "search" && (
        <>
          <SearchBar value={searchTerm} onChange={setSearchTerm} />
          <ArticleList
            articles={filteredArticles}
            loading={loading}
            justArrivedUrls={justArrivedUrls}
            bookmarkedUrls={bookmarkedUrls}
            onToggleBookmark={toggleBookmark}
            emptyMessage={
              searchTerm
                ? `No headlines match "${searchTerm}".`
                : "Type in the search box above to filter by title or source."
            }
          />
        </>
      )}

      {/* ── Saved tab ── */}
      {mobileTab === "saved" && (
        <ArticleList
          articles={savedArticles}
          loading={false}
          justArrivedUrls={justArrivedUrls}
          bookmarkedUrls={bookmarkedUrls}
          onToggleBookmark={toggleBookmark}
          emptyMessage="No saved articles yet. Tap the bookmark icon on any card to save it for later."
        />
      )}

      {/* ── Settings tab ── */}
      {mobileTab === "settings" && <SettingsPanel />}
    </div>
  );
}
