"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getSupabaseClient } from "../../lib/supabaseClient";
import { UserProfileProvider } from "../../context/UserProfileContext";
import { useUserProfile } from "../../context/UserProfileContext";
import { NewsHunterProvider } from "../../context/NewsHunterContext";
import { rpcUpsertMyProfile } from "../../lib/profileRpc";
import { trackEvent } from "../../lib/tracking";
import { ROUTE_TITLES } from "../../components/NavBar";
import Footer from "../../components/Footer";

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

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        router.replace("/login");
        return;
      }

      // MFA assurance check: if the user has a verified factor but has not
      // satisfied the AAL2 challenge yet (nextLevel = aal2, currentLevel =
      // aal1), send them back to /login so the second-factor challenge form
      // can be presented before we render protected UI.
      try {
        if (cancelled) return;
        const { data: aalData } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (cancelled) return;
        const currentLevel = aalData?.currentLevel;
        const nextLevel = aalData?.nextLevel;
        if (nextLevel === "aal2" && currentLevel !== "aal2") {
          router.replace("/login");
          return;
        }
      } catch {
        // If the MFA call fails (network etc.), prefer hard fail-closed —
        // sending the user back to the login screen surfaces the issue.
        if (cancelled) return;
        router.replace("/login");
        return;
      }

      if (cancelled) return;

      // Fire 'login' event once per browser session, keyed by Supabase
      // session access token so a refresh in the same tab does not retrigger.
      try {
        const sessionId = data.session.access_token?.slice(0, 24) ?? "anon";
        const storageKey = `analytics_login_logged_${sessionId}`;
        if (
          typeof window !== "undefined" &&
          !window.sessionStorage.getItem(storageKey)
        ) {
          window.sessionStorage.setItem(storageKey, "1");
          trackEvent("login");
        }
      } catch {
        // sessionStorage unavailable (private mode, etc.) — fail silent.
      }
      if (cancelled) return;
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  // Page-view tracking: fires on every pathname change once auth is settled.
  useEffect(() => {
    if (checking || !pathname) return;
    if (TRACKING_EXCLUDED_ROUTES.has(pathname)) return;
    trackEvent("page_view", pathname);
  }, [pathname, checking]);

  // Per-route browser tab title.
  useEffect(() => {
    if (!pathname) return;
    const label = ROUTE_TITLES[pathname];
    document.title = label ? `${label} | O&G Data` : "O&G Data";
  }, [pathname]);

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
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <FirstLoginGate />
          <div style={{ flex: 1 }}>{children}</div>
          <Footer />
        </div>
      </NewsHunterProvider>
    </UserProfileProvider>
  );
}

/* ── First-login modal ───────────────────────────────────────────────────────
   Shown once when the authenticated user has no display name set yet.
   Disappears automatically after a successful save (profile.full_name is set).
   ─────────────────────────────────────────────────────────────────────────── */
function FirstLoginGate() {
  const { profile, loading, refreshProfile } = useUserProfile();
  const supabase = getSupabaseClient();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Don't render while loading or when name is already set
  if (loading || profile?.full_name) return null;

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
