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
const SIDEBAR_BG = "#1a1a1a";
const SIDEBAR_WIDTH = 220;

// ── Sidebar sections ──────────────────────────────────────────────────────────
type SectionId = "members" | "permissions" | "card-images";

const SECTIONS: { id: SectionId; label: string; description: string; icon: React.ReactNode }[] = [
  {
    id: "members",
    label: "Members",
    description: "User roles & access",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    id: "permissions",
    label: "Permissions",
    description: "Module visibility",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    ),
  },
  {
    id: "card-images",
    label: "Card Images",
    description: "Home page previews",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    ),
  },
];

// ── Module labels ─────────────────────────────────────────────────────────────
const MODULE_LABELS: { slug: string; label: string; description: string }[] = [
  { slug: "sales",                  label: "Sales Dashboard",           description: "Volume analysis by product, segment, agent, region, and period" },
  { slug: "market-share",           label: "Market Share",              description: "Market share evolution over time broken down by distributor" },
  { slug: "navios-diesel",          label: "Diesel Imports Line-Up",    description: "Scheduled vessel arrivals and diesel import line-up by port" },
  { slug: "diesel-gasoline-margins",label: "Diesel and Gasoline Margins",description: "Diesel and gasoline margin tracking across regions and time" },
  { slug: "price-bands",            label: "Price Bands",               description: "Price band distribution and competitive positioning by fuel type" },
  { slug: "stocks",                 label: "Market Watch",              description: "Real-time stock quotes, historical charts, and market overview" },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function AdminPanelPage() {
  const { allowed, loading: roleLoading } = useRoleGuard("Admin");
  const { moduleVisibility, refreshVisibility, profile: myProfile } = useUserProfile();
  const supabase = getSupabaseClient();

  const [activeSection, setActiveSection] = useState<SectionId>("members");

  // ── Card Previews ──────────────────────────────────────────────────────────
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

  // ── Module Visibility ──────────────────────────────────────────────────────
  const [localVis, setLocalVis] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);

  useEffect(() => { setLocalVis({ ...moduleVisibility }); }, [moduleVisibility]);

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

  // ── Members ────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [savedUser, setSavedUser] = useState<string | null>(null);
  const [localRoles, setLocalRoles] = useState<Record<string, string>>({});

  const loadUsers = useCallback(async () => {
    if (!supabase) return;
    setUsersLoading(true);
    const data = await rpcGetAllUsersWithRoles(supabase);
    setUsers(data);
    const roles: Record<string, string> = {};
    for (const u of data) roles[u.id] = u.role;
    setLocalRoles(roles);
    setUsersLoading(false);
  }, [supabase]);

  useEffect(() => { if (allowed) loadUsers(); }, [allowed, loadUsers]);

  async function handleRoleChange(userId: string, newRole: "Admin" | "Client") {
    if (!supabase || savingUser) return;
    if (userId === myProfile?.id && newRole !== "Admin") {
      if (!confirm("Are you sure you want to remove your own Admin role? You will lose access to this page.")) return;
    }
    setLocalRoles((prev) => ({ ...prev, [userId]: newRole }));
    setSavingUser(userId);
    const ok = await rpcSetUserRole(supabase, userId, newRole);
    if (!ok) setLocalRoles((prev) => ({ ...prev, [userId]: users.find(u => u.id === userId)?.role ?? "Client" }));
    setSavingUser(null);
    setSavedUser(userId);
    setTimeout(() => setSavedUser((s) => (s === userId ? null : s)), 1500);
  }

  if (roleLoading || !allowed) return null;

  const currentSection = SECTIONS.find(s => s.id === activeSection)!;

  return (
    <main style={{ background: BG, minHeight: "100vh", fontFamily: "Arial, sans-serif" }}>
      <NavBar />

      <div style={{ display: "flex", minHeight: "calc(100vh - 56px)" }}>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside style={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          background: SIDEBAR_BG,
          display: "flex",
          flexDirection: "column",
          padding: "32px 0 24px",
        }}>
          {/* Header */}
          <div style={{ padding: "0 20px 28px" }}>
            <div style={{
              display: "inline-block",
              background: "rgba(255,80,0,0.15)",
              color: ORANGE,
              borderRadius: 16,
              padding: "2px 10px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}>
              Admin
            </div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>
              Admin Panel
            </div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
              Application settings
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "0 20px 16px" }} />

          {/* Nav items */}
          <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, padding: "0 10px" }}>
            {SECTIONS.map((section) => {
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    background: isActive ? "rgba(255,80,0,0.12)" : "transparent",
                    color: isActive ? ORANGE : "#aaa",
                    textAlign: "left",
                    width: "100%",
                    transition: "background 0.15s, color 0.15s",
                    fontFamily: "Arial, sans-serif",
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)"; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  {/* Icon */}
                  <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.6 }}>
                    {section.icon}
                  </span>
                  {/* Label + description */}
                  <span>
                    <div style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, lineHeight: 1.3 }}>
                      {section.label}
                    </div>
                    <div style={{ fontSize: 10, opacity: 0.55, marginTop: 1 }}>
                      {section.description}
                    </div>
                  </span>
                  {/* Active indicator */}
                  {isActive && (
                    <span style={{
                      marginLeft: "auto",
                      width: 3,
                      height: 20,
                      borderRadius: 2,
                      background: ORANGE,
                      flexShrink: 0,
                    }} />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Footer */}
          <div style={{ padding: "16px 20px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: 10, color: "#444", lineHeight: 1.5 }}>
              Changes apply immediately.<br />Only Admins see this panel.
            </div>
          </div>
        </aside>

        {/* ── Content area ─────────────────────────────────────────────────── */}
        <div style={{ flex: 1, padding: "40px 40px 80px", overflowY: "auto" }}>

          {/* Section header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <span style={{ color: ORANGE }}>{currentSection.icon}</span>
              <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#111", margin: 0 }}>
                {currentSection.label}
              </h1>
            </div>
            <p style={{ fontSize: 13, color: "#888", margin: 0 }}>
              {currentSection.description}
            </p>
          </div>

          {/* ── Members ────────────────────────────────────────────────────── */}
          {activeSection === "members" && (
            <div className="settings-card">
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: 0 }}>
                  All Users
                </h2>
                {!usersLoading && (
                  <span style={{ fontSize: 12, color: "#aaa" }}>{users.length} user{users.length !== 1 ? "s" : ""}</span>
                )}
              </div>
              <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px" }}>
                Assign roles to users. Changes take effect immediately on their next page load.
              </p>

              {usersLoading ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>Loading members…</div>
              ) : users.length === 0 ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>No users found.</div>
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
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: ORANGE, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0, letterSpacing: "0.04em" }}>
                          {initials}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", display: "flex", alignItems: "center", gap: 6 }}>
                            {user.full_name || <span style={{ color: "#aaa", fontWeight: 400 }}>No name</span>}
                            {isMe && <span style={{ fontSize: 10, background: "rgba(255,80,0,0.10)", color: ORANGE, borderRadius: 10, padding: "1px 7px", fontWeight: 600 }}>You</span>}
                          </div>
                          <div style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        {justSaved && <span className="settings-saved-tick" aria-live="polite">✓ Saved</span>}
                        <select
                          value={role}
                          disabled={isSaving}
                          onChange={(e) => handleRoleChange(user.id, e.target.value as "Admin" | "Client")}
                          style={{ fontFamily: "Arial, sans-serif", fontSize: 13, fontWeight: 600, padding: "5px 10px", borderRadius: 8, border: "1px solid #e0e0e0", background: "#fff", color: role === "Admin" ? ORANGE : "#555", cursor: isSaving ? "wait" : "pointer", outline: "none", appearance: "auto", minWidth: 90, opacity: isSaving ? 0.6 : 1, transition: "opacity 0.15s" }}
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
          )}

          {/* ── Permissions ─────────────────────────────────────────────────── */}
          {activeSection === "permissions" && (
            <div className="settings-card">
              <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>Module Visibility</h2>
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
                      {justSaved && <span className="settings-saved-tick" aria-live="polite">✓ Saved</span>}
                      <div className="form-check form-switch" style={{ margin: 0 }}>
                        <input
                          className="form-check-input"
                          type="checkbox"
                          role="switch"
                          id={`toggle-${slug}`}
                          checked={isVisible}
                          disabled={isSaving}
                          onChange={(e) => handleToggle(slug, e.target.checked)}
                          style={{ width: "2.5em", height: "1.25em", cursor: isSaving ? "wait" : "pointer" }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Card Images ──────────────────────────────────────────────────── */}
          {activeSection === "card-images" && (
            <div className="settings-card">
              <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>Card Preview Images</h2>
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
                    <div style={{ width: 80, height: 50, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: "#e0e0e0", border: "1px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {currentUrl
                        ? <img src={currentUrl} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <span style={{ fontSize: 10, color: "#bbb" }}>No image</span>
                      }
                    </div>
                    {/* Label */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="settings-module-label">{label}</div>
                      <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{slug}</div>
                    </div>
                    {/* Upload */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      {justSaved && <span className="settings-saved-tick" aria-live="polite">✓ Saved</span>}
                      {hasError && <span style={{ fontSize: 12, color: "#c0392b" }}>Upload failed</span>}
                      <label style={{ display: "inline-block", padding: "6px 14px", borderRadius: 8, border: `1px solid ${ORANGE}`, color: isUploading ? "#aaa" : ORANGE, fontSize: 12, fontWeight: 600, cursor: isUploading ? "wait" : "pointer", background: "#fff", transition: "opacity 0.15s", opacity: isUploading ? 0.6 : 1, whiteSpace: "nowrap" }}>
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
          )}

        </div>
      </div>
    </main>
  );
}
