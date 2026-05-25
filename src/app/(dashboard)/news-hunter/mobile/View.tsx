"use client";

// Mobile view — /news-hunter (≤768px).
//
// Implements the approved mockup: mockups/news-hunter-mobile.html.
// Structure:
//   MobileTopBar (sticky glass)
//   Title block + live status row (pulsing dot)
//   Sticky search bar
//   Horizontal filter pills (snap-scroll, topic-based from user keywords)
//   My Keywords section (compact chip row + Add button)
//   Article feed (MobileDataCard with favicon circle, headline, snippet, kw pills)
//   FAB (+) to add keyword
//   MobileBottomTabBar (Feed / Search / Saved / Settings)
//   BottomSheet — keyword editor (add/remove) or article detail
//
// Admin clipping feature is desktop-only in this wave.
// [mobile-only-deferred-clipping]
//
// Binding sync rule (CLAUDE.md § Dual-view policy):
//   Any meaningful change here (new filter, new KPI, new copy) must land in
//   desktop/View.tsx in the SAME commit, OR the commit message must declare
//   `[mobile-only]` with an explicit reason.

import { memo, useCallback, useMemo, useState } from "react";
import { List as VirtualList, type RowComponentProps } from "react-window";
import {
  MobileTopBar,
  MobileBottomTabBar,
  type MobileBottomTab,
  BottomSheet,
  MobileDataCard,
  SearchIcon,
  BookmarkIcon,
  PlusIcon,
  ShareIcon,
  CloseIcon,
} from "@/components/dashboard/mobile";
import { useUserProfile } from "@/context/UserProfileContext";
import AnonCTA from "@/components/AnonCTA";
import {
  useNewsHunterData,
  humanizeAge,
  domainColor,
  domainInitial,
  type MobileTab,
} from "../useNewsHunterData";
import type {
  KeywordEntry,
  KeywordMatchType,
  NewsArticle,
} from "@/context/NewsHunterContext";

// ── Icons ────────────────────────────────────────────────────────────────────
//
// IconFeed and IconSettings are domain-specific glyphs (feed widget / gear)
// not in the canonical design-system icon set; they stay inline below.
// IconSearch / IconBookmark / IconPlus / IconShare delegate to the canonical
// icons so visual drift is impossible.

function IconFeed(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16v4H4z" />
      <path d="M4 12h16" />
      <path d="M4 16h10" />
      <path d="M4 20h10" />
    </svg>
  );
}

const IconSearch = () => <SearchIcon size={22} />;

const IconBookmark = ({ filled }: { filled?: boolean }) => (
  <BookmarkIcon size={22} fill={filled ? "currentColor" : "none"} />
);

function IconSettings(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

const IconPlus = () => <PlusIcon size={24} strokeWidth={2.4} />;
const IconShare = () => <ShareIcon size={18} />;

// ── Sub-components ───────────────────────────────────────────────────────────

/** Pulsing green dot + "Live · <count> new in the last hour" */
function LiveRow({ count, loading }: { count: number; loading: boolean }): React.ReactElement {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12, color: "var(--mobile-text-muted)" }}>
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--mobile-live, #16a34a)",
          flexShrink: 0,
          display: "inline-block",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: -4,
            borderRadius: "50%",
            background: "var(--mobile-live, #16a34a)",
            opacity: 0.6,
            animation: "nh-pulse 1.8s ease-out infinite",
          }}
        />
      </span>
      <strong style={{ color: "var(--mobile-text)" }}>Live</strong>
      <span aria-hidden="true">·</span>
      {loading
        ? <span>loading…</span>
        : <span>{count} headline{count === 1 ? "" : "s"} today</span>
      }
    </div>
  );
}

