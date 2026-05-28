"use client";

// Mobile view for /home — Rappi-pastel × category sections (2026-05-28, Round 2).
//
// CEO feedback on the first Rappi pass (commit 10a2c17f) — the curated
// Featured / Daily picks / More tools layout dropped the canonical taxonomy.
// This iteration restores the two category sections that vigorated before
// the Rappi rework (commit 022f41bc) and dresses every tile in the pastel
// Rappi card with a smaller icon so the whole catalogue fits inside each
// section without scroll, hidden tiles or font cropping.
//
//   ┌────────────────────────────────┐
//   │  Team contact card             │  (mobile-only, kept above the grid)
//   ├────────────────────────────────┤
//   │ Oil & Gas               4  ▼   │  Collapsible section header
//   ├──────────────┬─────────────────┤
//   │  ▣  icon     │  ▣  icon        │  Uniform 2-col grid of pastel cards
//   │              │                 │  (icon top-left ~ 40% h, label
//   │  Label       │  Label          │  bottom-left, saturated brand
//   │              │                 │  colour). No horizontal scroll.
//   ├──────────────┴─────────────────┤
//   │ Fuel Distribution       6  ▼   │
//   ├──────────────┬─────────────────┤
//   │   …                            │
//   └────────────────────────────────┘
//
// Source of truth for category assignment: `useHomeData.cardsByCategory`
// (Markets / Oil & Gas / Fuel). Markets is hidden from the mobile gallery —
// its only mobile-eligible slug (news-hunter) lives behind the floating
// MobileNewsHunterPill instead. Desktop-only slugs are filtered through
// `HIDE_FROM_MOBILE_HOME` (defence-in-depth — `useHomeData` already drops
// them via visibility, but the set documents the contract).
//
// What we DELIBERATELY don't render here:
//   • Module thumbnails / images.
//   • DataSourcesTable (desktop-only since 2026-05-26).
//   • NewsHunterPanel / Alerts card / Profile/avatar / Stocks card.
//   • ExportFAB / ExportModal.
//   • MobileBottomTabBar (replaced by the global Home pill in MobileLayout).
//   • useDataSourcesFreshness — not imported, not called.

import { useMemo, useState } from "react";
import { MobileHomeRappiCard } from "@/components/dashboard/mobile";
import { getModuleIcon } from "@/data/moduleIcons";
import { useHomeData, type HomeCardDef, type HomeCategory } from "../useHomeData";
import TeamCard from "@/components/home/mobile/TeamCard";

// ── Hidden slugs ─────────────────────────────────────────────────────────
// Mirrors commit 022f41bc — desktop-only + non-gallery routes.
const HIDE_FROM_MOBILE_HOME = new Set<string>([
  "stocks",
  "news-hunter",
  "alerts",
  "admin-panel",
  "admin-analytics",
  "profile",
  // Desktop-only dashboards (post-mobile-reform 2026-05-27)
  "anp-cdp",
  "anp-prices",
  "anp-glp",
]);

// ── Section ordering ─────────────────────────────────────────────────────
interface SectionDef {
  id: Exclude<HomeCategory, "markets">;
  title: string;
}
const SECTIONS: SectionDef[] = [
  { id: "oilgas", title: "Oil & Gas" },
  { id: "fuel", title: "Fuel Distribution" },
];

// ── Per-slug Rappi metadata ──────────────────────────────────────────────
// Each entry maps to the CSS tokens added in globals.css under the
// "Rappi-style /home tile palette" block. `label` overrides the desktop
// title with a punchier mobile-friendly string when the original is too
// long for a 2-col 360px viewport. Slugs missing here fall back to
// neutral defaults — but every slug currently surfaced in the gallery is
// covered.
interface RappiSlugMeta {
  bgVar: string;
  fgVar: string;
  /** Optional mobile-friendly label override. */
  label?: string;
}

