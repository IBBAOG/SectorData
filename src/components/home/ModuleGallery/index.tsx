"use client";

// ModuleGallery — coherent module-card gallery for /home.
//
// Two variants:
//   <ModuleGallery variant="desktop" cardsByCategory={...} onNavigate={...} />
//   <ModuleGallery variant="mobile"  cardsByCategory={...} onNavigate={...}
//                                    collapsed={...} toggleCollapsed={...} />
//
// Desktop wraps the entire gallery in a glass card with a black "DASHBOARDS"
// header (matching NewsHunterPanel and DataSourcesTable on the same page).
// Mobile renders full-bleed iOS-style surface stripes with sticky collapsible
// section headers, identical interaction semantics adapted to touch.
//
// Both variants share the same category accent treatment: each section
// (Markets / Oil & Gas / Fuel Distribution) carries its color into the icon
// tile, the section header dot/count, hover/press background and the left
// accent bar. Brand orange (#ff5000) leads Markets — fitting because the
// brand IS the markets vertical's primary signal.
//
// All visual tokens & animations live in ModuleGallery.module.css.
// The per-category accent variables (--mg-accent, --mg-accent-soft, ...) are
// injected per-row via inline style and consumed by the module CSS.

import { useState, type CSSProperties } from "react";
import {
  ChevronRightIcon,
  ChevronDownIcon,
} from "@/components/dashboard/mobile";
import { getModuleIcon } from "@/data/moduleIcons";
import type {
  HomeCardDef,
  HomeCategory,
  HomeSectionState,
} from "@/app/(dashboard)/home/useHomeData";

import styles from "./ModuleGallery.module.css";

// ── Category accent palette ───────────────────────────────────────────────
// Each entry produces a full set of CSS variables consumed by the module CSS.

interface AccentTokens {
  accent: string;        // strong category color
  accentText: string;    // WCAG-AA-on-white text variant of accent
  soft: string;          // row hover / badge background
  tile: string;          // icon tile background (rest)
  tileHover: string;     // icon tile background (hover)
  tileBorder: string;    // inset 1px border on the tile (rest)
  glow: string;          // box-shadow glow color (hover)
}

const ACCENTS: Record<HomeCategory, AccentTokens> = {
  markets: {
    // Light-yellow family per user request (2026-05-28). Round 2: the
    // 10%-alpha amber on the icon tile composited to a muddy beige that
    // read orange-ish next to the brand chrome. Switching to OPAQUE pale
    // yellows on the tile so it visibly reads as yellow at rest:
    //   tile bg #fef3a8 (yellow-200, clearly yellow on the #fff8d6 row),
    //   tile fg #854d0e (yellow-800 / dark amber, AA on #fef3a8 ~7.4:1).
    accent:      "#a16207",                    // amber-700 (section dot, accent bar)
    accentText:  "#854d0e",                    // yellow-800 — used by icon stroke + name on hover
    soft:        "#fff8d6",                    // light yellow row tint (rest + hover)
    tile:        "#fef3a8",                    // OPAQUE yellow-200 — readable as yellow
    tileHover:   "#fde047",                    // yellow-400 — clearly yellow on hover
    tileBorder:  "rgba(133, 77, 14, 0.20)",
    glow:        "rgba(202, 138, 4, 0.30)",   // yellow-600 glow
  },
  oilgas: {
    // Round 9 (2026-05-28): bump the icon tile to an OPAQUE pale orange that
    // matches the vivacity of the Markets yellow chip. The earlier 10%-alpha
    // brand-orange composited to a near-white wash that read as "no tint";
    // switching to opaque orange-200 (#ffd4b8) makes the chip visibly orange
    // at rest, hover-200 → orange-300/400 (#ffb088). The icon stroke moves
    // from the brand #FF5000 (only ~2.5:1 on #ffd4b8 — fails AA 3:1 for
    // graphical objects) to orange-800 #9a3412 (≈7.0:1 on #ffd4b8 — passes
    // AA + AAA). Section dot, accent bar and glow keep the brand orange.
    accent:      "#FF5000",                    // brand orange (section dot, accent bar)
    accentText:  "#9a3412",                    // orange-800 — icon stroke + name-on-hover + badge text
    soft:        "rgba(255, 80, 0, 0.10)",
    tile:        "#ffd4b8",                    // OPAQUE orange-200 — readable as orange
    tileHover:   "#ffb088",                    // orange-300/400 — clearly orange on hover
    tileBorder:  "rgba(154, 52, 18, 0.20)",
    glow:        "rgba(255, 80, 0, 0.20)",
  },
  fuel: {
    // Round 9 (2026-05-28): same treatment as oilgas — OPAQUE pale green
    // (green-200 #bbf7d0) at rest, green-300 (#86efac) on hover. Icon stroke
    // stays #047857 (emerald-700), which scores ≈4.1:1 on #bbf7d0 — passes
    // AA for graphical objects (≥3:1). Section dot and glow keep emerald-600.
    accent:      "#059669",                    // emerald-600 (section dot, accent bar)
    accentText:  "#047857",                    // emerald-700 — icon stroke (AA on #bbf7d0)
    soft:        "rgba(5, 150, 105, 0.10)",
    tile:        "#bbf7d0",                    // OPAQUE green-200 — readable as green
    tileHover:   "#86efac",                    // green-300 — clearly green on hover
    tileBorder:  "rgba(4, 120, 87, 0.20)",
    glow:        "rgba(5, 150, 105, 0.20)",
  },
};

