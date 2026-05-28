"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Image from "next/image";
import { getSupabaseClient } from "../../lib/supabaseClient";
import { UserProfileProvider } from "../../context/UserProfileContext";
import { useUserProfile } from "../../context/UserProfileContext";
import { NewsHunterProvider } from "../../context/NewsHunterContext";
import { rpcUpsertMyProfile } from "../../lib/profileRpc";
import { trackEvent } from "../../lib/tracking";
import { ROUTE_TITLES } from "../../components/NavBar";
import Footer from "../../components/Footer";
import PWAInstallPrompt from "../../components/PWAInstallPrompt";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useTrackLastVisited } from "../../hooks/useTrackLastVisited";
import {
  MobileTopBar,
  MobileHomePill,
  MobileKebabMenu,
  MobileToastHost,
} from "../../components/dashboard/mobile";

// Routes excluded from page_view tracking — meta/admin pages should not
// pollute the dashboard engagement metrics they themselves report on.
const TRACKING_EXCLUDED_ROUTES = new Set<string>([
  "/login",
  "/profile",
  "/admin-panel",
  "/admin-analytics",
]);

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = getSupabaseClient();
  const [checking, setChecking] = useState(true);

  // Initial session check — anonymous visitors are allowed through (no
  // redirect to /login). The MFA gate runs only for authenticated Admins
  // and is moved into a separate effect after the profile loads.
  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;

      // Login event tracking — fires once per browser session, gated by
      // sessionStorage and only when an actual session exists.
      if (data.session) {
        try {
          const sessionId = data.session.access_token?.slice(0, 24) ?? "anon";
          const storageKey = `analytics_login_logged_${sessionId}`;
          if (
            typeof window !== "undefined" &&
            !window.sessionStorage.getItem(storageKey)
          ) {
            window.sessionStorage.setItem(storageKey, "1");
            // No visitor_id needed for logged-in events — the RPC uses auth.uid.
            trackEvent("login");
          }
        } catch {
          // sessionStorage unavailable (private mode, etc.) — fail silent.
        }
      }

      setChecking(false);
    });

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  if (!supabase) {
    return (
      <div className="container" style={{ padding: 24, fontFamily: "Arial" }}>
        <h5 style={{ fontWeight: 700 }}>Missing configuration</h5>
        <div style={{ fontSize: 13, color: "#555" }}>
          Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
          <code>.env.local</code>.
        </div>
      </div>
    );
  }

  if (checking) return null;

  return (
    <UserProfileProvider supabase={supabase}>
      <NewsHunterProvider supabase={supabase}>
        <AuthSideEffects pathname={pathname} router={router} />
        <FirstLoginGate />
        <DashboardShell>{children}</DashboardShell>
      </NewsHunterProvider>
    </UserProfileProvider>
  );
}

/* ── Shell switcher ────────────────────────────────────────────────────────
   Picks between desktop and mobile chrome based on viewport. Both shells
   render the same `children` (the active dashboard page); only the chrome
   around it differs. */
function DashboardShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  // Mount the last-visited tracker once at the shell level so it captures
  // every route change inside the dashboard. Tracking is mobile-only for now
  // (consumed by /home v2 horizontal "Last visited" row) — keeping the hook
  // unconditional avoids the rules-of-hooks footgun and is cheap (one
  // localStorage write per nav).
  useTrackLastVisited();

  if (isMobile) {
    return <MobileShell>{children}</MobileShell>;
  }
  return <DesktopShell>{children}</DesktopShell>;
}

/* ── Desktop shell ─────────────────────────────────────────────────────────
   The historical layout: full-height flex column, content + Footer, plus the
   PWA install prompt. NavBar is rendered by individual dashboard pages, not
   here. */
function DesktopShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <div style={{ flex: 1 }}>{children}</div>
      <Footer />
      <PWAInstallPrompt />
    </div>
  );
}

/* ── Mobile shell ──────────────────────────────────────────────────────────
   Plan § 3.2 chrome:
     • MobileTopBar (sticky 56px) — centered SectorData logo on the left
       slot, MobileKebabMenu on the right slot. No NavBar, no breadcrumb,
       no avatar — the kebab owns logout for logged-in users; anon visitors
       see the slot but the kebab renders nothing.
     • <main> — the active dashboard page renders here.
     • MobileHomePill (floating, auto-hides on /home) — single primary nav.
     • MobileToastHost — listens for `app-toast` CustomEvents and renders
       transient pill messages (used by MobileExcludedRedirect).
   No Footer, no PWAInstallPrompt — both are desktop chrome. */
