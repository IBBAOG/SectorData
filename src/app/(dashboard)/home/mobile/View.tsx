"use client";

// Mobile view for /home — Onda 7 polish (2026-05-28).
//
// Plan reference: /.claude/plans/o-modo-mobile-da-tranquil-giraffe.md § 4.1.
//
// Visual model: bento icon tiles (replacement for the v2 "capsule pill" layout).
// Each tile carries:
//   • A tinted 44×44 squircle icon badge (identity at a glance)
//   • The dashboard title (Arial 15px / 600)
// All other affordances (subtitle, preview thumbnail, badge) are deliberately
// omitted to keep the gallery scannable and minimal — the icon does the
// recognition work the thumbnail used to do.
//
// Layout (top → bottom) — Onda 7 polish (2026-05-28):
//   1. Sticky header           — owned by MobileLayout (not rendered here).
//                                Onda 7: drop logo only (no wordmark), perfectly
//                                centered via absolute positioning.
//   2. "Last visited" row      — horizontal scroll, compact icon tiles, only
//                                rendered when localStorage history exists.
//   3. Oil & Gas section       — 4 tiles in 2-col grid (anp-cdp hidden).
//   4. Fuel Distribution       — 6 tiles in 2-col grid (anp-prices, anp-glp hidden).
//   5. (no Markets section — /stocks, /news-hunter, /alerts excluded.)
//
// Onda 7 removes the three formerly "desktop-only" tiles (anp-cdp, anp-prices,
// anp-glp) from the gallery entirely — they now live in HIDE_FROM_MOBILE_HOME.
// Last-visited row is filtered by MOBILE_ELIGIBLE_SLUGS so stale localStorage
// entries for those slugs are silently skipped.
//
// What we DELIBERATELY don't render here:
//   • Module thumbnails / images.
//   • DataSourcesTable (desktop-only since 2026-05-26).
//   • NewsHunterPanel / Alerts card / Profile/avatar / Stocks card.
//   • ExportFAB / ExportModal.
//   • MobileBottomTabBar (replaced by the global Home pill in MobileLayout).
//   • useDataSourcesFreshness — not imported, not called.

import { useMemo, useState } from "react";
import {
  MobileHomeIconTile,
  getTileMeta,
} from "@/components/dashboard/mobile";
import { useHomeData, type HomeCardDef } from "../useHomeData";
import { readLastVisited } from "../../../../hooks/useTrackLastVisited";

// Canonical whitelist of the 10 mobile-eligible dashboards (Oil & Gas + Fuel
// Distribution). Used to filter the Last-visited row so stale localStorage
// entries for desktop-only slugs are silently skipped.
const MOBILE_ELIGIBLE_SLUGS = new Set<string>([
  // Oil & Gas (4)
  "well-by-well",
  "anp-cdp-bsw",
  "anp-cdp-depletion",
  "anp-cdp-diaria",
  // Fuel Distribution (6)
  "market-share",
  "price-bands",
  "subsidy-tracker",
  "diesel-gasoline-margins",
  "imports-exports",
  "navios-diesel",
]);

// Slugs hidden from the gallery. Includes desktop-only dashboards that were
// previously shown with `excluded={true}` (Onda 7: hidden entirely).
const HIDE_FROM_MOBILE_HOME = new Set<string>([
  "stocks",
  "news-hunter",
  "alerts",
  "admin-panel",
  "admin-analytics",
  "profile",
  // Desktop-only — hidden entirely (Onda 7, replaces the former excluded tiles)
  "anp-cdp",
  "anp-prices",
  "anp-glp",
]);

// Section metadata in display order (Oil & Gas first per plan).
interface SectionDef {
  id: "oilgas" | "fuel";
  title: string;
}
const SECTIONS: SectionDef[] = [
  { id: "oilgas", title: "Oil & Gas" },
  { id: "fuel", title: "Fuel Distribution" },
];

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Resolves a slug back to its HomeCardDef from the visible-cards list.
 * Returns undefined when the slug is no longer visible (in which case the
 * Last-visited row simply skips that entry).
 */
function findCardBySlug(
  cards: HomeCardDef[],
  slug: string,
): HomeCardDef | undefined {
  return cards.find((c) => c.slug === slug);
}