/** Horizontal scroll filter pills from user keywords + "All" */
function FilterPills({
  keywords,
  active,
  onSelect,
}: {
  keywords: string[];
  active: string;
  onSelect: (v: string) => void;
}): React.ReactElement {
  // Derive a deduplicated short list of topic labels from user keywords
  // Cap at 8 so the row doesn't get unwieldy
  const topics = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const kw of keywords) {
      const label = kw.charAt(0).toUpperCase() + kw.slice(1);
      if (!seen.has(label)) { seen.add(label); out.push(label); }
      if (out.length >= 8) break;
    }
    return out;
  }, [keywords]);

  return (
    <nav
      aria-label="Topic filters"
      style={{
        position: "sticky",
        top: "calc(var(--mobile-topbar-h) + 52px)", // below topbar + search
        zIndex: 22,
        height: 52,
        background: "var(--mobile-glass-bg)",
        WebkitBackdropFilter: "var(--mobile-glass-blur)",
        backdropFilter: "var(--mobile-glass-blur)",
        borderBottom: "1px solid var(--mobile-glass-border)",
        display: "flex",
        alignItems: "center",
        overflowX: "auto",
        overflowY: "hidden",
        gap: 8,
        padding: "0 16px",
        scrollSnapType: "x mandatory",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
      }}
    >
      {["All", ...topics].map((label) => {
        const isActive = active === label;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onSelect(label)}
            style={{
              flexShrink: 0,
              minHeight: 36,
              padding: "0 14px",
              borderRadius: 999,
              border: isActive ? "1px solid var(--mobile-accent)" : "1px solid var(--mobile-border)",
              background: isActive ? "var(--mobile-accent)" : "var(--mobile-surface)",
              color: isActive ? "#fff" : "var(--mobile-text)",
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
              scrollSnapAlign: "start",
              cursor: "pointer",
              fontFamily: "inherit",
              boxShadow: isActive ? "0 2px 8px rgba(255,80,0,0.25)" : "none",
              transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
            }}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}

/** Compact keyword chip list. Exact-match keywords get a small "EXACT" pill. */
function KeywordsSection({
  entries,
  onAddPress,
  onRemove,
  readOnly,
}: {
  entries: KeywordEntry[];
  onAddPress: () => void;
  onRemove: (kw: string) => Promise<void>;
  /**
   * When true, the section hides Add controls and renders chips as static
   * labels (no tap-to-remove). Used for anonymous visitors who see the
   * curated default keyword set.
   */
  readOnly?: boolean;
}): React.ReactElement {
  // Show max 5 + "+N more" indicator
  const visible = entries.slice(0, 5);
  const extra = entries.length - visible.length;

  return (
    <section style={{ padding: "16px 16px 12px", background: "var(--mobile-bg)" }} aria-label={readOnly ? "Default keywords" : "My keywords"}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--mobile-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {readOnly ? "Default Keywords" : "My Keywords"}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={onAddPress}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--mobile-accent)",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 8,
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
            aria-label="Add keyword"
          >
            <PlusIcon size={14} strokeWidth={2.4} />
            Add
          </button>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {visible.map((entry) => {
          const isExact = entry.match_type === "exact";
          const chipContent = (
            <>
              <span>#{entry.keyword}</span>
              {isExact && (
                <span
                  aria-label="Exact match"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    height: 14,
                    padding: "0 4px",
                    borderRadius: 3,
                    background: "var(--mobile-accent)",
                    color: "#fff",
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    lineHeight: 1,
                  }}
                >
                  EXACT
                </span>
              )}
            </>
          );
          const chipStyle: React.CSSProperties = {
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: "0 10px",
            borderRadius: 999,
            background: "rgba(255,80,0,0.10)",
            color: "var(--mobile-accent)",
            fontSize: 12,
            fontWeight: 600,
            border: isExact ? "1px solid var(--mobile-accent)" : 0,
            fontFamily: "inherit",
          };
          if (readOnly) {
            // Static chip — no click handler, no remove affordance.
            return (
              <span key={entry.keyword} style={chipStyle}>
                {chipContent}
              </span>
            );
          }
          return (
            <button
              key={entry.keyword}
              type="button"
              onClick={() => void onRemove(entry.keyword)}
              title={
                isExact
                  ? `Remove #${entry.keyword} (exact match)`
                  : `Remove #${entry.keyword}`
              }
              style={{ ...chipStyle, cursor: "pointer" }}
            >
              {chipContent}
            </button>
          );
        })}
        {extra > 0 && !readOnly && (
          <button
            type="button"
            onClick={onAddPress}
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 26,
              padding: "0 10px",
              borderRadius: 999,
              background: "transparent",
              color: "var(--mobile-text-muted)",
              fontSize: 12,
              fontWeight: 600,
              border: "1px dashed var(--mobile-border)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            +{extra} more
          </button>
        )}
        {extra > 0 && readOnly && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 26,
              padding: "0 10px",
              borderRadius: 999,
              background: "transparent",
              color: "var(--mobile-text-muted)",
              fontSize: 12,
              fontWeight: 600,
              border: "1px dashed var(--mobile-border)",
              fontFamily: "inherit",
            }}
          >
            +{extra} more
          </span>
        )}
        {entries.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--mobile-text-faint)", fontStyle: "italic" }}>
            No keywords — all headlines shown.
          </span>
        )}
      </div>
    </section>
  );
}

