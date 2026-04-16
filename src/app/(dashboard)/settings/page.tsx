"use client";

import { useCallback, useEffect, useState } from "react";

import NavBar from "../../../components/NavBar";
import { useRoleGuard } from "../../../hooks/useRoleGuard";
import { useUserProfile } from "../../../context/UserProfileContext";
import {
  rpcSetModuleVisibility,
  rpcGetAllUsersWithRoles,
  rpcSetUserRole,
} from "../../../lib/profileRpc";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { getInitials } from "../../../lib/avatarUtils";
import { getCardPreviews, uploadCardPreview } from "../../../lib/cardPreviewRpc";
import type { UserWithRole } from "../../../types/profile";

const ORANGE = "#FF5000";
const BG = "#f5f5f5";

/** Maps module_slug values to their display labels. */
const MODULE_LABELS: { slug: string; label: string; description: string }[] = [
  {
    slug: "sales",
    label: "Sales Dashboard",
    description: "Volume analysis by product, segment, agent, region, and period",
  },
  {
    slug: "market-share",
    label: "Market Share",
    description: "Market share evolution over time broken down by distributor",
  },
  {
    slug: "navios-diesel",
    label: "Diesel Imports Line-Up",
    description: "Scheduled vessel arrivals and diesel import line-up by port",
  },
  {
    slug: "diesel-gasoline-margins",
    label: "Diesel and Gasoline Margins",
    description: "Diesel and gasoline margin tracking across regions and time",
  },
  {
    slug: "price-bands",
    label: "Price Bands",
    description: "Price band distribution and competitive positioning by fuel type",
  },
  {
    slug: "stocks",
    label: "Market Watch",
    description: "Real-time stock quotes, historical charts, and market overview",
  },
];

