"use client";

// Desktop view — /admin-panel (≥769px).
//
// Verbatim port of the original page.tsx body. All state, RPC plumbing, and
// handlers live in the shared brain hook `useAdminPanelData`. This file is
// pure presentation.
//
// Binding sync rule (CLAUDE.md § Dual-view policy):
//   Any meaningful change here (new tab, new field, new copy) must land in
//   mobile/View.tsx in the SAME commit, OR the commit message must declare
//   `[desktop-only]` with an explicit reason.

import Link from "next/link";

import NavBar from "../../../../components/NavBar";
import { getInitials } from "../../../../lib/avatarUtils";
import { EDITABLE_TABLES } from "@/lib/dataInput/registry";
import { EditableTableEditor } from "@/components/dataInput/EditableTableEditor";
import { TableSelector } from "@/components/dataInput/TableSelector";

import {
  useAdminPanelData,
  MODULE_LABELS,
  SECTIONS,
  type SectionId,
} from "../useAdminPanelData";

const ORANGE = "#FF5000";
const BG = "#f5f5f5";
const SIDEBAR_BG = "#1a1a1a";
const SIDEBAR_WIDTH = 220;

// ── Sidebar section icons (desktop-only — mobile uses pill tabs without icons) ─

const SECTION_ICONS: Record<SectionId, React.ReactNode> = {
  members: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  permissions: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  "alert-recipients": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  "alerts-product": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  "default-news": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  ),
  "data-input": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  "field-stakes": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
};