// ── Component ─────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { cardsByCategory, visibleCards } = useHomeData();
  const [collapsedSections, setCollapsedSections] = useState<
    Record<SectionDef["id"], boolean>
  >({ oilgas: false, fuel: false });

  // Last-visited slugs from localStorage (newest first, capped at 4).
  // Read once on mount via useMemo so the row stays stable while the user
  // scrolls /home; it refreshes on the next visit to /home anyway.
  const lastVisitedSlugs = useMemo<string[]>(() => readLastVisited(), []);

  // Filter out hidden + desktop-only routes from each section's card list
  // (defence in depth — HIDE_FROM_MOBILE_HOME now includes the 3 former
  // excluded-but-shown slugs, so oilgasCards and fuelCards are clean).
  const oilgasCards = useMemo<HomeCardDef[]>(
    () => cardsByCategory.oilgas.filter((c) => !HIDE_FROM_MOBILE_HOME.has(c.slug)),
    [cardsByCategory.oilgas],
  );
  const fuelCards = useMemo<HomeCardDef[]>(
    () => cardsByCategory.fuel.filter((c) => !HIDE_FROM_MOBILE_HOME.has(c.slug)),
    [cardsByCategory.fuel],
  );

  const lastVisitedCards = useMemo<HomeCardDef[]>(() => {
    if (lastVisitedSlugs.length === 0) return [];
    return lastVisitedSlugs
      .map((slug) => findCardBySlug(visibleCards, slug))
      .filter(
        (c): c is HomeCardDef =>
          !!c && !!c.href && MOBILE_ELIGIBLE_SLUGS.has(c.slug),
      );
  }, [lastVisitedSlugs, visibleCards]);

  function toggleSection(id: SectionDef["id"]) {
    setCollapsedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function cardsForSection(id: SectionDef["id"]): HomeCardDef[] {
    return id === "oilgas" ? oilgasCards : fuelCards;
  }

  return (
    <div
      style={{
        background: "var(--mobile-bg)",
        fontFamily: "Arial, Helvetica, sans-serif",
        color: "var(--mobile-text)",
        fontSize: 14,
        lineHeight: 1.4,
        // Bottom padding clears the Home pill area (pill is at calc(24px +
        // safe-bottom), pill height 56) plus a comfy gutter.
        paddingBottom: "calc(120px + var(--mobile-safe-bottom))",
      }}
    >
      {/* No search bar — Onda 6 removed it; Onda 7 drop-only header above. */}

      {/* ── Last visited (hidden when there is no history) ───────────── */}
      {lastVisitedCards.length > 0 && (
        <section
          aria-label="Last visited dashboards"
          style={{ padding: "20px 0 4px" }}
        >
          <div
            style={{
              padding: "0 16px",
              marginBottom: 10,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--mobile-text-muted)",
            }}
          >
            Last visited
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              overflowX: "auto",
              padding: "2px 16px 14px",
              scrollSnapType: "x proximity",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {lastVisitedCards.map((card) => {
              const meta = getTileMeta(card.slug, "compact");
              return (
                <div
                  key={card.slug}
                  style={{
                    scrollSnapAlign: "start",
                    flex: "0 0 auto",
                  }}
                >
                  <MobileHomeIconTile
                    variant="compact"
                    title={card.title}
                    href={card.href ?? "#"}
                    icon={meta.icon}
                    tintBg={meta.tintBg}
                    tintFg={meta.tintFg}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Section list ─────────────────────────────────────────────── */}
      <div style={{ padding: lastVisitedCards.length > 0 ? "0 16px 24px" : "20px 16px 24px" }}>
        {SECTIONS.map((section) => {
          const cards = cardsForSection(section.id);
          if (cards.length === 0) return null;
          const collapsed = collapsedSections[section.id];

          return (
            <section
              key={section.id}
              aria-label={section.title}
              style={{ marginTop: 22 }}
            >
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                aria-expanded={!collapsed}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 4px",
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                  color: "var(--mobile-text)",
                  fontFamily: "inherit",
                  fontSize: 17,
                  fontWeight: 700,
                  letterSpacing: "-0.005em",
                  textAlign: "left",
                }}
              >
                <span>
                  {section.title}
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--mobile-text-muted)",
                      letterSpacing: 0,
                    }}
                  >
                    {cards.length}
                  </span>
                </span>
                <Chevron rotated={!collapsed} />
              </button>
              {!collapsed && (
                <div
                  style={{
                    marginTop: 14,
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  {cards.map((card) => {
                    const meta = getTileMeta(card.slug, "default");
                    return (
                      <MobileHomeIconTile
                        key={card.slug}
                        title={card.title}
                        href={card.href ?? "#"}
                        icon={meta.icon}
                        tintBg={meta.tintBg}
                        tintFg={meta.tintFg}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

      </div>
    </div>
  );
}

// ── Section chevron ──────────────────────────────────────────────────────
function Chevron({ rotated }: { rotated: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        color: "var(--mobile-text-muted)",
        transform: rotated ? "rotate(180deg)" : "rotate(0)",
        transition: "transform 0.18s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
