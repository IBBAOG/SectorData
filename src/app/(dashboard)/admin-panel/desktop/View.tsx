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
  type SgSubTab,
  type SgValueMode,
  type SgTableDraft,
  type SgGridBaseMetric,
  type SgUploadState,
  sgGridOutputKey,
} from "../useAdminPanelData";
import type {
  SensitivityAxis,
  SensitivityTableAdmin,
  StockGuideDriver,
} from "../../../../types/stockGuide";
import {
  isDynamicSource,
  type DriverCatalogEntry,
} from "../../../../hooks/useMarketDrivers";
import type { BaseInputMeta } from "../../../../lib/stockGuideSensitivity";
import type { GridUploadResult } from "../../../../lib/stockGuideGridUpload";

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
  "client-alerts": (
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
  "stock-guide": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
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
    handleToggle,

    localHomeVis,
    savingHome,
    homeToggleError,
    handleHomeToggle,

    localPublicVis,
    savingPublic,
    publicToggleError,
    handlePublicToggle,

    users,
    usersLoading,
    localRoles,
    savingUser,
    savedUser,
    handleRoleChange,

    caStats,
    caBases,
    caSubscribers,
    caEmailLog,
    caOverviewLoading,
    caSubscribersLoading,
    caEmailLogLoading,
    caError,
    caSubscribersError,
    caEmailLogError,
    caSourceActive,
    caTogglingSource,
    caSubscriberFilter,
    setCaSubscriberFilter,
    caTestEmail,
    setCaTestEmail,
    caSendingTest,
    caTestResult,
    caTestError,
    caCountsBySource,
    handleToggleCaSource,
    handleQueueCaTest,
    handleRefreshCaSubscribers,

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

    sgSubTab,
    setSgSubTab,
    sgLoading,
    sgConfigDraft,
    setSgConfigDraft,
    sgConfigSaving,
    sgConfigSaved,
    sgConfigError,
    sgSelectedTicker,
    sgEditorRow,
    sgEditorLoading,
    sgSaving,
    sgError,
    sgDeleteConfirm,
    sgTogglingVisibility,
    sgSearchQuery,
    setSgSearchQuery,
    sgFilteredCompanies,
    sgCompanyTickers,
    sgPendingChanges,
    handleSelectStockGuideCompany,
    handleChangeSgField,
    handleSaveSgCompany,
    handleToggleSgVisibility,
    handleSaveSgConfig,
    handleDeleteSgCompany,
    handleConfirmDeleteSgCompany,
    handleCancelDeleteSgCompany,

    sgDrivers,
    sgDriverRows,
    sgDriversLoading,
    sgDriversError,
    sgMarketCatalog,
    sgMarketLoading,
    sgResolveDriverRowValue,
    sgDriverSavingKey,
    sgDriverDeleteConfirm,
    handleChangeSgDriverField,
    handleSaveSgDriver,
    handleDeleteSgDriver,
    handleConfirmDeleteSgDriver,
    handleCancelDeleteSgDriver,

    sgTables,
    sgTablesLoading,
    sgTablesError,
    sgTableDraft,
    sgTableSaving,
    sgTableSaveError,
    sgTablePendingChanges,
    sgTableDeleteConfirm,
    sgTableValidationError,
    sgTableRowLabels,
    sgTableColLabels,
    sgTableBaseInputMeta,
    sgPreviewCell,
    sgPreviewQuotesLoading,
    handleSelectSgTable,
    handleNewSgTable,
    handleCancelSgTableEdit,
    handleChangeSgTableField,
    handleChangeSgTableValueMode,
    handleChangeSgTableSingleCompany,
    handleChangeSgAxisKind,
    handleChangeSgAxisDriver,
    handleToggleSgAxisCompany,
    handleAddSgAxisScenario,
    handleChangeSgAxisScenario,
    handleRemoveSgAxisScenario,
    handleChangeSgTableCell,
    handleChangeSgTableCellSecondary,
    sgGridDriverCatalog,
    sgGridDrivers,
    sgGridBaseCatalog,
    handleToggleSgGrid,
    handleAddSgGridOutput,
    handleRemoveSgGridOutput,
    handleChangeSgGridOutputBase,
    handleChangeSgGridOutputYear,
    handleAddSgGridAxis,
    handleRemoveSgGridAxis,
    handleChangeSgGridAxisField,
    handleToggleSgGridCompany,
    handleDownloadGridTemplate,
    sgGridTemplateWarning,
    sgGridPointCount,
    sgGridPointCountLoading,
    sgUpload,
    handleSelectSgGridUploadFile,
    handleConfirmSgGridUpload,
    handleResetSgGridUpload,
    handleSaveSgTable,
    handleDeleteSgTable,
    handleConfirmDeleteSgTable,
    handleCancelDeleteSgTable,

    formatDateBR,
  } = useAdminPanelData();

  if (roleLoading || !allowed) return null;

  const currentSection = SECTIONS.find((s) => s.id === activeSection)!;

  // ── Stock Guide comps-field rendering helper (local; keeps the 16 numeric
  //    inputs DRY). Each field is a labeled text/number input bound to
  //    sgEditorRow via handleChangeSgField. ────────────────────────────────────
  const SG_INPUT_STYLE: React.CSSProperties = {
    width: "100%", padding: "6px 10px", borderRadius: 6,
    border: "1px solid #e0e0e0", fontSize: 13, fontFamily: "Arial, sans-serif",
    outline: "none", boxSizing: "border-box",
  };
  type SgNumericField =
    | "shares_outstanding" | "target_price" | "display_order"
    | "net_debt_y1" | "net_debt_y2"
    | "ebitda_y1" | "ebitda_y2" | "net_income_y1" | "net_income_y2"
    | "mcap_adj_y1" | "mcap_adj_y2"
    | "fcfe_y1" | "fcfe_y2" | "dividends_y1" | "dividends_y2"
    | "volumes_y1" | "volumes_y2";
  const renderSgNumField = (
    field: SgNumericField,
    label: string,
    opts?: { hint?: string; placeholder?: string; step?: number },
  ): React.ReactElement => (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 4, letterSpacing: "0.02em" }}>
        {label}
      </span>
      <input
        type="number"
        step={opts?.step ?? "any"}
        value={sgEditorRow ? sgEditorRow[field] : ""}
        onChange={(e) => handleChangeSgField(field, e.target.value)}
        placeholder={opts?.placeholder ?? ""}
        style={{ ...SG_INPUT_STYLE, textAlign: "right" }}
      />
      {opts?.hint && (
        <span style={{ display: "block", fontSize: 10, color: "#aaa", marginTop: 3 }}>{opts.hint}</span>
      )}
    </label>
  );

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
                const isSavingPublic = savingPublic === slug;
                const isSavingHome = savingHome === slug;
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

          {/* ── Client Alerts (the rebuilt client-alerts product) ────────────── */}
          {activeSection === "client-alerts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              {/* 1 — Stats overview */}
              <div className="settings-card">
                <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>
                  Overview
                </h2>
                <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px" }}>
                  Live subscription and delivery figures for the client email alerts product.
                </p>

                {caError && (
                  <div style={{ padding: "10px 14px", background: "#fff5f5", borderRadius: 8, color: "#e53e3e", fontSize: 13, marginBottom: 16 }}>
                    {caError}
                  </div>
                )}

                {caOverviewLoading ? (
                  <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>Loading…</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                    {([
                      { label: "Total subscriptions",  value: caStats?.totals.subscriptions_total ?? 0,  tone: "#1a1a1a" },
                      { label: "Active subscriptions", value: caStats?.totals.subscriptions_active ?? 0, tone: "#38a169" },
                      { label: "Unique users",         value: caStats?.totals.unique_users ?? 0,         tone: "#1a1a1a" },
                      { label: "Sent (7d)",            value: caStats?.sent_7d ?? 0,                     tone: ORANGE },
                      { label: "Bounced (7d)",         value: caStats?.bounced_7d ?? 0,                  tone: (caStats?.bounced_7d ?? 0) > 0 ? "#e53e3e" : "#999" },
                    ] as const).map((card) => (
                      <div
                        key={card.label}
                        style={{
                          padding: "16px 18px", borderRadius: 10,
                          border: "1px solid #eee", background: "#fafafa",
                        }}
                      >
                        <div style={{ fontSize: "1.6rem", fontWeight: 700, color: card.tone, lineHeight: 1.1 }}>
                          {card.value.toLocaleString("en-US")}
                        </div>
                        <div style={{ fontSize: 11, color: "#888", marginTop: 4, fontWeight: 600, letterSpacing: "0.02em" }}>
                          {card.label}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2 — Sources */}
              <div className="settings-card">
                <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>
                  Sources
                </h2>
                <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px" }}>
                  The subscribable data sources. Toggle a source on/off, and queue a synthetic test
                  event (delivered on the next alert run, not immediately).
                </p>

                {caOverviewLoading ? (
                  <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>Loading…</div>
                ) : caBases.length === 0 ? (
                  <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>No subscribable sources.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "#999", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          <th style={{ padding: "8px 10px", fontWeight: 700 }}>Source</th>
                          <th style={{ padding: "8px 10px", fontWeight: 700 }}>Category</th>
                          <th style={{ padding: "8px 10px", fontWeight: 700 }}>Cadence</th>
                          <th style={{ padding: "8px 10px", fontWeight: 700, textAlign: "center" }}>Subscribers</th>
                          <th style={{ padding: "8px 10px", fontWeight: 700, textAlign: "center" }}>Enabled</th>
                          <th style={{ padding: "8px 10px", fontWeight: 700 }}>Test event</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caBases.map((b) => {
                          const counts = caCountsBySource[b.source_slug] ?? { total: 0, active: 0 };
                          const isActive = caSourceActive[b.source_slug] ?? true;
                          const isTogglingThis = caTogglingSource === b.source_slug;
                          const isSendingThis = caSendingTest === b.source_slug;
                          const testResult = caTestResult?.slug === b.source_slug ? caTestResult : null;
                          const testError = caTestError?.slug === b.source_slug ? caTestError : null;
                          return (
                            <tr key={b.source_slug} style={{ borderTop: "1px solid #f0f0f0" }}>
                              <td style={{ padding: "10px", verticalAlign: "top" }}>
                                <div style={{ fontWeight: 600, color: "#1a1a1a" }}>{b.display_name}</div>
                                <div style={{ fontSize: 11, color: "#bbb", marginTop: 2 }}>{b.source_slug}</div>
                              </td>
                              <td style={{ padding: "10px", color: "#666", verticalAlign: "top" }}>{b.category}</td>
                              <td style={{ padding: "10px", verticalAlign: "top" }}>
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 12,
                                  background: b.cadence === "immediate" ? "rgba(255,80,0,0.10)" : "rgba(100,100,100,0.10)",
                                  color: b.cadence === "immediate" ? ORANGE : "#777",
                                  textTransform: "capitalize", whiteSpace: "nowrap",
                                }}>
                                  {b.cadence}
                                </span>
                              </td>
                              <td style={{ padding: "10px", textAlign: "center", color: "#444", verticalAlign: "top", whiteSpace: "nowrap" }}>
                                <span style={{ fontWeight: 700, color: "#38a169" }}>{counts.active}</span>
                                <span style={{ color: "#bbb" }}> / {counts.total}</span>
                              </td>
                              <td style={{ padding: "10px", textAlign: "center", verticalAlign: "top" }}>
                                <button
                                  onClick={() => handleToggleCaSource(b.source_slug, !isActive)}
                                  disabled={isTogglingThis}
                                  role="switch"
                                  aria-checked={isActive}
                                  aria-label={`Toggle source ${b.display_name}`}
                                  style={{
                                    width: 38, height: 22, borderRadius: 11, border: "none",
                                    position: "relative", cursor: isTogglingThis ? "wait" : "pointer",
                                    background: isActive ? ORANGE : "#ccc",
                                    opacity: isTogglingThis ? 0.6 : 1, transition: "background 0.15s",
                                    padding: 0, verticalAlign: "middle",
                                  }}
                                >
                                  <span style={{
                                    position: "absolute", top: 2, left: isActive ? 18 : 2,
                                    width: 18, height: 18, borderRadius: "50%", background: "#fff",
                                    transition: "left 0.15s",
                                  }} />
                                </button>
                              </td>
                              <td style={{ padding: "10px", verticalAlign: "top", minWidth: 250 }}>
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                  <input
                                    type="email"
                                    value={caTestEmail[b.source_slug] ?? ""}
                                    onChange={(e) => setCaTestEmail(b.source_slug, e.target.value)}
                                    placeholder="email (optional)"
                                    disabled={isSendingThis}
                                    style={{
                                      flex: 1, minWidth: 0, padding: "5px 8px", borderRadius: 6,
                                      border: `1px solid ${testError ? "#e53e3e" : "#e0e0e0"}`,
                                      fontSize: 12, fontFamily: "Arial, sans-serif", outline: "none",
                                      boxSizing: "border-box",
                                    }}
                                  />
                                  <button
                                    onClick={() => handleQueueCaTest(b.source_slug)}
                                    disabled={isSendingThis}
                                    style={{
                                      padding: "5px 12px", borderRadius: 6, border: `1px solid ${ORANGE}`,
                                      background: "#fff", color: ORANGE, fontSize: 12, fontWeight: 600,
                                      cursor: isSendingThis ? "wait" : "pointer", fontFamily: "Arial, sans-serif",
                                      whiteSpace: "nowrap", opacity: isSendingThis ? 0.6 : 1,
                                    }}
                                  >
                                    {isSendingThis ? "Queuing…" : "Queue test"}
                                  </button>
                                </div>
                                {testResult && (
                                  <div style={{ fontSize: 11, color: "#38a169", marginTop: 4, lineHeight: 1.4 }}>
                                    ✓ Test event queued (id {testResult.eventId.slice(0, 8)}…). Delivered on the next alert run.
                                  </div>
                                )}
                                {testError && (
                                  <div style={{ fontSize: 11, color: "#e53e3e", marginTop: 4 }}>{testError.message}</div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 3 — Subscribers */}
              <div className="settings-card">
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
                  <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: 0 }}>
                    Subscribers
                  </h2>
                  {/* Source filter dropdown */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <select
                      value={caSubscriberFilter}
                      onChange={(e) => setCaSubscriberFilter(e.target.value)}
                      style={{
                        padding: "6px 10px", borderRadius: 6, border: "1px solid #e0e0e0",
                        fontSize: 12, fontFamily: "Arial, sans-serif", color: "#555",
                        background: "#fff", cursor: "pointer", outline: "none",
                      }}
                    >
                      <option value="">All sources</option>
                      {caBases.map((b) => (
                        <option key={b.source_slug} value={b.source_slug}>{b.display_name}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleRefreshCaSubscribers}
                      disabled={caSubscribersLoading}
                      style={{
                        padding: "6px 12px", borderRadius: 6, border: "1px solid #e0e0e0",
                        background: "#fff", color: "#555", fontSize: 12, fontWeight: 600,
                        cursor: caSubscribersLoading ? "wait" : "pointer", fontFamily: "Arial, sans-serif",
                      }}
                    >
                      {caSubscribersLoading ? "…" : "Refresh"}
                    </button>
                  </div>
                </div>
                <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px" }}>
                  Per-user subscriptions (active and paused), up to the 200 most recent.
                </p>

                {caSubscribersError ? (
                  <div style={{ padding: "16px", background: "#fff5f5", borderRadius: 8, color: "#e53e3e", fontSize: 13 }}>
                    {caSubscribersError}
                  </div>
                ) : caSubscribersLoading ? (
                  <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>Loading…</div>
                ) : caSubscribers.length === 0 ? (
                  <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>No subscribers found.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "#999", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          <th style={{ padding: "8px 10px", fontWeight: 700 }}>Email</th>
                          <th style={{ padding: "8px 10px", fontWeight: 700 }}>Source</th>
                          <th style={{ padding: "8px 10px", fontWeight: 700, textAlign: "center" }}>Active</th>
                          <th style={{ padding: "8px 10px", fontWeight: 700 }}>Cadence override</th>
                          <th style={{ padding: "8px 10px", fontWeight: 700 }}>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caSubscribers.map((s) => (
                          <tr key={s.subscription_id} style={{ borderTop: "1px solid #f0f0f0" }}>
                            <td style={{ padding: "10px", fontWeight: 600, color: "#1a1a1a", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {s.email}
                            </td>
                            <td style={{ padding: "10px", color: "#666", whiteSpace: "nowrap" }}>{s.source_slug}</td>
                            <td style={{ padding: "10px", textAlign: "center" }}>
                              <span style={{
                                fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 12,
                                background: s.is_active ? "rgba(72,187,120,0.15)" : "rgba(160,160,160,0.15)",
                                color: s.is_active ? "#38a169" : "#999",
                              }}>
                                {s.is_active ? "Active" : "Paused"}
                              </span>
                            </td>
                            <td style={{ padding: "10px", color: s.cadence_override ? "#444" : "#bbb" }}>
                              {s.cadence_override ?? "—"}
                            </td>
                            <td style={{ padding: "10px", color: "#888", whiteSpace: "nowrap" }}>{formatDateBR(s.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 4 — Recent email log */}
              <div className="settings-card">
                <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>
                  Recent email log
                </h2>
                <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px" }}>
                  The 100 most recent alert email-delivery records.
                </p>

                {caEmailLogError ? (
                  <div style={{ padding: "16px", background: "#fff5f5", borderRadius: 8, color: "#e53e3e", fontSize: 13 }}>
                    {caEmailLogError}
                  </div>
                ) : caEmailLogLoading ? (
                  <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>Loading…</div>
                ) : caEmailLog.length === 0 ? (
                  <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>No emails sent yet.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "#999", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          <th style={{ padding: "8px 10px", fontWeight: 700 }}>Time</th>
                          <th style={{ padding: "8px 10px", fontWeight: 700 }}>Email</th>
                          <th style={{ padding: "8px 10px", fontWeight: 700 }}>Subject</th>
                          <th style={{ padding: "8px 10px", fontWeight: 700, textAlign: "center" }}>Status</th>
                          <th style={{ padding: "8px 10px", fontWeight: 700 }}>Provider id</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caEmailLog.map((row) => {
                          const ok = row.status === "sent" || row.status === "delivered";
                          const bad = row.status === "bounced" || row.status === "failed" || row.status === "complained";
                          const pillBg = ok ? "rgba(72,187,120,0.15)" : bad ? "rgba(229,62,62,0.12)" : "rgba(160,160,160,0.15)";
                          const pillColor = ok ? "#38a169" : bad ? "#e53e3e" : "#999";
                          return (
                            <tr key={row.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                              <td style={{ padding: "10px", color: "#888", whiteSpace: "nowrap" }}>{formatDateBR(row.recorded_at)}</td>
                              <td style={{ padding: "10px", fontWeight: 600, color: "#1a1a1a", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {row.email}
                              </td>
                              <td style={{ padding: "10px", color: "#555", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {row.subject}
                              </td>
                              <td style={{ padding: "10px", textAlign: "center" }}>
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 12,
                                  background: pillBg, color: pillColor, textTransform: "capitalize", whiteSpace: "nowrap",
                                }}>
                                  {row.status}
                                </span>
                              </td>
                              <td style={{ padding: "10px", color: "#bbb", fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                                {row.provider_message_id ? `${row.provider_message_id.slice(0, 14)}…` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
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

          {/* ── Stock Guide ──────────────────────────────────────────────────── */}
          {activeSection === "stock-guide" && (
            <>
              {/* ── Sub-navigation: Companies / Drivers / Sensitivities ───────── */}
              <div
                style={{
                  display: "flex", gap: 4, marginBottom: 18, padding: 4,
                  background: "#ececec", borderRadius: 10, width: "fit-content",
                }}
              >
                {([
                  { id: "companies" as const,     label: "Companies" },
                  { id: "drivers" as const,       label: "Drivers" },
                  { id: "sensitivities" as const, label: "Sensitivities" },
                ]).map(({ id, label }) => {
                  const isActive = sgSubTab === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setSgSubTab(id as SgSubTab)}
                      aria-pressed={isActive}
                      style={{
                        padding: "7px 18px", borderRadius: 7, border: "none",
                        background: isActive ? "#fff" : "transparent",
                        color: isActive ? ORANGE : "#777",
                        fontSize: 13, fontWeight: 700, cursor: "pointer",
                        fontFamily: "Arial, sans-serif",
                        boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                        transition: "background 0.15s, color 0.15s",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* ════════════════════════ COMPANIES sub-tab ═══════════════════ */}
              {sgSubTab === "companies" && (
              <>
              {/* ── Global config sub-panel ───────────────────────────────────── */}
              <div className="settings-card" style={{ marginBottom: 18 }}>
                <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>
                  Forward-year labels &amp; assumptions
                </h2>
                <p style={{ fontSize: 13, color: "#888", margin: "0 0 16px" }}>
                  Column headers shown over the Y1/Y2 multiples, plus the assumptions footnote on the public dashboard.
                </p>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <label style={{ display: "block", width: 140 }}>
                    <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 4 }}>
                      Year 1 label
                    </span>
                    <input
                      type="text"
                      value={sgConfigDraft.y1_label}
                      onChange={(e) => setSgConfigDraft({ ...sgConfigDraft, y1_label: e.target.value })}
                      placeholder="2026E"
                      style={{ ...SG_INPUT_STYLE }}
                    />
                  </label>
                  <label style={{ display: "block", width: 140 }}>
                    <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 4 }}>
                      Year 2 label
                    </span>
                    <input
                      type="text"
                      value={sgConfigDraft.y2_label}
                      onChange={(e) => setSgConfigDraft({ ...sgConfigDraft, y2_label: e.target.value })}
                      placeholder="2027E"
                      style={{ ...SG_INPUT_STYLE }}
                    />
                  </label>
                  <label style={{ display: "block", flex: 1, minWidth: 240 }}>
                    <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 4 }}>
                      Assumptions note
                    </span>
                    <textarea
                      value={sgConfigDraft.assumptions_note}
                      onChange={(e) => setSgConfigDraft({ ...sgConfigDraft, assumptions_note: e.target.value })}
                      placeholder="e.g. Brent USD 80/bbl 2026, BRL 5.20/USD"
                      rows={2}
                      style={{ ...SG_INPUT_STYLE, resize: "vertical", minHeight: 56 }}
                    />
                  </label>
                </div>
                {sgConfigError && (
                  <div style={{
                    marginTop: 12, padding: "10px 12px", borderRadius: 8,
                    background: "#fff5f5", border: "1px solid rgba(229,62,62,0.3)",
                    color: "#c0392b", fontSize: 12, lineHeight: 1.4,
                  }}>
                    {sgConfigError}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
                  <button
                    onClick={handleSaveSgConfig}
                    disabled={sgConfigSaving}
                    style={{
                      padding: "8px 22px", borderRadius: 8, border: "none",
                      background: sgConfigSaving ? "#e0e0e0" : ORANGE,
                      color: sgConfigSaving ? "#aaa" : "#fff",
                      fontSize: 13, fontWeight: 700,
                      cursor: sgConfigSaving ? "not-allowed" : "pointer",
                      fontFamily: "Arial, sans-serif", transition: "background 0.15s",
                    }}
                  >
                    {sgConfigSaving ? "Saving…" : "Save config"}
                  </button>
                  {sgConfigSaved && (
                    <span style={{ fontSize: 12, color: "#38a169", fontWeight: 600 }}>Saved ✓</span>
                  )}
                </div>
              </div>

              {/* ── Two-pane: company list + editor ───────────────────────────── */}
              <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", minHeight: 560, alignItems: "stretch" }}>

                  {/* ── Left pane: company list ─────────────────────────────── */}
                  <div style={{ width: 320, flexShrink: 0, borderRight: "1px solid #ececec", display: "flex", flexDirection: "column", background: "#fafafa" }}>
                    <div style={{ padding: "20px 16px 12px", borderBottom: "1px solid #ececec", background: "#fff" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
                        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1a1a1a", margin: 0 }}>
                          Companies
                        </h2>
                        <span style={{ fontSize: 11, color: "#aaa", fontWeight: 600 }}>
                          {sgFilteredCompanies.length} shown
                        </span>
                      </div>
                      <input
                        type="search"
                        value={sgSearchQuery}
                        onChange={(e) => setSgSearchQuery(e.target.value)}
                        placeholder="Search ticker or name…"
                        style={{
                          width: "100%", padding: "7px 10px", borderRadius: 8,
                          border: "1px solid #e0e0e0", fontSize: 13, fontFamily: "Arial, sans-serif",
                          outline: "none", boxSizing: "border-box",
                        }}
                      />
                    </div>
                    <div style={{ flex: 1, overflowY: "auto", maxHeight: 520 }}>
                      {sgLoading ? (
                        <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
                          Loading companies…
                        </div>
                      ) : sgFilteredCompanies.length === 0 ? (
                        <div style={{ padding: "24px 16px", textAlign: "center", color: "#bbb", fontSize: 12 }}>
                          No companies match the search.
                        </div>
                      ) : (
                        sgFilteredCompanies.map((c) => {
                          const isSelected = sgSelectedTicker === c.ticker;
                          const toggling = sgTogglingVisibility === c.ticker;
                          return (
                            <div
                              key={c.ticker}
                              style={{
                                borderLeft: isSelected ? `3px solid ${ORANGE}` : "3px solid transparent",
                                background: isSelected ? "#fff" : "transparent",
                                borderBottom: "1px solid #f0f0f0",
                                display: "flex", alignItems: "center", gap: 8,
                                padding: "8px 12px 8px 14px",
                                transition: "background 0.1s",
                              }}
                              onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "#f0f0f0"; }}
                              onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                            >
                              <button
                                onClick={() => handleSelectStockGuideCompany(c.ticker)}
                                style={{
                                  flex: 1, minWidth: 0, textAlign: "left", border: "none",
                                  background: "transparent", cursor: "pointer", padding: 0,
                                  fontFamily: "Arial, sans-serif",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>
                                    {c.ticker}
                                  </span>
                                  {!c.is_visible && (
                                    <span style={{
                                      fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
                                      background: "rgba(160,160,160,0.18)", color: "#888", whiteSpace: "nowrap",
                                      textTransform: "uppercase", letterSpacing: "0.04em",
                                    }}>
                                      Restricted
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 11, color: "#999", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {c.company_name}
                                </div>
                              </button>
                              {/* Hide/show toggle (optimistic) */}
                              <button
                                onClick={() => handleToggleSgVisibility(c.ticker, !c.is_visible)}
                                disabled={toggling}
                                role="switch"
                                aria-checked={c.is_visible}
                                aria-label={c.is_visible ? `Hide ${c.ticker}` : `Show ${c.ticker}`}
                                title={c.is_visible ? "Visible — click to restrict" : "Restricted — click to make visible"}
                                style={{
                                  flexShrink: 0, width: 38, height: 22, borderRadius: 11, border: "none",
                                  background: c.is_visible ? ORANGE : "#ccc",
                                  cursor: toggling ? "wait" : "pointer", position: "relative",
                                  transition: "background 0.15s", opacity: toggling ? 0.6 : 1, padding: 0,
                                }}
                              >
                                <span style={{
                                  position: "absolute", top: 2, left: c.is_visible ? 18 : 2,
                                  width: 18, height: 18, borderRadius: "50%", background: "#fff",
                                  transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                                }} />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* ── Right pane: comps editor + grid editor ──────────────── */}
                  <div style={{ flex: 1, padding: "20px 24px", display: "flex", flexDirection: "column", minWidth: 0, overflowY: "auto", maxHeight: 700 }}>
                    {!sgSelectedTicker ? (
                      <div style={{
                        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#bbb", fontSize: 13, textAlign: "center", padding: 32,
                      }}>
                        Select a company on the left to edit its comps and sensitivity grid.
                      </div>
                    ) : sgEditorLoading || !sgEditorRow ? (
                      <div style={{ padding: "32px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
                        Loading company…
                      </div>
                    ) : (
                      <>
                        {/* Header */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                          <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#1a1a1a", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {sgSelectedTicker}
                          </h3>
                        </div>

                        {/* ── Comps editor ──────────────────────────────────── */}
                        {/* Identity fields */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginBottom: 4 }}>
                          <label style={{ display: "block" }}>
                            <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 4 }}>Company name</span>
                            <input
                              type="text"
                              value={sgEditorRow.company_name}
                              onChange={(e) => handleChangeSgField("company_name", e.target.value)}
                              placeholder="Company name"
                              style={{ ...SG_INPUT_STYLE }}
                            />
                          </label>
                          <label style={{ display: "block" }}>
                            <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 4 }}>Yahoo symbol</span>
                            <input
                              type="text"
                              value={sgEditorRow.yahoo_symbol}
                              onChange={(e) => handleChangeSgField("yahoo_symbol", e.target.value)}
                              placeholder="e.g. PETR4"
                              style={{ ...SG_INPUT_STYLE }}
                            />
                          </label>
                          <label style={{ display: "block" }}>
                            <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 4 }}>Sector</span>
                            <select
                              value={sgEditorRow.sector}
                              onChange={(e) => handleChangeSgField("sector", e.target.value)}
                              style={{ ...SG_INPUT_STYLE, cursor: "pointer" }}
                            >
                              <option value="oil_gas">Oil &amp; Gas</option>
                              <option value="fuel_distribution">Fuel Distribution</option>
                            </select>
                          </label>
                          <label style={{ display: "block" }}>
                            <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 4 }}>Volume unit</span>
                            <select
                              value={sgEditorRow.volume_unit}
                              onChange={(e) => handleChangeSgField("volume_unit", e.target.value)}
                              style={{ ...SG_INPUT_STYLE, cursor: "pointer" }}
                            >
                              <option value="kbpd">kbpd</option>
                              <option value="thousand_m3">thousand m³</option>
                            </select>
                          </label>
                          <label style={{ display: "block" }}>
                            <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 4 }}>Recommendation</span>
                            <select
                              value={sgEditorRow.recommendation}
                              onChange={(e) => handleChangeSgField("recommendation", e.target.value)}
                              style={{ ...SG_INPUT_STYLE, cursor: "pointer" }}
                            >
                              <option value="">—</option>
                              <option value="OP">OP — Outperform</option>
                              <option value="MP">MP — Marketperform</option>
                              <option value="UP">UP — Underperform</option>
                            </select>
                          </label>
                          <label style={{ display: "block" }}>
                            <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 4 }}>Last update</span>
                            <input
                              type="date"
                              value={sgEditorRow.last_update}
                              onChange={(e) => handleChangeSgField("last_update", e.target.value)}
                              style={{ ...SG_INPUT_STYLE }}
                            />
                          </label>
                          {renderSgNumField("target_price", "Target price")}
                          {renderSgNumField("display_order", "Display order", { step: 1, placeholder: "0" })}
                          {renderSgNumField("shares_outstanding", "Shares outstanding (absolute)", {
                            hint: "used for Market cap = shares × live price",
                          })}
                        </div>

                        {/* Live-derivation hint */}
                        <div style={{
                          marginTop: 14, padding: "9px 12px", borderRadius: 8,
                          background: "rgba(255,80,0,0.06)", border: "1px solid rgba(255,80,0,0.18)",
                          color: "#9a4a23", fontSize: 11.5, lineHeight: 1.5,
                        }}>
                          EV/EBITDA, P/E, FCFE Yield and Div Yield are computed <strong>live</strong>{" "}
                          in the dashboard from the live price + these fundamentals — they are{" "}
                          <strong>not</strong> entered here. Enter Net Debt, EBITDA, Net Income,
                          FCFE and Dividends per year (all BRL mn) below. EV(year) = Market cap +
                          Net Debt(year); a negative Net Debt means net cash.
                        </div>

                        {/* Forward-pair groups (fundamentals) */}
                        <div style={{ marginTop: 18 }}>
                          {([
                            { label: "Net Debt (BRL mn, < 0 = net cash)", y1: "net_debt_y1" as const, y2: "net_debt_y2" as const },
                            { label: "EBITDA (BRL mn)",     y1: "ebitda_y1" as const,     y2: "ebitda_y2" as const },
                            { label: "Net Income (BRL mn)", y1: "net_income_y1" as const, y2: "net_income_y2" as const },
                            { label: "FCFE (BRL mn)",       y1: "fcfe_y1" as const,       y2: "fcfe_y2" as const },
                            { label: "Dividends (BRL mn)",  y1: "dividends_y1" as const,  y2: "dividends_y2" as const },
                            { label: "Volumes",             y1: "volumes_y1" as const,    y2: "volumes_y2" as const },
                          ]).map((grp, idx) => (
                            <div
                              key={grp.label}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "minmax(120px, 1.2fr) minmax(0, 1fr) minmax(0, 1fr)",
                                gap: 12, alignItems: "center",
                                padding: "8px 0",
                                borderTop: idx === 0 ? "1px solid #ececec" : "1px solid #f5f5f5",
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#555" }}>{grp.label}</div>
                              <label style={{ display: "block" }}>
                                <span style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#aaa", marginBottom: 3 }}>
                                  {sgConfigDraft.y1_label || "Y1"}
                                </span>
                                <input
                                  type="number"
                                  step="any"
                                  value={sgEditorRow[grp.y1]}
                                  onChange={(e) => handleChangeSgField(grp.y1, e.target.value)}
                                  style={{ ...SG_INPUT_STYLE, textAlign: "right" }}
                                />
                              </label>
                              <label style={{ display: "block" }}>
                                <span style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#aaa", marginBottom: 3 }}>
                                  {sgConfigDraft.y2_label || "Y2"}
                                </span>
                                <input
                                  type="number"
                                  step="any"
                                  value={sgEditorRow[grp.y2]}
                                  onChange={(e) => handleChangeSgField(grp.y2, e.target.value)}
                                  style={{ ...SG_INPUT_STYLE, textAlign: "right" }}
                                />
                              </label>
                            </div>
                          ))}
                        </div>

                        {/* Market-cap adjustment — tax-credit NPV (optional; subtracted from the live market cap) */}
                        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #ececec" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 4 }}>
                            Market cap adjustment — tax-credit NPV (optional)
                          </div>
                          <div style={{ fontSize: 11, color: "#aaa", marginBottom: 12, lineHeight: 1.5 }}>
                            Subtracted from the live market cap before computing EV/EBITDA,
                            P/E, FCFE Yield, Div Yield and the Upside-adjusted price. Use for
                            non-operating assets such as the NPV of recognized tax credits
                            (e.g. Vibra, Ultrapar). Leave empty for no adjustment. The Net
                            Income column and the P/E numerator always use reported earnings.
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                            {renderSgNumField("mcap_adj_y1", `Tax-credit NPV ${sgConfigDraft.y1_label || "Y1"} (BRL mn)`, {
                              placeholder: "empty = no adjustment",
                            })}
                            {renderSgNumField("mcap_adj_y2", `Tax-credit NPV ${sgConfigDraft.y2_label || "Y2"} (BRL mn)`, {
                              placeholder: "empty = no adjustment",
                            })}
                          </div>
                        </div>

                        {/* Comps error banner */}
                        {sgError && (
                          <div style={{
                            marginTop: 12, padding: "10px 12px", borderRadius: 8,
                            background: "#fff5f5", border: "1px solid rgba(229,62,62,0.3)",
                            color: "#c0392b", fontSize: 12, lineHeight: 1.4,
                          }}>
                            {sgError}
                          </div>
                        )}

                        {/* Comps footer actions */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18, paddingTop: 14, borderTop: "1px solid #ececec" }}>
                          <button
                            onClick={handleSaveSgCompany}
                            disabled={sgSaving || !sgPendingChanges}
                            title={!sgPendingChanges ? "No changes to save" : undefined}
                            style={{
                              padding: "8px 22px", borderRadius: 8, border: "none",
                              background: (sgSaving || !sgPendingChanges) ? "#e0e0e0" : ORANGE,
                              color: (sgSaving || !sgPendingChanges) ? "#aaa" : "#fff",
                              fontSize: 13, fontWeight: 700,
                              cursor: (sgSaving || !sgPendingChanges) ? "not-allowed" : "pointer",
                              fontFamily: "Arial, sans-serif", transition: "background 0.15s",
                            }}
                          >
                            {sgSaving ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={() => handleDeleteSgCompany(sgSelectedTicker)}
                            disabled={sgSaving}
                            style={{
                              background: "none", border: "none", color: "#e53e3e",
                              fontSize: 12, fontWeight: 600, cursor: sgSaving ? "not-allowed" : "pointer",
                              fontFamily: "Arial, sans-serif", padding: "4px 6px",
                              opacity: sgSaving ? 0.5 : 1, textDecoration: "underline",
                            }}
                          >
                            Delete company
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Delete-confirm modal overlay */}
                {sgDeleteConfirm && (
                  <div
                    style={{
                      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      zIndex: 1050, fontFamily: "Arial, sans-serif",
                    }}
                    onClick={handleCancelDeleteSgCompany}
                  >
                    <div
                      style={{
                        background: "#fff", borderRadius: 10, padding: 24, maxWidth: 420,
                        boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 8px" }}>
                        Delete company
                      </h3>
                      <p style={{ fontSize: 13, color: "#555", margin: "0 0 18px", lineHeight: 1.5 }}>
                        Delete <strong>«{sgDeleteConfirm}»</strong> and its sensitivity grid?
                        This cannot be undone.
                      </p>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        <button
                          onClick={handleCancelDeleteSgCompany}
                          disabled={sgSaving}
                          style={{
                            padding: "8px 16px", borderRadius: 8, border: "1px solid #e0e0e0",
                            background: "#fff", color: "#555", fontSize: 13, fontWeight: 600,
                            cursor: sgSaving ? "not-allowed" : "pointer", fontFamily: "Arial, sans-serif",
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleConfirmDeleteSgCompany}
                          disabled={sgSaving}
                          style={{
                            padding: "8px 16px", borderRadius: 8, border: "none",
                            background: "#e53e3e", color: "#fff", fontSize: 13, fontWeight: 700,
                            cursor: sgSaving ? "wait" : "pointer", fontFamily: "Arial, sans-serif",
                            opacity: sgSaving ? 0.6 : 1,
                          }}
                        >
                          {sgSaving ? "Deleting…" : "Confirm"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              </>
              )}

              {/* ════════════════════════ DRIVERS sub-tab ═════════════════════ */}
              {sgSubTab === "drivers" && (
                <div className="settings-card">
                  <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>
                    Drivers registry
                  </h2>
                  <p style={{ fontSize: 13, color: "#888", margin: "0 0 16px" }}>
                    Central macro/assumption variables (Brent, USD/BRL, …) referenced by
                    sensitivity tables. <strong>Current value</strong> is the &ldquo;today&rdquo;
                    base value used to highlight the matching scenario in a sensitivity table.
                    A driver can be <strong>Static</strong> (you type the value) or{" "}
                    <strong>Dynamic</strong> (bound to a live market metric, computed in the
                    browser from the Yahoo proxy).
                  </p>

                  {sgDriversError && (
                    <div style={{
                      marginBottom: 14, padding: "10px 12px", borderRadius: 8,
                      background: "#fff5f5", border: "1px solid rgba(229,62,62,0.3)",
                      color: "#c0392b", fontSize: 12, lineHeight: 1.4,
                    }}>
                      {sgDriversError}
                    </div>
                  )}

                  {sgDriversLoading ? (
                    <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
                      Loading drivers…
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: "2px solid #ececec" }}>
                            {["Name", "Source", "Unit", "Current value", ""].map((h, i) => (
                              <th
                                key={h || i}
                                style={{
                                  textAlign: i === 3 ? "right" : "left",
                                  padding: "8px 10px", fontSize: 11, fontWeight: 700,
                                  color: "#888", letterSpacing: "0.02em",
                                  width: i === 4 ? 90 : undefined,
                                }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sgDriverRows.map((row, index) => {
                            const isNew = row.id == null;
                            const key = isNew ? "new" : String(row.id);
                            const saving = sgDriverSavingKey === key;
                            const dynamic = isDynamicSource(row.source);
                            // FX metrics are a spot-flat approximation (no FX forward).
                            const isFxSource = row.source.startsWith("avg_fx_");
                            const computed = dynamic
                              ? sgResolveDriverRowValue(row)
                              : null;
                            const computedLabel =
                              computed != null && Number.isFinite(computed)
                                ? `${computed.toFixed(2)}${row.unit ? ` ${row.unit}` : ""}`
                                : sgMarketLoading
                                  ? "computing…"
                                  : "—";
                            return (
                              <tr
                                key={key}
                                style={{
                                  borderBottom: "1px solid #f0f0f0",
                                  background: isNew ? "rgba(255,80,0,0.04)" : "transparent",
                                }}
                              >
                                <td style={{ padding: "6px 10px" }}>
                                  <input
                                    type="text"
                                    value={row.name}
                                    onChange={(e) => handleChangeSgDriverField(index, "name", e.target.value)}
                                    placeholder={isNew ? "e.g. Brent" : ""}
                                    style={{ ...SG_INPUT_STYLE }}
                                  />
                                  {dynamic && (
                                    <span
                                      style={{
                                        display: "inline-block",
                                        marginTop: 4,
                                        padding: "1px 7px",
                                        borderRadius: 4,
                                        background: "rgba(255,80,0,0.10)",
                                        color: ORANGE,
                                        fontSize: 9.5,
                                        fontWeight: 700,
                                        letterSpacing: "0.04em",
                                        textTransform: "uppercase",
                                      }}
                                    >
                                      dynamic · {computedLabel}
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: "6px 10px" }}>
                                  <select
                                    value={row.source}
                                    onChange={(e) => handleChangeSgDriverField(index, "source", e.target.value)}
                                    style={{ ...SG_INPUT_STYLE, cursor: "pointer" }}
                                  >
                                    <option value="">Static</option>
                                    {sgMarketCatalog.map((c) => (
                                      <option key={c.key} value={c.key}>
                                        {c.label}
                                      </option>
                                    ))}
                                  </select>
                                  {dynamic && isFxSource && (
                                    <div style={{ fontSize: 9.5, color: "#aaa", marginTop: 3, lineHeight: 1.3 }}>
                                      (spot-based approximation — no FX forward)
                                    </div>
                                  )}
                                </td>
                                <td style={{ padding: "6px 10px" }}>
                                  <input
                                    type="text"
                                    value={row.unit}
                                    onChange={(e) => handleChangeSgDriverField(index, "unit", e.target.value)}
                                    placeholder={isNew ? "e.g. USD/bbl" : ""}
                                    disabled={dynamic}
                                    title={dynamic ? "Unit is set by the bound market metric" : undefined}
                                    style={{
                                      ...SG_INPUT_STYLE,
                                      ...(dynamic ? { background: "#f5f5f5", color: "#999", cursor: "not-allowed" } : {}),
                                    }}
                                  />
                                </td>
                                <td style={{ padding: "6px 10px" }}>
                                  {dynamic ? (
                                    <div
                                      style={{
                                        textAlign: "right",
                                        fontSize: 12,
                                        color: "#555",
                                        fontWeight: 600,
                                        whiteSpace: "nowrap",
                                      }}
                                      title="Computed live from the Yahoo proxy"
                                    >
                                      Computed: {computedLabel}
                                    </div>
                                  ) : (
                                    <input
                                      type="number"
                                      step="any"
                                      value={row.current_value}
                                      onChange={(e) => handleChangeSgDriverField(index, "current_value", e.target.value)}
                                      style={{ ...SG_INPUT_STYLE, textAlign: "right" }}
                                    />
                                  )}
                                </td>
                                <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                    <button
                                      onClick={() => handleSaveSgDriver(index)}
                                      disabled={saving || !row.name.trim()}
                                      title={!row.name.trim() ? "Name is required" : undefined}
                                      style={{
                                        padding: "5px 12px", borderRadius: 6, border: "none",
                                        background: (saving || !row.name.trim()) ? "#e0e0e0" : ORANGE,
                                        color: (saving || !row.name.trim()) ? "#aaa" : "#fff",
                                        fontSize: 12, fontWeight: 700,
                                        cursor: (saving || !row.name.trim()) ? "not-allowed" : "pointer",
                                        fontFamily: "Arial, sans-serif",
                                      }}
                                    >
                                      {saving ? "…" : isNew ? "Add" : "Save"}
                                    </button>
                                    {!isNew && row.id != null && (
                                      <button
                                        onClick={() => handleDeleteSgDriver(row.id as number)}
                                        disabled={saving}
                                        aria-label={`Delete driver ${row.name}`}
                                        title="Delete driver"
                                        style={{
                                          width: 28, height: 28, borderRadius: 6,
                                          border: "1px solid #e0e0e0", background: "#fff", color: "#e53e3e",
                                          cursor: saving ? "not-allowed" : "pointer", fontSize: 15, lineHeight: 1, padding: 0,
                                          fontFamily: "Arial, sans-serif",
                                        }}
                                      >
                                        ×
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Driver delete-confirm modal */}
                  {sgDriverDeleteConfirm != null && (
                    <div
                      style={{
                        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        zIndex: 1050, fontFamily: "Arial, sans-serif",
                      }}
                      onClick={handleCancelDeleteSgDriver}
                    >
                      <div
                        style={{
                          background: "#fff", borderRadius: 10, padding: 24, maxWidth: 420,
                          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 8px" }}>
                          Delete driver
                        </h3>
                        <p style={{ fontSize: 13, color: "#555", margin: "0 0 18px", lineHeight: 1.5 }}>
                          Delete{" "}
                          <strong>
                            «{sgDrivers.find((d) => d.id === sgDriverDeleteConfirm)?.name ?? sgDriverDeleteConfirm}»
                          </strong>
                          ? Sensitivity tables that reference it will keep their stored scenarios but
                          lose the driver name/highlight. This cannot be undone.
                        </p>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                          <button
                            onClick={handleCancelDeleteSgDriver}
                            style={{
                              padding: "8px 16px", borderRadius: 8, border: "1px solid #e0e0e0",
                              background: "#fff", color: "#555", fontSize: 13, fontWeight: 600,
                              cursor: "pointer", fontFamily: "Arial, sans-serif",
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleConfirmDeleteSgDriver}
                            style={{
                              padding: "8px 16px", borderRadius: 8, border: "none",
                              background: "#e53e3e", color: "#fff", fontSize: 13, fontWeight: 700,
                              cursor: "pointer", fontFamily: "Arial, sans-serif",
                            }}
                          >
                            Confirm
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ════════════════════════ SENSITIVITIES sub-tab ═══════════════ */}
              {sgSubTab === "sensitivities" && (
                <SensitivityBuilder
                  tables={sgTables}
                  tablesLoading={sgTablesLoading}
                  tablesError={sgTablesError}
                  draft={sgTableDraft}
                  saving={sgTableSaving}
                  saveError={sgTableSaveError}
                  pendingChanges={sgTablePendingChanges}
                  validationError={sgTableValidationError}
                  deleteConfirm={sgTableDeleteConfirm}
                  rowLabels={sgTableRowLabels}
                  colLabels={sgTableColLabels}
                  baseInputMeta={sgTableBaseInputMeta}
                  previewCell={sgPreviewCell}
                  previewQuotesLoading={sgPreviewQuotesLoading}
                  companyTickers={sgCompanyTickers}
                  drivers={sgDrivers}
                  inputStyle={SG_INPUT_STYLE}
                  onSelect={handleSelectSgTable}
                  onNew={handleNewSgTable}
                  onCancelEdit={handleCancelSgTableEdit}
                  onChangeField={handleChangeSgTableField}
                  onChangeValueMode={handleChangeSgTableValueMode}
                  onChangeSingleCompany={handleChangeSgTableSingleCompany}
                  onChangeAxisKind={handleChangeSgAxisKind}
                  onChangeAxisDriver={handleChangeSgAxisDriver}
                  onToggleAxisCompany={handleToggleSgAxisCompany}
                  onAddScenario={handleAddSgAxisScenario}
                  onChangeScenario={handleChangeSgAxisScenario}
                  onRemoveScenario={handleRemoveSgAxisScenario}
                  onChangeCell={handleChangeSgTableCell}
                  onChangeCellSecondary={handleChangeSgTableCellSecondary}
                  gridDriverCatalog={sgGridDriverCatalog}
                  gridDrivers={sgGridDrivers}
                  gridBaseCatalog={sgGridBaseCatalog}
                  onToggleGrid={handleToggleSgGrid}
                  onAddGridOutput={handleAddSgGridOutput}
                  onRemoveGridOutput={handleRemoveSgGridOutput}
                  onChangeGridOutputBase={handleChangeSgGridOutputBase}
                  onChangeGridOutputYear={handleChangeSgGridOutputYear}
                  onAddGridAxis={handleAddSgGridAxis}
                  onRemoveGridAxis={handleRemoveSgGridAxis}
                  onChangeGridAxisField={handleChangeSgGridAxisField}
                  onToggleGridCompany={handleToggleSgGridCompany}
                  onDownloadGridTemplate={handleDownloadGridTemplate}
                  gridTemplateWarning={sgGridTemplateWarning}
                  gridPointCount={sgGridPointCount}
                  gridPointCountLoading={sgGridPointCountLoading}
                  upload={sgUpload}
                  onSelectUploadFile={handleSelectSgGridUploadFile}
                  onConfirmUpload={handleConfirmSgGridUpload}
                  onResetUpload={handleResetSgGridUpload}
                  onSave={handleSaveSgTable}
                  onDelete={handleDeleteSgTable}
                  onConfirmDelete={handleConfirmDeleteSgTable}
                  onCancelDelete={handleCancelDeleteSgTable}
                />
              )}
            </>
          )}

        </div>
      </div>
    </main>
  );
}

// ── Filled-template upload panel (in-admin browser parse + chunked replace) ───
//
// Closes the configure → Download template → fill → Upload loop without a
// terminal. All state lives in the hook (`upload`); this is pure presentation.
// Errors (red) block the Confirm; warnings (amber) allow proceeding; a summary
// line previews the point count before the chunked replace-total.
function GridUploadPanel({
  disabled,
  upload,
  onSelectFile,
  onConfirm,
  onReset,
}: {
  disabled: boolean;
  upload: SgUploadState;
  onSelectFile: (file: File) => void;
  onConfirm: () => void;
  onReset: () => void;
}): React.ReactElement {
  const reportCard: React.CSSProperties = {
    marginTop: 10, padding: "10px 12px", borderRadius: 8,
    fontSize: 11.5, lineHeight: 1.5, fontFamily: "Arial, sans-serif",
  };

  const renderReport = (
    result: GridUploadResult,
    opts: { showConfirm: boolean },
  ): React.ReactElement => {
    const { errors, warnings, summary } = result;
    const s = summary;
    const summaryLine =
      `${s.scenarioCount.toLocaleString("en-US")} scenario${s.scenarioCount === 1 ? "" : "s"} × ` +
      `${s.tickerCount.toLocaleString("en-US")} ticker${s.tickerCount === 1 ? "" : "s"} × ` +
      `${s.metricCount.toLocaleString("en-US")} metric${s.metricCount === 1 ? "" : "s"} = ` +
      `${s.totalRows.toLocaleString("en-US")} point${s.totalRows === 1 ? "" : "s"}`;
    return (
      <>
        <div style={{ ...reportCard, background: "#f7f7f7", border: "1px solid #e3e3e3", color: "#1a1a1a", fontWeight: 700 }}>
          {summaryLine}
        </div>
        {errors.length > 0 && (
          <div style={{ ...reportCard, background: "#fef2f2", border: "1px solid rgba(220,38,38,0.4)", color: "#991b1b" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              {errors.length} error{errors.length === 1 ? "" : "s"} — fix these before uploading:
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div style={{ ...reportCard, background: "#fff7ed", border: "1px solid rgba(255,80,0,0.35)", color: "#9a3412" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              {warnings.length} warning{warnings.length === 1 ? "" : "s"} (you can still proceed):
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
        <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
          {opts.showConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={errors.length > 0 || summary.totalRows === 0}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: errors.length > 0 || summary.totalRows === 0 ? "#f3f3f3" : ORANGE,
                color: errors.length > 0 || summary.totalRows === 0 ? "#aaa" : "#fff",
                fontSize: 12.5, fontWeight: 700,
                cursor: errors.length > 0 || summary.totalRows === 0 ? "not-allowed" : "pointer",
                fontFamily: "Arial, sans-serif",
              }}
            >
              Confirm upload (replaces all existing points)
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "1px solid #d0d0d0",
              background: "#fff", color: "#555", fontSize: 12.5, fontWeight: 600,
              cursor: "pointer", fontFamily: "Arial, sans-serif",
            }}
          >
            {opts.showConfirm ? "Cancel" : "Choose another file"}
          </button>
        </div>
      </>
    );
  };

  return (
    <div>
      <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
        Upload filled template (.xlsx)
      </span>

      {(upload.phase === "idle" || upload.phase === "parsing") && (
        <>
          <label
            style={{
              display: "inline-block", padding: "8px 16px", borderRadius: 8,
              border: `1px solid ${disabled ? "#e0e0e0" : ORANGE}`,
              background: disabled ? "#f3f3f3" : "#fff",
              color: disabled ? "#aaa" : ORANGE,
              fontSize: 12.5, fontWeight: 700,
              cursor: disabled ? "not-allowed" : "pointer",
              fontFamily: "Arial, sans-serif",
            }}
            title={disabled ? "Save the table shell first" : undefined}
          >
            {upload.phase === "parsing" ? "Reading workbook…" : "⬆ Upload filled template (.xlsx)"}
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={disabled || upload.phase === "parsing"}
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onSelectFile(f);
                e.target.value = ""; // allow re-selecting the same file
              }}
            />
          </label>
          <div style={{ marginTop: 6, fontSize: 11.5, color: "#888", lineHeight: 1.45 }}>
            Pick the filled template — it is parsed + validated in your browser, then
            uploaded in chunks (replace-total). Nothing is written until you confirm.
          </div>
        </>
      )}

      {upload.phase === "report" && (
        <>
          <div style={{ fontSize: 11.5, color: "#666" }}>
            <strong>{upload.fileName}</strong>
          </div>
          {renderReport(upload.result, { showConfirm: true })}
        </>
      )}

      {upload.phase === "uploading" && (
        <div style={{ ...reportCard, background: "#f7f7f7", border: "1px solid #e3e3e3", color: "#1a1a1a", fontWeight: 700 }}>
          Uploading {upload.sent.toLocaleString("en-US")} / {upload.total.toLocaleString("en-US")}…
        </div>
      )}

      {upload.phase === "done" && (
        <>
          <div style={{ ...reportCard, background: "#f0fdf4", border: "1px solid rgba(22,163,74,0.4)", color: "#166534", fontWeight: 700 }}>
            ✓ {upload.total.toLocaleString("en-US")} point{upload.total === 1 ? "" : "s"} uploaded
            {Object.keys(upload.byMetric).length > 0 && (
              <span style={{ fontWeight: 400 }}>
                {" "}(
                {Object.entries(upload.byMetric)
                  .map(([m, n]) => `${m}: ${n.toLocaleString("en-US")}`)
                  .join(", ")}
                )
              </span>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={onReset}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "1px solid #d0d0d0",
                background: "#fff", color: "#555", fontSize: 12.5, fontWeight: 600,
                cursor: "pointer", fontFamily: "Arial, sans-serif",
              }}
            >
              Upload another file
            </button>
          </div>
        </>
      )}

      {upload.phase === "error" && (
        <>
          <div style={{ ...reportCard, background: "#fef2f2", border: "1px solid rgba(220,38,38,0.4)", color: "#991b1b" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Upload failed</div>
            {upload.message}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            {upload.result && upload.result.errors.length === 0 && upload.result.rows.length > 0 && (
              <button
                type="button"
                onClick={onConfirm}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "none", background: ORANGE,
                  color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                  fontFamily: "Arial, sans-serif",
                }}
              >
                Retry upload (re-runs the whole replace)
              </button>
            )}
            <button
              type="button"
              onClick={onReset}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "1px solid #d0d0d0",
                background: "#fff", color: "#555", fontSize: 12.5, fontWeight: 600,
                cursor: "pointer", fontFamily: "Arial, sans-serif",
              }}
            >
              Start over
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Sensitivity-table builder (Sensitivities sub-tab) ─────────────────────────
//
// Two-pane: LEFT = list of all tables (incl. hidden companies) with a "New
// table" button; RIGHT = the builder form (basics + two axis editors + the cell
// matrix, plus a second Net-Debt matrix when value_mode === 'ev_ebitda'). All
// state lives in the hook; this is pure presentation.

const VALUE_MODE_OPTIONS: { id: SgValueMode; label: string }[] = [
  { id: "absolute",  label: "Absolute" },
  { id: "yield",     label: "Yield (÷ mkt cap)" },
  { id: "pe",        label: "P/E (mkt cap ÷)" },
  { id: "ev_ebitda", label: "EV/EBITDA" },
  { id: "upside",    label: "Upside" },
];

const AXIS_KIND_OPTIONS: { id: SensitivityAxis["kind"]; label: string }[] = [
  { id: "company", label: "Company" },
  { id: "driver",  label: "Driver" },
  { id: "year",    label: "Year" },
];

interface SensitivityBuilderProps {
  tables: SensitivityTableAdmin[];
  tablesLoading: boolean;
  tablesError: string | null;
  draft: SgTableDraft | null;
  saving: boolean;
  saveError: string | null;
  pendingChanges: boolean;
  validationError: string | null;
  deleteConfirm: number | null;
  rowLabels: string[];
  colLabels: string[];
  /** Per-mode hint + matrix labels (null when no draft is open). */
  baseInputMeta: BaseInputMeta | null;
  /** Live "Dashboard preview" value for (rowIdx, colIdx) of the draft. */
  previewCell: (rowIdx: number, colIdx: number) => string;
  /** True while the preview's live quotes are loading. */
  previewQuotesLoading: boolean;
  companyTickers: string[];
  drivers: StockGuideDriver[];
  inputStyle: React.CSSProperties;
  onSelect: (id: number) => void;
  onNew: () => void;
  onCancelEdit: () => void;
  onChangeField: (field: "title" | "metric_label" | "unit" | "display_order", value: string) => void;
  onChangeValueMode: (mode: SgValueMode) => void;
  onChangeSingleCompany: (ticker: string) => void;
  onChangeAxisKind: (axis: "row" | "col", kind: SensitivityAxis["kind"]) => void;
  onChangeAxisDriver: (axis: "row" | "col", driverId: string) => void;
  onToggleAxisCompany: (axis: "row" | "col", ticker: string) => void;
  onAddScenario: (axis: "row" | "col") => void;
  onChangeScenario: (axis: "row" | "col", i: number, value: string) => void;
  onRemoveScenario: (axis: "row" | "col", i: number) => void;
  onChangeCell: (r: number, c: number, value: string) => void;
  onChangeCellSecondary: (r: number, c: number, value: string) => void;
  // ── Scenario-grid builder ───────────────────────────────────────────────────
  gridDriverCatalog: DriverCatalogEntry[];
  /** The full drivers registry — any driver can drive an axis. */
  gridDrivers: StockGuideDriver[];
  /** The 4 base metrics an output row can use (dropdown). */
  gridBaseCatalog: SgGridBaseMetric[];
  onToggleGrid: (on: boolean) => void;
  onAddGridOutput: () => void;
  onRemoveGridOutput: (idx: number) => void;
  onChangeGridOutputBase: (idx: number, base: string) => void;
  onChangeGridOutputYear: (idx: number, year: string) => void;
  onAddGridAxis: () => void;
  onRemoveGridAxis: (axisIdx: number) => void;
  onChangeGridAxisField: (
    axisIdx: number,
    field: "driverId" | "label" | "unit" | "tmin" | "tmax" | "tstep",
    value: string,
  ) => void;
  onToggleGridCompany: (ticker: string) => void;
  /** Generate + download the scenario-grid template Excel. */
  onDownloadGridTemplate: () => void;
  /** Warning copy when the template would be very large, else null. */
  gridTemplateWarning: string | null;
  /** Read-only count of uploaded grid points for the saved draft (null = N/A). */
  gridPointCount: number | null;
  gridPointCountLoading: boolean;
  /** In-admin filled-template upload widget state. */
  upload: SgUploadState;
  /** Parse + validate a chosen .xlsx (no network). */
  onSelectUploadFile: (file: File) => void;
  /** Confirm the validated upload (chunked replace-total). */
  onConfirmUpload: () => void;
  /** Dismiss the upload widget. */
  onResetUpload: () => void;
  onSave: () => void;
  onDelete: (id: number) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

function SensitivityBuilder(props: SensitivityBuilderProps): React.ReactElement {
  const {
    tables, tablesLoading, tablesError, draft, saving, saveError, pendingChanges,
    validationError, deleteConfirm, rowLabels, colLabels, baseInputMeta,
    previewCell, previewQuotesLoading, companyTickers, drivers,
    inputStyle, onSelect, onNew, onCancelEdit, onChangeField, onChangeValueMode,
    onChangeSingleCompany, onChangeAxisKind, onChangeAxisDriver, onToggleAxisCompany,
    onAddScenario, onChangeScenario, onRemoveScenario, onChangeCell,
    onChangeCellSecondary,
    gridDrivers, gridBaseCatalog, onToggleGrid,
    onAddGridOutput, onRemoveGridOutput, onChangeGridOutputBase, onChangeGridOutputYear,
    onAddGridAxis,
    onRemoveGridAxis, onChangeGridAxisField, onToggleGridCompany,
    onDownloadGridTemplate, gridTemplateWarning,
    gridPointCount, gridPointCountLoading,
    upload, onSelectUploadFile, onConfirmUpload, onResetUpload,
    onSave, onDelete, onConfirmDelete, onCancelDelete,
  } = props;

  const labelSpan: React.CSSProperties = {
    display: "block", fontSize: 11, fontWeight: 700, color: "#888",
    marginBottom: 4, letterSpacing: "0.02em",
  };
  const neitherAxisCompany =
    draft != null && draft.rowAxis.kind !== "company" && draft.colAxis.kind !== "company";

  // ── Axis editor (kind picker + per-kind body) ───────────────────────────────
  const renderAxisEditor = (which: "row" | "col"): React.ReactElement => {
    const axis = which === "row" ? draft!.rowAxis : draft!.colAxis;
    const title = which === "row" ? "Row axis" : "Column axis";
    return (
      <div style={{ border: "1px solid #ececec", borderRadius: 10, padding: 16 }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a", margin: "0 0 12px" }}>
          {title}
        </h4>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={labelSpan}>Kind</span>
          <select
            value={axis.kind}
            onChange={(e) => onChangeAxisKind(which, e.target.value as SensitivityAxis["kind"])}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            {AXIS_KIND_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>

        {axis.kind === "company" && (
          <div>
            <span style={labelSpan}>Tickers on this axis</span>
            {companyTickers.length === 0 ? (
              <div style={{ fontSize: 12, color: "#bbb" }}>No companies available.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {companyTickers.map((t) => {
                  const on = axis.companies.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => onToggleAxisCompany(which, t)}
                      aria-pressed={on}
                      style={{
                        padding: "4px 10px", borderRadius: 14, cursor: "pointer",
                        border: on ? `1px solid ${ORANGE}` : "1px solid #e0e0e0",
                        background: on ? "rgba(255,80,0,0.10)" : "#fff",
                        color: on ? ORANGE : "#666", fontSize: 12, fontWeight: 700,
                        fontFamily: "Arial, sans-serif",
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {axis.kind === "driver" && (
          <div>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={labelSpan}>Driver</span>
              <select
                value={axis.driverId}
                onChange={(e) => onChangeAxisDriver(which, e.target.value)}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                <option value="">— select a driver —</option>
                {drivers.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.name}{d.unit ? ` (${d.unit})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <span style={labelSpan}>Scenarios</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {axis.scenarios.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="number"
                    step="any"
                    value={s}
                    onChange={(e) => onChangeScenario(which, i, e.target.value)}
                    placeholder={`Scenario ${i + 1}`}
                    style={{ ...inputStyle, textAlign: "right", maxWidth: 160 }}
                  />
                  <button
                    onClick={() => onRemoveScenario(which, i)}
                    aria-label={`Remove scenario ${i + 1}`}
                    title="Remove scenario"
                    style={{
                      width: 28, height: 28, borderRadius: 6, border: "1px solid #e0e0e0",
                      background: "#fff", color: "#e53e3e", cursor: "pointer",
                      fontSize: 15, lineHeight: 1, padding: 0, fontFamily: "Arial, sans-serif",
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => onAddScenario(which)}
                style={{
                  alignSelf: "flex-start", padding: "5px 12px", borderRadius: 7,
                  border: `1px solid ${ORANGE}`, background: "rgba(255,80,0,0.08)",
                  color: ORANGE, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  fontFamily: "Arial, sans-serif",
                }}
              >
                + Scenario
              </button>
            </div>
          </div>
        )}

        {axis.kind === "year" && (
          <div style={{ fontSize: 12, color: "#888", lineHeight: 1.5 }}>
            Fixed to both forward years (Y1 &amp; Y2), using the global config labels.
          </div>
        )}
      </div>
    );
  };

  // ── Cell matrix (primary or secondary) ──────────────────────────────────────
  const renderMatrix = (
    matrix: string[][],
    onChange: (r: number, c: number, value: string) => void,
    label: string,
  ): React.ReactElement => (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8 }}>{label}</div>
      {rowLabels.length === 0 || colLabels.length === 0 ? (
        <div style={{
          padding: "20px 16px", textAlign: "center", color: "#bbb", fontSize: 12,
          border: "1px dashed #e0e0e0", borderRadius: 8,
        }}>
          Define at least one item on each axis to build the matrix.
        </div>
      ) : (
        <div style={{ overflowX: "auto", paddingBottom: 4 }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 6 }}>
            <thead>
              <tr>
                <th style={{ width: 130 }} />
                {colLabels.map((lbl, c) => (
                  <th key={c} style={{ minWidth: 100, fontSize: 11, fontWeight: 700, color: "#555", padding: "0 4px" }}>
                    {lbl || `Col ${c + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowLabels.map((rLbl, r) => (
                <tr key={r}>
                  <th style={{ width: 130, textAlign: "right", fontSize: 11, fontWeight: 700, color: "#555", paddingRight: 6 }}>
                    {rLbl || `Row ${r + 1}`}
                  </th>
                  {colLabels.map((_, c) => (
                    <td key={c}>
                      <input
                        type="number"
                        step="any"
                        value={matrix[r]?.[c] ?? ""}
                        onChange={(e) => onChange(r, c, e.target.value)}
                        style={{ ...inputStyle, textAlign: "right", fontSize: 12, minWidth: 90 }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ── Live "Dashboard preview" — read-only mirror of the typed matrix ──────────
  // Shows the EXACT value /stock-guide will render for each cell, using the same
  // shared compute + format helpers. Hidden for 'absolute' (no transform).
  const renderPreviewGrid = (): React.ReactElement | null => {
    if (!draft || draft.value_mode === "absolute") return null;
    if (rowLabels.length === 0 || colLabels.length === 0) return null;
    return (
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed #e0e0e0" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#555" }}>
            Dashboard preview (live prices)
          </div>
          <span style={{ fontSize: 11, color: "#aaa" }}>
            {previewQuotesLoading
              ? "loading live prices…"
              : "needs live price + shares outstanding"}
          </span>
        </div>
        <div style={{ overflowX: "auto", paddingBottom: 4 }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 6 }}>
            <thead>
              <tr>
                <th style={{ width: 130 }} />
                {colLabels.map((lbl, c) => (
                  <th key={c} style={{ minWidth: 100, fontSize: 11, fontWeight: 700, color: "#999", padding: "0 4px" }}>
                    {lbl || `Col ${c + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowLabels.map((rLbl, r) => (
                <tr key={r}>
                  <th style={{ width: 130, textAlign: "right", fontSize: 11, fontWeight: 700, color: "#999", paddingRight: 6 }}>
                    {rLbl || `Row ${r + 1}`}
                  </th>
                  {colLabels.map((_, c) => (
                    <td key={c}>
                      <div
                        style={{
                          minWidth: 90, padding: "6px 8px", textAlign: "right",
                          fontSize: 12, fontWeight: 700, color: "#1a1a1a",
                          background: "#fafafa", border: "1px solid #ececec", borderRadius: 6,
                          fontFamily: "Arial, sans-serif",
                        }}
                      >
                        {previewQuotesLoading ? "—" : previewCell(r, c)}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ── Scenario-grid (interpolated) shell editor ───────────────────────────────
  // The admin defines only the CASE: x driver + axis labels + output + the
  // membership companies. The per-company points are NOT typed here — they arrive
  // via the Brent-grid Excel upload (Local Data). A read-only point count gives
  // confidence the upload landed. Serialized into definition.grid by the hook.
  const renderGridEditor = (): React.ReactElement | null => {
    if (!draft) return null;
    const g = draft.gridDef;
    const selected = draft.gridCompanies;
    return (
      <div style={{ paddingTop: 8, borderTop: "1px solid #ececec" }}>
        {/* Hint banner */}
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          margin: "4px 0 16px", padding: "10px 14px", borderRadius: 8,
          background: "rgba(255,80,0,0.06)", border: `1px solid rgba(255,80,0,0.28)`,
          borderLeft: `4px solid ${ORANGE}`,
        }}>
          <span style={{ fontSize: 14, lineHeight: "18px" }} aria-hidden>💡</span>
          <span style={{ fontSize: 12, lineHeight: 1.5, color: "#7a3300", fontWeight: 600 }}>
            Grid points are uploaded via the Brent-grid Excel (Local Data), not typed
            here. The dashboard interpolates the per-company mesh live as the analyst
            drags up to three sliders (one per axis). Changing the axes requires
            re-uploading the grid Excel.
          </span>
        </div>

        {/* Axes (ordered, 1..3) */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={labelSpan}>Axes (drag one slider per axis on the dashboard)</span>
            {g.axes.length < 3 && (
              <button
                type="button"
                onClick={onAddGridAxis}
                style={{
                  padding: "4px 10px", borderRadius: 7, border: `1px solid ${ORANGE}`,
                  background: "rgba(255,80,0,0.08)", color: ORANGE, fontSize: 12,
                  fontWeight: 700, cursor: "pointer", fontFamily: "Arial, sans-serif",
                }}
              >
                + Add axis
              </button>
            )}
          </div>
          {g.axes.map((axis, i) => {
            // Drivers already bound by SIBLING axes are excluded from this select.
            const usedBySiblings = new Set(
              g.axes.filter((_, j) => j !== i).map((a) => a.driverId),
            );
            const driverOptions = gridDrivers.filter(
              (d) => String(d.id) === axis.driverId || !usedBySiblings.has(String(d.id)),
            );
            return (
              <div
                key={i}
                style={{
                  border: "1px solid #ececec", borderRadius: 8, padding: 12,
                  marginBottom: 10, background: "#fcfcfc",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{
                    display: "inline-block", padding: "2px 9px", borderRadius: 12,
                    background: "rgba(255,80,0,0.10)", color: ORANGE, fontSize: 11,
                    fontWeight: 700, letterSpacing: "0.03em",
                  }}>
                    Axis {i + 1}
                  </span>
                  {g.axes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveGridAxis(i)}
                      style={{
                        padding: "3px 9px", borderRadius: 7, border: "1px solid #e0e0e0",
                        background: "#fff", color: "#b91c1c", fontSize: 11.5,
                        fontWeight: 700, cursor: "pointer", fontFamily: "Arial, sans-serif",
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <label style={{ display: "block" }}>
                    <span style={labelSpan}>Driver</span>
                    <select
                      value={axis.driverId}
                      onChange={(e) => onChangeGridAxisField(i, "driverId", e.target.value)}
                      style={{ ...inputStyle, cursor: "pointer" }}
                    >
                      <option value="">— select a driver —</option>
                      {driverOptions.map((d) => (
                        <option key={d.id} value={String(d.id)}>
                          {d.name}{d.unit ? ` (${d.unit})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={labelSpan}>Axis label</span>
                    <input
                      type="text"
                      value={axis.label}
                      onChange={(e) => onChangeGridAxisField(i, "label", e.target.value)}
                      placeholder="e.g. Brent (avg 2026)"
                      style={{ ...inputStyle }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={labelSpan}>Axis unit</span>
                    <input
                      type="text"
                      value={axis.unit}
                      onChange={(e) => onChangeGridAxisField(i, "unit", e.target.value)}
                      placeholder="e.g. USD/bbl"
                      style={{ ...inputStyle }}
                    />
                  </label>
                </div>
                {/* Template range (drives the downloadable Excel grid). */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
                  <label style={{ display: "block" }}>
                    <span style={labelSpan}>Template min</span>
                    <input
                      type="number"
                      value={axis.tmin}
                      onChange={(e) => onChangeGridAxisField(i, "tmin", e.target.value)}
                      placeholder="40"
                      style={{ ...inputStyle }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={labelSpan}>Template max</span>
                    <input
                      type="number"
                      value={axis.tmax}
                      onChange={(e) => onChangeGridAxisField(i, "tmax", e.target.value)}
                      placeholder="150"
                      style={{ ...inputStyle }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={labelSpan}>Template step</span>
                    <input
                      type="number"
                      value={axis.tstep}
                      onChange={(e) => onChangeGridAxisField(i, "tstep", e.target.value)}
                      placeholder="10"
                      style={{ ...inputStyle }}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {/* Outputs (one column + one mesh metric sheet each). Each row = a base
            metric + an optional 4-digit year → effective key `base_year` / `base`. */}
        <div style={{ marginBottom: 16 }}>
          <span style={labelSpan}>Outputs (each becomes a column + a metric sheet in the template)</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {g.outputs.map((o, idx) => {
              const key = sgGridOutputKey(o);
              return (
                <div
                  key={idx}
                  style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                >
                  <select
                    value={o.base}
                    onChange={(e) => onChangeGridOutputBase(idx, e.target.value)}
                    style={{ ...inputStyle, width: 160 }}
                  >
                    {gridBaseCatalog.map((m) => (
                      <option key={m.base} value={m.base}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={o.year}
                    onChange={(e) => onChangeGridOutputYear(idx, e.target.value)}
                    placeholder="e.g. 2026"
                    maxLength={4}
                    style={{ ...inputStyle, width: 90 }}
                  />
                  <span style={{ fontSize: 12, color: "#888", fontFamily: "Arial, sans-serif" }}>
                    → <strong style={{ color: "#555" }}>{o.label}</strong>
                    <span style={{ color: "#bbb" }}> (sheet: {key})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveGridOutput(idx)}
                    disabled={g.outputs.length <= 1}
                    title="Remove output"
                    style={{
                      marginLeft: "auto", padding: "2px 9px", borderRadius: 6,
                      border: "1px solid #e0e0e0", background: "#fff",
                      color: g.outputs.length <= 1 ? "#ccc" : "#c00",
                      cursor: g.outputs.length <= 1 ? "not-allowed" : "pointer",
                      fontSize: 12, fontWeight: 700, fontFamily: "Arial, sans-serif",
                    }}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onAddGridOutput}
            disabled={g.outputs.length >= 12}
            style={{
              marginTop: 8, padding: "4px 12px", borderRadius: 14,
              border: `1px solid ${ORANGE}`,
              background: g.outputs.length >= 12 ? "#f5f5f5" : "rgba(255,80,0,0.10)",
              color: g.outputs.length >= 12 ? "#bbb" : ORANGE,
              cursor: g.outputs.length >= 12 ? "not-allowed" : "pointer",
              fontSize: 12, fontWeight: 700, fontFamily: "Arial, sans-serif",
            }}
          >
            + Add output
          </button>
        </div>

        {/* Companies */}
        <div style={{ marginBottom: 16 }}>
          <span style={labelSpan}>Companies (points uploaded per company)</span>
          {companyTickers.length === 0 ? (
            <div style={{ fontSize: 12, color: "#bbb" }}>No companies available.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {companyTickers.map((t) => {
                const on = selected.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onToggleGridCompany(t)}
                    aria-pressed={on}
                    style={{
                      padding: "4px 10px", borderRadius: 14, cursor: "pointer",
                      border: on ? `1px solid ${ORANGE}` : "1px solid #e0e0e0",
                      background: on ? "rgba(255,80,0,0.10)" : "#fff",
                      color: on ? ORANGE : "#666", fontSize: 12, fontWeight: 700,
                      fontFamily: "Arial, sans-serif",
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Read-only uploaded-point count */}
        <div style={{
          padding: "10px 14px", borderRadius: 8, background: "#fafafa",
          border: "1px solid #ececec", fontSize: 12, color: "#555",
        }}>
          {draft.id == null ? (
            <span style={{ color: "#999" }}>
              Save the table first, then upload the Brent-grid Excel to populate points.
            </span>
          ) : gridPointCountLoading ? (
            <span style={{ color: "#999" }}>Counting uploaded points…</span>
          ) : gridPointCount == null ? (
            <span style={{ color: "#999" }}>Point count unavailable.</span>
          ) : gridPointCount === 0 ? (
            <span>
              <strong style={{ color: ORANGE }}>0 points</strong> uploaded yet — upload
              the Brent-grid Excel (Local Data) to populate the mesh.
            </span>
          ) : (
            <span>
              <strong style={{ color: "#1a1a1a" }}>{gridPointCount.toLocaleString("en-US")}</strong>{" "}
              scenario-grid point{gridPointCount === 1 ? "" : "s"} uploaded for this table.
            </span>
          )}
        </div>

        {/* Download template (.xlsx) — generated in the browser via ExcelJS. */}
        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            onClick={onDownloadGridTemplate}
            disabled={draft.id == null}
            title={draft.id == null ? "Save the table shell first" : undefined}
            style={{
              padding: "8px 16px", borderRadius: 8,
              border: `1px solid ${draft.id == null ? "#e0e0e0" : ORANGE}`,
              background: draft.id == null ? "#f3f3f3" : ORANGE,
              color: draft.id == null ? "#aaa" : "#fff",
              fontSize: 12.5, fontWeight: 700,
              cursor: draft.id == null ? "not-allowed" : "pointer",
              fontFamily: "Arial, sans-serif",
            }}
          >
            ⬇ Download template (.xlsx)
          </button>
          <div style={{ marginTop: 6, fontSize: 11.5, color: "#888", lineHeight: 1.45 }}>
            One sheet per output (sheet name = metric key). Each sheet&rsquo;s first
            columns are the axis coordinates (in axis order), followed by one empty
            column per company — fill them with the model output, then upload via
            Local Data.
          </div>
          {gridTemplateWarning && (
            <div style={{
              marginTop: 8, padding: "8px 12px", borderRadius: 8,
              background: "#fff7ed", border: "1px solid rgba(255,80,0,0.35)",
              color: "#9a3412", fontSize: 11.5, fontWeight: 600,
            }}>
              {gridTemplateWarning}
            </div>
          )}
        </div>

        {/* Upload filled template (.xlsx) — browser parse + validate + chunked replace. */}
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #ececec" }}>
          <GridUploadPanel
            disabled={draft.id == null}
            upload={upload}
            onSelectFile={onSelectUploadFile}
            onConfirm={onConfirmUpload}
            onReset={onResetUpload}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", minHeight: 560, alignItems: "stretch" }}>

        {/* ── Left pane: table list ─────────────────────────────────────────── */}
        <div style={{ width: 300, flexShrink: 0, borderRight: "1px solid #ececec", display: "flex", flexDirection: "column", background: "#fafafa" }}>
          <div style={{ padding: "18px 16px 12px", borderBottom: "1px solid #ececec", background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1a1a1a", margin: 0 }}>
              Sensitivity tables
            </h2>
            <button
              onClick={onNew}
              style={{
                padding: "6px 12px", borderRadius: 7, border: "none", background: ORANGE,
                color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Arial, sans-serif",
              }}
            >
              + New table
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 600 }}>
            {tablesLoading ? (
              <div style={{ padding: "24px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
                Loading tables…
              </div>
            ) : tables.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", color: "#bbb", fontSize: 12 }}>
                No sensitivity tables yet. Click &ldquo;+ New table&rdquo; to create one.
              </div>
            ) : (
              tables.map((t) => {
                const isSelected = draft?.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => onSelect(t.id)}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      borderLeft: isSelected ? `3px solid ${ORANGE}` : "3px solid transparent",
                      background: isSelected ? "#fff" : "transparent",
                      borderBottom: "1px solid #f0f0f0", border: "none",
                      borderBottomColor: "#f0f0f0", padding: "10px 14px",
                      cursor: "pointer", fontFamily: "Arial, sans-serif",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a", marginBottom: 4 }}>
                      {t.title || "(untitled)"}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
                        background: "rgba(255,80,0,0.12)", color: ORANGE, textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}>
                        {t.definition?.grid != null
                          ? "Scenario grid"
                          : VALUE_MODE_OPTIONS.find((m) => m.id === t.value_mode)?.label ?? t.value_mode}
                      </span>
                      <span style={{ fontSize: 11, color: "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.companies.join(", ") || "—"}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right pane: builder form ──────────────────────────────────────── */}
        <div style={{ flex: 1, padding: "20px 24px", minWidth: 0, overflowY: "auto", maxHeight: 720 }}>
          {tablesError && (
            <div style={{
              marginBottom: 14, padding: "10px 12px", borderRadius: 8,
              background: "#fff5f5", border: "1px solid rgba(229,62,62,0.3)",
              color: "#c0392b", fontSize: 12, lineHeight: 1.4,
            }}>
              {tablesError}
            </div>
          )}

          {!draft ? (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              color: "#bbb", fontSize: 13, textAlign: "center", padding: 32, minHeight: 400,
            }}>
              Select a table on the left to edit, or click &ldquo;+ New table&rdquo; to create one.
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#1a1a1a", margin: 0 }}>
                  {draft.id == null ? "New table" : `Edit: ${draft.title || "(untitled)"}`}
                </h3>
                <button
                  onClick={onCancelEdit}
                  style={{
                    background: "none", border: "none", color: "#888", fontSize: 12,
                    fontWeight: 600, cursor: "pointer", fontFamily: "Arial, sans-serif",
                    textDecoration: "underline", padding: "4px 6px",
                  }}
                >
                  Close
                </button>
              </div>

              {/* Mode toggle: Static matrix vs Scenario grid (interpolated) */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {[
                  { on: false, label: "Static matrix" },
                  { on: true, label: "Scenario grid (interpolated)" },
                ].map((m) => {
                  const active = draft.grid === m.on;
                  return (
                    <button
                      key={m.label}
                      type="button"
                      onClick={() => onToggleGrid(m.on)}
                      style={{
                        padding: "7px 16px", borderRadius: 8, cursor: "pointer",
                        border: active ? `1px solid ${ORANGE}` : "1px solid #e0e0e0",
                        background: active ? "rgba(255,80,0,0.10)" : "#fff",
                        color: active ? ORANGE : "#666", fontSize: 12.5, fontWeight: 700,
                        fontFamily: "Arial, sans-serif",
                      }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              {/* Basics */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginBottom: 18 }}>
                <label style={{ display: "block", gridColumn: "1 / -1" }}>
                  <span style={labelSpan}>Title</span>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => onChangeField("title", e.target.value)}
                    placeholder={draft.grid ? "e.g. Target price vs Brent" : "e.g. FCFE yield by Brent scenario"}
                    style={{ ...inputStyle }}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <span style={labelSpan}>Value mode</span>
                  <select
                    value={draft.value_mode}
                    onChange={(e) => onChangeValueMode(e.target.value as SgValueMode)}
                    style={{ ...inputStyle, cursor: "pointer" }}
                  >
                    {/* Grid tables interpolate the target price → only Upside (vs
                        live price) or Absolute (raw target price) make sense. */}
                    {(draft.grid
                      ? VALUE_MODE_OPTIONS.filter((o) => o.id === "upside" || o.id === "absolute")
                      : VALUE_MODE_OPTIONS
                    ).map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "block" }}>
                  <span style={labelSpan}>Display order</span>
                  <input
                    type="number"
                    step={1}
                    value={draft.display_order}
                    onChange={(e) => onChangeField("display_order", e.target.value)}
                    placeholder="0"
                    style={{ ...inputStyle, textAlign: "right" }}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <span style={labelSpan}>Metric label</span>
                  <input
                    type="text"
                    value={draft.metric_label}
                    onChange={(e) => onChangeField("metric_label", e.target.value)}
                    placeholder="e.g. FCFE"
                    style={{ ...inputStyle }}
                  />
                </label>
                <label style={{ display: "block" }}>
                  <span style={labelSpan}>Unit</span>
                  <input
                    type="text"
                    value={draft.unit}
                    onChange={(e) => onChangeField("unit", e.target.value)}
                    placeholder="e.g. BRL mn"
                    style={{ ...inputStyle }}
                  />
                </label>
              </div>

              {draft.grid ? (
                /* ── Scenario-grid (interpolated) editor ───────────────────── */
                renderGridEditor()
              ) : (
                <>
                  {/* Axis editors */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, marginBottom: 18 }}>
                    {renderAxisEditor("row")}
                    {renderAxisEditor("col")}
                  </div>

                  {/* Single-company select (only when NEITHER axis is company) */}
                  {neitherAxisCompany && (
                    <label style={{ display: "block", marginBottom: 18, maxWidth: 280 }}>
                      <span style={labelSpan}>Company (table membership)</span>
                      <select
                        value={draft.singleCompany}
                        onChange={(e) => onChangeSingleCompany(e.target.value)}
                        style={{ ...inputStyle, cursor: "pointer" }}
                      >
                        <option value="">— select a company —</option>
                        {companyTickers.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  {/* Cell matrix / matrices */}
                  <div style={{ paddingTop: 8, borderTop: "1px solid #ececec" }}>
                    {/* Hint banner — makes the derived value_mode transform obvious
                        at input time (you type the BASE value → dashboard shows …). */}
                    {baseInputMeta && (
                      <div style={{
                        display: "flex", alignItems: "flex-start", gap: 10,
                        margin: "4px 0 14px", padding: "10px 14px", borderRadius: 8,
                        background: "rgba(255,80,0,0.06)",
                        border: `1px solid rgba(255,80,0,0.28)`,
                        borderLeft: `4px solid ${ORANGE}`,
                      }}>
                        <span style={{ fontSize: 14, lineHeight: "18px" }} aria-hidden>💡</span>
                        <span style={{ fontSize: 12, lineHeight: 1.5, color: "#7a3300", fontWeight: 600 }}>
                          {baseInputMeta.hint}
                        </span>
                      </div>
                    )}
                    {renderMatrix(
                      draft.cells,
                      onChangeCell,
                      baseInputMeta?.primaryLabel ?? (draft.metric_label || "Values"),
                    )}
                    {draft.value_mode === "ev_ebitda" &&
                      renderMatrix(
                        draft.cellsSecondary,
                        onChangeCellSecondary,
                        baseInputMeta?.secondaryLabel ?? "Net Debt (BRL mn)",
                      )}
                    {renderPreviewGrid()}
                  </div>
                </>
              )}

              {/* Validation / save error */}
              {(validationError || saveError) && (
                <div style={{
                  marginTop: 14, padding: "10px 12px", borderRadius: 8,
                  background: "#fff5f5", border: "1px solid rgba(229,62,62,0.3)",
                  color: "#c0392b", fontSize: 12, lineHeight: 1.4,
                }}>
                  {saveError || validationError}
                </div>
              )}

              {/* Footer actions */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18, paddingTop: 14, borderTop: "1px solid #ececec" }}>
                <button
                  onClick={onSave}
                  disabled={saving || !pendingChanges || validationError != null}
                  title={
                    validationError != null ? validationError
                      : !pendingChanges ? "No changes to save"
                      : undefined
                  }
                  style={{
                    padding: "8px 22px", borderRadius: 8, border: "none",
                    background: (saving || !pendingChanges || validationError != null) ? "#e0e0e0" : ORANGE,
                    color: (saving || !pendingChanges || validationError != null) ? "#aaa" : "#fff",
                    fontSize: 13, fontWeight: 700,
                    cursor: (saving || !pendingChanges || validationError != null) ? "not-allowed" : "pointer",
                    fontFamily: "Arial, sans-serif", transition: "background 0.15s",
                  }}
                >
                  {saving ? "Saving…" : "Save table"}
                </button>
                {draft.id != null && (
                  <button
                    onClick={() => onDelete(draft.id as number)}
                    disabled={saving}
                    style={{
                      background: "none", border: "none", color: "#e53e3e", fontSize: 12,
                      fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
                      fontFamily: "Arial, sans-serif", padding: "4px 6px",
                      opacity: saving ? 0.5 : 1, textDecoration: "underline",
                    }}
                  >
                    Delete table
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Table delete-confirm modal */}
      {deleteConfirm != null && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1050, fontFamily: "Arial, sans-serif",
          }}
          onClick={onCancelDelete}
        >
          <div
            style={{
              background: "#fff", borderRadius: 10, padding: 24, maxWidth: 420,
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a", margin: "0 0 8px" }}>
              Delete table
            </h3>
            <p style={{ fontSize: 13, color: "#555", margin: "0 0 18px", lineHeight: 1.5 }}>
              Delete{" "}
              <strong>
                «{tables.find((t) => t.id === deleteConfirm)?.title ?? deleteConfirm}»
              </strong>
              ? This cannot be undone.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={onCancelDelete}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "1px solid #e0e0e0",
                  background: "#fff", color: "#555", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", fontFamily: "Arial, sans-serif",
                }}
              >
                Cancel
              </button>
              <button
                onClick={onConfirmDelete}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "none",
                  background: "#e53e3e", color: "#fff", fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: "Arial, sans-serif",
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