export default function SettingsPage() {
  const { allowed, loading: roleLoading } = useRoleGuard("Admin");
  const { moduleVisibility, refreshVisibility, profile: myProfile } = useUserProfile();
  const supabase = getSupabaseClient();

  // ── Card Previews state ────────────────────────────────────────────────────
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const [uploadingSlug, setUploadingSlug] = useState<string | null>(null);
  const [savedPreviewSlug, setSavedPreviewSlug] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    getCardPreviews(supabase).then(setLocalPreviews);
  }, [supabase]);

  async function handlePreviewUpload(slug: string, file: File) {
    if (!supabase || uploadingSlug) return;
    setUploadingSlug(slug);
    setUploadError(null);
    const url = await uploadCardPreview(supabase, slug, file);
    if (url) {
      setLocalPreviews((prev) => ({ ...prev, [slug]: url }));
      setSavedPreviewSlug(slug);
      setTimeout(() => setSavedPreviewSlug((s) => (s === slug ? null : s)), 2000);
    } else {
      setUploadError(slug);
      setTimeout(() => setUploadError((s) => (s === slug ? null : s)), 3000);
    }
    setUploadingSlug(null);
  }

  // ── Module visibility state ────────────────────────────────────────────────
  const [localVis, setLocalVis] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);

  useEffect(() => {
    setLocalVis({ ...moduleVisibility });
  }, [moduleVisibility]);

  async function handleToggle(slug: string, newValue: boolean) {
    if (!supabase || saving) return;
    setLocalVis((prev) => ({ ...prev, [slug]: newValue }));
    setSaving(slug);
    await rpcSetModuleVisibility(supabase, slug, newValue);
    await refreshVisibility();
    setSaving(null);
    setSavedSlug(slug);
    setTimeout(() => setSavedSlug((s) => (s === slug ? null : s)), 1500);
  }

  // ── Members / user management state ───────────────────────────────────────
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  // Tracks which user IDs have an in-flight role update
  const [savingUser, setSavingUser] = useState<string | null>(null);
  // Tracks which user ID just had their role saved (shows ✓ for 1.5s)
  const [savedUser, setSavedUser] = useState<string | null>(null);
  // Optimistic local role map: userId → role
  const [localRoles, setLocalRoles] = useState<Record<string, string>>({});

  const loadUsers = useCallback(async () => {
    if (!supabase) return;
    setUsersLoading(true);
    const data = await rpcGetAllUsersWithRoles(supabase);
    setUsers(data);
    // Initialise localRoles from fetched data
    const roles: Record<string, string> = {};
    for (const u of data) roles[u.id] = u.role;
    setLocalRoles(roles);
    setUsersLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (allowed) loadUsers();
  }, [allowed, loadUsers]);

  async function handleRoleChange(userId: string, newRole: "Admin" | "Client") {
    if (!supabase || savingUser) return;
    // Prevent Admin from accidentally removing their own Admin role
    if (userId === myProfile?.id && newRole !== "Admin") {
      if (!confirm("Are you sure you want to remove your own Admin role? You will lose access to this page.")) return;
    }
    // Optimistic update
    setLocalRoles((prev) => ({ ...prev, [userId]: newRole }));
    setSavingUser(userId);
    const ok = await rpcSetUserRole(supabase, userId, newRole);
    if (!ok) {
      // Revert on failure
      setLocalRoles((prev) => ({ ...prev, [userId]: users.find(u => u.id === userId)?.role ?? "Client" }));
    }
    setSavingUser(null);
    setSavedUser(userId);
    setTimeout(() => setSavedUser((s) => (s === userId ? null : s)), 1500);
  }

  if (roleLoading || !allowed) return null;

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
            Admin
          </div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#111", margin: "0 0 8px" }}>
            Settings
          </h1>
          <p style={{ fontSize: 14, color: "#666", margin: 0 }}>
            Configure the application for all users.
          </p>
        </div>

        {/* ── Members section ────────────────────────────────────────────── */}
        <div className="settings-card" style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: 0 }}>
              Members
            </h2>
            {!usersLoading && (
              <span style={{ fontSize: 12, color: "#aaa" }}>{users.length} user{users.length !== 1 ? "s" : ""}</span>
            )}
          </div>
          <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px" }}>
            Assign roles to users. Changes take effect immediately on their next page load.
          </p>

          {usersLoading ? (
            <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
              Loading members…
            </div>
          ) : users.length === 0 ? (
            <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
              No users found.
            </div>
          ) : (
            users.map((user) => {
              const role = (localRoles[user.id] ?? user.role) as "Admin" | "Client";
              const isSaving = savingUser === user.id;
              const justSaved = savedUser === user.id;
              const isMe = user.id === myProfile?.id;
              const initials = getInitials(
                user.full_name ? { id: user.id, role, full_name: user.full_name, avatar_url: null, created_at: user.created_at } : null,
                user.email
              );

              return (
                <div key={user.id} className="settings-module-row" style={{ alignItems: "center" }}>
                  {/* Avatar + name/email */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: ORANGE,
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                        flexShrink: 0,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {initials}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", display: "flex", alignItems: "center", gap: 6 }}>
                        {user.full_name || <span style={{ color: "#aaa", fontWeight: 400 }}>No name</span>}
                        {isMe && (
                          <span style={{ fontSize: 10, background: "rgba(255,80,0,0.10)", color: ORANGE, borderRadius: 10, padding: "1px 7px", fontWeight: 600 }}>
                            You
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {user.email}
                      </div>
                    </div>
                  </div>

                  {/* Role selector + saved feedback */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    {justSaved && (
                      <span className="settings-saved-tick" aria-live="polite">✓ Saved</span>
                    )}
                    <select
                      value={role}
                      disabled={isSaving}
                      onChange={(e) => handleRoleChange(user.id, e.target.value as "Admin" | "Client")}
                      style={{
                        fontFamily: "Arial, sans-serif",
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "5px 10px",
                        borderRadius: 8,
                        border: "1px solid #e0e0e0",
                        background: "#fff",
                        color: role === "Admin" ? ORANGE : "#555",
                        cursor: isSaving ? "wait" : "pointer",
                        outline: "none",
                        appearance: "auto",
                        minWidth: 90,
                        opacity: isSaving ? 0.6 : 1,
                        transition: "opacity 0.15s",
                      }}
                    >
                      <option value="Client">Client</option>
                      <option value="Admin">Admin</option>
                    </select>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Module visibility section ──────────────────────────────────── */}
        <div className="settings-card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>
            Module Visibility
          </h2>
          <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px" }}>
            Toggle which modules are visible to <strong>Client</strong> users.
            Admins always have access to all modules regardless of these settings.
          </p>

          {MODULE_LABELS.map(({ slug, label, description }) => {
            const isVisible = localVis[slug] ?? true;
            const isSaving = saving === slug;
            const justSaved = savedSlug === slug;

            return (
              <div key={slug} className="settings-module-row">
                <div style={{ flex: 1, paddingRight: 24 }}>
                  <div className="settings-module-label">{label}</div>
                  <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>{description}</div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {justSaved && (
                    <span className="settings-saved-tick" aria-live="polite">✓ Saved</span>
                  )}
                  <div className="form-check form-switch" style={{ margin: 0 }}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      role="switch"
                      id={`toggle-${slug}`}
                      checked={isVisible}
                      disabled={isSaving}
                      onChange={(e) => handleToggle(slug, e.target.checked)}
                      style={{
                        width: "2.5em",
                        height: "1.25em",
                        cursor: isSaving ? "wait" : "pointer",
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Card Previews section ─────────────────────────────────────── */}
        <div className="settings-card">
          <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>
            Card Previews
          </h2>
          <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px" }}>
            Upload a custom preview image for each dashboard card shown on the Home page.
            Images are stored in Supabase and replace the default screenshots immediately.
          </p>

          {MODULE_LABELS.map(({ slug, label }) => {
            const currentUrl = localPreviews[slug];
            const isUploading = uploadingSlug === slug;
            const justSaved = savedPreviewSlug === slug;
            const hasError = uploadError === slug;

            return (
              <div key={slug} className="settings-module-row" style={{ alignItems: "center", gap: 16 }}>
                {/* Thumbnail */}
                <div
                  style={{
                    width: 80,
                    height: 50,
                    borderRadius: 4,
                    overflow: "hidden",
                    flexShrink: 0,
                    background: "#e0e0e0",
                    border: "1px solid #ddd",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {currentUrl ? (
                    <img
                      src={currentUrl}
                      alt={label}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <span style={{ fontSize: 10, color: "#bbb" }}>No image</span>
                  )}
                </div>

                {/* Label */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="settings-module-label">{label}</div>
                  <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{slug}</div>
                </div>

                {/* Feedback + Upload button */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  {justSaved && (
                    <span className="settings-saved-tick" aria-live="polite">✓ Saved</span>
                  )}
                  {hasError && (
                    <span style={{ fontSize: 12, color: "#c0392b" }}>Upload failed</span>
                  )}
                  <label
                    style={{
                      display: "inline-block",
                      padding: "6px 14px",
                      borderRadius: 8,
                      border: `1px solid ${ORANGE}`,
                      color: isUploading ? "#aaa" : ORANGE,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: isUploading ? "wait" : "pointer",
                      background: "#fff",
                      transition: "opacity 0.15s",
                      opacity: isUploading ? 0.6 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isUploading ? "Uploading…" : "Upload image"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      style={{ display: "none" }}
                      disabled={isUploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handlePreviewUpload(slug, file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

      </section>
    </main>
  );
}