const LABELS: Record<HomeCategory, string> = {
  markets: "Markets",
  oilgas: "Oil & Gas",
  fuel: "Fuel Distribution",
};

const ORDER: HomeCategory[] = ["markets", "oilgas", "fuel"];

function accentStyle(cat: HomeCategory): CSSProperties {
  const a = ACCENTS[cat];
  return {
    // CSS vars consumed by ModuleGallery.module.css
    ["--mg-accent" as string]:             a.accent,
    ["--mg-accent-text" as string]:        a.accentText,
    ["--mg-accent-soft" as string]:        a.soft,
    ["--mg-accent-tile" as string]:        a.tile,
    ["--mg-accent-tile-hover" as string]:  a.tileHover,
    ["--mg-accent-tile-border" as string]: a.tileBorder,
    ["--mg-accent-glow" as string]:        a.glow,
  };
}

// ── Shared types ─────────────────────────────────────────────────────────

interface CommonProps {
  cardsByCategory: Record<HomeCategory, HomeCardDef[]>;
  onNavigate: (href: string) => void;
}

type DesktopProps = CommonProps & {
  variant: "desktop";
  title?: string; // Header label, defaults to "Dashboards"
};

type MobileProps = CommonProps & {
  variant: "mobile";
  collapsed: HomeSectionState;
  toggleCollapsed: (cat: HomeCategory) => void;
  /** When true (search active with empty results), hide sections that have no cards entirely. */
  hideEmptySections?: boolean;
  /** Sticky-top offset (px) for collapsible headers — pass the topbar+search height. */
  stickyTop?: number;
};

type Props = DesktopProps | MobileProps;

// ── Desktop row ──────────────────────────────────────────────────────────

interface DesktopRowProps {
  card: HomeCardDef;
  onNavigate: (href: string) => void;
}

function DesktopRow({ card, onNavigate }: DesktopRowProps): React.ReactElement {
  const { slug, title, disabled, href, badge } = card;
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={title}
      className={`${styles.row} ${disabled ? styles.rowDisabled : ""}`}
      onClick={() => { if (!disabled && href) onNavigate(href); }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled && href) {
          e.preventDefault();
          onNavigate(href);
        }
      }}
    >
      <div className={styles.iconTile} aria-hidden="true">
        {getModuleIcon(slug, 22, 2)}
      </div>
      <span className={styles.name}>{title}</span>
      <span className={styles.rightCluster}>
        {badge && badge !== "Available" && (
          <span className={`${styles.badge} ${disabled ? styles.badgeDisabled : ""}`}>
            {badge}
          </span>
        )}
        {!disabled && (
          <span className={styles.chevron} aria-hidden="true">
            <ChevronRightIcon size={14} />
          </span>
        )}
      </span>
    </div>
  );
}