// ── Virtualized list constants ───────────────────────────────────────────────
// MobileDataCard with variant="expanded" is documented as ~88-96px tall.
// We add headroom for the optional snippet (2-line clamp) + keyword pills row.
// 120px covers the full expanded card height at this font scale.
// The list is capped at 70dvh so it fits the mobile viewport without overflow.
const MOBILE_ITEM_H = 120;
const MOBILE_MAX_LIST_H_VH = 0.7; // 70dvh — computed at render time

/** Article card with favicon circle, headline, snippet, keyword pills */
const ArticleCard = memo(function ArticleCard({
  article,
  bookmarked,
  justArrived,
  onToggleBookmark,
}: {
  article: NewsArticle;
  bookmarked: boolean;
  justArrived: boolean;
  onToggleBookmark: (url: string) => void;
}): React.ReactElement {
  const color = domainColor(article.domain);
  const initial = domainInitial(article.domain);
  const ageLabel = humanizeAge(article.published_at);

  const favicon = (
    <div
      aria-hidden="true"
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        background: color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 700,
        color: "#fff",
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );

  const kwPills = article.matched_keywords.slice(0, 3).map((kw) => (
    <span
      key={kw}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 22,
        padding: "0 8px",
        borderRadius: 999,
        background: "transparent",
        border: "1px solid var(--mobile-accent)",
        color: "var(--mobile-accent)",
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      #{kw}
    </span>
  ));

  const rightSlot = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <span style={{ fontSize: 11, color: "var(--mobile-text-faint)", whiteSpace: "nowrap" }}>
        {ageLabel}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleBookmark(article.url); }}
          aria-label={bookmarked ? "Remove bookmark" : "Save article"}
          style={{
            width: 32,
            height: 32,
            border: 0,
            background: "transparent",
            color: bookmarked ? "var(--mobile-accent)" : "var(--mobile-text-muted)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          <IconBookmark filled={bookmarked} />
        </button>
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share article"
          style={{
            width: 32,
            height: 32,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--mobile-text-muted)",
            borderRadius: 8,
          }}
        >
          <IconShare />
        </a>
      </div>
    </div>
  );

  const subtitleNode = (
    <div>
      <div style={{ marginBottom: 4, fontSize: 12, color: "var(--mobile-text-muted)" }}>
        {article.source_name} · {article.domain}
      </div>
      {article.snippet && (
        <div
          style={{
            fontSize: 13,
            color: "var(--mobile-text-muted)",
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            marginBottom: kwPills.length > 0 ? 6 : 0,
          }}
        >
          {article.snippet}
        </div>
      )}
      {kwPills.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
          {kwPills}
        </div>
      )}
    </div>
  );

  return (
    <div
      style={{
        outline: justArrived ? "2px solid rgba(255,212,0,0.6)" : "none",
        borderRadius: justArrived ? 4 : 0,
        transition: "outline 0.5s ease",
      }}
    >
      <MobileDataCard
        leftIcon={favicon}
        title={article.title}
        subtitle={subtitleNode}
        rightSlot={rightSlot}
        onClick={() => window.open(article.url, "_blank", "noopener,noreferrer")}
        variant="expanded"
      />
    </div>
  );
});

