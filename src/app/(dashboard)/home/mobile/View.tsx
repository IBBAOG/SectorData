"use client";

// Mobile view for /home.
//
// Redesigned 2026-05-26: icon + module name list layout.
// One card per row, compact, with per-slug SVG icons from moduleIcons.tsx.
// Hover/tap: icon glows orange, row gets accent-left-bar, translateX(3px).
// Same analysis/structure as desktop — same categories, same visibility logic.
//
// Structure:
//   MobileTopBar  — sticky glass top bar (wordmark + Sign in / avatar)
//   Greeting      — "Good morning / afternoon / evening, <name>"
//   Search input  — sticky below top bar, live-filters module list
//   4× category sections — Markets / Oil & Gas / Fuel Distribution / Admin
//     - sticky collapsible section header with chevron + count badge
//     - compact list: icon circle + module name + chevron
//   MobileBottomTabBar — fixed bottom nav

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  MobileTopBar,
  MobileBottomTabBar,
  type MobileBottomTab,
  ChevronRightIcon,
  ChevronDownIcon,
  SearchIcon,
} from "@/components/dashboard/mobile";
import { useHomeData, type HomeCategory } from "../useHomeData";
import { useUserProfile } from "../../../../context/UserProfileContext";
import { getModuleIcon } from "../../../../data/moduleIcons";

// ── Design tokens ─────────────────────────────────────────────────────────
const CATEGORY_ACCENT: Record<HomeCategory, string> = {
  markets: "#ff5000",
  oilgas: "#2563eb",
  fuel: "#059669",
  admin: "#6b7280",
};

const CATEGORY_ACCENT_SOFT: Record<HomeCategory, string> = {
  markets: "rgba(255, 80, 0, 0.12)",
  oilgas: "rgba(37, 99, 235, 0.12)",
  fuel: "rgba(5, 150, 105, 0.12)",
  admin: "rgba(107, 114, 128, 0.12)",
};

const CATEGORY_LABELS: Record<HomeCategory, string> = {
  markets: "Markets",
  oilgas: "Oil & Gas",
  fuel: "Fuel Distribution",
  admin: "Admin",
};

const CATEGORY_ORDER: HomeCategory[] = ["markets", "oilgas", "fuel", "admin"];

// ── Helpers ──────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function getInitials(fullName: string | null | undefined): string {
  if (!fullName) return "?";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getFirstName(fullName: string | null | undefined): string {
  if (!fullName) return "there";
  return fullName.trim().split(/\s+/)[0];
}

// ── Module row (icon + name) ──────────────────────────────────────────────

interface ModuleRowProps {
  slug: string;
  title: string;
  disabled: boolean;
  href: string | null;
  accent: string;
  accentSoft: string;
  onNavigate: (href: string) => void;
}

function ModuleRow({ slug, title, disabled, href, accent, accentSoft, onNavigate }: ModuleRowProps) {
  const [pressed, setPressed] = useState(false);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={title}
      aria-disabled={disabled}
      onClick={() => { if (!disabled && href) onNavigate(href); }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled && href) {
          e.preventDefault();
          onNavigate(href);
        }
      }}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr auto",
        alignItems: "center",
        gap: 12,
        minHeight: 56,
        padding: "0 16px 0 12px",
        background: pressed ? "rgba(0,0,0,0.04)" : "var(--mobile-surface)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        WebkitTapHighlightColor: "transparent",
        outline: "none",
        // Left accent bar via box-shadow
        boxShadow: pressed
          ? `inset 3px 0 0 ${accent}`
          : "none",
        transition: "background 0.12s ease, box-shadow 0.12s ease",
        position: "relative",
      }}
    >
      {/* Icon bubble */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          background: pressed ? accentSoft : "rgba(0,0,0,0.05)",
          color: pressed ? accent : "var(--mobile-text-muted)",
          transition: "background 0.12s ease, color 0.12s ease, transform 0.12s ease",
          transform: pressed ? "scale(1.08)" : "scale(1)",
        }}
        aria-hidden="true"
      >
        {getModuleIcon(slug, 20, 2)}
      </div>

      {/* Module name */}
      <span
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "var(--mobile-text)",
          fontFamily: "Arial, Helvetica, sans-serif",
          lineHeight: 1.25,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>

      {/* Chevron */}
      {!disabled && (
        <span
          style={{
            color: "var(--mobile-text-faint)",
            display: "flex",
            alignItems: "center",
            transition: "transform 0.12s ease",
            transform: pressed ? "translateX(3px)" : "translateX(0)",
          }}
          aria-hidden="true"
        >
          <ChevronRightIcon size={16} />
        </span>
      )}
    </div>
  );
}

// ── Tab bar icons ─────────────────────────────────────────────────────────

const HOME_TABS: MobileBottomTab[] = [
  {
    key: "home",
    label: "Home",
    active: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10v10h14V10" />
      </svg>
    ),
  },
  {
    key: "discover",
    label: "Discover",
    active: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="m9 15 2-6 6-2-2 6z" />
      </svg>
    ),
  },
  {
    key: "saved",
    label: "Saved",
    active: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 4h12v17l-6-4-6 4z" />
      </svg>
    ),
  },
  {
    key: "profile",
    label: "Profile",
    active: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
];