// ── Main component ────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement | null {
  const {
    allowed,
    roleLoading,
    myProfile,

    activeSection,
    setActiveSection,
    activeDataInputSlug,
    setActiveDataInputSlug,

    localVis,
    saving,
    savedSlug,
    handleToggle,

    localHomeVis,
    savingHome,
    savedHomeSlug,
    homeToggleError,
    handleHomeToggle,

    localPublicVis,
    savingPublic,
    savedPublicSlug,
    publicToggleError,
    handlePublicToggle,

    users,
    usersLoading,
    localRoles,
    savingUser,
    savedUser,
    handleRoleChange,

    recipients,
    recipientsLoading,
    recipientsError,
    newEmail,
    setNewEmail,
    addingEmail,
    addEmailError,
    addEmailSuccess,
    togglingId,
    removingId,
    confirmRemoveId,
    setConfirmRemoveId,
    handleAddRecipient,
    handleToggleRecipient,
    handleRemoveRecipient,

    alertsStats,
    alertsStatsLoading,
    alertsSubscribers,
    alertsSubscribersLoading,
    alertsSubscriberSourceFilter,
    setAlertsSubscriberSourceFilter,
    alertsSources,
    alertsSourcesLoading,
    alertsEmailLog,
    alertsEmailLogLoading,
    alertsEmailLogStatusFilter,
    setAlertsEmailLogStatusFilter,
    alertsOutbox,
    alertsOutboxLoading,
    requeueingOutboxId,
    sendingTestSlug,
    togglingSourceSlug,
    unsubscribingId,
    handleAlertsForceUnsubscribe,
    handleAlertsRequeueOutbox,
    handleAlertsSendTestEvent,
    handleAlertsToggleSource,

    defaultKeywords,
    defaultKeywordsLoading,
    defaultKeywordsError,
    newKeyword,
    setNewKeyword,
    newKeywordMatchType,
    setNewKeywordMatchType,
    addingKeyword,
    addKeywordError,
    addKeywordSuccess,
    removingKeyword,
    confirmRemoveKeyword,
    setConfirmRemoveKeyword,
    togglingMatchType,
    handleAddKeyword,
    handleRemoveKeyword,
    handleToggleMatchType,

    fieldStakesOverview,
    fieldStakesEmpresas,
    fieldStakesLoading,
    selectedCampo,
    editorStakes,
    editorLoading,
    newEmpresaInput,
    setNewEmpresaInput,
    newEmpresaPctInput,
    setNewEmpresaPctInput,
    savingStakes,
    deleteCampoConfirm,
    stakesError,
    stakesSearchQuery,
    setStakesSearchQuery,
    stakesStatusFilter,
    setStakesStatusFilter,
    currentSum,
    isValidSum,
    pendingChanges,
    groupedOverview,
    expandedCanonicals,
    handleToggleCanonical,
    selectedCampoLastUpdated,
    handleSelectCampo,
    handleAddEmpresaRow,
    handleRemoveEmpresaRow,
    handleChangeStake,
    handleSaveStakes,
    handleDeleteCampo,
    handleConfirmDeleteCampo,
    handleCancelDeleteCampo,

    isValidEmail,
    formatDateBR,
  } = useAdminPanelData();

  if (roleLoading || !allowed) return null;

  const currentSection = SECTIONS.find((s) => s.id === activeSection)!;

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
                    {SECTION_ICONS[section.id]}
                  </span>
                  {/* Label */}
                  <span>
                    <div style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, lineHeight: 1.3 }}>
                      {section.label}
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

            {/* Analytics dashboard — route navigation, not a section toggle */}
            <Link
              href="/admin-analytics"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 8,
                color: "#aaa",
                textDecoration: "none",
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLAnchorElement).style.color = "#fff"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; (e.currentTarget as HTMLAnchorElement).style.color = "#aaa"; }}
            >
              <span style={{ flexShrink: 0, opacity: 0.6 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </span>
              <span>
                <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>
                  Analytics dashboard
                </div>
              </span>
              <span style={{ marginLeft: "auto", opacity: 0.4, flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </Link>
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
              <span style={{ color: ORANGE }}>{SECTION_ICONS[currentSection.id]}</span>
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
              <p style={{ fontSize: 13, color: "#888", margin: "0 0 8px" }}>
                Three independent axes per module:
              </p>
              <ul style={{ fontSize: 12, color: "#666", margin: "0 0 16px", paddingLeft: 18, lineHeight: 1.6 }}>
                <li><strong>Public</strong> — visible to anonymous (logged-out) visitors. Enabling Public automatically enables Clients (a logged-in user must not lose access on sign-in).</li>
                <li><strong>Clients</strong> — visible to Client tier users once logged in. Admins always have access regardless of these settings.</li>
                <li><strong>Home</strong> — module card appears in the /home gallery for all users (including Admins). Hiding it here does not block access via direct URL or the nav.</li>
              </ul>

              {/* Column headers */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "8px 0",
                  borderBottom: "1px solid #f0f0f0",
                  marginBottom: 4,
                }}
              >
                <div style={{ flex: 1, paddingRight: 24, fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Module
                </div>
                <div style={{ width: 90, textAlign: "center", fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Public
                </div>
                <div style={{ width: 90, textAlign: "center", fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Clients
                </div>
                <div style={{ width: 90, textAlign: "center", fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Home
                </div>
              </div>

              {MODULE_LABELS.map(({ slug, label, description }) => {
                const isClientVisible = localVis[slug] ?? true;
                const isPublicVisible = localPublicVis[slug] ?? true;
                const isHomeVisible = localHomeVis[slug] ?? true;
                const isSavingClient = saving === slug;
                const justSavedClient = savedSlug === slug;
                const isSavingPublic = savingPublic === slug;
                const justSavedPublic = savedPublicSlug === slug;
                const isSavingHome = savingHome === slug;
                const justSavedHome = savedHomeSlug === slug;
                const publicError = publicToggleError?.slug === slug ? publicToggleError.message : null;
                const homeError = homeToggleError?.slug === slug ? homeToggleError.message : null;
                // When Public is ON, Clients must also be ON (DB invariant).
                // The Clients toggle is forced-on and disabled in this case.
                const clientsForcedOn = isPublicVisible;
                // Home invariant: home=true requires at least one of Public or
                // Clients to be true. Disable the Home toggle (and grey it out)
                // when both are false — the DB trigger would coerce home=false
                // anyway, so prevent the click entirely.
                const homeDisabled = !isPublicVisible && !isClientVisible;
                return (
                  <div key={slug} className="settings-module-row" style={{ alignItems: "center" }}>
                    <div style={{ flex: 1, paddingRight: 24 }}>
                      <div className="settings-module-label">{label}</div>
                      <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>{description}</div>
                    </div>

                    {/* Public toggle */}
                    <div style={{ width: 90, display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
                      {justSavedPublic && <span className="settings-saved-tick" aria-live="polite">✓</span>}
                      {publicError && (
                        <span style={{ fontSize: 11, color: "#c0392b" }} title={publicError}>Error</span>
                      )}
                      <div className="form-check form-switch" style={{ margin: 0 }}>
                        <input
                          className="form-check-input"
                          type="checkbox"
                          role="switch"
                          id={`toggle-public-${slug}`}
                          aria-label={`Public access to ${label}`}
                          checked={isPublicVisible}
                          disabled={isSavingPublic}
                          onChange={(e) => handlePublicToggle(slug, e.target.checked)}
                          style={{ width: "2.5em", height: "1.25em", cursor: isSavingPublic ? "wait" : "pointer", opacity: isSavingPublic ? 0.6 : 1 }}
                        />
                      </div>
                    </div>

                    {/* Clients toggle */}
                    <div style={{ width: 90, display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
                      {justSavedClient && <span className="settings-saved-tick" aria-live="polite">✓</span>}
                      <div
                        className="form-check form-switch"
                        style={{ margin: 0 }}
                        title={clientsForcedOn ? "Clients access is locked on while Public is enabled" : undefined}
                      >
                        <input
                          className="form-check-input"
                          type="checkbox"
                          role="switch"
                          id={`toggle-${slug}`}
                          aria-label={`Client access to ${label}`}
                          checked={isClientVisible}
                          disabled={isSavingClient || clientsForcedOn}
                          onChange={(e) => handleToggle(slug, e.target.checked)}
                          style={{
                            width: "2.5em",
                            height: "1.25em",
                            cursor: isSavingClient || clientsForcedOn ? "not-allowed" : "pointer",
                            opacity: clientsForcedOn ? 0.5 : 1,
                          }}
                        />
                      </div>
                    </div>

                    {/* Home toggle */}
                    <div
                      style={{ width: 90, display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}
                      title={homeDisabled ? "Make the module visible to Public or Clients first" : undefined}
                    >
                      {justSavedHome && <span className="settings-saved-tick" aria-live="polite">✓</span>}
                      {homeError && (
                        <span style={{ fontSize: 11, color: "#c0392b" }} title={homeError}>Error</span>
                      )}
                      <div className="form-check form-switch" style={{ margin: 0 }}>
                        <input
                          className="form-check-input"
                          type="checkbox"
                          role="switch"
                          id={`home-toggle-${slug}`}
                          aria-label={`Show ${label} on Home`}
                          checked={isHomeVisible && !homeDisabled}
                          disabled={isSavingHome || homeDisabled}
                          onChange={(e) => handleHomeToggle(slug, e.target.checked)}
                          style={{
                            width: "2.5em",
                            height: "1.25em",
                            cursor: isSavingHome || homeDisabled ? "not-allowed" : "pointer",
                            opacity: isSavingHome || homeDisabled ? 0.4 : 1,
                          }}
                        />
                      </div>
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
                    onChange={e => { setNewEmail(e.target.value); }}
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
                              Remove
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

          {/* ── Alerts Product ───────────────────────────────────────────────── */}
          {activeSection === "alerts-product" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

              {/* Sub-section A — Subscriber stats */}
              <div className="settings-card">
                <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>
                  Subscriber Stats
                </h2>
                <p style={{ fontSize: 13, color: "#888", margin: "0 0 16px" }}>
                  Overview of the opt-in subscriber base across all alert sources.
                </p>
                {alertsStatsLoading ? (
                  <div style={{ padding: "16px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>Loading…</div>
                ) : !alertsStats ? (
                  <div style={{ fontSize: 13, color: "#bbb" }}>No stats available.</div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                    {[
                      { label: "Total", value: alertsStats.totals.subscribers_total },
                      { label: "Active", value: alertsStats.totals.subscribers_active },
                      {
                        label: "Unconfirmed",
                        value: alertsStats.totals.subscribers_total - alertsStats.totals.subscribers_confirmed,
                      },
                      { label: "Sent (7d)", value: alertsStats.sent_7d },
                      { label: "Bounced (7d)", value: alertsStats.bounced_7d },
                      {
                        label: "Bounce rate (7d)",
                        value: `${alertsStats.bounce_rate_7d_pct.toFixed(2)}%`,
                      },
                    ].map(({ label, value }) => (
                      <div
                        key={label}
                        style={{
                          minWidth: 120,
                          padding: "12px 16px",
                          borderRadius: 10,
                          background: "#f8f8f8",
                          border: "1px solid #ececec",
                        }}
                      >
                        <div style={{ fontSize: 11, color: "#aaa", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          {label}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1a", marginTop: 4 }}>
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {alertsStats && alertsStats.per_source.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Active per source
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {alertsStats.per_source.map(({ source_slug, subscribers_active }) => (
                        <span
                          key={source_slug}
                          style={{
                            fontSize: 12,
                            padding: "3px 10px",
                            borderRadius: 12,
                            background: "rgba(255,80,0,0.07)",
                            border: "1px solid rgba(255,80,0,0.2)",
                            color: "#1a1a1a",
                          }}
                        >
                          {source_slug} <strong>{subscribers_active}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Sub-section B — Subscribers table */}
              <div className="settings-card">
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                  <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: 0 }}>Subscribers</h2>
                  {!alertsSubscribersLoading && (
                    <span style={{ fontSize: 12, color: "#aaa" }}>{alertsSubscribers.length} total</span>
                  )}
                </div>
                <p style={{ fontSize: 13, color: "#888", margin: "0 0 12px" }}>
                  All opt-in subscribers. Use Force Unsubscribe to immediately deactivate a subscriber.
                </p>

                {/* Source filter */}
                <div style={{ marginBottom: 12 }}>
                  <select
                    value={alertsSubscriberSourceFilter}
                    onChange={(e) => setAlertsSubscriberSourceFilter(e.target.value)}
                    style={{
                      fontSize: 13, padding: "5px 10px", borderRadius: 8,
                      border: "1px solid #e0e0e0", background: "#fff",
                      fontFamily: "Arial, sans-serif", outline: "none",
                    }}
                  >
                    <option value="">All sources</option>
                    {alertsSources.map((s) => (
                      <option key={s.source_slug} value={s.source_slug}>
                        {s.display_name || s.source_slug}
                      </option>
                    ))}
                  </select>
                </div>

                {alertsSubscribersLoading ? (
                  <div style={{ padding: "16px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>Loading…</div>
                ) : alertsSubscribers.length === 0 ? (
                  <div style={{ padding: "16px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
                    No subscribers yet. The first opt-in will appear here.
                  </div>
                ) : (
                  <>
                    {/* Column headers */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 90px 70px 100px 100px", gap: 8, padding: "6px 0", borderBottom: "1px solid #f0f0f0", marginBottom: 4 }}>
                      {["Email", "Source", "Confirmed", "Active", "Joined", "Actions"].map((col) => (
                        <div key={col} style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.06em" }}>{col}</div>
                      ))}
                    </div>
                    {alertsSubscribers
                      .filter((s) => !alertsSubscriberSourceFilter || s.source_slug === alertsSubscriberSourceFilter)
                      .map((sub) => {
                        const isUnsubscribing = unsubscribingId === sub.id;
                        return (
                          <div
                            key={sub.id}
                            className="settings-module-row"
                            style={{ display: "grid", gridTemplateColumns: "1fr 140px 90px 70px 100px 100px", gap: 8, alignItems: "center" }}
                          >
                            <div style={{ fontSize: 13, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {sub.email}
                            </div>
                            <div style={{ fontSize: 12, color: "#888" }}>{sub.source_slug}</div>
                            <div>
                              <span style={{
                                fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                                background: sub.is_confirmed ? "rgba(72,187,120,0.15)" : "rgba(237,137,54,0.15)",
                                color: sub.is_confirmed ? "#38a169" : "#c05621",
                              }}>
                                {sub.is_confirmed ? "Yes" : "Pending"}
                              </span>
                            </div>
                            <div>
                              <span style={{
                                fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                                background: sub.is_active ? "rgba(72,187,120,0.15)" : "rgba(160,160,160,0.15)",
                                color: sub.is_active ? "#38a169" : "#999",
                              }}>
                                {sub.is_active ? "Yes" : "No"}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: "#aaa" }}>{formatDateBR(sub.created_at)}</div>
                            <div>
                              <button
                                onClick={() => handleAlertsForceUnsubscribe(sub.id)}
                                disabled={isUnsubscribing || !sub.is_active}
                                style={{
                                  fontSize: 11, padding: "4px 8px", borderRadius: 6,
                                  border: "1px solid #e53e3e", background: "#fff",
                                  color: sub.is_active ? "#e53e3e" : "#ccc",
                                  cursor: isUnsubscribing || !sub.is_active ? "not-allowed" : "pointer",
                                  opacity: isUnsubscribing ? 0.6 : 1,
                                  fontFamily: "Arial, sans-serif",
                                }}
                              >
                                {isUnsubscribing ? "…" : "Force unsub"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </>
                )}
              </div>

              {/* Sub-section C — Sources management */}
              <div className="settings-card">
                <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>Sources</h2>
                <p style={{ fontSize: 13, color: "#888", margin: "0 0 12px" }}>
                  Toggle sources on/off. Send a test event to verify the pipeline.
                </p>
                {alertsSourcesLoading ? (
                  <div style={{ padding: "16px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>Loading…</div>
                ) : alertsSources.length === 0 ? (
                  <div style={{ padding: "16px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>No sources registered.</div>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 90px 130px 120px", gap: 8, padding: "6px 0", borderBottom: "1px solid #f0f0f0", marginBottom: 4 }}>
                      {["Source", "Category", "Active", "Toggle", "Test event"].map((col) => (
                        <div key={col} style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.06em" }}>{col}</div>
                      ))}
                    </div>
                    {alertsSources.map((src) => {
                      const isToggling = togglingSourceSlug === src.source_slug;
                      const isSending = sendingTestSlug === src.source_slug;
                      return (
                        <div
                          key={src.source_slug}
                          className="settings-module-row"
                          style={{ display: "grid", gridTemplateColumns: "1fr 140px 90px 130px 120px", gap: 8, alignItems: "center" }}
                        >
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>
                              {src.display_name || src.source_slug}
                            </div>
                            <div style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace" }}>{src.source_slug}</div>
                          </div>
                          <div style={{ fontSize: 12, color: "#888" }}>{src.category}</div>
                          <div>
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                              background: src.is_active ? "rgba(72,187,120,0.15)" : "rgba(160,160,160,0.15)",
                              color: src.is_active ? "#38a169" : "#999",
                            }}>
                              {src.is_active ? "Active" : "Off"}
                            </span>
                          </div>
                          <div className="form-check form-switch" style={{ margin: 0 }}>
                            <input
                              className="form-check-input"
                              type="checkbox"
                              role="switch"
                              aria-label={`Toggle source ${src.source_slug}`}
                              checked={src.is_active}
                              disabled={isToggling}
                              onChange={(e) => handleAlertsToggleSource(src.source_slug, e.target.checked)}
                              style={{ width: "2.5em", height: "1.25em", cursor: isToggling ? "wait" : "pointer", opacity: isToggling ? 0.6 : 1 }}
                            />
                          </div>
                          <div>
                            <button
                              onClick={() => handleAlertsSendTestEvent(src.source_slug)}
                              disabled={!!sendingTestSlug}
                              style={{
                                fontSize: 12, padding: "5px 10px", borderRadius: 6,
                                border: `1px solid ${ORANGE}`, background: "#fff", color: ORANGE,
                                cursor: isSending ? "wait" : "pointer",
                                opacity: isSending || (!!sendingTestSlug && !isSending) ? 0.6 : 1,
                                fontFamily: "Arial, sans-serif", whiteSpace: "nowrap",
                              }}
                            >
                              {isSending ? "Sending…" : "Send test"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {/* Sub-section D — Email log */}
              <div className="settings-card">
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                  <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: 0 }}>Email Log</h2>
                  {!alertsEmailLogLoading && (
                    <span style={{ fontSize: 12, color: "#aaa" }}>{alertsEmailLog.length} recent entries</span>
                  )}
                </div>
                <p style={{ fontSize: 13, color: "#888", margin: "0 0 12px" }}>
                  Recent email delivery events. Filter by status to find bounces or failures.
                </p>

                {/* Status filter */}
                <div style={{ marginBottom: 12 }}>
                  <select
                    value={alertsEmailLogStatusFilter}
                    onChange={(e) => setAlertsEmailLogStatusFilter(e.target.value)}
                    style={{
                      fontSize: 13, padding: "5px 10px", borderRadius: 8,
                      border: "1px solid #e0e0e0", background: "#fff",
                      fontFamily: "Arial, sans-serif", outline: "none",
                    }}
                  >
                    <option value="">All statuses</option>
                    <option value="sent">Sent</option>
                    <option value="delivered">Delivered</option>
                    <option value="opened">Opened</option>
                    <option value="clicked">Clicked</option>
                    <option value="bounced">Bounced</option>
                    <option value="complained">Complained</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>

                {alertsEmailLogLoading ? (
                  <div style={{ padding: "16px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>Loading…</div>
                ) : alertsEmailLog.length === 0 ? (
                  <div style={{ padding: "16px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>No email log entries yet.</div>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 90px 1fr 140px", gap: 8, padding: "6px 0", borderBottom: "1px solid #f0f0f0", marginBottom: 4 }}>
                      {["Email", "Subject", "Status", "Provider ID", "Recorded"].map((col) => (
                        <div key={col} style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.06em" }}>{col}</div>
                      ))}
                    </div>
                    {alertsEmailLog
                      .filter((e) => !alertsEmailLogStatusFilter || e.status === alertsEmailLogStatusFilter)
                      .slice(0, 100)
                      .map((entry) => {
                        const statusColor: Record<string, string> = {
                          sent: "#c05621",       // yellow-ish — pending delivery
                          delivered: "#38a169",  // green — confirmed
                          opened: "#38a169",
                          clicked: "#38a169",
                          bounced: "#e53e3e",    // red — problem
                          complained: "#e53e3e",
                          failed: "#c0392b",
                        };
                        return (
                          <div
                            key={entry.id}
                            className="settings-module-row"
                            style={{ display: "grid", gridTemplateColumns: "1fr 1fr 90px 1fr 140px", gap: 8, alignItems: "center" }}
                          >
                            <div style={{ fontSize: 12, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {entry.email}
                            </div>
                            <div style={{ fontSize: 12, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {entry.subject ?? "—"}
                            </div>
                            <div>
                              <span style={{
                                fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                                background: `${statusColor[entry.status] ?? "#999"}22`,
                                color: statusColor[entry.status] ?? "#999",
                              }}>
                                {entry.status}
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {entry.provider_message_id ?? "—"}
                            </div>
                            <div style={{ fontSize: 12, color: "#aaa" }}>{formatDateBR(entry.recorded_at)}</div>
                          </div>
                        );
                      })}
                  </>
                )}
              </div>

              {/* Sub-section E — Outbox repair */}
              <div className="settings-card">
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                  <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: 0 }}>Outbox Repair</h2>
                  {!alertsOutboxLoading && (
                    <span style={{ fontSize: 12, color: "#aaa" }}>{alertsOutbox.length} failed</span>
                  )}
                </div>
                <p style={{ fontSize: 13, color: "#888", margin: "0 0 12px" }}>
                  Failed outbox rows. Use Requeue to reset their status and retry delivery.
                </p>
                {alertsOutboxLoading ? (
                  <div style={{ padding: "16px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>Loading…</div>
                ) : alertsOutbox.length === 0 ? (
                  <div style={{ padding: "16px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
                    No failed outbox entries. Everything is healthy.
                  </div>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 70px 110px 100px", gap: 8, padding: "6px 0", borderBottom: "1px solid #f0f0f0", marginBottom: 4 }}>
                      {["Email", "Source", "Attempts", "Last attempt", "Actions"].map((col) => (
                        <div key={col} style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.06em" }}>{col}</div>
                      ))}
                    </div>
                    {alertsOutbox.map((row) => {
                      const isRequeuing = requeueingOutboxId === row.id;
                      return (
                        <div
                          key={row.id}
                          className="settings-module-row"
                          style={{ display: "grid", gridTemplateColumns: "1fr 120px 70px 110px 100px", gap: 8, alignItems: "center" }}
                        >
                          <div style={{ fontSize: 13, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {row.subscriber?.email ?? "—"}
                          </div>
                          <div style={{ fontSize: 12, color: "#888" }}>{row.event?.source_slug ?? "—"}</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e53e3e" }}>{row.send_attempts}</div>
                          <div style={{ fontSize: 12, color: "#aaa" }}>
                            {row.last_attempt_at ? formatDateBR(row.last_attempt_at) : "—"}
                          </div>
                          <div>
                            <button
                              onClick={() => handleAlertsRequeueOutbox(row.id)}
                              disabled={!!requeueingOutboxId}
                              style={{
                                fontSize: 12, padding: "5px 10px", borderRadius: 6,
                                border: `1px solid ${ORANGE}`, background: "#fff", color: ORANGE,
                                cursor: isRequeuing ? "wait" : "pointer",
                                opacity: isRequeuing || (!!requeueingOutboxId && !isRequeuing) ? 0.6 : 1,
                                fontFamily: "Arial, sans-serif", whiteSpace: "nowrap",
                              }}
                            >
                              {isRequeuing ? "…" : "Requeue"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

            </div>
          )}

          {/* ── Default News Keywords ────────────────────────────────────────── */}
          {activeSection === "default-news" && (
            <div className="settings-card">
              <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>
                Default News Keywords
              </h2>
              <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px", lineHeight: 1.55 }}>
                These keywords are used by anonymous visitors of the News Hunter dashboard.
                Logged-in users have their own personal keyword list.
              </p>

              {/* Error banner */}
              {defaultKeywordsError && (
                <div style={{ padding: "10px 14px", background: "#fff5f5", borderRadius: 8, color: "#e53e3e", fontSize: 13, marginBottom: 16 }}>
                  {defaultKeywordsError}
                </div>
              )}

              {/* Add form */}
              <div style={{ display: "flex", gap: 10, marginBottom: 24, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <input
                    type="text"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddKeyword()}
                    placeholder="e.g. Petrobras, diesel, BNDES"
                    disabled={addingKeyword}
                    style={{
                      width: "100%", padding: "8px 12px", borderRadius: 8,
                      border: `1px solid ${addKeywordError ? "#e53e3e" : "#e0e0e0"}`,
                      fontSize: 13, fontFamily: "Arial, sans-serif", outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  {addKeywordError && (
                    <div style={{ fontSize: 12, color: "#e53e3e", marginTop: 4 }}>{addKeywordError}</div>
                  )}
                </div>
                {/* Exact match toggle for new keyword */}
                <label
                  title="When enabled, only whole-word matches trigger an alert. Useful for short/generic terms like 'Vibra'."
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 12px", borderRadius: 8,
                    border: `1px solid ${newKeywordMatchType === "exact" ? ORANGE : "#e0e0e0"}`,
                    background: newKeywordMatchType === "exact" ? "rgba(255,80,0,0.06)" : "#fff",
                    cursor: "pointer", fontSize: 12, fontFamily: "Arial, sans-serif",
                    color: newKeywordMatchType === "exact" ? ORANGE : "#666",
                    whiteSpace: "nowrap", transition: "all 0.15s", userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={newKeywordMatchType === "exact"}
                    onChange={(e) => setNewKeywordMatchType(e.target.checked ? "exact" : "substring")}
                    disabled={addingKeyword}
                    style={{ accentColor: ORANGE, cursor: "pointer" }}
                  />
                  Exact match (whole word)
                </label>
                <button
                  onClick={handleAddKeyword}
                  disabled={addingKeyword || !newKeyword.trim()}
                  style={{
                    padding: "8px 18px", borderRadius: 8, border: "none",
                    background: addingKeyword || !newKeyword.trim() ? "#e0e0e0" : ORANGE,
                    color: addingKeyword || !newKeyword.trim() ? "#aaa" : "#fff",
                    fontSize: 13, fontWeight: 600,
                    cursor: addingKeyword || !newKeyword.trim() ? "not-allowed" : "pointer",
                    fontFamily: "Arial, sans-serif", whiteSpace: "nowrap",
                    transition: "background 0.15s",
                  }}
                >
                  {addingKeyword ? "Adding…" : addKeywordSuccess ? "✓ Added" : "Add"}
                </button>
              </div>

              {/* Keyword list */}
              {defaultKeywordsLoading ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>Loading…</div>
              ) : defaultKeywords.length === 0 ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>No default keywords yet.</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {defaultKeywords.map((kw) => {
                    const isConfirming = confirmRemoveKeyword === kw.keyword;
                    const isRemoving = removingKeyword === kw.keyword;
                    const isExact = kw.match_type === "exact";
                    const isTogglingThis = togglingMatchType.has(kw.keyword);
                    return (
                      <span
                        key={kw.keyword}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "4px 10px 4px 12px",
                          borderRadius: 20,
                          background: isConfirming ? "#fff5f5" : isExact ? "rgba(255,80,0,0.12)" : "rgba(255,80,0,0.08)",
                          border: `1px solid ${isConfirming ? "#e53e3e" : isExact ? ORANGE : "rgba(255,80,0,0.25)"}`,
                          fontSize: 13, color: isConfirming ? "#e53e3e" : "#1a1a1a",
                          fontFamily: "Arial, sans-serif",
                          transition: "background 0.15s, border-color 0.15s",
                        }}
                      >
                        {kw.keyword}
                        {/* "Exact" badge — shown when match_type is exact */}
                        {!isConfirming && isExact && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                            textTransform: "uppercase", padding: "1px 5px",
                            borderRadius: 6, background: ORANGE, color: "#fff",
                          }}>
                            Exact
                          </span>
                        )}
                        {!isConfirming && (
                          /* Toggle match type button */
                          <button
                            onClick={() => handleToggleMatchType(kw.keyword, kw.match_type)}
                            disabled={isTogglingThis}
                            title={
                              isExact
                                ? "Switch to substring matching"
                                : "Switch to exact (whole-word) matching. When enabled, only whole-word matches trigger an alert. Useful for short/generic terms like 'Vibra'."
                            }
                            style={{
                              background: "none", border: "1px dashed",
                              borderColor: isExact ? ORANGE : "#ccc",
                              borderRadius: 4,
                              cursor: isTogglingThis ? "wait" : "pointer",
                              color: isExact ? ORANGE : "#999",
                              lineHeight: 1, padding: "1px 4px",
                              fontFamily: "Arial, sans-serif", fontSize: 10, fontWeight: 700,
                              display: "flex", alignItems: "center",
                              opacity: isTogglingThis ? 0.5 : 1,
                              transition: "opacity 0.15s",
                            }}
                            aria-label={`Toggle match type for keyword ${kw.keyword}`}
                          >
                            {isTogglingThis ? "…" : isExact ? "≈" : "="}
                          </button>
                        )}
                        {isConfirming ? (
                          <>
                            <button
                              onClick={() => handleRemoveKeyword(kw.keyword)}
                              disabled={isRemoving}
                              style={{ fontSize: 11, fontWeight: 700, marginLeft: 4, padding: "2px 8px", borderRadius: 10, border: "none", background: "#e53e3e", color: "#fff", cursor: isRemoving ? "wait" : "pointer", fontFamily: "Arial, sans-serif" }}
                            >
                              {isRemoving ? "…" : "Remove"}
                            </button>
                            <button
                              onClick={() => setConfirmRemoveKeyword(null)}
                              style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", color: "#555", cursor: "pointer", fontFamily: "Arial, sans-serif" }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmRemoveKeyword(kw.keyword)}
                            style={{
                              background: "none", border: "none", cursor: "pointer",
                              color: "#aaa", lineHeight: 1, padding: 0,
                              fontFamily: "Arial, sans-serif", fontSize: 14,
                              display: "flex", alignItems: "center",
                            }}
                            aria-label={`Remove keyword ${kw.keyword}`}
                            title="Remove"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Field Stakes ─────────────────────────────────────────────────── */}
          {activeSection === "field-stakes" && (
            <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", minHeight: 560, alignItems: "stretch" }}>

                {/* ── Left pane: field list ─────────────────────────────────── */}
                <div style={{ width: 340, flexShrink: 0, borderRight: "1px solid #ececec", display: "flex", flexDirection: "column", background: "#fafafa" }}>
                  <div style={{ padding: "20px 16px 12px", borderBottom: "1px solid #ececec", background: "#fff" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
                      <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1a1a1a", margin: 0 }}>
                        Fields
                      </h2>
                      <span style={{ fontSize: 11, color: "#aaa", fontWeight: 600 }}>
                        {fieldStakesOverview.length} total
                      </span>
                    </div>
                    <input
                      type="search"
                      value={stakesSearchQuery}
                      onChange={(e) => setStakesSearchQuery(e.target.value)}
                      placeholder="Search field…"
                      style={{
                        width: "100%", padding: "7px 10px", borderRadius: 8,
                        border: "1px solid #e0e0e0", fontSize: 13, fontFamily: "Arial, sans-serif",
                        outline: "none", boxSizing: "border-box",
                      }}
                    />
                    <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
                      {([
                        { id: "all" as const,        label: "All",     color: "#888",    bg: "rgba(160,160,160,0.10)" },
                        { id: "complete" as const,   label: "✓",       color: "#38a169", bg: "rgba(72,187,120,0.15)" },
                        { id: "incomplete" as const, label: "⚠",       color: "#d69e2e", bg: "rgba(214,158,46,0.15)" },
                        { id: "empty" as const,      label: "○",       color: "#999",    bg: "rgba(180,180,180,0.15)" },
                      ] as const).map(({ id, label, color, bg }) => {
                        const isActive = stakesStatusFilter === id;
                        const count = id === "all"
                          ? fieldStakesOverview.length
                          : id === "complete"
                            ? fieldStakesOverview.filter((o) => o.is_complete).length
                            : id === "incomplete"
                              ? fieldStakesOverview.filter((o) => !o.is_complete && o.n_empresas > 0).length
                              : fieldStakesOverview.filter((o) => o.n_empresas === 0).length;
                        return (
                          <button
                            key={id}
                            onClick={() => setStakesStatusFilter(id)}
                            style={{
                              flex: 1, padding: "5px 6px", borderRadius: 6,
                              border: isActive ? `1px solid ${color}` : "1px solid transparent",
                              background: isActive ? bg : "#f5f5f5",
                              color: isActive ? color : "#888",
                              fontSize: 11, fontWeight: 700, cursor: "pointer",
                              fontFamily: "Arial, sans-serif", textAlign: "center",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                              transition: "background 0.15s, border-color 0.15s",
                            }}
                            aria-pressed={isActive}
                            title={id}
                          >
                            <span>{label}</span>
                            <span style={{ fontSize: 10, opacity: 0.8, fontWeight: 600 }}>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ flex: 1, overflowY: "auto", maxHeight: 520 }}>
                    {fieldStakesLoading ? (
                      <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
                        Loading fields…
                      </div>
                    ) : groupedOverview.length === 0 ? (
                      <div style={{ padding: "24px 16px", textAlign: "center", color: "#bbb", fontSize: 12 }}>
                        No fields match the current filters.
                      </div>
                    ) : (
                      // Canonical-grouped rendering (Round 4).
                      // — Single-variant groups: render inline (no chevron),
                      //   the row itself is the variant selector.
                      // — Multi-variant groups: header is clickable (toggles
                      //   `expandedCanonicals`); when expanded, variants are
                      //   listed indented below.
                      // Right-pane editor still acts on ONE variant at a time
                      // because stakes legitimately differ per contract type.
                      groupedOverview.map((group) => {
                        const isMulti = group.n_variants > 1;
                        const isExpanded = expandedCanonicals.has(group.canonical);

                        // Group-level aggregate status (used in the header pill).
                        const groupStatus: "empty" | "complete" | "incomplete" | "mixed" =
                          group.all_empty
                            ? "empty"
                            : group.all_complete
                              ? "complete"
                              : group.any_incomplete && group.variants.some((v) => v.is_complete)
                                ? "mixed"
                                : "incomplete";
                        const groupStatusColor =
                          groupStatus === "complete"
                            ? "#38a169"
                            : groupStatus === "incomplete"
                              ? "#d69e2e"
                              : groupStatus === "mixed"
                                ? "#d69e2e"
                                : "#aaa";
                        const groupStatusBg =
                          groupStatus === "complete"
                            ? "rgba(72,187,120,0.15)"
                            : groupStatus === "incomplete"
                              ? "rgba(214,158,46,0.15)"
                              : groupStatus === "mixed"
                                ? "rgba(214,158,46,0.10)"
                                : "rgba(180,180,180,0.15)";
                        const groupStatusText =
                          groupStatus === "complete"
                            ? "100%"
                            : groupStatus === "mixed"
                              ? "Mixed"
                              : groupStatus === "incomplete"
                                ? `${group.variants[0].soma_pct.toFixed(2)}%`
                                : "—";

                        // ── Single-variant inline row ─────────────────────
                        if (!isMulti) {
                          const row = group.variants[0];
                          const isSelected = selectedCampo === row.campo;
                          return (
                            <button
                              key={group.canonical}
                              onClick={() => handleSelectCampo(row.campo)}
                              style={{
                                width: "100%", textAlign: "left", border: "none",
                                borderLeft: isSelected ? `3px solid ${ORANGE}` : "3px solid transparent",
                                background: isSelected ? "#fff" : "transparent",
                                padding: "10px 14px", cursor: "pointer",
                                borderBottom: "1px solid #f0f0f0",
                                fontFamily: "Arial, sans-serif",
                                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                                transition: "background 0.1s",
                              }}
                              onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "#f0f0f0"; }}
                              onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {row.campo}
                                </div>
                                <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
                                  {row.n_empresas} {row.n_empresas === 1 ? "company" : "companies"}
                                  {row.has_data_in_producao ? " · prod. data" : ""}
                                </div>
                              </div>
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                                background: groupStatusBg, color: groupStatusColor, flexShrink: 0, whiteSpace: "nowrap",
                              }}>
                                {groupStatusText}
                              </span>
                            </button>
                          );
                        }

                        // ── Multi-variant: collapsible group ──────────────
                        return (
                          <div key={group.canonical}>
                            {/* Group header — clickable to expand/collapse */}
                            <button
                              onClick={() => handleToggleCanonical(group.canonical)}
                              aria-expanded={isExpanded}
                              aria-controls={`field-stakes-group-${group.canonical}`}
                              style={{
                                width: "100%", textAlign: "left", border: "none",
                                background: "rgba(255,80,0,0.04)",
                                padding: "10px 14px 10px 10px", cursor: "pointer",
                                borderBottom: "1px solid #f0f0f0",
                                fontFamily: "Arial, sans-serif",
                                display: "flex", alignItems: "center", gap: 8,
                                transition: "background 0.1s",
                              }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,80,0,0.08)"; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,80,0,0.04)"; }}
                            >
                              {/* Chevron */}
                              <span
                                aria-hidden="true"
                                style={{
                                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                                  width: 14, height: 14, color: "#888", flexShrink: 0,
                                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                                  transition: "transform 0.12s",
                                }}
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="9 18 15 12 9 6" />
                                </svg>
                              </span>
                              {/* Canonical name */}
                              <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "baseline", gap: 6 }}>
                                <span style={{
                                  fontSize: 13, fontWeight: 700, color: "#1a1a1a",
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>
                                  {group.canonical}
                                </span>
                                <span style={{
                                  fontSize: 10, fontWeight: 600, color: "#888",
                                  background: "rgba(0,0,0,0.05)", padding: "1px 6px", borderRadius: 8,
                                  flexShrink: 0, whiteSpace: "nowrap",
                                }}>
                                  {group.n_variants} variants
                                </span>
                              </div>
                              {/* Aggregate status pill */}
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                                background: groupStatusBg, color: groupStatusColor, flexShrink: 0, whiteSpace: "nowrap",
                              }}>
                                {groupStatusText}
                              </span>
                            </button>

                            {/* Expanded — variants indented under the header */}
                            {isExpanded && (
                              <div id={`field-stakes-group-${group.canonical}`}>
                                {group.variants.map((row) => {
                                  const isSelected = selectedCampo === row.campo;
                                  const isEmpty = row.n_empresas === 0;
                                  const status = isEmpty ? "empty" : row.is_complete ? "complete" : "incomplete";
                                  const statusColor = status === "complete" ? "#38a169" : status === "incomplete" ? "#d69e2e" : "#aaa";
                                  const statusBg = status === "complete" ? "rgba(72,187,120,0.15)" : status === "incomplete" ? "rgba(214,158,46,0.15)" : "rgba(180,180,180,0.15)";
                                  const statusText = status === "complete" ? "100%" : status === "incomplete" ? `${row.soma_pct.toFixed(2)}%` : "—";
                                  return (
                                    <button
                                      key={row.campo}
                                      onClick={() => handleSelectCampo(row.campo)}
                                      style={{
                                        width: "100%", textAlign: "left", border: "none",
                                        borderLeft: isSelected ? `3px solid ${ORANGE}` : "3px solid transparent",
                                        background: isSelected ? "#fff" : "transparent",
                                        padding: "8px 14px 8px 30px", cursor: "pointer",
                                        borderBottom: "1px solid #f5f5f5",
                                        fontFamily: "Arial, sans-serif",
                                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                                        transition: "background 0.1s",
                                      }}
                                      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "#f0f0f0"; }}
                                      onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                                    >
                                      <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          {row.campo}
                                        </div>
                                        <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>
                                          {row.n_empresas} {row.n_empresas === 1 ? "company" : "companies"}
                                          {row.has_data_in_producao ? " · prod. data" : ""}
                                        </div>
                                      </div>
                                      <span style={{
                                        fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                                        background: statusBg, color: statusColor, flexShrink: 0, whiteSpace: "nowrap",
                                      }}>
                                        {statusText}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* ── Right pane: editor ────────────────────────────────────── */}
                <div style={{ flex: 1, padding: "20px 24px", display: "flex", flexDirection: "column", minWidth: 0 }}>
                  {!selectedCampo ? (
                    <div style={{
                      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#bbb", fontSize: 13, textAlign: "center", padding: 32,
                    }}>
                      Select a field on the left to edit its working-interest breakdown.
                    </div>
                  ) : (
                    <>
                      {/* Header */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                        <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#1a1a1a", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {selectedCampo}
                        </h3>
                        <span style={{
                          fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 12,
                          background: isValidSum ? "rgba(72,187,120,0.15)" : "rgba(229,62,62,0.15)",
                          color: isValidSum ? "#38a169" : "#e53e3e",
                          whiteSpace: "nowrap", flexShrink: 0,
                        }}>
                          {currentSum.toFixed(2)}% / 100%
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "#aaa", marginBottom: 14 }}>
                        {selectedCampoLastUpdated
                          ? `Last updated: ${formatDateBR(selectedCampoLastUpdated)}`
                          : "Not yet saved."}
                      </div>

                      {editorLoading ? (
                        <div style={{ padding: "32px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
                          Loading stakes…
                        </div>
                      ) : (
                        <>
                          {/* datalist for autocomplete (shared across all rows) */}
                          <datalist id="field-stakes-empresa-list">
                            {fieldStakesEmpresas.map((e) => (
                              <option key={e.empresa} value={e.empresa} />
                            ))}
                          </datalist>

                          {/* Table header */}
                          <div style={{ display: "flex", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f0f0f0", fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                            <div style={{ flex: 1 }}>Company</div>
                            <div style={{ width: 120, textAlign: "right", paddingRight: 8 }}>Stake %</div>
                            <div style={{ width: 32 }} />
                          </div>

                          {/* Rows */}
                          {editorStakes.length === 0 && (
                            <div style={{ padding: "20px 0", textAlign: "center", color: "#bbb", fontSize: 12 }}>
                              No companies registered yet. Use the form below to add one.
                            </div>
                          )}
                          {editorStakes.map((row, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: "flex", alignItems: "center", gap: 8, padding: "8px 0",
                                borderBottom: "1px solid #f5f5f5",
                              }}
                            >
                              <input
                                type="text"
                                list="field-stakes-empresa-list"
                                value={row.empresa}
                                onChange={(e) => handleChangeStake(idx, "empresa", e.target.value)}
                                placeholder="Company name"
                                style={{
                                  flex: 1, padding: "6px 10px", borderRadius: 6,
                                  border: "1px solid #e0e0e0", fontSize: 13, fontFamily: "Arial, sans-serif",
                                  outline: "none", boxSizing: "border-box",
                                }}
                              />
                              <input
                                type="number"
                                step={0.001}
                                min={0}
                                max={100}
                                value={Number.isFinite(row.stake_pct) ? row.stake_pct : 0}
                                onChange={(e) => handleChangeStake(idx, "stake_pct", e.target.value)}
                                style={{
                                  width: 120, padding: "6px 10px", borderRadius: 6,
                                  border: "1px solid #e0e0e0", fontSize: 13, fontFamily: "Arial, sans-serif",
                                  outline: "none", boxSizing: "border-box", textAlign: "right",
                                }}
                              />
                              <button
                                onClick={() => handleRemoveEmpresaRow(idx)}
                                style={{
                                  width: 32, height: 28, borderRadius: 6, border: "1px solid #e0e0e0",
                                  background: "#fff", color: "#e53e3e", cursor: "pointer",
                                  fontFamily: "Arial, sans-serif", fontSize: 14, lineHeight: 1,
                                }}
                                aria-label={`Remove ${row.empresa || "row"}`}
                                title="Remove row"
                              >
                                ×
                              </button>
                            </div>
                          ))}

                          {/* Add company form */}
                          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0 4px", borderTop: "1px dashed #e0e0e0", marginTop: 4 }}>
                            <input
                              type="text"
                              list="field-stakes-empresa-list"
                              value={newEmpresaInput}
                              onChange={(e) => setNewEmpresaInput(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleAddEmpresaRow()}
                              placeholder="+ Add company"
                              style={{
                                flex: 1, padding: "6px 10px", borderRadius: 6,
                                border: "1px solid #e0e0e0", fontSize: 13, fontFamily: "Arial, sans-serif",
                                outline: "none", boxSizing: "border-box",
                              }}
                            />
                            <input
                              type="number"
                              step={0.001}
                              min={0}
                              max={100}
                              value={newEmpresaPctInput}
                              onChange={(e) => setNewEmpresaPctInput(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleAddEmpresaRow()}
                              placeholder="0.00"
                              style={{
                                width: 120, padding: "6px 10px", borderRadius: 6,
                                border: "1px solid #e0e0e0", fontSize: 13, fontFamily: "Arial, sans-serif",
                                outline: "none", boxSizing: "border-box", textAlign: "right",
                              }}
                            />
                            <button
                              onClick={handleAddEmpresaRow}
                              style={{
                                width: 32, height: 28, borderRadius: 6, border: "none",
                                background: ORANGE, color: "#fff", cursor: "pointer",
                                fontFamily: "Arial, sans-serif", fontSize: 16, lineHeight: 1, fontWeight: 700,
                              }}
                              aria-label="Add row"
                              title="Add row"
                            >
                              +
                            </button>
                          </div>

                          {/* Error banner */}
                          {stakesError && (
                            <div style={{
                              marginTop: 12, padding: "10px 12px", borderRadius: 8,
                              background: "#fff5f5", border: "1px solid rgba(229,62,62,0.3)",
                              color: "#c0392b", fontSize: 12, lineHeight: 1.4,
                            }}>
                              {stakesError}
                            </div>
                          )}

                          {/* Footer actions */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18, paddingTop: 14, borderTop: "1px solid #ececec" }}>
                            <button
                              onClick={handleSaveStakes}
                              disabled={!isValidSum || savingStakes || !pendingChanges}
                              title={
                                !isValidSum
                                  ? "Sum must equal 100% before saving"
                                  : !pendingChanges
                                    ? "No changes to save"
                                    : undefined
                              }
                              style={{
                                padding: "8px 22px", borderRadius: 8, border: "none",
                                background: (!isValidSum || savingStakes || !pendingChanges) ? "#e0e0e0" : ORANGE,
                                color: (!isValidSum || savingStakes || !pendingChanges) ? "#aaa" : "#fff",
                                fontSize: 13, fontWeight: 700,
                                cursor: (!isValidSum || savingStakes || !pendingChanges) ? "not-allowed" : "pointer",
                                fontFamily: "Arial, sans-serif", transition: "background 0.15s",
                              }}
                            >
                              {savingStakes ? "Saving…" : "Save"}
                            </button>
                            <button
                              onClick={() => handleDeleteCampo(selectedCampo)}
                              disabled={savingStakes}
                              style={{
                                background: "none", border: "none", color: "#e53e3e",
                                fontSize: 12, fontWeight: 600, cursor: savingStakes ? "not-allowed" : "pointer",
                                fontFamily: "Arial, sans-serif", padding: "4px 6px",
                                opacity: savingStakes ? 0.5 : 1, textDecoration: "underline",
                              }}
                            >
                              Delete all stakes for this field
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Delete-confirm modal overlay */}
              {deleteCampoConfirm && (
                <div
                  style={{
                    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    zIndex: 1050, fontFamily: "Arial, sans-serif",
                  }}
                  onClick={handleCancelDeleteCampo}
                >
                  <div
                    style={{
                      background: "#fff", borderRadius: 10, padding: 24, maxWidth: 420,
                      boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 8px" }}>
                      Delete all stakes
                    </h3>
                    <p style={{ fontSize: 13, color: "#555", margin: "0 0 18px", lineHeight: 1.5 }}>
                      Delete all stakes for <strong>«{deleteCampoConfirm}»</strong>?
                      This cannot be undone.
                    </p>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <button
                        onClick={handleCancelDeleteCampo}
                        disabled={savingStakes}
                        style={{
                          padding: "8px 16px", borderRadius: 8, border: "1px solid #e0e0e0",
                          background: "#fff", color: "#555", fontSize: 13, fontWeight: 600,
                          cursor: savingStakes ? "not-allowed" : "pointer", fontFamily: "Arial, sans-serif",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleConfirmDeleteCampo}
                        disabled={savingStakes}
                        style={{
                          padding: "8px 16px", borderRadius: 8, border: "none",
                          background: "#e53e3e", color: "#fff", fontSize: 13, fontWeight: 700,
                          cursor: savingStakes ? "wait" : "pointer", fontFamily: "Arial, sans-serif",
                          opacity: savingStakes ? 0.6 : 1,
                        }}
                      >
                        {savingStakes ? "Deleting…" : "Confirm"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </main>
  );
}
