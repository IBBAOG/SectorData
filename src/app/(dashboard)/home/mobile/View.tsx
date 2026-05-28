"use client";

// Mobile view for /home — Rappi-inspired redesign (2026-05-28).
//
// Visual model: pastel "Rappi launcher" tiles, three flavours composed in a
// single screen-length composition.
//
//   ┌────────────────────────────────┐
//   │  Team contact card             │  (kept above the grid; mobile-only)
//   ├────────────────────────────────┤
//   │ Featured                       │  Section header (uppercase, faint)
//   ├──────────────┬─────────────────┤
//   │              │                 │  HERO row — 2 large pastel cards
//   │  Brazil Prod │  Market Share   │  (focal modules, biggest illos)
//   │              │                 │
//   ├──────────────┴─────────────────┤
//   │ Daily Picks                    │
//   ├───────┬───────┬───────┬────────┤
//   │       │       │       │        │  SECONDARY — 2x2 grid of medium
//   │ Daily │ Subsi │ Imp&  │ Diesel │  pastel cards (next-tier modules)
//   │ Prod  │ dy    │ Exp   │ Line-Up│
//   ├───────┴───────┴───────┴────────┤
//   │ More                           │
//   │ ┌───┐┌───┐┌───┐┌───┐┌───┐ →     │  QUICK row — horizontal scroll of
//   │ │BSW││Dep││PB ││D&G││NH │       │  small neutral cards (deep-cut
//   │ └───┘└───┘└───┘└───┘└───┘       │  modules)
//   └────────────────────────────────┘
//
// Curatorial layer (HERO_SLUGS / SECONDARY_SLUGS / QUICK_SLUGS) defines a
// PREFERRED order — the actual rendering filters by `useHomeData` visibility
// rules (Anon / Client / Admin) and only paints what the user is allowed to
// see. A slug missing from visibility is silently dropped from its row.
//
// What we DELIBERATELY don't render here:
//   • Module thumbnails / images.
//   • DataSourcesTable (desktop-only since 2026-05-26).
//   • NewsHunterPanel / Alerts card / Profile/avatar / Stocks card.
//   • ExportFAB / ExportModal.
//   • MobileBottomTabBar (replaced by the global Home pill in MobileLayout).
//   • useDataSourcesFreshness — not imported, not called.

import { useMemo } from "react";
import { MobileHomeRappiCard } from "@/components/dashboard/mobile";
import { getModuleIcon } from "@/data/moduleIcons";
import { useHomeData, type HomeCardDef } from "../useHomeData";
import TeamCard from "@/components/home/mobile/TeamCard";

// ── Curatorial slot configuration ─────────────────────────────────────────
//
// Slugs are listed in display order. A slug present here but absent from
// `cardsByCategory` (because the user's visibility tier excludes it) is
// quietly skipped — no placeholder, no warning.

interface RappiTileMeta {
  /** Slug-specific pastel background CSS variable. */
  bgVar: string;
  /** Slug-specific saturated label/illustration foreground CSS variable. */
  fgVar: string;
  /** Hero/secondary: short copy line painted above the title (uppercase). */
  sublabel?: string;
  /** Optional emoji adornment painted behind the SVG (3D-style backdrop). */
  emoji?: string;
  /** Override the desktop title with a more punchy mobile label. */
  label?: string;
}

const HERO_SLUGS: { slug: string; meta: RappiTileMeta }[] = [
  {
    slug: "well-by-well",
    meta: {
      bgVar: "var(--mobile-home-tile-well-by-well-bg)",
      fgVar: "var(--mobile-home-tile-well-by-well-fg)",
      sublabel: "Production",
      emoji: "🛢️",
      label: "Brazil Production",
    },
  },
  {
    slug: "market-share",
    meta: {
      bgVar: "var(--mobile-home-tile-market-share-bg)",
      fgVar: "var(--mobile-home-tile-market-share-fg)",
      sublabel: "Distribution",
      emoji: "⛽",
      label: "Market Share",
    },
  },
];

const SECONDARY_SLUGS: { slug: string; meta: RappiTileMeta }[] = [
  {
    slug: "anp-cdp-diaria",
    meta: {
      bgVar: "var(--mobile-home-tile-anp-cdp-diaria-bg)",
      fgVar: "var(--mobile-home-tile-anp-cdp-diaria-fg)",
      emoji: "📅",
      label: "Daily Production",
    },
  },
  {
    slug: "subsidy-tracker",
    meta: {
      bgVar: "var(--mobile-home-tile-subsidy-tracker-bg)",
      fgVar: "var(--mobile-home-tile-subsidy-tracker-fg)",
      emoji: "💰",
      label: "Subsidy",
    },
  },
  {
    slug: "imports-exports",
    meta: {
      bgVar: "var(--mobile-home-tile-imports-exports-bg)",
      fgVar: "var(--mobile-home-tile-imports-exports-fg)",
      emoji: "🌍",
      label: "Imports & Exports",
    },
  },
  {
    slug: "navios-diesel",
    meta: {
      bgVar: "var(--mobile-home-tile-navios-diesel-bg)",
      fgVar: "var(--mobile-home-tile-navios-diesel-fg)",
      emoji: "🚢",
      label: "Diesel Line-Up",
    },
  },
];

