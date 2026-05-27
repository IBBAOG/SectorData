"use client";

// NewsHunterPanel — glass card showing the most-recent News Hunter headlines.
// Sits in the center column of the /home desktop layout (between module cards
// and DataSourcesTable). Desktop-only: mobile/View.tsx does not render it.
//
// Data source: reuses the already-mounted NewsHunterProvider (60s incremental
// polling on found_at watermark) via useNewsHunter(). No additional fetches,
// no additional RPCs.
//
// PARITY contract with /news-hunter dashboard:
//   The /news-hunter page renders `filteredArticles` from useNewsHunterData,
//   which (in its default landing state — no search, topic="All") reduces to
//   the keyword-filtered article list. This panel applies the SAME keyword
//   filter via the shared util `filterArticlesByKeywords` and takes the first
//   N items. The context already pre-sorts articles by `published_at desc`
//   on every merge, so no extra sort is needed here — the top-N shown here
//   ARE the top-N visible at the top of /news-hunter for the same user.
//
//   We deliberately do NOT mount useNewsHunterData() here because it calls
//   useModuleVisibilityGuard("news-hunter"), which would redirect users who
//   have news-hunter hidden — and the panel lives on /home itself, creating
//   a self-redirect loop.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useNewsHunter } from "../../../context/NewsHunterContext";
import { filterArticlesByKeywords } from "../../../app/(dashboard)/news-hunter/useNewsHunterData";

import styles from "./NewsHunterPanel.module.css";

// Number of articles to show in the home panel.
// 20 was requested by the CTO — gives a deeper feed snapshot directly on
// /home. The panel grows taller than the right-column stack (TeamPanel +
// DataSourcesTable) and the home page scrolls naturally as a result.
const ITEM_COUNT = 20;

// Local age helper — kept here (not re-exported from useNewsHunterData) so
// this panel has zero coupling to the news-hunter dashboard internals.
// Re-rendered every 30s by AGE_REFRESH_MS ticker below.
function humanizeAge(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

const AGE_REFRESH_MS = 30_000;

// Arrow icon (matches DataSourcesTable's CTA arrow style)
function ArrowRight({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export default function NewsHunterPanel(): React.ReactElement {
  const { articles, keywordEntries, loading, error } = useNewsHunter();

  // Tick every 30s so "X m ago" labels stay current without coupling to the
  // news-hunter dashboard's ageTick state.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), AGE_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Top-N most-recent — replicates the /news-hunter dashboard's default
  // landing-state feed: same articles (context-sorted published_at desc),
  // same keyword filter (via the shared filterArticlesByKeywords util),
  // sliced to ITEM_COUNT. No additional sort, no extra fallback ordering —
  // we trust the context's canonical order so the first N cards here are
  // identical (and in the same order) to the first N cards rendered at the
  // top of /news-hunter for the same viewer.
  const topArticles = useMemo(() => {
    if (!articles || articles.length === 0) return [];
    return filterArticlesByKeywords(articles, keywordEntries).slice(0, ITEM_COUNT);
  }, [articles, keywordEntries]);

  return (
    <div className={styles.root}>
      {/* Header — pulse dot + label. The footer "Open full feed" CTA is the
          only entry point to the full dashboard now (per CTO 2026-05-27). */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>
          <span className={styles.pulseDot} aria-hidden="true" />
          News Hunter
        </span>
      </div>

      {/* Body */}
      {error ? (
        <div className={styles.errorPlaceholder}>Could not load latest news.</div>
      ) : loading && topArticles.length === 0 ? (
        <div className={styles.placeholder}>Loading latest headlines…</div>
      ) : topArticles.length === 0 ? (
        <div className={styles.placeholder}>No recent headlines yet.</div>
      ) : (
        <div className={styles.list}>
          {topArticles.map((a) => {
            const sourceLabel = a.source_name?.trim() || a.domain || "Source";
            const age = humanizeAge(a.published_at ?? a.found_at);
            return (
              <div key={a.url} className={styles.item}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.itemLink}
                  title={a.title}
                >
                  <span className={styles.title}>{a.title}</span>
                  <span className={styles.meta}>
                    <span className={styles.source}>{sourceLabel}</span>
                    {age && (
                      <>
                        <span className={styles.dot} aria-hidden="true" />
                        <span className={styles.time}>{age}</span>
                      </>
                    )}
                  </span>
                </a>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer — full-feed CTA */}
      <div className={styles.footer}>
        <Link
          href="/news-hunter"
          className={styles.footerLink}
          aria-label="Open the full News Hunter feed"
        >
          Open full feed
          <ArrowRight />
        </Link>
      </div>
    </div>
  );
}
