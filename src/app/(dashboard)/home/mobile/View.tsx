"use client";

// Mobile view for /home.
// Visual source of truth: mockups/home-mobile.html
//
// Structure:
//   MobileTopBar  — sticky glass top bar (wordmark + theme toggle + avatar)
//   Greeting      — "Good morning / afternoon / evening, <name>"
//   Search input  — sticky below top bar, live-filters module list
//   4× category sections — Markets / Oil & Gas / Fuel Distribution / Admin
//     - sticky collapsible section header with chevron + count badge
//     - list of module cards (gradient thumb + title + description + chevron)
//   MobileBottomTabBar — fixed bottom nav (Home / Discover / Saved / Profile)
//
// Components used from src/components/dashboard/mobile/:
//   MobileTopBar, MobileBottomTabBar

import Link from "next/link";
import { useRouter } from "next/navigation";
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

// ---- Greeting ---------------------------------------------------------------

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

// ---- Category gradient thumbnails ------------------------------------------

const CATEGORY_GRADIENT: Record<HomeCategory, string> = {
  markets: "linear-gradient(135deg, #ff5000 0%, #b3370a 100%)",
  oilgas: "linear-gradient(135deg, #2563eb 0%, #0d9488 100%)",
  fuel: "linear-gradient(135deg, #059669 0%, #0d9488 100%)",
  admin: "linear-gradient(135deg, #4b5563 0%, #1f2937 100%)",
};

const CATEGORY_LABELS: Record<HomeCategory, string> = {
  markets: "Markets",
  oilgas: "Oil & Gas",
  fuel: "Fuel Distribution",
  admin: "Admin",
};

const CATEGORY_ORDER: HomeCategory[] = ["markets", "oilgas", "fuel", "admin"];

// ---- Tab bar icons ----------------------------------------------------------

const HOME_TABS: MobileBottomTab[] = [
  {
    key: "home",
    label: "Home",
    active: true,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
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
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
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
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 4h12v17l-6-4-6 4z" />
      </svg>
    ),
  },
  {
    key: "profile",
    label: "Profile",
    active: false,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
];

