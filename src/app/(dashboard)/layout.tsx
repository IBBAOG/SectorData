"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "../../lib/supabaseClient";
import { UserProfileProvider } from "../../context/UserProfileContext";
import { useUserProfile } from "../../context/UserProfileContext";
import { NewsHunterProvider } from "../../context/NewsHunterContext";
import { rpcUpsertMyProfile } from "../../lib/profileRpc";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const supabase = getSupabaseClient();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) router.replace("/login");
      else setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

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
        <FirstLoginGate />
        {children}
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
