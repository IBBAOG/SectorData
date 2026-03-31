"use client";

import { useEffect, useState } from "react";

import NavBar from "../../../components/NavBar";
import { useUserProfile } from "../../../context/UserProfileContext";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { getInitials, formatMemberSince } from "../../../lib/avatarUtils";

const ORANGE = "#FF5000";
const BG = "#f5f5f5";

export default function ProfilePage() {
  const { profile, loading } = useUserProfile();
  const [email, setEmail] = useState<string | null>(null);
  const supabase = getSupabaseClient();

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null);
    });
  }, [supabase]);

  const initials = getInitials(profile, email);
  const displayName = profile?.full_name ?? email ?? "User";
  const isAdmin = profile?.role === "Admin";

  return (
    <main style={{ background: BG, minHeight: "100vh", fontFamily: "Arial, sans-serif" }}>
      <NavBar />

      <section style={{ maxWidth: 960, margin: "0 auto", padding: "64px 24px" }}>

        {/* Page header */}
        <div style={{ marginBottom: 40 }}>
          <div
            style={{
              display: "inline-block",
              background: "rgba(232,93,32,0.10)",
              color: ORANGE,
              borderRadius: 20,
              padding: "3px 12px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            My Account
          </div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#111", margin: 0 }}>
            Profile
          </h1>
        </div>

        {/* Profile card */}
        <div className="profile-card">

          {/* Avatar circle */}
          <div className="profile-avatar-circle">{initials}</div>

          {/* Name */}
          <h2
            style={{
              textAlign: "center",
              fontSize: "1.25rem",
              fontWeight: 700,
              color: "#1a1a1a",
              margin: "0 0 8px",
            }}
          >
            {loading ? "Loading…" : displayName}
          </h2>

          {/* Role badge */}
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <span className={`role-badge role-badge--${isAdmin ? "admin" : "client"}`}>
              {loading ? "—" : (profile?.role ?? "Client")}
            </span>
          </div>

          {/* Info rows */}
          <div className="profile-info-row">
            <span className="profile-info-label">Email</span>
            <span className="profile-info-value" style={{ color: loading ? "#bbb" : undefined }}>
              {loading ? "Loading…" : (email ?? "—")}
            </span>
          </div>

          {profile?.full_name && (
            <div className="profile-info-row">
              <span className="profile-info-label">Name</span>
              <span className="profile-info-value">{profile.full_name}</span>
            </div>
          )}

          <div className="profile-info-row">
            <span className="profile-info-label">Role</span>
            <span className="profile-info-value">
              {loading ? "—" : (profile?.role ?? "Client")}
            </span>
          </div>

          <div className="profile-info-row">
            <span className="profile-info-label">Member since</span>
            <span className="profile-info-value">
              {loading
                ? "—"
                : profile?.created_at
                  ? formatMemberSince(profile.created_at)
                  : "—"}
            </span>
          </div>
        </div>

        {/* Extensibility note: additional sections (Edit Profile, Preferences,
            Notification Settings, etc.) can be added as separate cards below
            this one without modifying the profile card above. */}
      </section>
    </main>
  );
}
