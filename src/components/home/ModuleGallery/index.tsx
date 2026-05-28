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
    accent:      "#FF5000",                    // brand orange pure (Round 8, per user request)
    accentText:  "#FF5000",                    // borderline WCAG AA on #fff (~3.4:1); passes AA Large only
    soft:        "rgba(255, 80, 0, 0.10)",
    tile:        "rgba(255, 80, 0, 0.10)",
    tileHover:   "rgba(255, 80, 0, 0.18)",
    tileBorder:  "rgba(255, 80, 0, 0.16)",
    glow:        "rgba(255, 80, 0, 0.20)",
  },
  fuel: {
    accent:      "#059669",                    // emerald-600
    accentText:  "#047857",                    // matches --ds-cat-proprietary-text
    soft:        "rgba(5, 150, 105, 0.10)",
    tile:        "rgba(5, 150, 105, 0.10)",
    tileHover:   "rgba(5, 150, 105, 0.18)",
    tileBorder:  "rgba(5, 150, 105, 0.16)",
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
