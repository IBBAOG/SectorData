"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

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
import { EDITABLE_TABLES } from "@/lib/dataInput/registry";
import { EditableTableEditor } from "@/components/dataInput/EditableTableEditor";
import { TableSelector } from "@/components/dataInput/TableSelector";

const ORANGE = "#FF5000";
const BG = "#f5f5f5";
const SIDEBAR_BG = "#1a1a1a";
const SIDEBAR_WIDTH = 220;

// ── Sidebar sections ──────────────────────────────────────────────────────────
type SectionId = "members" | "permissions" | "card-images" | "alert-recipients" | "data-input";

type AlertRecipient = {
  id: string;
  email: string;
  is_active: boolean;
  created_at: string;
  added_by: string | null;
};

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
  {
    id: "alert-recipients",
    label: "Alert Emails",
    description: "Notification recipients",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
        <polyline points="22,6 12,13 2,6"/>
      </svg>
    ),
  },
  {
    id: "data-input",
    label: "Data Input",
    description: "Edit reference tables",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    ),
  },
];

// ── Module labels ─────────────────────────────────────────────────────────────
const MODULE_LABELS: { slug: string; label: string; description: string }[] = [
  // Fuel Distribution
  { slug: "sales-volumes",           label: "Sales Dashboard",              description: "Volume analysis by product, segment, agent, region, and period" },
  { slug: "market-share",            label: "Market Share",                 description: "Market share evolution over time broken down by distributor" },
  { slug: "navios-diesel",           label: "Diesel Imports Line-Up",       description: "Scheduled vessel arrivals and diesel import line-up by port" },
  { slug: "diesel-gasoline-margins", label: "Diesel and Gasoline Margins",  description: "Diesel and gasoline margin tracking across regions and time" },
  { slug: "price-bands",             label: "Price Bands",                  description: "Price band distribution and competitive positioning by fuel type" },
  // Statistics
  { slug: "mdic-comex",              label: "MDIC Comex",                   description: "Brazilian trade balance and import/export volumes by product and origin" },
  { slug: "anp-ppi",                 label: "ANP PPI",                      description: "ANP import price parity reference benchmarks for fuel pricing" },
  { slug: "anp-precos-produtores",   label: "ANP Producer Prices",          description: "Producer prices for fuels tracked by ANP" },
  { slug: "anp-precos-distribuicao", label: "ANP Distribution Prices",      description: "Distribution prices for fuels tracked by ANP" },
  { slug: "anp-glp",                 label: "ANP LPG",                      description: "LPG production and distribution data from ANP" },
  { slug: "anp-daie",                label: "ANP Open Data IE",             description: "Open import/export energy data from ANP's DAIE dataset" },
  { slug: "anp-desembaracos",        label: "ANP Customs Clearances",       description: "Fuel customs clearance volumes from ANP" },
  { slug: "anp-painel-importacoes",  label: "ANP Imports Panel",            description: "ANP fuel import dashboard with volume and origin country tracking" },
  { slug: "anp-lpc",                 label: "ANP LPC Prices",               description: "ANP consumer price survey across Brazilian gas stations" },
  { slug: "sindicom",                label: "SINDICOM",                     description: "Fuel distribution data from the SINDICOM industry association" },
  { slug: "anp-cdp",                 label: "ANP CDP Production",           description: "ANP CDP oil and gas production data by well and field" },
  { slug: "anp-cdp-diaria",          label: "ANP CDP Diária",               description: "Daily oil and gas production by field from ANP Power BI" },
  { slug: "anp-cdp-bsw",             label: "ANP CDP — BSW by Well",        description: "Water cut vs months since first production, by well" },
  { slug: "anp-cdp-depletion",       label: "ANP CDP — Depletion",          description: "Uptime-normalized oil production and decline analysis by field" },
  // Other
  { slug: "stocks",                  label: "Market Watch",                 description: "Real-time stock quotes, historical charts, and market overview" },
  { slug: "news-hunter",             label: "News Hunter",                  description: "Live oil & gas news feed with incremental polling across ~60 sources" },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function AdminPanelPage() {
  const { allowed, loading: roleLoading } = useRoleGuard("Admin");
  const { moduleVisibility, refreshVisibility, profile: myProfile } = useUserProfile();
  const supabase = getSupabaseClient();

  const [activeSection, setActiveSection] = useState<SectionId>("members");
  const [activeDataInputSlug, setActiveDataInputSlug] = useState<string>(EDITABLE_TABLES[0].slug);

  // ── Card Previews ──────────────────────────────────────────────────────────
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const [uploadingSlug, setUploadingSlug] = useState<string | null>(null);
  const [savedPreviewSlug, setSavedPreviewSlug] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<{ slug: string; message: string } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    getCardPreviews(supabase).then(setLocalPreviews);
  }, [supabase]);

  async function handlePreviewUpload(slug: string, file: File) {
    if (!supabase || uploadingSlug) return;
    setUploadingSlug(slug);
    setUploadError(null);
    const result = await uploadCardPreview(supabase, slug, file);
    if ("url" in result) {
      setLocalPreviews((prev) => ({ ...prev, [slug]: result.url }));
      setSavedPreviewSlug(slug);
      setTimeout(() => setSavedPreviewSlug((s) => (s === slug ? null : s)), 2000);
    } else {
      setUploadError({ slug, message: result.error });
      setTimeout(() => setUploadError((s) => (s?.slug === slug ? null : s)), 6000);
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

  // ── Alert Recipients ───────────────────────────────────────────────────────
  const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [addingEmail, setAddingEmail] = useState(false);
  const [addEmailError, setAddEmailError] = useState<string | null>(null);
  const [addEmailSuccess, setAddEmailSuccess] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

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

  // ── Alert Recipient helpers ────────────────────────────────────────────────
  function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  function formatDateBR(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  const loadRecipients = useCallback(async () => {
    if (!supabase) return;
    setRecipientsLoading(true);
    setRecipientsError(null);
    const { data, error } = await supabase
      .from("alert_recipients")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setRecipientsError(error.message);
    else setRecipients((data as AlertRecipient[]) ?? []);
    setRecipientsLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (allowed && activeSection === "alert-recipients") loadRecipients();
  }, [allowed, activeSection, loadRecipients]);

  async function handleAddRecipient() {
    if (!supabase || addingEmail || !isValidEmail(newEmail)) return;
    setAddingEmail(true);
    setAddEmailError(null);
    const { error } = await supabase.from("alert_recipients").insert({
      email: newEmail.trim().toLowerCase(),
      is_active: true,
      added_by: myProfile?.id ?? null,
    });
    if (error) {
      setAddEmailError(error.code === "23505" ? "This email is already registered." : error.message);
    } else {
      setNewEmail("");
      setAddEmailSuccess(true);
      setTimeout(() => setAddEmailSuccess(false), 2000);
      await loadRecipients();
    }
    setAddingEmail(false);
  }

  async function handleToggleRecipient(id: string, currentActive: boolean) {
    if (!supabase || togglingId) return;
    setTogglingId(id);
    await supabase.from("alert_recipients").update({ is_active: !currentActive }).eq("id", id);
    await loadRecipients();
    setTogglingId(null);
  }

  async function handleRemoveRecipient(id: string) {
    if (!supabase || removingId) return;
    setRemovingId(id);
    await supabase.from("alert_recipients").delete().eq("id", id);
    setConfirmRemoveId(null);
    await loadRecipients();
    setRemovingId(null);
  }

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
        <div style={{ flex: 1, padding: "clamp(16px, 3vw, 40px) clamp(16px, 3vw, 40px) 48px", overflowY: "auto", minWidth: 0 }}>

          {/* Section header */}
          <div style={{ marginBottom: 18 }}>
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

          {/* Analytics callout — link to /admin-analytics. Lives above every
              admin-panel section so admins always see it; non-Admins never reach
              this component (useRoleGuard redirects them). */}
          <Link
            href="/admin-analytics"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              background: "linear-gradient(90deg, rgba(255,80,0,0.08), rgba(255,80,0,0.02))",
              border: "1px solid rgba(255,80,0,0.25)",
              borderRadius: 12,
              padding: "12px 16px",
              marginBottom: 24,
              textDecoration: "none",
              color: "inherit",
              fontFamily: "Arial, sans-serif",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ color: ORANGE, display: "inline-flex" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>
                  Analytics dashboard
                </div>
                <div style={{ fontSize: 11.5, color: "#666", marginTop: 1 }}>
                  Engagement, exports, and logins by user and dashboard.
                </div>
              </div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: ORANGE, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Abrir →
            </span>
          </Link>

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
                const errorForSlug = uploadError?.slug === slug ? uploadError.message : null;
                return (
                  <div key={slug} className="settings-module-row" style={{ alignItems: "center", gap: 16 }}>
                    {/* Thumbnail */}
                    <div style={{ width: 80, height: 50, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: "#e0e0e0", border: "1px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                      {currentUrl
                        ? <Image src={currentUrl} alt={label} fill sizes="80px" style={{ objectFit: "cover" }} unoptimized />
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
                      {errorForSlug && (
                        <span style={{ fontSize: 12, color: "#c0392b", maxWidth: 200, wordBreak: "break-word" }} title={errorForSlug}>
                          {errorForSlug.length > 40 ? errorForSlug.slice(0, 40) + "…" : errorForSlug}
                        </span>
                      )}
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

          {/* ── Data Input ───────────────────────────────────────────────────── */}
          {activeSection === "data-input" && (
            <div className="settings-card">
              <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>
                Data Input
              </h2>
              <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px" }}>
                Add, edit, or delete rows in reference tables. Changes write directly to Supabase.
                Editing a <code>(product, date)</code> or <code>(fuel_type, week)</code> that already
                exists will update the existing row (upsert behavior).
              </p>
              <TableSelector activeSlug={activeDataInputSlug} onChange={setActiveDataInputSlug} />
              <EditableTableEditor
                key={activeDataInputSlug}
                config={EDITABLE_TABLES.find((t) => t.slug === activeDataInputSlug)!}
              />
            </div>
          )}

          {/* ── Alert Recipients ─────────────────────────────────────────────── */}
          {activeSection === "alert-recipients" && (
            <div className="settings-card">
              <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>
                Alert Recipients
              </h2>
              <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px" }}>
                Emails that will receive automatic notifications of new data releases (ANP, MDIC, etc.).
              </p>

              {/* Add form */}
              <div style={{ display: "flex", gap: 10, marginBottom: 24, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={e => { setNewEmail(e.target.value); setAddEmailError(null); }}
                    onKeyDown={e => e.key === "Enter" && handleAddRecipient()}
                    placeholder="email@empresa.com"
                    disabled={addingEmail}
                    style={{
                      width: "100%", padding: "8px 12px", borderRadius: 8,
                      border: `1px solid ${addEmailError ? "#e53e3e" : "#e0e0e0"}`,
                      fontSize: 13, fontFamily: "Arial, sans-serif", outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  {addEmailError && (
                    <div style={{ fontSize: 12, color: "#e53e3e", marginTop: 4 }}>{addEmailError}</div>
                  )}
                </div>
                <button
                  onClick={handleAddRecipient}
                  disabled={addingEmail || !isValidEmail(newEmail)}
                  style={{
                    padding: "8px 18px", borderRadius: 8, border: "none",
                    background: addingEmail || !isValidEmail(newEmail) ? "#e0e0e0" : ORANGE,
                    color: addingEmail || !isValidEmail(newEmail) ? "#aaa" : "#fff",
                    fontSize: 13, fontWeight: 600,
                    cursor: addingEmail || !isValidEmail(newEmail) ? "not-allowed" : "pointer",
                    fontFamily: "Arial, sans-serif", whiteSpace: "nowrap",
                    transition: "background 0.15s",
                  }}
                >
                  {addingEmail ? "Adding…" : addEmailSuccess ? "✓ Added" : "Add"}
                </button>
              </div>

              {/* List */}
              {recipientsLoading ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>Loading…</div>
              ) : recipientsError ? (
                <div style={{ padding: "16px", background: "#fff5f5", borderRadius: 8, color: "#e53e3e", fontSize: 13 }}>
                  Error: {recipientsError}
                </div>
              ) : recipients.length === 0 ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>No recipients registered.</div>
              ) : (
                recipients.map((r) => {
                  const isToggling = togglingId === r.id;
                  const isRemoving = removingId === r.id;
                  const isConfirming = confirmRemoveId === r.id;
                  return (
                    <div key={r.id} className="settings-module-row" style={{ alignItems: "center", gap: 12 }}>
                      {/* Email + date */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.email}
                        </div>
                        <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
                          Added on {formatDateBR(r.created_at)}
                        </div>
                      </div>
                      {/* Status badge */}
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 12,
                        background: r.is_active ? "rgba(72,187,120,0.15)" : "rgba(160,160,160,0.15)",
                        color: r.is_active ? "#38a169" : "#999",
                        flexShrink: 0,
                      }}>
                        {r.is_active ? "Active" : "Inactive"}
                      </span>
                      {/* Actions */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        {isConfirming ? (
                          <>
                            <span style={{ fontSize: 12, color: "#e53e3e" }}>Are you sure?</span>
                            <button
                              onClick={() => handleRemoveRecipient(r.id)}
                              disabled={isRemoving}
                              style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 6, border: "none", background: "#e53e3e", color: "#fff", cursor: isRemoving ? "wait" : "pointer", fontFamily: "Arial, sans-serif" }}
                            >
                              {isRemoving ? "…" : "Remove"}
                            </button>
                            <button
                              onClick={() => setConfirmRemoveId(null)}
                              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #e0e0e0", background: "#fff", color: "#555", cursor: "pointer", fontFamily: "Arial, sans-serif" }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleToggleRecipient(r.id, r.is_active)}
                              disabled={!!togglingId}
                              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: `1px solid ${r.is_active ? "#e0e0e0" : ORANGE}`, background: "#fff", color: r.is_active ? "#666" : ORANGE, cursor: isToggling ? "wait" : "pointer", fontFamily: "Arial, sans-serif", opacity: isToggling ? 0.6 : 1 }}
                            >
                              {r.is_active ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              onClick={() => setConfirmRemoveId(r.id)}
                              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #e0e0e0", background: "#fff", color: "#e53e3e", cursor: "pointer", fontFamily: "Arial, sans-serif" }}
                            >
                              Remover
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

        </div>
      </div>
    </main>
  );
}
