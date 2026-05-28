"use client";

// ─── Mobile View — /news-hunter (≤768px) ────────────────────────────────────
//
// Spec: docs/app/news-hunter.md § "Mobile single-page feed (2026-05-28)".
//
// Mobile is a single-page feed — no tabs, no search input, no saved/bookmark
// surface, no settings/keyword CRUD. Users land directly on the feed; the only
// in-view interaction is the horizontal chip row, which filters the feed
// in-place by substring match across title + snippet + matched_keywords.
//
// Layout (top → bottom, the global mobile chrome — MobileTopBar / MobileHomePill
// / MobileKebabMenu / MobileToastHost — is mounted by (dashboard)/layout.tsx;
// this View only renders the content area):
//
//   1. Sticky in-page header        — page title "News Hunter" + scan status
//   2. AnonCTA (anon visitors only) — login nudge
//   3. Quick-search chip row         — 14 curated chips (All + 14 named).
//                                      Tapping a chip applies that filter
//                                      in-place; tapping the active chip clears
//                                      it. Padrão: nenhum chip selecionado = All.
//   4. ArticleList                   — sliced to MAX_VISIBLE most recent.
//
// Mobile-only divergences vs desktop/View.tsx (declared per § Dual-view policy):
//   • NO tab navigation          — single-page feed
//   • NO search input            — chip filtering only
//   • NO bookmark / Saved tab    — feature removed on mobile
//   • NO keyword CRUD            — read keywords from hook; CRUD desktop-only
//   • NO export buttons / FAB    — mobile is no-export by design
//   • NO virtualization library  — list is sliced to MAX_VISIBLE for cheap DOM
//   • NO theme toggle             — mobile is light-only (Mobile reform
//                                    2026-05-27).
//
// Binding sync rule (CLAUDE.md § Dual-view policy): this commit is tagged
// [mobile-only] — the simplification was a product decision specifically for
// mobile; desktop retains the full feature set (search, saved, settings).

import { useMemo, useState } from "react";

import BarrelLoading from "@/components/dashboard/BarrelLoading";

import {
  useNewsHunterData,
  humanizeAge,
  domainColor,
  domainInitial,
  stripAccents,
} from "../useNewsHunterData";
import type { NewsArticle } from "@/context/NewsHunterContext";

// Cap the number of cards in DOM at any time. The mobile feed is
// monitoring-only; users are not expected to scroll through thousands of
// stories on a phone (export + deep paging is the desktop view's job).
const MAX_VISIBLE = 60;

// ── Quick-search chip constants ──────────────────────────────────────────────
// Mirrors QUICK_SEARCH_CHIPS in desktop/View.tsx for terminology parity, but on
// mobile the chips filter the feed in-place (no separate Search surface).
const QUICK_SEARCH_CHIPS = [
  "Petrobras",
  "PRIO",
  "Vibra",
  "Ultrapar",
  "Cosan",
  "Petróleo",
  "Gasolina",
  "Diesel",
  "PetroReconcavo",
  "Braskem",
  "Brava",
  "Raízen",
  "Compass",
  "OceanPact",
] as const;

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
// One row in the feed. Tap anywhere on the card → opens the article URL in a
// new tab. No bookmark icon on mobile.

interface ArticleCardProps {
  article: NewsArticle;
  isNew: boolean;
  /**
   * Tags to render on the card — already scoped to the viewer's relevant
   * keyword set (defaults ∪ own for authed; defaults for anon). Pass an empty
   * array to omit the tag row. Use `visibleTagsFor(article)` from the hook
   * rather than `article.matched_keywords` directly, otherwise foreign-user
   * keywords (e.g. "ANS" from another user) leak into the UI.
   */
  visibleTags: string[];
}