function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--mobile-bg)",
        minHeight: "100dvh",
        fontFamily: "Arial, Helvetica, sans-serif",
        color: "var(--mobile-text)",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <MobileTopBar
        leftSlot={
          // The MobileTopBar grid is `1fr auto`. To get a truly centered
          // wordmark while the kebab sits in the right column, we let the
          // leftSlot fill the 1fr and center its contents. The kebab takes
          // 44px on the right, so we add a 44px right padding inside the
          // leftSlot so the wordmark optically aligns to the viewport
          // centerline (visual symmetry trick — without it the wordmark
          // would lean leftwards by half the kebab width).
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              minWidth: 0,
              paddingLeft: 44,
            }}
          >
            <Image
              src="/blood-drop-navbar.png"
              alt=""
              width={22}
              height={22}
              priority
              style={{
                opacity: 0.78,
                height: 22,
                width: "auto",
                objectFit: "contain",
              }}
            />
            <span
              style={{
                fontWeight: 700,
                fontSize: 16,
                letterSpacing: "0.06em",
                color: "var(--mobile-text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              SECTORDATA
              <span style={{ color: "var(--mobile-accent)" }}>.</span>
            </span>
          </div>
        }
        rightSlot={<MobileKebabMenu />}
      />

      <main>{children}</main>

      <MobileHomePill />
      <MobileToastHost />
    </div>
  );
}

/* ── Auth-side effects (MFA gate, page-view tracking, document.title) ──────
   Lives inside the provider so it has access to `role`, `loading` and
   `visitorId` from UserProfileContext. The MFA challenge is enforced only
   for Admins; Client and Anon visitors pass through. */
function AuthSideEffects({
  pathname,
  router,
}: {
  pathname: string | null;
  router: ReturnType<typeof useRouter>;
}) {
  const supabase = getSupabaseClient();
  const { role, loading, visitorId } = useUserProfile();

  // Admin MFA gate — runs only after the profile resolves and the user is
  // identified as Admin. AAL2 challenge must be satisfied; otherwise we
  // bounce back to /login where the challenge form lives.
  useEffect(() => {
    if (loading || !supabase) return;
    if (role !== "Admin") return;
    let cancelled = false;
    (async () => {
      try {
        const { data: aalData } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (cancelled) return;
        const currentLevel = aalData?.currentLevel;
        const nextLevel = aalData?.nextLevel;
        if (nextLevel === "aal2" && currentLevel !== "aal2") {
          router.replace("/login");
        }
      } catch {
        // Fail-closed: if the MFA introspection errors out, route to /login.
        router.replace("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, role, router, supabase]);

  // Page-view tracking: fires on every pathname change once auth has settled.
  // Anonymous visitors are attributed via visitorId; logged-in users via
  // auth.uid server-side. Excluded routes are skipped entirely.
  useEffect(() => {
    if (loading || !pathname) return;
    if (TRACKING_EXCLUDED_ROUTES.has(pathname)) return;
    trackEvent("page_view", pathname, {}, visitorId);
  }, [pathname, loading, visitorId]);

  // Per-route browser tab title.
  useEffect(() => {
    if (!pathname) return;
    const label = ROUTE_TITLES[pathname];
    document.title = label ? `${label} | O&G Data` : "O&G Data";
  }, [pathname]);

  return null;
}

/* ── First-login modal ───────────────────────────────────────────────────────
   Shown once when the authenticated user has no display name set yet.
   Disappears automatically after a successful save (profile.full_name is set).
   Anonymous visitors (`profile === null`) never see this modal.
   ─────────────────────────────────────────────────────────────────────────── */
function FirstLoginGate() {
  const { profile, loading, refreshProfile } = useUserProfile();
  const supabase = getSupabaseClient();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Don't render while loading, when no profile (anon), or when name is set.
  if (loading || !profile || profile.full_name) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !supabase) return;
    setSaving(true);
    setError(null);
    const result = await rpcUpsertMyProfile(supabase, trimmed, null);
    setSaving(false);
    if (!result) {
      setError("Could not save your name. Please try again.");
      return;
    }
    await refreshProfile();
  }

  return (
    <div className="first-login-overlay">
      <div className="first-login-modal">
        <h2>Welcome!</h2>
        <p>Before you continue, please choose your display name.</p>
        <form onSubmit={handleSubmit}>
          <input
            className="profile-edit-input"
            type="text"
            placeholder="Your full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            autoFocus
            required
            minLength={2}
            maxLength={80}
          />
          {error && <div className="profile-edit-error">{error}</div>}
          <button
            className="profile-save-btn"
            type="submit"
            disabled={saving || name.trim().length < 2}
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