// ── VirtualizedMobileFeed ────────────────────────────────────────────────────
// react-window v2 passes rowProps directly into the row component alongside
// the reserved { ariaAttributes, index, style } props.

interface MobileFeedRowProps {
  articles: NewsArticle[];
  bookmarkedUrls: Set<string>;
  justArrivedUrls: Set<string>;
  onToggleBookmark: (url: string) => void;
}

function _MobileFeedRowInner({
  index,
  style,
  articles,
  bookmarkedUrls,
  justArrivedUrls,
  onToggleBookmark,
}: RowComponentProps<MobileFeedRowProps>): React.ReactElement {
  const a = articles[index];
  return (
    <div style={style}>
      <ArticleCard
        article={a}
        bookmarked={bookmarkedUrls.has(a.url)}
        justArrived={justArrivedUrls.has(a.url)}
        onToggleBookmark={onToggleBookmark}
      />
    </div>
  );
}
// Cast: React.memo broadens return type to ReactNode; rowComponent needs ReactElement | null.
const MobileFeedRow = memo(_MobileFeedRowInner) as unknown as (
  props: RowComponentProps<MobileFeedRowProps>,
) => React.ReactElement | null;

function VirtualizedMobileFeed({
  articles,
  bookmarkedUrls,
  justArrivedUrls,
  onToggleBookmark,
}: {
  articles: NewsArticle[];
  bookmarkedUrls: Set<string>;
  justArrivedUrls: Set<string>;
  onToggleBookmark: (url: string) => void;
}): React.ReactElement {
  // Use window.innerHeight if available (client-only), fall back to 600.
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 600;
  const listHeight = Math.min(articles.length * MOBILE_ITEM_H, Math.floor(viewportH * MOBILE_MAX_LIST_H_VH));

  const rowProps: MobileFeedRowProps = useMemo(
    () => ({ articles, bookmarkedUrls, justArrivedUrls, onToggleBookmark }),
    [articles, bookmarkedUrls, justArrivedUrls, onToggleBookmark],
  );

  return (
    // key={articles.length} resets scroll when filter changes result count.
    <div
      key={articles.length}
      style={{ height: listHeight, width: "100%", overflowY: "auto" }}
    >
      <VirtualList<MobileFeedRowProps>
        defaultHeight={listHeight}
        rowCount={articles.length}
        rowHeight={MOBILE_ITEM_H}
        rowProps={rowProps}
        rowComponent={MobileFeedRow}
      />
    </div>
  );
}

/** Small inline "EXACT" pill used inside list rows. */
function ExactBadge(): React.ReactElement {
  return (
    <span
      aria-label="Exact match"
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 16,
        padding: "0 5px",
        borderRadius: 3,
        background: "var(--mobile-accent)",
        color: "#fff",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.05em",
        lineHeight: 1,
        marginLeft: 6,
      }}
    >
      EXACT
    </span>
  );
}

/** "Exact match" toggle (checkbox + label). Shared between Settings tab and
 *  the BottomSheet keyword editor. */
function ExactMatchToggle({
  value,
  onChange,
}: {
  value: KeywordMatchType;
  onChange: (v: KeywordMatchType) => void;
}): React.ReactElement {
  const checked = value === "exact";
  return (
    <label
      title="Match only when the term appears as a standalone word (case-insensitive)."
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        color: checked ? "var(--mobile-accent)" : "var(--mobile-text-muted)",
        cursor: "pointer",
        userSelect: "none",
        padding: "4px 8px",
        borderRadius: 8,
        border: checked
          ? "1px solid var(--mobile-accent)"
          : "1px solid var(--mobile-border)",
        background: checked ? "rgba(255,80,0,0.08)" : "transparent",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked ? "exact" : "substring")}
        style={{ width: 14, height: 14, accentColor: "var(--mobile-accent)", margin: 0, cursor: "pointer" }}
      />
      Exact match
    </label>
  );
}