// ---- Main component ---------------------------------------------------------

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

  // Bottom tab navigation — "Discover" and "Saved" are placeholders;
  // "Profile" navigates to /profile. For anon visitors, the profile page
  // redirects to /login, so the tap effectively becomes "Sign in".
  function handleTabChange(key: string) {
    if (key === "profile") {
      router.push(isAnon ? "/login" : "/profile");
    }
    // Home = stay; Discover/Saved = future features
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
      {/* ---- Top bar -------------------------------------------------------- */}
      {/* For anon visitors the right slot becomes a "Sign in" pill instead of
          the avatar bubble — there is no profile to identify. */}
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

      {/* ---- Greeting ------------------------------------------------------- */}
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

      {/* ---- Search --------------------------------------------------------- */}
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

      {/* ---- Gallery -------------------------------------------------------- */}
      <main style={{ paddingBottom: 12 }}>
        {CATEGORY_ORDER.map((cat) => {
          const cards = cardsByCategory[cat];
          // Hide entire section when search returns 0 cards for it
          if (search && cards.length === 0) return null;

          const isCollapsed = collapsed[cat];
          const label = CATEGORY_LABELS[cat];

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
              {/* Section header — sticky below top bar + search */}
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
                  top: "calc(var(--mobile-topbar-h) + 60px)", // topbar + search strip
                  zIndex: 18,
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
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

                {/* Label */}
                <span
                  style={{
                    fontSize: 13,
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
                    height: 22,
                    padding: "0 8px",
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
                    <article
                      key={card.slug}
                      onClick={() => {
                        if (!card.disabled && card.href) router.push(card.href);
                      }}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "56px 1fr auto",
                        columnGap: 14,
                        alignItems: "center",
                        minHeight: 96,
                        padding: "14px 16px",
                        background: "var(--mobile-surface)",
                        borderBottom:
                          idx < cards.length - 1
                            ? "1px solid var(--mobile-divider)"
                            : "none",
                        cursor: card.disabled ? "default" : "pointer",
                        opacity: card.disabled ? 0.5 : 1,
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      {/* Gradient thumbnail */}
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 14,
                          background: CATEGORY_GRADIENT[card.category],
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          color: "#fff",
                          boxShadow:
                            "0 4px 12px rgba(0,0,0,0.10), 0 1px 0 rgba(255,255,255,0.18) inset",
                        }}
                        aria-hidden="true"
                      >
                        <CategoryIcon cat={card.category} slug={card.slug} />
                      </div>

                      {/* Body */}
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 600,
                            color: "var(--mobile-text)",
                            lineHeight: 1.2,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {card.title}
                        </div>
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 12,
                            color: "var(--mobile-text-muted)",
                            lineHeight: 1.35,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {card.description}
                        </div>
                      </div>

                      {/* Right: chevron */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 6,
                          color: "var(--mobile-text-faint)",
                          flexShrink: 0,
                        }}
                      >
                        <ChevronRightIcon size={18} />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </main>

      {/* ---- Bottom tab bar ------------------------------------------------- */}
      <MobileBottomTabBar tabs={HOME_TABS} onChange={handleTabChange} />
    </div>
  );
}

// ---- Per-slug icon picker ---------------------------------------------------
// Each module gets a relevant SVG icon. Falls back to the category icon.

function CategoryIcon({
  cat,
  slug,
}: {
  cat: HomeCategory;
  slug: string;
}): React.ReactElement {
  // Per-slug icons matching mockup
  const icons: Record<string, React.ReactElement> = {
    stocks: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <path d="M7 4v3" /><path d="M7 14v6" />
        <rect x="5" y="7" width="4" height="7" rx="1" />
        <path d="M17 3v4" /><path d="M17 14v7" />
        <rect x="15" y="7" width="4" height="7" rx="1" />
      </svg>
    ),
    "news-hunter": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <path d="M4 4h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
        <path d="M19 8h2v9a3 3 0 0 1-3 3" />
        <path d="M8 8h7" /><path d="M8 12h7" /><path d="M8 16h4" />
      </svg>
    ),
    "anp-cdp": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <path d="M3 20h18" /><path d="M6 20V8l6 4 6-4v12" />
        <path d="M9 14h6" /><path d="M12 4v4" />
      </svg>
    ),
    "anp-cdp-bsw": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <path d="M12 2.5s7 7.5 7 12.5a7 7 0 0 1-14 0c0-5 7-12.5 7-12.5z" />
        <path d="M9 15a3 3 0 0 0 3 3" />
      </svg>
    ),
    "anp-cdp-depletion": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <polyline points="3 6 9 12 13 8 21 16" />
        <polyline points="21 16 21 10 15 10" />
      </svg>
    ),
    "anp-cdp-diaria": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18" /><path d="M8 3v4" /><path d="M16 3v4" />
        <path d="M8 15h2" /><path d="M14 15h2" />
      </svg>
    ),
    "market-share": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <path d="M21 12a9 9 0 1 1-9-9" />
        <path d="M22 12A10 10 0 0 0 12 2v10z" />
      </svg>
    ),
    sales: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <rect x="3" y="12" width="4" height="9" rx="1" />
        <rect x="10" y="6" width="4" height="15" rx="1" />
        <rect x="17" y="9" width="4" height="12" rx="1" />
      </svg>
    ),
    "navios-diesel": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <path d="M3 17l1.5 3a1 1 0 0 0 .9.5h13.2a1 1 0 0 0 .9-.5L21 17" />
        <path d="M3 17l9-5 9 5" /><path d="M12 3v9" /><path d="M8 7h8" />
      </svg>
    ),
    "diesel-gasoline-margins": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <path d="M3 13a9 9 0 0 1 18 0" />
        <path d="M3 13h18" /><path d="M12 13l4-5" />
        <circle cx="12" cy="13" r="1.5" />
      </svg>
    ),
    "price-bands": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <path d="M3 8h18" /><path d="M3 16h18" />
        <path d="M7 4v16" /><path d="M17 4v16" />
      </svg>
    ),
    "subsidy-tracker": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <path d="M12 2v20" /><path d="M5 8l7 4 7-4" /><path d="M5 14l7 4 7-4" />
      </svg>
    ),
    "anp-precos-produtores": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <path d="M3 21V11l5 3V11l5 3V11l5 3V21" />
        <path d="M3 21h18" /><path d="M7 17h2" /><path d="M12 17h2" /><path d="M17 17h2" />
      </svg>
    ),
    "anp-precos-distribuicao": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <path d="M4 4h13l3 3v13H4z" /><path d="M8 9h8" /><path d="M8 13h8" /><path d="M8 17h5" />
      </svg>
    ),
    "anp-glp": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <path d="M9 3h6v3a3 3 0 0 1-6 0z" />
        <rect x="7" y="6" width="10" height="15" rx="3" />
        <path d="M10 11h4" /><path d="M10 15h4" />
      </svg>
    ),
    "imports-exports": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <circle cx="12" cy="12" r="8" />
        <path d="M2 12h3" /><path d="M19 12h3" />
        <path d="M7 7l-3 5 3 5" /><path d="M17 7l3 5-3 5" />
      </svg>
    ),
    "anp-lpc": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <rect x="4" y="3" width="10" height="18" rx="1" />
        <path d="M4 12h10" /><path d="M14 8h2l3 3v7a2 2 0 0 1-2 2" /><path d="M19 11v-3" />
      </svg>
    ),
    alerts: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    ),
    profile: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
    "admin-panel": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    ),
  };

  // Category fallback icons
  const fallback: Record<HomeCategory, React.ReactElement> = {
    markets: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <polyline points="3 17 9 11 13 15 21 7" />
        <polyline points="21 7 21 13 15 13" />
      </svg>
    ),
    oilgas: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
    fuel: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <rect x="3" y="12" width="4" height="9" rx="1" />
        <rect x="10" y="6" width="4" height="15" rx="1" />
      </svg>
    ),
    admin: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  };

  return icons[slug] ?? fallback[cat];
}
