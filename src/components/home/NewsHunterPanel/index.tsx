"use client";

// NewsHunterPanel — glass card showing the most-recent News Hunter headlines.
// Sits in the center column of the /home desktop layout (between module cards
// and DataSourcesTable). Desktop-only: mobile/View.tsx does not render it.
//
// Data source: reuses the already-mounted NewsHunterProvider (60s incremental
// polling on found_at watermark) via useNewsHunter(). No additional fetches,
// no additional RPCs.
//
// Renders top 6 articles sorted by published_at desc (the context already
// sorts on every merge). Article rows link out to the external article URL;
// the panel header + footer link to /news-hunter (full dashboard).

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useNewsHunter } from "../../../context/NewsHunterContext";

import styles from "./NewsHunterPanel.module.css";

// Number of articles to show in the home panel.
// 6 keeps the panel visually balanced with TeamPanel (3 rows above) +
// DataSourcesTable (≈19 rows expanded). Tuned for ~360px column width.
const ITEM_COUNT = 6;

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
  const { articles, loading, error } = useNewsHunter();

  // Tick every 30s so "X m ago" labels stay current without coupling to the
  // news-hunter dashboard's ageTick state.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), AGE_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Top-N most-recent. Context already sorts by published_at desc on merge,
  // so we just slice. If published_at is missing on some rows, fall back
  // to found_at-desc among the same prefix (defensive).
  const topArticles = useMemo(() => {
    if (!articles || articles.length === 0) return [];
    // Sort defensively: published_at desc nulls last, then found_at desc.
    const sorted = [...articles].sort((a, b) => {
      const ap = a.published_at ? new Date(a.published_at).getTime() : 0;
      const bp = b.published_at ? new Date(b.published_at).getTime() : 0;
      if (bp !== ap) return bp - ap;
      const af = a.found_at ? new Date(a.found_at).getTime() : 0;
      const bf = b.found_at ? new Date(b.found_at).getTime() : 0;
      return bf - af;
    });
    return sorted.slice(0, ITEM_COUNT);
  }, [articles]);

  return (
    <div className={styles.root}>
      {/* Header — pulse dot + label + inline "Open" CTA */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>
          <span className={styles.pulseDot} aria-hidden="true" />
          News Hunter
        </span>
        <Link
          href="/news-hunter"
          className={styles.headerCta}
          aria-label="Open News Hunter dashboard"
        >
          Open
          <ArrowRight />
        </Link>
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