/** Settings tab — keyword management full list */
function SettingsTab({
  entries,
  addKeyword,
  removeKeyword,
  readOnly,
}: {
  entries: KeywordEntry[];
  addKeyword: (raw: string, matchType?: KeywordMatchType) => Promise<void>;
  removeKeyword: (kw: string) => Promise<void>;
  /**
   * When true, the form is hidden and an AnonCTA banner replaces it.
   * The keyword list still renders so visitors can see what the default
   * feed is filtered against.
   */
  readOnly?: boolean;
}): React.ReactElement {
  const [draft, setDraft] = useState("");
  const [draftType, setDraftType] = useState<KeywordMatchType>("substring");

  if (readOnly) {
    return (
      <div style={{ padding: "20px 16px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px", color: "var(--mobile-text)" }}>
          Settings
        </h2>
        <AnonCTA
          message="Sign in to personalize your keywords and create your own news feed."
          ctaText="Sign in"
          ctaHref="/login"
        />
        <p style={{ fontSize: 13, color: "var(--mobile-text-muted)", margin: "16px 0 8px" }}>
          The public feed is filtered by these default keywords:
        </p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {entries.map((entry) => {
            const isExact = entry.match_type === "exact";
            return (
              <li
                key={entry.keyword}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "10px 0",
                  borderBottom: "1px solid var(--mobile-divider)",
                  fontSize: 14,
                  color: "var(--mobile-text)",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center" }}>
                  #{entry.keyword}
                  {isExact && <ExactBadge />}
                </span>
              </li>
            );
          })}
          {entries.length === 0 && (
            <li style={{ color: "var(--mobile-text-faint)", fontStyle: "italic", fontSize: 13 }}>
              No default keywords configured.
            </li>
          )}
        </ul>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 16px" }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px", color: "var(--mobile-text)" }}>
        Settings
      </h2>
      <p style={{ fontSize: 13, color: "var(--mobile-text-muted)", marginBottom: 16 }}>
        Keywords control which articles the scanner fetches. Changes take effect on the next scanner run (~5 min).
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void addKeyword(draft, draftType);
          setDraft("");
          setDraftType("substring");
        }}
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add keyword…"
          style={{
            flex: "1 1 160px",
            height: 40,
            borderRadius: 10,
            border: "1px solid var(--mobile-border)",
            background: "var(--mobile-surface)",
            color: "var(--mobile-text)",
            fontFamily: "inherit",
            fontSize: 14,
            padding: "0 12px",
            outline: "none",
          }}
        />
        <ExactMatchToggle value={draftType} onChange={setDraftType} />
        <button
          type="submit"
          style={{
            height: 40,
            padding: "0 16px",
            borderRadius: 10,
            border: 0,
            background: "var(--mobile-accent)",
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Add
        </button>
      </form>
      <p style={{ fontSize: 11.5, color: "var(--mobile-text-faint)", margin: "0 0 16px", lineHeight: 1.45 }}>
        Default keywords match anywhere. Turn on <strong style={{ color: "var(--mobile-accent)" }}>Exact match</strong> so the term only hits as a standalone word.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {entries.map((entry) => {
          const isExact = entry.match_type === "exact";
          return (
            <li
              key={entry.keyword}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 0",
                borderBottom: "1px solid var(--mobile-divider)",
                fontSize: 14,
                color: "var(--mobile-text)",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center" }}>
                #{entry.keyword}
                {isExact && <ExactBadge />}
              </span>
              <button
                type="button"
                onClick={() => void removeKeyword(entry.keyword)}
                aria-label={`Remove keyword ${entry.keyword}`}
                style={{
                  border: 0,
                  background: "transparent",
                  color: "var(--mobile-text-muted)",
                  fontSize: 20,
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: "0 4px",
                  fontFamily: "inherit",
                }}
              >
                ×
              </button>
            </li>
          );
        })}
        {entries.length === 0 && (
          <li style={{ color: "var(--mobile-text-faint)", fontStyle: "italic", fontSize: 13 }}>
            No keywords yet.
          </li>
        )}
      </ul>
    </div>
  );
}