// ── Mobile row ───────────────────────────────────────────────────────────

interface MobileRowProps {
  card: HomeCardDef;
  onNavigate: (href: string) => void;
}

function MobileRow({ card, onNavigate }: MobileRowProps): React.ReactElement {
  const { slug, title, disabled, href } = card;
  const [pressed, setPressed] = useState(false);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={title}
      className={
        `${styles.mobileRow} ${pressed ? styles.mobileRowPressed : ""} ${disabled ? styles.rowDisabled : ""}`
      }
      onClick={() => { if (!disabled && href) onNavigate(href); }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled && href) {
          e.preventDefault();
          onNavigate(href);
        }
      }}
      onPointerDown={() => { if (!disabled) setPressed(true); }}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
    >
      <div className={styles.mobileIconTile} aria-hidden="true">
        {getModuleIcon(slug, 22, 2)}
      </div>
      <span className={styles.mobileName}>{title}</span>
      {!disabled && (
        <span className={styles.mobileChevron} aria-hidden="true">
          <ChevronRightIcon size={16} />
        </span>
      )}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────

export default function ModuleGallery(props: Props): React.ReactElement | null {
  if (props.variant === "desktop") {
    const { cardsByCategory, onNavigate, title = "Dashboards" } = props;
    return (
      <div className={styles.root} aria-label="Module navigation">
        {/* Black header bar — matches NewsHunterPanel/DataSourcesTable */}
        <div className={styles.header}>
          <span className={styles.headerTitle}>
            <span className={styles.pulseDot} aria-hidden="true" />
            {title}
          </span>
        </div>

        {ORDER.map((cat) => {
          const cards = cardsByCategory[cat];
          if (!cards || cards.length === 0) return null;
          return (
            <div
              key={cat}
              className={styles.section}
              style={accentStyle(cat)}
            >
              <div className={styles.sectionHeader}>
                <span className={styles.sectionDot} aria-hidden="true" />
                <span className={styles.sectionLabel}>{LABELS[cat]}</span>
                <span className={styles.sectionRule} aria-hidden="true" />
                <span className={styles.sectionCount} aria-label={`${cards.length} modules`}>
                  {cards.length}
                </span>
              </div>
              <div className={styles.sectionBody}>
                {cards.map((card) => (
                  <DesktopRow
                    key={card.slug}
                    card={card}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Mobile variant
  const {
    cardsByCategory,
    onNavigate,
    collapsed,
    toggleCollapsed,
    hideEmptySections,
    stickyTop = 0,
  } = props;

  return (
    <div className={styles.mobileRoot}>
      {ORDER.map((cat) => {
        const cards = cardsByCategory[cat];
        if (hideEmptySections && (!cards || cards.length === 0)) return null;
        const isCollapsed = collapsed[cat];

        return (
          <section
            key={cat}
            className={styles.mobileSection}
            style={accentStyle(cat)}
          >
            <header
              role="button"
              tabIndex={0}
              aria-expanded={!isCollapsed}
              className={styles.mobileSectionHeader}
              style={{ top: stickyTop }}
              onClick={() => toggleCollapsed(cat)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleCollapsed(cat);
                }
              }}
            >
              <span
                className={
                  `${styles.mobileSectionChevron} ${isCollapsed ? styles.mobileSectionChevronCollapsed : ""}`
                }
                aria-hidden="true"
              >
                <ChevronDownIcon size={14} strokeWidth={2.5} />
              </span>
              <span className={styles.mobileSectionDot} aria-hidden="true" />
              <span className={styles.mobileSectionLabel}>{LABELS[cat]}</span>
              <span aria-hidden="true" />
              <span
                className={styles.mobileSectionCount}
                aria-label={`${cards?.length ?? 0} modules`}
              >
                {cards?.length ?? 0}
              </span>
            </header>

            {!isCollapsed && cards && cards.length > 0 && (
              <div className={styles.mobileSectionBody}>
                {cards.map((card, idx) => (
                  <div key={card.slug}>
                    <MobileRow card={card} onNavigate={onNavigate} />
                    {idx < cards.length - 1 && (
                      <div className={styles.mobileRowDivider} aria-hidden="true" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
