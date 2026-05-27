"use client";

// Mobile view for /home.
//
// Redesigned 2026-05-28: gallery extracted to <ModuleGallery variant="mobile" />,
// which carries the same category accent treatment as the desktop variant
// (colored icon tiles + accent press states + section dot/count badges).
// Same analysis/structure as desktop — same categories, same visibility logic.
//
// Structure:
//   MobileTopBar  — sticky glass top bar (wordmark + Sign in / avatar)
//   Greeting      — "Good morning / afternoon / evening, <name>"
//   Search input  — sticky below top bar, live-filters module list
//   <ModuleGallery variant="mobile" /> — 3× collapsible sections
//   MobileBottomTabBar — fixed bottom nav

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MobileTopBar,
  MobileBottomTabBar,
  type MobileBottomTab,
  SearchIcon,
} from "@/components/dashboard/mobile";
import { useHomeData } from "../useHomeData";
import { useUserProfile } from "../../../../context/UserProfileContext";
import ModuleGallery from "../../../../components/home/ModuleGallery";

// Sticky-top offset for category section headers — must equal
// MobileTopBar height + the height of the sticky search row beneath it.
// Topbar = 56 (var --mobile-topbar-h), search container = 60.
const GALLERY_STICKY_TOP = 56 + 60;

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

  // When search is active, hide sections that have no matching cards.
  const isSearching = search.trim().length > 0;

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

      {/* ── Module list (glass-coherent gallery) ─────────────────────── */}
      <main>
        <ModuleGallery
          variant="mobile"
          cardsByCategory={cardsByCategory}
          onNavigate={(href) => router.push(href)}
          collapsed={collapsed}
          toggleCollapsed={toggleCollapsed}
          hideEmptySections={isSearching}
          stickyTop={GALLERY_STICKY_TOP}
        />
      </main>

      {/* ── Bottom tab bar ───────────────────────────────────────────── */}
      <MobileBottomTabBar tabs={HOME_TABS} onChange={handleTabChange} />
    </div>
  );
}