// ── Keyword editor BottomSheet ───────────────────────────────────────────────

function KeywordSheet({
  open,
  onClose,
  entries,
  addKeyword,
  removeKeyword,
}: {
  open: boolean;
  onClose: () => void;
  entries: KeywordEntry[];
  addKeyword: (raw: string, matchType?: KeywordMatchType) => Promise<void>;
  removeKeyword: (kw: string) => Promise<void>;
}): React.ReactElement {
  const [draft, setDraft] = useState("");
  const [draftType, setDraftType] = useState<KeywordMatchType>("substring");

  const handleAdd = useCallback(async () => {
    await addKeyword(draft, draftType);
    setDraft("");
    setDraftType("substring");
  }, [draft, draftType, addKeyword]);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="My Keywords"
      height="70vh"
      footer={
        <form
          onSubmit={(e) => { e.preventDefault(); void handleAdd(); }}
          style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add keyword…"
            style={{
              flex: "1 1 160px",
              height: 40,
              borderRadius: 10,
              border: "1px solid var(--mobile-border)",
              background: "var(--mobile-surface)",
              color: "var(--mobile-text)",
              fontFamily: "inherit",
              fontSize: 14,
              padding: "0 12px",
              outline: "none",
            }}
          />
          <ExactMatchToggle value={draftType} onChange={setDraftType} />
          <button
            type="submit"
            style={{
              height: 40,
              padding: "0 16px",
              borderRadius: 10,
              border: 0,
              background: "var(--mobile-accent)",
              color: "#fff",
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Add
          </button>
        </form>
      }
    >
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {entries.map((entry) => {
          const isExact = entry.match_type === "exact";
          return (
            <li
              key={entry.keyword}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 0",
                borderBottom: "1px solid var(--mobile-divider)",
                fontSize: 15,
                color: "var(--mobile-text)",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center" }}>
                #{entry.keyword}
                {isExact && <ExactBadge />}
              </span>
              <button
                type="button"
                onClick={() => void removeKeyword(entry.keyword)}
                aria-label={`Remove keyword ${entry.keyword}`}
                style={{
                  border: 0,
                  background: "transparent",
                  color: "var(--mobile-text-muted)",
                  fontSize: 20,
                  lineHeight: 1,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  padding: "0 4px",
                }}
              >
                ×
              </button>
            </li>
          );
        })}
        {entries.length === 0 && (
          <li style={{ color: "var(--mobile-text-faint)", fontStyle: "italic", fontSize: 13 }}>
            No keywords yet. Add one above.
          </li>
        )}
      </ul>
    </BottomSheet>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const {
    filteredArticles,
    articles,
    savedArticles,
    justArrivedUrls,
    keywords,
    keywordEntries,
    loading,
    error,
    readOnly,
    visible,
    visLoading,
    newKeyword: _newKeyword,
    setNewKeyword: _setNewKeyword,
    addKeyword,
    removeKeyword,
    searchTerm,
    setSearchTerm,
    topicFilter,
    setTopicFilter,
    theme,
    toggleTheme,
    bookmarkedUrls,
    toggleBookmark,
    mobileTab,
    setMobileTab,
    lastScanLabel,
  } = useNewsHunterData();

  const { profile } = useUserProfile();
  const initials = profile?.full_name
    ? profile.full_name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()
    : "?";

  const [kwSheetOpen, setKwSheetOpen] = useState(false);

  // Count today's articles for the live row
  const todayCount = useMemo(() => {
    const today = new Date().toDateString();
    return articles.filter((a) => new Date(a.published_at).toDateString() === today).length;
  }, [articles]);

  if (visLoading || !visible) return <></>;

  // ── Bottom tabs ────────────────────────────────────────────────────────────

  const tabs: MobileBottomTab[] = [
    { key: "feed", label: "Feed", icon: <IconFeed />, active: mobileTab === "feed" },
    { key: "search", label: "Search", icon: <IconSearch />, active: mobileTab === "search" },
    { key: "saved", label: "Saved", icon: <IconBookmark />, active: mobileTab === "saved" },
    { key: "settings", label: "Settings", icon: <IconSettings />, active: mobileTab === "settings" },
  ];

  // ── Render helpers ─────────────────────────────────────────────────────────

  const feedList = mobileTab === "saved" ? savedArticles : filteredArticles;

  // ── Shell ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Keyframe for live dot pulse — injected once */}
      <style>{`
        @keyframes nh-pulse {
          0%   { transform: scale(0.6); opacity: 0.6; }
          80%  { transform: scale(1.8); opacity: 0; }
          100% { transform: scale(1.8); opacity: 0; }
        }
      `}</style>

      <div
        style={{
          minHeight: "100dvh",
          background: "var(--mobile-bg)",
          color: "var(--mobile-text)",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 14,
          paddingBottom: "calc(var(--mobile-tabbar-h) + var(--mobile-safe-bottom) + 80px)",
        }}
        // Sync dark/light through data attribute — the mobile tokens are on :root,
        // no need for a separate theme attribute here. The toggle is for UX only.
        data-nh-mobile-theme={theme}
      >
        {/* Top bar */}
        <MobileTopBar
          title={<span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "0.04em" }}>SECTORDATA<span style={{ color: "var(--mobile-accent)" }}>.</span></span>}
          showThemeToggle
          onToggleTheme={toggleTheme}
          showAvatar
          avatarInitials={initials}
          avatarLabel={profile?.full_name ?? "User"}
        />

        {/* Settings tab — full-page keyword management */}
        {mobileTab === "settings" && (
          <SettingsTab
            entries={keywordEntries}
            addKeyword={addKeyword}
            removeKeyword={removeKeyword}
            readOnly={readOnly}
          />
        )}

        {mobileTab !== "settings" && (
          <>
            {/* Title block */}
            <section style={{ padding: "16px 16px 12px", background: "var(--mobile-bg)" }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--mobile-text)", margin: 0, letterSpacing: "-0.01em" }}>
                {mobileTab === "saved" ? "Saved Articles" : "News Hunter"}
              </h1>
              {mobileTab !== "saved" && (
                <LiveRow count={todayCount} loading={loading} />
              )}
              {mobileTab === "saved" && (
                <p style={{ fontSize: 13, color: "var(--mobile-text-muted)", margin: "4px 0 0" }}>
                  {savedArticles.length} article{savedArticles.length === 1 ? "" : "s"} bookmarked
                </p>
              )}
            </section>

            {/* Sticky search — always visible on feed/search/saved */}
            <div
              style={{
                position: "sticky",
                top: "var(--mobile-topbar-h)",
                zIndex: 25,
                padding: "8px 16px",
                background: "var(--mobile-glass-bg)",
                WebkitBackdropFilter: "var(--mobile-glass-blur)",
                backdropFilter: "var(--mobile-glass-blur)",
                borderBottom: "1px solid var(--mobile-glass-border)",
              }}
            >
              <div style={{ position: "relative", height: 36 }}>
                <SearchIcon
                  size={18}
                  style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--mobile-text-faint)", pointerEvents: "none" }}
                />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search articles or keywords…"
                  aria-label="Search articles or keywords"
                  style={{
                    width: "100%",
                    height: 36,
                    borderRadius: 10,
                    border: "1px solid var(--mobile-border)",
                    background: "var(--mobile-surface)",
                    color: "var(--mobile-text)",
                    fontFamily: "inherit",
                    fontSize: 14,
                    padding: "0 36px 0 36px",
                    outline: "none",
                  }}
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    aria-label="Clear search"
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 24,
                      height: 24,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "50%",
                      background: "var(--mobile-row-press)",
                      border: 0,
                      cursor: "pointer",
                      color: "var(--mobile-text-muted)",
                    }}
                  >
                    <CloseIcon size={12} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>

            {/* Topic pills — feed tab only */}
            {mobileTab === "feed" && (
              <>
                <FilterPills
                  keywords={keywords}
                  active={topicFilter}
                  onSelect={setTopicFilter}
                />
                {readOnly && (
                  <div style={{ padding: "0 16px" }}>
                    <AnonCTA
                      message="Sign in to personalize your keywords and create your own news feed."
                      ctaText="Sign in"
                      ctaHref="/login"
                    />
                  </div>
                )}
                <KeywordsSection
                  entries={keywordEntries}
                  onAddPress={() => setKwSheetOpen(true)}
                  onRemove={removeKeyword}
                  readOnly={readOnly}
                />
              </>
            )}

            {/* Article feed */}
            <main aria-label={mobileTab === "saved" ? "Saved articles" : "Article feed"}>
              {error && (
                <div style={{ margin: "12px 16px", padding: "10px 14px", background: "rgba(168,35,47,0.08)", border: "1px solid rgba(168,35,47,0.25)", borderRadius: 8, color: "#a8232f", fontSize: 13 }}>
                  Failed to load: {error}
                </div>
              )}

              {!loading && feedList.length === 0 && (
                <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--mobile-text-muted)" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: "var(--mobile-text)" }}>
                    {mobileTab === "saved" ? "No saved articles" : "No headlines yet"}
                  </p>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    {mobileTab === "saved"
                      ? "Tap the bookmark icon on any article to save it."
                      : articles.length === 0
                        ? "The scanner runs every ~5 min and writes new articles to Supabase."
                        : "No news matches the current filters."}
                  </p>
                </div>
              )}

              {feedList.length > 0 && (
                <VirtualizedMobileFeed
                  articles={feedList}
                  bookmarkedUrls={bookmarkedUrls}
                  justArrivedUrls={justArrivedUrls}
                  onToggleBookmark={toggleBookmark}
                />
              )}

              {loading && feedList.length === 0 && (
                <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
                  Loading headlines…
                </div>
              )}
            </main>
          </>
        )}
      </div>

      {/* FAB — add keyword (feed + settings tabs).
          Hidden for anon visitors: they can't mutate keywords, so a +
          floating button would mislead them. */}
      {!readOnly && (mobileTab === "feed" || mobileTab === "settings") && (
        <button
          type="button"
          onClick={() => setKwSheetOpen(true)}
          aria-label="Add keyword"
          style={{
            position: "fixed",
            right: 16,
            bottom: "calc(var(--mobile-tabbar-h) + var(--mobile-safe-bottom) + 16px)",
            zIndex: 35,
            width: 56,
            height: 56,
            borderRadius: "50%",
            border: 0,
            background: "var(--mobile-accent)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(255,80,0,0.35), 0 1px 0 rgba(255,255,255,0.25) inset",
            transition: "transform 0.12s ease, background 0.15s ease",
          }}
        >
          <IconPlus />
        </button>
      )}

      {/* Bottom tab bar */}
      <MobileBottomTabBar
        tabs={tabs}
        onChange={(key) => setMobileTab(key as MobileTab)}
      />

      {/* Keyword editor sheet — never mounted for anon visitors. */}
      {!readOnly && (
        <KeywordSheet
          open={kwSheetOpen}
          onClose={() => setKwSheetOpen(false)}
          entries={keywordEntries}
          addKeyword={addKeyword}
          removeKeyword={removeKeyword}
        />
      )}

      {/* Status label announced to screen readers */}
      <p aria-live="polite" aria-atomic="true" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
        {loading ? "Loading news articles" : lastScanLabel}
      </p>
    </>
  );
}
