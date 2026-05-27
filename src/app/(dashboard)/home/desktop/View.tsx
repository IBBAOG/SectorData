"use client";

// Desktop view for /home.
//
// Layout: 3-column grid — module cards (left), News Hunter live panel (center,
// glanceable headlines), TeamPanel + DataSourcesTable (right). The News
// Hunter panel is the visual focal point: positioned dead-center horizontally,
// with a yellow pulse dot in the black header (matching the news_articles
// category color in DataSourcesTable) to signal "live feed".
//
// Cards are icon + module name rows (compact list, one card per row).
// Hover: icon gains brand orange color + scale, row gets glass background +
// left-bar accent + slight translateX.
//
// Mobile view is unchanged (cards only, no right column, no center panel).

import { useState } from "react";
import { useRouter } from "next/navigation";
import NavBar from "../../../../components/NavBar";
import { useHomeData } from "../useHomeData";
import DataSourcesTable from "../../../../components/home/DataSourcesTable";
import TeamPanel from "../../../../components/home/TeamPanel";
import NewsHunterPanel from "../../../../components/home/NewsHunterPanel";
import { getModuleIcon } from "../../../../data/moduleIcons";

// ── Design tokens ─────────────────────────────────────────────────────────
const ORANGE = "#ff5000";
const ORANGE_SOFT = "rgba(255, 80, 0, 0.08)";
const ORANGE_GLOW = "rgba(255, 80, 0, 0.22)";
const BG = "#f5f5f5";

// ── Category accent colors (left-bar) ─────────────────────────────────────
const CATEGORY_ACCENT: Record<string, string> = {
  markets: "#ff5000",
  oilgas: "#2563eb",
  fuel: "#059669",
};

// ── Category section labels ────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  markets: "Markets",
  oilgas: "Oil & Gas",
  fuel: "Fuel Distribution",
};

const CATEGORY_ORDER = ["markets", "oilgas", "fuel"] as const;

// ── Category section header ────────────────────────────────────────────────

function SectionHeader({ label, accent }: { label: string; accent: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "16px 0 6px",
      }}
    >
      <span
        style={{
          width: 3,
          height: 14,
          borderRadius: 999,
          background: accent,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#888",
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 1,
          background: "rgba(0,0,0,0.07)",
          marginLeft: 2,
        }}
      />
    </div>
  );
}

// ── Module card row ────────────────────────────────────────────────────────

interface ModuleCardProps {
  slug: string;
  title: string;
  disabled: boolean;
  href: string | null;
  badge: string;
  accent: string;
  onNavigate: (href: string) => void;
}

function ModuleCard({ slug, title, disabled, href, badge, accent, onNavigate }: ModuleCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={title}
      onClick={() => { if (!disabled && href) onNavigate(href); }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled && href) {
          e.preventDefault();
          onNavigate(href);
        }
      }}
      onMouseEnter={() => !disabled && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => !disabled && setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 14px 10px 0",
        borderRadius: 10,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        position: "relative",
        background: hovered ? ORANGE_SOFT : "transparent",
        transform: hovered ? "translateX(4px)" : "translateX(0)",
        transition: "background 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease",
        outline: "none",
        // Left accent bar (appears on hover via overflow+clip trick)
        overflow: "visible",
        marginBottom: 2,
      }}
    >
      {/* Left accent bar */}
      <div
        style={{
          position: "absolute",
          left: -14,
          top: "50%",
          transform: `translateY(-50%) scaleY(${hovered ? 1 : 0})`,
          transformOrigin: "center",
          width: 3,
          height: "60%",
          borderRadius: 999,
          background: accent,
          transition: "transform 0.18s ease",
          pointerEvents: "none",
        }}
      />

      {/* Icon container */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: hovered
            ? "rgba(255, 80, 0, 0.12)"
            : "rgba(0, 0, 0, 0.05)",
          color: hovered ? ORANGE : "#555",
          transition: "background 0.18s ease, color 0.22s ease, transform 0.22s ease, box-shadow 0.22s ease",
          transform: hovered ? "scale(1.12)" : "scale(1)",
          boxShadow: hovered
            ? `0 4px 14px ${ORANGE_GLOW}, 0 1px 4px rgba(0,0,0,0.08)`
            : "none",
        }}
        aria-hidden="true"
      >
        {getModuleIcon(slug, 20, 2)}
      </div>

      {/* Module name */}
      <span
        style={{
          flex: 1,
          fontSize: 14,
          fontWeight: 600,
          color: hovered ? "#111" : "#222",
          fontFamily: "Arial, Helvetica, sans-serif",
          transition: "color 0.15s ease",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 1.3,
        }}
      >
        {title}
      </span>

      {/* Badge (if present) */}
      {badge && badge !== "Available" && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: disabled ? "#999" : ORANGE,
            background: disabled ? "rgba(0,0,0,0.06)" : "rgba(255,80,0,0.10)",
            borderRadius: 6,
            padding: "2px 7px",
          }}
        >
          {badge}
        </span>
      )}

      {/* Arrow indicator */}
      {!disabled && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          width={14}
          height={14}
          style={{
            flexShrink: 0,
            color: hovered ? ORANGE : "rgba(0,0,0,0.20)",
            transition: "color 0.18s ease, transform 0.18s ease",
            transform: hovered ? "translateX(3px)" : "translateX(0)",
          }}
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const router = useRouter();
  const { cardsByCategory } = useHomeData();

  return (
    <main
      style={{
        background: BG,
        minHeight: "100vh",
        color: "#1a1a1a",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <NavBar />

      {/* 3-column split: cards (left, 1.4fr) · News Hunter (center, 1fr) ·
          Team + Data Sources (right, 1fr). News Hunter sits visually
          centered on the page; the cards list still gets the most width
          because it carries the densest content (3 categories × ~5 rows). */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr",
          gap: 0,
          alignItems: "start",
          padding: "32px 24px 80px",
        }}
      >
        {/* ── Left column: module list ──────────────────────────────────── */}
        <section
          style={{ paddingRight: 24, paddingLeft: 14 }}
          aria-label="Module navigation"
        >
          {CATEGORY_ORDER.map((cat) => {
            const cards = cardsByCategory[cat];
            if (!cards || cards.length === 0) return null;
            const accent = CATEGORY_ACCENT[cat] ?? ORANGE;

            return (
              <div key={cat}>
                <SectionHeader label={CATEGORY_LABELS[cat] ?? cat} accent={accent} />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {cards.map((card) => (
                    <ModuleCard
                      key={card.slug}
                      slug={card.slug}
                      title={card.title}
                      disabled={card.disabled}
                      href={card.href}
                      badge={card.badge}
                      accent={accent}
                      onNavigate={(href) => router.push(href)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        {/* ── Center column: News Hunter live panel ───────────────────── */}
        <section
          style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 2 }}
          aria-label="Latest news"
        >
          <NewsHunterPanel />
        </section>

        {/* ── Right column: Team + Data Sources ────────────────────────── */}
        <section style={{ paddingLeft: 12, paddingTop: 2 }}>
          <TeamPanel />
          <div style={{ marginBottom: 12 }} />
          <DataSourcesTable />
        </section>
      </div>
    </main>
  );
}