// ── Main component ────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const router = useRouter();
  const { profile, role } = useUserProfile();
  const {
    cardsByCategory,
    search,
    setSearch,
    collapsed,
    toggleCollapsed,
  } = useHomeData();

  const isAnon = role === "Anon";
  const initials = getInitials(profile?.full_name);
  const firstName = isAnon ? "Guest" : getFirstName(profile?.full_name);

  function handleTabChange(key: string) {
    if (key === "profile") {
      router.push(isAnon ? "/login" : "/profile");
    }
  }

  return (
    <div
      style={{
        background: "var(--mobile-bg)",
        minHeight: "100dvh",
        fontFamily: "Arial, Helvetica, sans-serif",
        color: "var(--mobile-text)",
        fontSize: 14,
        lineHeight: 1.4,
        WebkitFontSmoothing: "antialiased",
        paddingBottom: "calc(var(--mobile-tabbar-h) + var(--mobile-safe-bottom))",
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <MobileTopBar
        leftSlot={
          <div
            style={{
              fontWeight: 700,
              fontSize: 17,
              letterSpacing: "0.04em",
              color: "var(--mobile-text)",
            }}
          >
            SECTORDATA
            <span style={{ color: "var(--mobile-accent)" }}>.</span>
          </div>
        }
        showThemeToggle={false}
        showAvatar={!isAnon}
        avatarInitials={initials}
        avatarLabel={profile?.full_name ?? "User"}
        rightSlot={
          isAnon ? (
            <Link
              href="/login"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "6px 14px",
                background: "var(--mobile-accent)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                borderRadius: 999,
                textDecoration: "none",
                letterSpacing: "0.02em",
                minHeight: 32,
              }}
            >
              Sign in
            </Link>
          ) : undefined
        }
      />

      {/* ── Greeting ─────────────────────────────────────────────────── */}
      <section
        aria-label="Greeting"
        style={{ padding: "20px 16px 8px", background: "var(--mobile-bg)" }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--mobile-text)",
            letterSpacing: "-0.01em",
            lineHeight: 1.15,
          }}
        >
          {getGreeting()}, {firstName}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 14,
            color: "var(--mobile-text-muted)",
            lineHeight: 1.4,
          }}
        >
          What would you like to explore?
        </div>
      </section>

      {/* ── Search ───────────────────────────────────────────────────── */}
      <div
        style={{
          position: "sticky",
          top: "var(--mobile-topbar-h)",
          zIndex: 25,
          padding: "8px 16px 12px",
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
            placeholder="Search modules..."
            aria-label="Search modules"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              height: 40,
              borderRadius: 10,
              border: "1px solid var(--mobile-border)",
              background: "var(--mobile-surface)",
              color: "var(--mobile-text)",
              fontFamily: "inherit",
              fontSize: 14,
              padding: "0 36px 0 38px",
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
                width: 24,
                height: 24,
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
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Module list ──────────────────────────────────────────────── */}
      <main style={{ paddingBottom: 12 }}>
        {CATEGORY_ORDER.map((cat) => {
          const cards = cardsByCategory[cat];
          if (search && cards.length === 0) return null;

          const isCollapsed = collapsed[cat];
          const label = CATEGORY_LABELS[cat];
          const accent = CATEGORY_ACCENT[cat];
          const accentSoft = CATEGORY_ACCENT_SOFT[cat];

          return (
            <section
              key={cat}
              style={{
                background: "var(--mobile-surface)",
                borderTop: "1px solid var(--mobile-divider)",
                borderBottom: "1px solid var(--mobile-divider)",
                marginTop: 14,
              }}
            >
              {/* Section header */}
              <header
                role="button"
                tabIndex={0}
                aria-expanded={!isCollapsed}
                onClick={() => toggleCollapsed(cat)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleCollapsed(cat);
                  }
                }}
                style={{
                  position: "sticky",
                  top: "calc(var(--mobile-topbar-h) + 60px)",
                  zIndex: 18,
                  display: "grid",
                  gridTemplateColumns: "auto auto 1fr auto",
                  alignItems: "center",
                  gap: 8,
                  height: 44,
                  padding: "0 16px",
                  background: "var(--mobile-glass-bg)",
                  WebkitBackdropFilter: "var(--mobile-glass-blur)",
                  backdropFilter: "var(--mobile-glass-blur)",
                  borderBottom: "1px solid var(--mobile-glass-border)",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                {/* Chevron */}
                <span
                  style={{
                    width: 18,
                    height: 18,
                    color: "var(--mobile-text-muted)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "transform 0.2s ease",
                    transform: isCollapsed ? "rotate(-90deg)" : "none",
                  }}
                >
                  <ChevronDownIcon size={14} strokeWidth={2.5} />
                </span>

                {/* Category dot */}
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: accent,
                    flexShrink: 0,
                  }}
                />

                {/* Label */}
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--mobile-text)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  {label}
                </span>

                {/* Count badge */}
                <span
                  style={{
                    minWidth: 24,
                    height: 20,
                    padding: "0 7px",
                    borderRadius: 999,
                    background: "rgba(0,0,0,0.06)",
                    color: "var(--mobile-text-muted)",
                    fontSize: 11,
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    letterSpacing: "0.02em",
                  }}
                >
                  {cards.length}
                </span>
              </header>

              {/* Section body */}
              {!isCollapsed && (
                <div>
                  {cards.map((card, idx) => (
                    <div key={card.slug}>
                      <ModuleRow
                        slug={card.slug}
                        title={card.title}
                        disabled={card.disabled}
                        href={card.href}
                        accent={accent}
                        accentSoft={accentSoft}
                        onNavigate={(href) => router.push(href)}
                      />
                      {idx < cards.length - 1 && (
                        <div
                          style={{
                            height: 1,
                            background: "var(--mobile-divider)",
                            margin: "0 16px 0 68px",
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </main>

      {/* ── Bottom tab bar ───────────────────────────────────────────── */}
      <MobileBottomTabBar tabs={HOME_TABS} onChange={handleTabChange} />
    </div>
  );
}
