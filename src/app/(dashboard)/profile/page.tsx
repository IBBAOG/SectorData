"use client";

import { useEffect, useState } from "react";

import NavBar from "../../../components/NavBar";
import { useUserProfile } from "../../../context/UserProfileContext";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { getInitials, formatMemberSince } from "../../../lib/avatarUtils";
import { rpcUpsertMyProfile } from "../../../lib/profileRpc";

const ORANGE = "#FF5000";
const BG = "#f5f5f5";

export default function ProfilePage() {
  const { profile, loading, refreshProfile } = useUserProfile();
  const [email, setEmail] = useState<string | null>(null);
  const supabase = getSupabaseClient();

  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null);
    });
  }, [supabase]);

  // Seed the edit field once profile loads
  useEffect(() => {
    if (profile?.full_name) setEditName(profile.full_name);
  }, [profile?.full_name]);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = editName.trim();
    if (!trimmed || !supabase) return;
    setSaving(true);
    setSaveStatus("idle");
    const result = await rpcUpsertMyProfile(supabase, trimmed, profile?.avatar_url ?? null);
    setSaving(false);
    if (!result) {
      setSaveStatus("error");
      return;
    }
    await refreshProfile();
    setSaveStatus("success");
  }

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

        {/* Edit name card */}
        <div className="profile-edit-card">
          <h3>Edit Display Name</h3>
          <form onSubmit={handleSaveName}>
            <input
              className="profile-edit-input"
              type="text"
              value={editName}
              onChange={(e) => { setEditName(e.target.value); setSaveStatus("idle"); }}
              disabled={saving || loading}
              maxLength={80}
              placeholder="Your full name"
            />
            {saveStatus === "success" && (
              <div className="profile-edit-success">Name updated successfully.</div>
            )}
            {saveStatus === "error" && (
              <div className="profile-edit-error">Could not save. Please try again.</div>
            )}
            <button
              className="profile-save-btn"
              type="submit"
              disabled={saving || loading || editName.trim().length < 2}
            >
              {saving ? "Saving…" : "Save Name"}
            </button>
          </form>
        </div>

      </section>
    </main>
  );
}
