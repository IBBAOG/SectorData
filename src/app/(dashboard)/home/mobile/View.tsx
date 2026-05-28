"use client";

// Mobile view for /home — Onda 5 visual refresh (2026-05-28).
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
// Layout (top → bottom) — Onda 6 (2026-05-28):
//   1. Sticky header           — owned by MobileLayout (not rendered here).
//                                Onda 6: solid black background, "Oil & Gas
//                                Data" white wordmark + kebab.
//   2. "Last visited" row      — horizontal scroll, compact icon tiles, only
//                                rendered when localStorage history exists.
//   3. Oil & Gas section       — 5 tiles in 2-col grid.
//   4. Fuel Distribution       — 8 tiles in 2-col grid.
//   5. (no Markets section — /stocks, /news-hunter, /alerts excluded.)
//
// Onda 6 removed the sticky search bar that previously sat between the header
// and the Last-visited row — it added clutter without saving steps (the
// catalogue is short and tiles are already discoverable at a glance). The
// `search` state still exists in `useHomeData` (other consumers may yet wire
// it up); we simply never read or write it from this View, so the filter is a
// no-op and the gallery shows every visible card.
//
// What we DELIBERATELY don't render here:
//   • Module thumbnails / images.
//   • DataSourcesTable (desktop-only since 2026-05-26).
//   • NewsHunterPanel / Alerts card / Profile/avatar / Stocks card.
//   • ExportFAB / ExportModal.
//   • MobileBottomTabBar (replaced by the global Home pill in MobileLayout).
//   • useDataSourcesFreshness — not imported, not called.
//
// Excluded routes that still appear in the gallery (anp-cdp, anp-prices,
// anp-glp): rendered with `excluded={true}` — the tile remains tappable, and
// the destination `page.tsx` mounts `MobileExcludedRedirect` which bounces
// the user back to /home with a toast. The visual "Desktop only" caption
// inside the tile sets expectations before the tap.

import { useMemo, useState } from "react";
import {
  MobileHomeIconTile,
  getTileMeta,
} from "@/components/dashboard/mobile";
import { useHomeData, type HomeCardDef } from "../useHomeData";
import { readLastVisited } from "../../../../hooks/useTrackLastVisited";

// Slugs that are explicitly excluded from the mobile experience (plan § 3.1).
// We hide them from the Home gallery regardless of module_visibility — the
// MobileExcludedRedirect handles the deep-link case.
const HIDE_FROM_MOBILE_HOME = new Set<string>([
  "stocks",
  "news-hunter",
  "alerts",
  "admin-panel",
  "admin-analytics",
  "profile",
]);

// These dashboards are mobile-incompatible (they redirect to /home on tap via
// MobileExcludedRedirect) but we keep them in the /home grid so the catalogue
// is complete; the tile renders with `excluded={true}` to set expectations.
const EXCLUDED_DESKTOP_ONLY = new Set<string>([
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

  // Filter hidden routes out of each section's card list (defence in depth).
  // Excluded-but-still-shown routes (anp-cdp, anp-prices, anp-glp) stay; they
  // render with `excluded={true}` and the destination page bounces.
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
          !!c && !!c.href && !HIDE_FROM_MOBILE_HOME.has(c.slug),
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
      {/* Onda 6 (2026-05-28): the sticky search bar that lived here was
          removed — the catalogue is short and tiles are scannable on their
          own. Tile gallery follows the dark header directly. */}

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
                    excluded={EXCLUDED_DESKTOP_ONLY.has(card.slug)}
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
                        excluded={EXCLUDED_DESKTOP_ONLY.has(card.slug)}
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
