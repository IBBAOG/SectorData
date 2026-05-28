"use client";

// Mobile view for /home (Onda 2 of the mobile reform, rewrite from scratch).
//
// Plan reference: /.claude/plans/o-modo-mobile-da-tranquil-giraffe.md § 4.1.
//
// Layout (top → bottom):
//   1. Sticky header           — owned by MobileLayout (not rendered here).
//   2. Search bar (sticky)     — full-width Liquid Glass, real-time filter.
//   3. "Last visited" row      — horizontal scroll, 4 compact pills, only
//                                rendered when localStorage history exists.
//   4. Oil & Gas section       — 5 pills in 2-col grid, expanded by default.
//   5. Fuel Distribution       — 8 pills in 2-col grid, expanded by default.
//   6. (no Markets section — /stocks, /news-hunter, /alerts excluded.)
//
// What we DELIBERATELY don't render here:
//   • Module thumbnails / images.
//   • DataSourcesTable (desktop-only since 2026-05-26).
//   • NewsHunterPanel / Alerts card / Profile/avatar / Stocks card.
//   • ExportFAB / ExportModal.
//   • MobileBottomTabBar (replaced by the global Home pill in MobileLayout).
//   • useDataSourcesFreshness — not imported, not called.
//
// Visibility logic comes from `useHomeData()`. We further restrict the visible
// set to Oil & Gas + Fuel Distribution categories so excluded routes never
// show up even if module_visibility flags them visible (defence in depth).

import { useMemo, useState } from "react";
import {
  MobileHomeCardPill,
  SearchIcon,
  CloseIcon,
} from "@/components/dashboard/mobile";
import { useHomeData, type HomeCardDef } from "../useHomeData";
import { readLastVisited } from "../../../../hooks/useTrackLastVisited";

// Slugs that are explicitly excluded from the mobile experience (plan § 3.1).
// We hide them from the Home gallery regardless of module_visibility — the
// MobileExcludedRedirect handles the deep-link case.
const EXCLUDED_FROM_MOBILE_HOME = new Set<string>([
  "stocks",
  "news-hunter",
  "alerts",
  "admin-panel",
  "admin-analytics",
  "profile",
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
  const { cardsByCategory, visibleCards, search, setSearch } = useHomeData();
  const [collapsedSections, setCollapsedSections] = useState<
    Record<SectionDef["id"], boolean>
  >({ oilgas: false, fuel: false });

  // Last-visited slugs from localStorage (newest first, capped at 4).
  // Read once on mount via useMemo so the row stays stable while the user
  // scrolls /home; it refreshes on the next visit to /home anyway.
  const lastVisitedSlugs = useMemo<string[]>(() => readLastVisited(), []);

  // Filter excluded routes out of each section's card list. The default home
  // hook already removes them when visibility is off, but we belt-and-suspender
  // here to guarantee the mobile gallery cannot show excluded routes even if
  // an admin flips module_visibility upstream.
  const oilgasCards = useMemo<HomeCardDef[]>(
    () => cardsByCategory.oilgas.filter((c) => !EXCLUDED_FROM_MOBILE_HOME.has(c.slug)),
    [cardsByCategory.oilgas],
  );
  const fuelCards = useMemo<HomeCardDef[]>(
    () => cardsByCategory.fuel.filter((c) => !EXCLUDED_FROM_MOBILE_HOME.has(c.slug)),
    [cardsByCategory.fuel],
  );

  const lastVisitedCards = useMemo<HomeCardDef[]>(() => {
    if (lastVisitedSlugs.length === 0) return [];
    return lastVisitedSlugs
      .map((slug) => findCardBySlug(visibleCards, slug))
      .filter(
        (c): c is HomeCardDef =>
          !!c && !!c.href && !EXCLUDED_FROM_MOBILE_HOME.has(c.slug),
      );
  }, [lastVisitedSlugs, visibleCards]);

  const isSearching = search.trim().length > 0;

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
      {/* ── Search (sticky just below the MobileTopBar) ──────────────── */}
      <div
        style={{
          position: "sticky",
          top: "var(--mobile-topbar-h)",
          zIndex: 25,
          padding: "12px 16px",
          background: "var(--mobile-glass-bg)",
          WebkitBackdropFilter: "var(--mobile-glass-blur)",
          backdropFilter: "var(--mobile-glass-blur)",
          borderBottom: "1px solid var(--mobile-glass-border)",
        }}
      >
        <div style={{ position: "relative", height: 40 }}>
          <span
            style={{
              position: "absolute",
              top: "50%",
              left: 12,
              transform: "translateY(-50%)",
              color: "var(--mobile-text-faint)",
              pointerEvents: "none",
            }}
          >
            <SearchIcon size={18} />
          </span>
          <input
            type="search"
            placeholder="Search dashboards"
            aria-label="Search dashboards"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              height: 40,
              borderRadius: 999,
              border: "1px solid var(--mobile-border)",
              background: "var(--mobile-surface)",
              color: "var(--mobile-text)",
              fontFamily: "inherit",
              fontSize: 14,
              padding: "0 40px 0 38px",
              outline: "none",
              transition: "border-color 0.15s ease, box-shadow 0.15s ease",
            }}
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
              style={{
                position: "absolute",
                top: "50%",
                right: 8,
                transform: "translateY(-50%)",
                width: 26,
                height: 26,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                background: "rgba(0,0,0,0.08)",
                border: 0,
                cursor: "pointer",
                color: "var(--mobile-text-muted)",
              }}
            >
              <CloseIcon size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Last visited (hidden if no history or when searching) ────── */}
      {lastVisitedCards.length > 0 && !isSearching && (
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
            {lastVisitedCards.map((card) => (
              <div
                key={card.slug}
                style={{
                  scrollSnapAlign: "start",
                  flex: "0 0 auto",
                }}
              >
                <MobileHomeCardPill
                  variant="compact"
                  title={card.title}
                  href={card.href ?? "#"}
                />
              </div>
            ))}
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
                  {cards.map((card) => (
                    <MobileHomeCardPill
                      key={card.slug}
                      title={card.title}
                      href={card.href ?? "#"}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {isSearching &&
          oilgasCards.length === 0 &&
          fuelCards.length === 0 && (
            <div
              role="status"
              style={{
                marginTop: 40,
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--mobile-text-muted)",
                fontSize: 14,
              }}
            >
              No dashboards match &quot;{search.trim()}&quot;.
            </div>
          )}
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
