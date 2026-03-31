"use client";

import { useEffect, useState } from "react";

import NavBar from "../../../components/NavBar";
import { useUserProfile } from "../../../context/UserProfileContext";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { getInitials, formatMemberSince } from "../../../lib/avatarUtils";
import { rpcUpsertMyProfile } from "../../../lib/profileRpc";

const ORANGE = "#FF5000";
const BG = "#f5f5f5";

function PencilIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 14 14" fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path
        d="M9.5 1.5L12.5 4.5L4.5 12.5H1.5V9.5L9.5 1.5Z"
        stroke="currentColor" strokeWidth="1.4"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ProfilePage() {
  const { profile, loading, refreshProfile } = useUserProfile();
  const [email, setEmail] = useState<string | null>(null);
  const supabase = getSupabaseClient();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null);
    });
  }, [supabase]);

  function startEdit() {
    setEditName(profile?.full_name ?? "");
    setSaveError(false);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setSaveError(false);
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = editName.trim();
    if (!trimmed || !supabase) return;
    setSaving(true);
    setSaveError(false);
    const result = await rpcUpsertMyProfile(supabase, trimmed, profile?.avatar_url ?? null);
    setSaving(false);
    if (!result) {
      setSaveError(true);
      return;
    }
    await refreshProfile();
    setEditing(false);
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

          {/* Name row — always shown, with inline edit */}
          <div className="profile-info-row">
            <span className="profile-info-label">Name</span>
            {editing ? (
              <form className="profile-name-edit-form" onSubmit={handleSaveName}>
                <input
                  className="profile-name-edit-input"
                  type="text"
                  value={editName}
                  onChange={(e) => { setEditName(e.target.value); setSaveError(false); }}
                  disabled={saving}
                  autoFocus
                  maxLength={80}
                  placeholder="Your full name"
                />
                {saveError && (
                  <span className="profile-name-edit-error">Error saving. Try again.</span>
                )}
                <div className="profile-name-edit-actions">
                  <button
                    type="submit"
                    className="profile-name-edit-btn profile-name-edit-btn--save"
                    disabled={saving || editName.trim().length < 2}
                  >
                    {saving ? "…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className="profile-name-edit-btn profile-name-edit-btn--cancel"
                    onClick={cancelEdit}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="profile-info-value">
                  {loading ? "—" : (profile?.full_name ?? "—")}
                </span>
                {!loading && (
                  <button
                    className="profile-name-edit-icon-btn"
                    onClick={startEdit}
                    aria-label="Edit name"
                    title="Edit name"
                  >
                    <PencilIcon />
                  </button>
                )}
              </div>
            )}
          </div>

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

      </section>
    </main>
  );
}