const QUICK_SLUGS: { slug: string; meta: RappiTileMeta }[] = [
  {
    slug: "anp-cdp-bsw",
    meta: {
      bgVar: "var(--mobile-home-tile-anp-cdp-bsw-badge-bg)",
      fgVar: "var(--mobile-home-tile-anp-cdp-bsw-badge-fg)",
      label: "BSW",
    },
  },
  {
    slug: "anp-cdp-depletion",
    meta: {
      bgVar: "var(--mobile-home-tile-anp-cdp-depletion-badge-bg)",
      fgVar: "var(--mobile-home-tile-anp-cdp-depletion-badge-fg)",
      label: "Depletion",
    },
  },
  {
    slug: "price-bands",
    meta: {
      bgVar: "var(--mobile-home-tile-price-bands-badge-bg)",
      fgVar: "var(--mobile-home-tile-price-bands-badge-fg)",
      label: "Price Bands",
    },
  },
  {
    slug: "diesel-gasoline-margins",
    meta: {
      bgVar: "var(--mobile-home-tile-diesel-gasoline-margins-badge-bg)",
      fgVar: "var(--mobile-home-tile-diesel-gasoline-margins-badge-fg)",
      label: "D&G Margins",
    },
  },
  {
    slug: "news-hunter",
    meta: {
      bgVar: "var(--mobile-home-tile-news-hunter-badge-bg)",
      fgVar: "var(--mobile-home-tile-news-hunter-badge-fg)",
      label: "News Hunter",
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────

/** Build a flat slug → card map from the visibility-filtered catalogue. */
function buildSlugMap(cards: HomeCardDef[]): Map<string, HomeCardDef> {
  const m = new Map<string, HomeCardDef>();
  for (const c of cards) m.set(c.slug, c);
  return m;
}

interface RappiResolvedTile {
  slug: string;
  href: string;
  card: HomeCardDef;
  meta: RappiTileMeta;
}

/** Filter the curated slug list against the visibility map. */
function resolveTiles(
  list: { slug: string; meta: RappiTileMeta }[],
  slugMap: Map<string, HomeCardDef>,
): RappiResolvedTile[] {
  const out: RappiResolvedTile[] = [];
  for (const entry of list) {
    const card = slugMap.get(entry.slug);
    if (!card || !card.href) continue;
    out.push({
      slug: entry.slug,
      href: card.href,
      card,
      meta: entry.meta,
    });
  }
  return out;
}

// ── Component ─────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visibleCards } = useHomeData();

  const slugMap = useMemo(() => buildSlugMap(visibleCards), [visibleCards]);
  const heroTiles = useMemo(() => resolveTiles(HERO_SLUGS, slugMap), [slugMap]);
  const secondaryTiles = useMemo(
    () => resolveTiles(SECONDARY_SLUGS, slugMap),
    [slugMap],
  );
  const quickTiles = useMemo(
    () => resolveTiles(QUICK_SLUGS, slugMap),
    [slugMap],
  );

  return (
    <div
      style={{
        background: "var(--mobile-bg)",
        fontFamily: "Arial, Helvetica, sans-serif",
        color: "var(--mobile-text)",
        fontSize: 14,
        lineHeight: 1.4,
        paddingBottom: "calc(120px + var(--mobile-safe-bottom))",
      }}
    >
      <div style={{ padding: "16px 16px 24px" }}>
        {/* Team contacts — kept above the grid for at-a-glance ownership. */}
        <TeamCard />

        {/* ── Featured (HERO) ─────────────────────────────────────────── */}
        {heroTiles.length > 0 && (
          <Section title="Featured" marginTop={22}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: heroTiles.length === 1 ? "1fr" : "1fr 1fr",
                gap: 12,
              }}
            >
              {heroTiles.map((t) => (
                <MobileHomeRappiCard
                  key={t.slug}
                  href={t.href}
                  label={t.meta.label ?? t.card.title}
                  sublabel={t.meta.sublabel}
                  illustration={getModuleIcon(t.slug, 56, 1.75)}
                  emoji={t.meta.emoji}
                  bgColor={t.meta.bgVar}
                  fgColor={t.meta.fgVar}
                  variant="hero"
                />
              ))}
            </div>
          </Section>
        )}

        {/* ── Daily Picks (SECONDARY 2×2) ─────────────────────────────── */}
        {secondaryTiles.length > 0 && (
          <Section title="Daily picks" marginTop={22}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              {secondaryTiles.map((t) => (
                <MobileHomeRappiCard
                  key={t.slug}
                  href={t.href}
                  label={t.meta.label ?? t.card.title}
                  illustration={getModuleIcon(t.slug, 36, 1.8)}
                  emoji={t.meta.emoji}
                  bgColor={t.meta.bgVar}
                  fgColor={t.meta.fgVar}
                  variant="secondary"
                />
              ))}
            </div>
          </Section>
        )}

        {/* ── More (QUICK horizontal scroll) ──────────────────────────── */}
        {quickTiles.length > 0 && (
          <Section title="More tools" marginTop={22}>
            <div
              className="mobile-home-quick-row"
              style={{
                display: "flex",
                gap: 10,
                overflowX: "auto",
                overflowY: "hidden",
                // Pull the row to the edges so cards bleed against the
                // viewport sides — improves the "scroll for more" cue.
                marginLeft: -16,
                marginRight: -16,
                paddingLeft: 16,
                paddingRight: 16,
                paddingBottom: 4,
              }}
            >
              {quickTiles.map((t) => (
                <MobileHomeRappiCard
                  key={t.slug}
                  href={t.href}
                  label={t.meta.label ?? t.card.title}
                  illustration={getModuleIcon(t.slug, 22, 2)}
                  bgColor={t.meta.bgVar}
                  fgColor={t.meta.fgVar}
                  variant="quick"
                />
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────
//
// Uppercase faint header sits above each row. Kept minimal so the colourful
// cards do the talking.

function Section({
  title,
  marginTop,
  children,
}: {
  title: string;
  marginTop: number;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop }} aria-label={title}>
      <h2
        style={{
          margin: "0 0 10px",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--mobile-text-muted)",
          fontFamily: "inherit",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