const RAPPI_META: Record<string, RappiSlugMeta> = {
  // Oil & Gas
  "well-by-well": {
    bgVar: "var(--mobile-home-tile-well-by-well-bg)",
    fgVar: "var(--mobile-home-tile-well-by-well-fg)",
    label: "Brazil Production",
  },
  "anp-cdp-bsw": {
    bgVar: "var(--mobile-home-tile-anp-cdp-bsw-bg)",
    fgVar: "var(--mobile-home-tile-anp-cdp-bsw-fg)",
    label: "BSW by Well",
  },
  "anp-cdp-depletion": {
    bgVar: "var(--mobile-home-tile-anp-cdp-depletion-bg)",
    fgVar: "var(--mobile-home-tile-anp-cdp-depletion-fg)",
    label: "Depletion",
  },
  "anp-cdp-diaria": {
    bgVar: "var(--mobile-home-tile-anp-cdp-diaria-bg)",
    fgVar: "var(--mobile-home-tile-anp-cdp-diaria-fg)",
    label: "Daily Production",
  },
  // Fuel Distribution
  "market-share": {
    bgVar: "var(--mobile-home-tile-market-share-bg)",
    fgVar: "var(--mobile-home-tile-market-share-fg)",
    label: "Market Share",
  },
  "navios-diesel": {
    bgVar: "var(--mobile-home-tile-navios-diesel-bg)",
    fgVar: "var(--mobile-home-tile-navios-diesel-fg)",
    label: "Diesel Line-Up",
  },
  "diesel-gasoline-margins": {
    bgVar: "var(--mobile-home-tile-diesel-gasoline-margins-bg)",
    fgVar: "var(--mobile-home-tile-diesel-gasoline-margins-fg)",
    label: "D&G Margins",
  },
  "price-bands": {
    bgVar: "var(--mobile-home-tile-price-bands-bg)",
    fgVar: "var(--mobile-home-tile-price-bands-fg)",
    label: "Price Bands",
  },
  "subsidy-tracker": {
    bgVar: "var(--mobile-home-tile-subsidy-tracker-bg)",
    fgVar: "var(--mobile-home-tile-subsidy-tracker-fg)",
    label: "Subsidy",
  },
  "imports-exports": {
    bgVar: "var(--mobile-home-tile-imports-exports-bg)",
    fgVar: "var(--mobile-home-tile-imports-exports-fg)",
    label: "Imports & Exports",
  },
};

const DEFAULT_META: RappiSlugMeta = {
  bgVar: "var(--mobile-surface)",
  fgVar: "var(--mobile-text)",
};

// ── Component ─────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { cardsByCategory } = useHomeData();
  const [collapsedSections, setCollapsedSections] = useState<
    Record<SectionDef["id"], boolean>
  >({ oilgas: false, fuel: false });

  const oilgasCards = useMemo<HomeCardDef[]>(
    () => cardsByCategory.oilgas.filter((c) => !HIDE_FROM_MOBILE_HOME.has(c.slug)),
    [cardsByCategory.oilgas],
  );
  const fuelCards = useMemo<HomeCardDef[]>(
    () => cardsByCategory.fuel.filter((c) => !HIDE_FROM_MOBILE_HOME.has(c.slug)),
    [cardsByCategory.fuel],
  );

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
      <div style={{ padding: "20px 16px 24px" }}>
        {/* Team contacts — compact card above module groups (mobile-only). */}
        <TeamCard />

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
                  borderBottom: "1px solid #E5E7EB",
                  cursor: "pointer",
                  color: "#FF5000",
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
                    const meta = RAPPI_META[card.slug] ?? DEFAULT_META;
                    const href = card.href ?? "#";
                    return (
                      <MobileHomeRappiCard
                        key={card.slug}
                        href={href}
                        label={meta.label ?? card.title}
                        illustration={getModuleIcon(card.slug, 26, 1.9)}
                        bgColor={meta.bgVar}
                        fgColor={meta.fgVar}
                        variant="uniform"
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