function ArticleCard({
  article,
  isNew,
  visibleTags,
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

      {/* Header row: domain badge + source/time */}
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

      {/* Matched keyword pills — scoped to the viewer's relevant set, so a
          keyword added by another user (e.g. "ANS") never appears here. */}
      {visibleTags.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          {visibleTags.slice(0, 4).map((kw) => (
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
          {visibleTags.length > 4 && (
            <span
              style={{
                fontSize: 10,
                color: "var(--mobile-text-faint)",
                alignSelf: "center",
                fontWeight: 600,
              }}
            >
              +{visibleTags.length - 4}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

// ─── Quick-search chip row — feed-filter version ────────────────────────────
//
// On mobile the chip row filters the feed in-place. Tapping a chip selects it
// (background brand orange); tapping the active chip clears the filter. No
// chip selected ≡ "All".
function QuickSearchChipRow({
  active,
  onPick,
}: {
  active: string | null;
  onPick: (term: string | null) => void;
}): React.ReactElement {
  return (
    <div
      role="group"
      aria-label="Quick filter chips"
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
      {QUICK_SEARCH_CHIPS.map((term) => {
        const isActive = active?.toLowerCase() === term.toLowerCase();
        return (
          <button
            key={term}
            type="button"
            onClick={() => onPick(isActive ? null : term)}
            aria-label={
              isActive ? `Clear filter: ${term}` : `Filter by: ${term}`
            }
            aria-pressed={isActive}
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
            {term}
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
  emptyMessage,
  visibleTagsFor,
}: {
  articles: NewsArticle[];
  loading: boolean;
  justArrivedUrls: Set<string>;
  emptyMessage: string;
  /** See ArticleCardProps.visibleTags — scopes tag pills to the viewer. */
  visibleTagsFor: (article: NewsArticle) => string[];
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
          isNew={justArrivedUrls.has(article.url)}
          visibleTags={visibleTagsFor(article)}
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
          Showing the {MAX_VISIBLE} most recent headlines. Pick a chip above to
          drill down.
        </p>
      )}
    </div>
  );
}

// ─── MobileView — top-level component ───────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const {
    filteredArticles,
    articles,
    justArrivedUrls,
    loading,
    error,
    visible,
    visLoading,
    readOnly,
    lastScanLabel,
    visibleTagsFor,
  } = useNewsHunterData();

  // Local-to-mobile chip filter state. `null` ≡ "All" (no chip filter applied).
  const [chipFilter, setChipFilter] = useState<string | null>(null);

  // Apply the chip filter on top of the hook's already-filtered list. Substring
  // match (case + accent insensitive) against title + snippet + the visible
  // (already-scoped) tags — so foreign-user tags can't match a chip even
  // transitively.
  const chipFilteredArticles = useMemo(() => {
    if (!chipFilter) return filteredArticles;
    const needle = stripAccents(chipFilter.toLowerCase()).trim();
    if (!needle) return filteredArticles;
    return filteredArticles.filter((a) => {
      const tags = visibleTagsFor(a);
      const haystack = stripAccents(
        `${a.title} ${a.snippet} ${tags.join(" ")}`.toLowerCase(),
      );
      return haystack.includes(needle);
    });
  }, [chipFilter, filteredArticles, visibleTagsFor]);

  if (visLoading || !visible) return <></>;

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

      {/* Error banner */}
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

      {/* Anon login nudge — anon visitors can still browse but can't customize */}
      {readOnly && (
        <AnonCTA message="Log in on desktop to customize the keywords tracked for you." />
      )}

      {/* Quick-search chips — tap to filter the feed in-place */}
      <QuickSearchChipRow active={chipFilter} onPick={setChipFilter} />

      {/* Feed */}
      <ArticleList
        articles={chipFilteredArticles}
        loading={loading}
        justArrivedUrls={justArrivedUrls}
        visibleTagsFor={visibleTagsFor}
        emptyMessage={
          articles.length === 0
            ? "No headlines yet. The scanner runs every ~5 min and new articles will appear here automatically."
            : chipFilter
              ? `No headlines match "${chipFilter}".`
              : "No articles match your keywords yet."
        }
      />
    </div>
  );
}
