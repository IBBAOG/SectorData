"use client";

// Mobile view — /admin-panel (≤768px).
//
// Same analyses as desktop, mobile-first UX. Sections become a horizontally
// scrollable pill row (6 tabs don't fit in a single-line container). Each
// section renders one MobileDataCard per row:
//   • Members     — avatar, name+email, role pill on the right (tap to switch)
//   • Permissions — module name+description, then three toggle rows:
//                   Public / Clients / Home (all three axes in one card)
//   • Alert Emails — email+date, status pill, inline action buttons in a
//                    BottomSheet (deactivate / remove)
//   • Data Input  — desktop-only message (EditableTableEditor is too
//                   complex for mobile in this wave)
//
// All state, RPC calls, and handlers live in `useAdminPanelData`. This file is
// pure presentation.
//
// Binding sync rule (CLAUDE.md § Dual-view policy):
//   Any meaningful change here (new section, new field, new copy) must land
//   in desktop/View.tsx in the SAME commit, OR the commit message must
//   declare `[mobile-only]` with an explicit reason.

import { useMemo, useState } from "react";

import {
  MobileTopBar,
  BottomSheet,
  MobileDataCard,
  SearchIcon,
  ChevronDownIcon,
  CheckIcon,
} from "@/components/dashboard/mobile";
import { getInitials } from "../../../../lib/avatarUtils";

import {
  useAdminPanelData,
  MODULE_LABELS,
  SECTIONS,
  type SectionId,
} from "../useAdminPanelData";

const ORANGE = "#FF5000";

// ── Helpers ───────────────────────────────────────────────────────────────────

function filterBySearch<T>(items: T[], query: string, keys: (item: T) => string[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => keys(item).some((s) => s.toLowerCase().includes(q)));
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement | null {
  const {
    allowed,
    roleLoading,
    myProfile,

    activeSection,
    setActiveSection,

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

  // Local mobile-only UI state (not part of the brain — pure presentation)
  const [search, setSearch] = useState("");
  const [rolePickerUserId, setRolePickerUserId] = useState<string | null>(null);
  // Field-stakes editor sheet visibility — mobile-only. Decoupled from the
  // shared `selectedCampo` (which the brain hook owns) so closing the sheet
  // doesn't lose the user's selection; re-opening is one tap on the card.
  const [fieldStakesSheetOpen, setFieldStakesSheetOpen] = useState(false);

  const rolePickerUser = useMemo(
    () => users.find((u) => u.id === rolePickerUserId) ?? null,
    [users, rolePickerUserId],
  );

  // Reset search whenever the section changes — searches are scoped per tab
  function changeSection(id: SectionId) {
    setSearch("");
    setActiveSection(id);
  }

  if (roleLoading || !allowed) return null;

  // ── Section-specific filtered collections ──────────────────────────────────
  const filteredUsers = filterBySearch(users, search, (u) => [
    u.full_name ?? "",
    u.email,
    u.role,
  ]);
  const filteredModules = filterBySearch(MODULE_LABELS, search, (m) => [
    m.label,
    m.slug,
    m.description,
  ]);
  const filteredRecipients = filterBySearch(recipients, search, (r) => [r.email]);
  const filteredKeywords = filterBySearch(defaultKeywords, search, (k) => [k.keyword]);

  // Section-specific search placeholder
  const searchPlaceholder: Record<SectionId, string> = {
    "members": "Search by name, email, or role",
    "permissions": "Search modules",
    "alert-recipients": "Search recipients",
    "alerts-product": "Search subscribers or sources",
    "default-news": "Search keywords",
    "data-input": "",
    "field-stakes": "", // section has its own dedicated search/filter UI
  };

  return (
    <div
      style={{
        background: "var(--mobile-bg)",
        minHeight: "100dvh",
        fontFamily: "Arial, Helvetica, sans-serif",
        color: "var(--mobile-text)",
        fontSize: 14,
        lineHeight: 1.4,
        WebkitFontSmoothing: "antialiased",
        paddingBottom: "calc(var(--mobile-safe-bottom) + 24px)",
      }}
    >
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <MobileTopBar
        leftSlot={
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--mobile-accent)",
              }}
            >
              Admin
            </span>
            <span
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: "var(--mobile-text)",
                letterSpacing: "-0.01em",
              }}
            >
              Admin Panel
            </span>
          </div>
        }
        showThemeToggle={false}
        showAvatar
        avatarInitials={getInitials(myProfile, null)}
        avatarLabel={myProfile?.full_name ?? "Admin"}
      />

      {/* ── Section pills (horizontal scroll) ────────────────────────────── */}
      <div
        style={{
          position: "sticky",
          top: "var(--mobile-topbar-h)",
          zIndex: 25,
          padding: "10px 0",
          background: "var(--mobile-glass-bg)",
          WebkitBackdropFilter: "var(--mobile-glass-blur)",
          backdropFilter: "var(--mobile-glass-blur)",
          borderBottom: "1px solid var(--mobile-glass-border)",
        }}
      >
        <div
          role="tablist"
          aria-label="Admin sections"
          style={{
            display: "flex",
            gap: 8,
            padding: "0 16px",
            overflowX: "auto",
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {SECTIONS.map((section) => {
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => changeSection(section.id)}
                style={{
                  flex: "0 0 auto",
                  minHeight: 36,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: isActive
                    ? `1px solid ${ORANGE}`
                    : "1px solid var(--mobile-border)",
                  background: isActive ? ORANGE : "var(--mobile-surface)",
                  color: isActive ? "#fff" : "var(--mobile-text-muted)",
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "background 0.15s, color 0.15s, border-color 0.15s",
                  boxShadow: isActive ? "0 2px 8px rgba(255,80,0,0.25)" : "none",
                }}
              >
                {section.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Section header & search ──────────────────────────────────────── */}
      <section style={{ padding: "16px 16px 8px" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--mobile-text-faint)",
          }}
        >
          {SECTIONS.find((s) => s.id === activeSection)?.description}
        </div>
        <h1
          style={{
            margin: "4px 0 0",
            fontSize: 22,
            fontWeight: 700,
            color: "var(--mobile-text)",
            letterSpacing: "-0.01em",
            lineHeight: 1.15,
          }}
        >
          {SECTIONS.find((s) => s.id === activeSection)?.label}
        </h1>
      </section>

      {/* Search input (only for sections with searchable rows) */}
      {activeSection !== "data-input" && activeSection !== "field-stakes" && (
        <div style={{ padding: "4px 16px 12px" }}>
          <div style={{ position: "relative", height: 40 }}>
            <span
              style={{
                position: "absolute",
                top: "50%",
                left: 12,
                transform: "translateY(-50%)",
                color: "var(--mobile-text-faint)",
                pointerEvents: "none",
              }}
            >
              <SearchIcon size={18} />
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder[activeSection]}
              aria-label={searchPlaceholder[activeSection]}
              style={{
                width: "100%",
                height: 40,
                borderRadius: 10,
                border: "1px solid var(--mobile-border)",
                background: "var(--mobile-surface)",
                color: "var(--mobile-text)",
                fontFamily: "inherit",
                fontSize: 14,
                padding: "0 12px 0 38px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MEMBERS                                                             */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeSection === "members" && (
        <section>
          {usersLoading ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              Loading members…
            </div>
          ) : filteredUsers.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              {search ? "No users match your search." : "No users found."}
            </div>
          ) : (
            <>
              <div style={{ padding: "0 16px 8px", fontSize: 12, color: "var(--mobile-text-muted)" }}>
                {filteredUsers.length} of {users.length} user{users.length !== 1 ? "s" : ""}
              </div>
              {filteredUsers.map((user) => {
                const role = (localRoles[user.id] ?? user.role) as "Admin" | "Client";
                const isSaving = savingUser === user.id;
                const justSaved = savedUser === user.id;
                const isMe = user.id === myProfile?.id;
                const initials = getInitials(
                  user.full_name
                    ? { id: user.id, role, full_name: user.full_name, avatar_url: null, created_at: user.created_at }
                    : null,
                  user.email,
                );
                return (
                  <MobileDataCard
                    key={user.id}
                    onClick={() => setRolePickerUserId(user.id)}
                    leftIcon={
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: "50%",
                          background: ORANGE,
                          color: "#fff",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 14,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                        }}
                      >
                        {initials}
                      </div>
                    }
                    title={
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {user.full_name || (
                          <span style={{ color: "var(--mobile-text-muted)", fontWeight: 400 }}>
                            No name
                          </span>
                        )}
                        {isMe && (
                          <span
                            style={{
                              fontSize: 10,
                              background: "rgba(255,80,0,0.10)",
                              color: ORANGE,
                              borderRadius: 10,
                              padding: "1px 7px",
                              fontWeight: 600,
                            }}
                          >
                            You
                          </span>
                        )}
                      </span>
                    }
                    subtitle={user.email}
                    rightSlot={
                      <>
                        {justSaved && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: "#38a169",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                            aria-live="polite"
                          >
                            <CheckIcon size={14} strokeWidth={2.5} /> Saved
                          </span>
                        )}
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            background:
                              role === "Admin"
                                ? "rgba(255,80,0,0.10)"
                                : "rgba(0,0,0,0.06)",
                            color: role === "Admin" ? ORANGE : "var(--mobile-text-muted)",
                            opacity: isSaving ? 0.6 : 1,
                          }}
                        >
                          {role}
                          <ChevronDownIcon size={14} strokeWidth={2.5} />
                        </span>
                      </>
                    }
                  />
                );
              })}
            </>
          )}
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* PERMISSIONS                                                         */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeSection === "permissions" && (
        <section>
          <div style={{ padding: "0 16px 12px", fontSize: 12, color: "var(--mobile-text-muted)", lineHeight: 1.5 }}>
            Three axes per module: <strong>Public</strong> (anonymous visitors),{" "}
            <strong>Clients</strong> (logged-in users), and <strong>Home</strong> (gallery
            card visibility for all users). Enabling Public also enables Clients
            automatically. Admins always have access.
          </div>
          {filteredModules.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              No modules match your search.
            </div>
          ) : (
            filteredModules.map(({ slug, label, description }) => {
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
              const clientsForcedOn = isPublicVisible;
              // Home invariant: home=true requires at least one of Public or
              // Clients to be true. Disable the Home toggle when both are false.
              const homeDisabled = !isPublicVisible && !isClientVisible;

              return (
                <article
                  key={slug}
                  style={{
                    background: "var(--mobile-surface)",
                    borderBottom: "1px solid var(--mobile-divider)",
                    padding: "14px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {/* Title + description */}
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--mobile-text)", lineHeight: 1.2 }}>
                      {label}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 12, color: "var(--mobile-text-muted)", lineHeight: 1.4 }}>
                      {description}
                    </div>
                  </div>

                  {/* Public row */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mobile-text)" }}>Public</span>
                      <span style={{ fontSize: 11, color: "var(--mobile-text-faint)" }}>Anonymous visitors</span>
                    </div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      {justSavedPublic && (
                        <span
                          style={{ fontSize: 10, fontWeight: 700, color: "#38a169", display: "inline-flex", alignItems: "center", gap: 4 }}
                          aria-live="polite"
                        >
                          <CheckIcon size={14} strokeWidth={2.5} />
                        </span>
                      )}
                      {publicError && (
                        <span style={{ fontSize: 11, color: "#c0392b" }} title={publicError}>Failed</span>
                      )}
                      <label className="form-check form-switch" style={{ margin: 0, paddingLeft: 0, display: "inline-block" }}>
                        <input
                          className="form-check-input"
                          type="checkbox"
                          role="switch"
                          aria-label={`Public access to ${label}`}
                          checked={isPublicVisible}
                          disabled={isSavingPublic}
                          onChange={(e) => handlePublicToggle(slug, e.target.checked)}
                          style={{
                            width: "2.6em",
                            height: "1.4em",
                            cursor: isSavingPublic ? "wait" : "pointer",
                            opacity: isSavingPublic ? 0.6 : 1,
                            margin: 0,
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Clients row */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mobile-text)" }}>Clients</span>
                      <span style={{ fontSize: 11, color: "var(--mobile-text-faint)" }}>
                        {clientsForcedOn ? "Locked on (Public is enabled)" : "Logged-in Client tier"}
                      </span>
                    </div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      {justSavedClient && (
                        <span
                          style={{ fontSize: 10, fontWeight: 700, color: "#38a169", display: "inline-flex", alignItems: "center", gap: 4 }}
                          aria-live="polite"
                        >
                          <CheckIcon size={14} strokeWidth={2.5} />
                        </span>
                      )}
                      <label className="form-check form-switch" style={{ margin: 0, paddingLeft: 0, display: "inline-block" }}>
                        <input
                          className="form-check-input"
                          type="checkbox"
                          role="switch"
                          aria-label={`Client access to ${label}`}
                          checked={isClientVisible}
                          disabled={isSavingClient || clientsForcedOn}
                          onChange={(e) => handleToggle(slug, e.target.checked)}
                          style={{
                            width: "2.6em",
                            height: "1.4em",
                            cursor: isSavingClient || clientsForcedOn ? "not-allowed" : "pointer",
                            opacity: clientsForcedOn ? 0.5 : 1,
                            margin: 0,
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Home row */}
                  <div
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
                    title={homeDisabled ? "Make the module visible to Public or Clients first" : undefined}
                  >
                    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mobile-text)" }}>Home</span>
                      <span style={{ fontSize: 11, color: homeDisabled ? "var(--mobile-text-faint)" : "var(--mobile-text-faint)" }}>
                        {homeDisabled ? "Requires Public or Clients to be on" : "Show card in /home gallery"}
                      </span>
                    </div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      {justSavedHome && !homeDisabled && (
                        <span
                          style={{ fontSize: 10, fontWeight: 700, color: "#38a169", display: "inline-flex", alignItems: "center", gap: 4 }}
                          aria-live="polite"
                        >
                          <CheckIcon size={14} strokeWidth={2.5} />
                        </span>
                      )}
                      {homeError && (
                        <span style={{ fontSize: 11, color: "#c0392b" }} title={homeError}>Failed</span>
                      )}
                      <label className="form-check form-switch" style={{ margin: 0, paddingLeft: 0, display: "inline-block" }}>
                        <input
                          className="form-check-input"
                          type="checkbox"
                          role="switch"
                          aria-label={`Show ${label} on Home`}
                          checked={isHomeVisible && !homeDisabled}
                          disabled={isSavingHome || homeDisabled}
                          onChange={(e) => handleHomeToggle(slug, e.target.checked)}
                          style={{
                            width: "2.6em",
                            height: "1.4em",
                            cursor: isSavingHome || homeDisabled ? "not-allowed" : "pointer",
                            opacity: isSavingHome || homeDisabled ? 0.4 : 1,
                            margin: 0,
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* ALERT EMAILS                                                        */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeSection === "alert-recipients" && (
        <section>
          {/* Add form */}
          <div
            style={{
              padding: "0 16px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, color: "var(--mobile-text-muted)", lineHeight: 1.5 }}>
              Emails receive automatic notifications of new data releases (ANP, MDIC, etc.).
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddRecipient()}
                placeholder="name@company.com"
                disabled={addingEmail}
                style={{
                  flex: 1,
                  minHeight: 44,
                  padding: "0 14px",
                  borderRadius: 10,
                  border: `1px solid ${addEmailError ? "#e53e3e" : "var(--mobile-border)"}`,
                  fontSize: 14,
                  fontFamily: "inherit",
                  outline: "none",
                  background: "var(--mobile-surface)",
                  color: "var(--mobile-text)",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={handleAddRecipient}
                disabled={addingEmail || !isValidEmail(newEmail)}
                style={{
                  minHeight: 44,
                  padding: "0 18px",
                  borderRadius: 10,
                  border: "none",
                  background:
                    addingEmail || !isValidEmail(newEmail) ? "var(--mobile-divider)" : ORANGE,
                  color:
                    addingEmail || !isValidEmail(newEmail) ? "var(--mobile-text-faint)" : "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor:
                    addingEmail || !isValidEmail(newEmail) ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                  fontFamily: "inherit",
                }}
              >
                {addingEmail ? "Adding…" : addEmailSuccess ? "✓ Added" : "Add"}
              </button>
            </div>
            {addEmailError && (
              <div style={{ fontSize: 12, color: "#e53e3e" }}>{addEmailError}</div>
            )}
          </div>

          {/* List */}
          {recipientsLoading ? (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              Loading recipients…
            </div>
          ) : recipientsError ? (
            <div
              style={{
                margin: "0 16px",
                padding: 12,
                background: "rgba(229,62,62,0.08)",
                borderRadius: 8,
                color: "#e53e3e",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {recipientsError}
            </div>
          ) : filteredRecipients.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              {search
                ? "No recipients match your search."
                : "No recipients registered yet."}
            </div>
          ) : (
            filteredRecipients.map((r) => {
              const isToggling = togglingId === r.id;
              return (
                <MobileDataCard
                  key={r.id}
                  variant="default"
                  title={r.email}
                  subtitle={`Added on ${formatDateBR(r.created_at)}`}
                  status={
                    r.is_active
                      ? { label: "Active", tone: "completed" }
                      : { label: "Inactive", tone: "neutral" }
                  }
                  onClick={() => setConfirmRemoveId(r.id)}
                  rightSlot={
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleRecipient(r.id, r.is_active);
                      }}
                      disabled={!!togglingId}
                      style={{
                        minHeight: 32,
                        padding: "0 10px",
                        borderRadius: 8,
                        border: `1px solid ${
                          r.is_active ? "var(--mobile-border)" : ORANGE
                        }`,
                        background: "var(--mobile-surface)",
                        color: r.is_active ? "var(--mobile-text-muted)" : ORANGE,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: isToggling ? "wait" : "pointer",
                        opacity: isToggling ? 0.6 : 1,
                        fontFamily: "inherit",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.is_active ? "Disable" : "Enable"}
                    </button>
                  }
                />
              );
            })
          )}
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* ALERTS PRODUCT                                                      */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeSection === "alerts-product" && (
        <section>

          {/* A — Stats */}
          <div style={{ padding: "0 16px 16px" }}>
            <div style={{ fontSize: 12, color: "var(--mobile-text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
              Overview of the opt-in subscriber base across all alert sources.
            </div>
            {alertsStatsLoading ? (
              <div style={{ padding: "16px 0", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
                Loading stats…
              </div>
            ) : !alertsStats ? (
              <div style={{ fontSize: 13, color: "var(--mobile-text-muted)" }}>No stats available.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { label: "Total", value: alertsStats.totals.subscribers_total },
                  { label: "Active", value: alertsStats.totals.subscribers_active },
                  {
                    label: "Unconfirmed",
                    value: alertsStats.totals.subscribers_total - alertsStats.totals.subscribers_confirmed,
                  },
                  {
                    label: "Bounce (7d)",
                    value: `${alertsStats.bounce_rate_7d_pct.toFixed(2)}%`,
                  },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: "var(--mobile-surface)",
                      border: "1px solid var(--mobile-border)",
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--mobile-text-faint)" }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--mobile-text)", marginTop: 4 }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* B — Subscribers */}
          <div style={{ padding: "0 16px 8px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 8 }}>
              Subscribers
            </div>
            {/* Source filter */}
            <select
              value={alertsSubscriberSourceFilter}
              onChange={(e) => setAlertsSubscriberSourceFilter(e.target.value)}
              style={{
                fontSize: 13, padding: "8px 12px", borderRadius: 8, marginBottom: 8,
                border: "1px solid var(--mobile-border)", background: "var(--mobile-surface)",
                color: "var(--mobile-text)", fontFamily: "inherit", outline: "none", width: "100%",
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
            <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              Loading subscribers…
            </div>
          ) : alertsSubscribers.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              No subscribers yet. The first opt-in will appear here.
            </div>
          ) : (
            alertsSubscribers
              .filter((s) => {
                const q = search.trim().toLowerCase();
                if (q && !s.email.toLowerCase().includes(q) && !s.source_slug.toLowerCase().includes(q)) return false;
                if (alertsSubscriberSourceFilter && s.source_slug !== alertsSubscriberSourceFilter) return false;
                return true;
              })
              .map((sub) => {
                const isUnsubscribing = unsubscribingId === sub.id;
                return (
                  <MobileDataCard
                    key={sub.id}
                    variant="default"
                    title={sub.email}
                    subtitle={`${sub.source_slug} · ${formatDateBR(sub.created_at)}`}
                    status={
                      sub.is_active
                        ? sub.is_confirmed
                          ? { label: "Active", tone: "completed" }
                          : { label: "Unconfirmed", tone: "unloading" }
                        : { label: "Inactive", tone: "neutral" }
                    }
                    rightSlot={
                      <button
                        type="button"
                        onClick={() => handleAlertsForceUnsubscribe(sub.id)}
                        disabled={isUnsubscribing || !sub.is_active}
                        style={{
                          minHeight: 32,
                          padding: "0 10px",
                          borderRadius: 8,
                          border: "1px solid rgba(229,62,62,0.4)",
                          background: "var(--mobile-surface)",
                          color: sub.is_active ? "#e53e3e" : "var(--mobile-text-faint)",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: isUnsubscribing || !sub.is_active ? "not-allowed" : "pointer",
                          opacity: isUnsubscribing ? 0.6 : 1,
                          fontFamily: "inherit",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isUnsubscribing ? "…" : "Force unsub"}
                      </button>
                    }
                  />
                );
              })
          )}

          {/* C — Sources */}
          <div style={{ padding: "16px 16px 8px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 4 }}>
              Sources
            </div>
            <div style={{ fontSize: 12, color: "var(--mobile-text-muted)", marginBottom: 8, lineHeight: 1.4 }}>
              Toggle sources active/inactive. Send a test event for QA.
            </div>
          </div>

          {alertsSourcesLoading ? (
            <div style={{ padding: "16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              Loading sources…
            </div>
          ) : alertsSources.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              No sources registered.
            </div>
          ) : (
            alertsSources.map((src) => {
              const isToggling = togglingSourceSlug === src.source_slug;
              const isSending = sendingTestSlug === src.source_slug;
              return (
                <article
                  key={src.source_slug}
                  style={{
                    background: "var(--mobile-surface)",
                    borderBottom: "1px solid var(--mobile-divider)",
                    padding: "14px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--mobile-text)" }}>
                      {src.display_name || src.source_slug}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--mobile-text-faint)", fontFamily: "monospace" }}>
                      {src.source_slug} · {src.category}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    {/* Active toggle */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <label className="form-check form-switch" style={{ margin: 0, paddingLeft: 0, display: "inline-block" }}>
                        <input
                          className="form-check-input"
                          type="checkbox"
                          role="switch"
                          aria-label={`Toggle source ${src.source_slug}`}
                          checked={src.is_active}
                          disabled={isToggling}
                          onChange={(e) => handleAlertsToggleSource(src.source_slug, e.target.checked)}
                          style={{ width: "2.6em", height: "1.4em", cursor: isToggling ? "wait" : "pointer", opacity: isToggling ? 0.6 : 1, margin: 0 }}
                        />
                      </label>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mobile-text-muted)" }}>
                        {src.is_active ? "Active" : "Off"}
                      </span>
                    </div>
                    {/* Test button */}
                    <button
                      type="button"
                      onClick={() => handleAlertsSendTestEvent(src.source_slug)}
                      disabled={!!sendingTestSlug}
                      style={{
                        minHeight: 36,
                        padding: "0 12px",
                        borderRadius: 8,
                        border: `1px solid ${ORANGE}`,
                        background: "var(--mobile-surface)",
                        color: ORANGE,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: isSending ? "wait" : "pointer",
                        opacity: isSending || (!!sendingTestSlug && !isSending) ? 0.6 : 1,
                        fontFamily: "inherit",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isSending ? "Sending…" : "Send test"}
                    </button>
                  </div>
                </article>
              );
            })
          )}

          {/* D — Email log */}
          <div style={{ padding: "16px 16px 8px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 4 }}>
              Email Log
            </div>
            <select
              value={alertsEmailLogStatusFilter}
              onChange={(e) => setAlertsEmailLogStatusFilter(e.target.value)}
              style={{
                fontSize: 13, padding: "8px 12px", borderRadius: 8, marginTop: 4,
                border: "1px solid var(--mobile-border)", background: "var(--mobile-surface)",
                color: "var(--mobile-text)", fontFamily: "inherit", outline: "none", width: "100%",
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
            <div style={{ padding: "16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              Loading email log…
            </div>
          ) : alertsEmailLog.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              No email log entries yet.
            </div>
          ) : (
            alertsEmailLog
              .filter((e) => !alertsEmailLogStatusFilter || e.status === alertsEmailLogStatusFilter)
              .slice(0, 50)
              .map((entry) => {
                const statusTone: Record<string, "completed" | "unloading" | "neutral"> = {
                  sent: "neutral",        // pending — amber/yellow semantics
                  delivered: "completed", // green — confirmed delivery
                  opened: "completed",
                  clicked: "completed",
                  bounced: "unloading",   // red — problem
                  complained: "unloading",
                  failed: "unloading",
                };
                return (
                  <MobileDataCard
                    key={entry.id}
                    variant="default"
                    title={entry.email}
                    subtitle={entry.subject ?? "—"}
                    status={{ label: entry.status, tone: statusTone[entry.status] ?? "neutral" }}
                  />
                );
              })
          )}

          {/* E — Outbox repair */}
          <div style={{ padding: "16px 16px 8px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 4 }}>
              Outbox Repair
            </div>
            <div style={{ fontSize: 12, color: "var(--mobile-text-muted)", lineHeight: 1.4 }}>
              Failed outbox entries. Requeue to retry delivery.
            </div>
          </div>

          {alertsOutboxLoading ? (
            <div style={{ padding: "16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              Loading outbox…
            </div>
          ) : alertsOutbox.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              No failed outbox entries. Everything is healthy.
            </div>
          ) : (
            alertsOutbox.map((row) => {
              const isRequeuing = requeueingOutboxId === row.id;
              return (
                <MobileDataCard
                  key={row.id}
                  variant="default"
                  title={row.subscriber?.email ?? "—"}
                  subtitle={`${row.event?.source_slug ?? "—"} · ${row.send_attempts} attempts`}
                  status={{ label: "Failed", tone: "unloading" }}
                  rightSlot={
                    <button
                      type="button"
                      onClick={() => handleAlertsRequeueOutbox(row.id)}
                      disabled={!!requeueingOutboxId}
                      style={{
                        minHeight: 32,
                        padding: "0 10px",
                        borderRadius: 8,
                        border: `1px solid ${ORANGE}`,
                        background: "var(--mobile-surface)",
                        color: ORANGE,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: isRequeuing ? "wait" : "pointer",
                        opacity: isRequeuing || (!!requeueingOutboxId && !isRequeuing) ? 0.6 : 1,
                        fontFamily: "inherit",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isRequeuing ? "…" : "Requeue"}
                    </button>
                  }
                />
              );
            })
          )}

        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* DEFAULT NEWS KEYWORDS                                               */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeSection === "default-news" && (
        <section>
          {/* Description + add form */}
          <div
            style={{
              padding: "0 16px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, color: "var(--mobile-text-muted)", lineHeight: 1.5 }}>
              These keywords are used by anonymous visitors of the News Hunter dashboard.
              Logged-in users have their own personal keyword list.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddKeyword()}
                placeholder="e.g. Petrobras, diesel"
                disabled={addingKeyword}
                style={{
                  flex: 1,
                  minHeight: 44,
                  padding: "0 14px",
                  borderRadius: 10,
                  border: `1px solid ${addKeywordError ? "#e53e3e" : "var(--mobile-border)"}`,
                  fontSize: 14,
                  fontFamily: "inherit",
                  outline: "none",
                  background: "var(--mobile-surface)",
                  color: "var(--mobile-text)",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={handleAddKeyword}
                disabled={addingKeyword || !newKeyword.trim()}
                style={{
                  minHeight: 44,
                  padding: "0 18px",
                  borderRadius: 10,
                  border: "none",
                  background:
                    addingKeyword || !newKeyword.trim() ? "var(--mobile-divider)" : ORANGE,
                  color:
                    addingKeyword || !newKeyword.trim() ? "var(--mobile-text-faint)" : "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor:
                    addingKeyword || !newKeyword.trim() ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                  fontFamily: "inherit",
                }}
              >
                {addingKeyword ? "Adding…" : addKeywordSuccess ? "✓ Added" : "Add"}
              </button>
            </div>
            {/* Exact match toggle for new keyword */}
            <label
              title="When enabled, only whole-word matches trigger an alert. Useful for short/generic terms like 'Vibra'."
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                minHeight: 44,
                padding: "0 14px",
                borderRadius: 10,
                border: `1px solid ${newKeywordMatchType === "exact" ? ORANGE : "var(--mobile-border)"}`,
                background: newKeywordMatchType === "exact" ? "rgba(255,80,0,0.06)" : "var(--mobile-surface)",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <div
                className="form-check form-switch"
                style={{ margin: 0, paddingLeft: 0, display: "inline-block" }}
              >
                <input
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  checked={newKeywordMatchType === "exact"}
                  onChange={(e) => setNewKeywordMatchType(e.target.checked ? "exact" : "substring")}
                  disabled={addingKeyword}
                  aria-label="Exact match (whole word)"
                  style={{ width: "2.6em", height: "1.4em", cursor: "pointer", margin: 0 }}
                />
              </div>
              <span style={{
                fontSize: 13,
                fontWeight: 600,
                color: newKeywordMatchType === "exact" ? ORANGE : "var(--mobile-text-muted)",
              }}>
                Exact match (whole word)
              </span>
            </label>
            {addKeywordError && (
              <div style={{ fontSize: 12, color: "#e53e3e" }}>{addKeywordError}</div>
            )}
          </div>

          {/* Error banner */}
          {defaultKeywordsError && (
            <div
              style={{
                margin: "0 16px 12px",
                padding: 12,
                background: "rgba(229,62,62,0.08)",
                borderRadius: 8,
                color: "#e53e3e",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {defaultKeywordsError}
            </div>
          )}

          {/* Keyword list */}
          {defaultKeywordsLoading ? (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              Loading keywords…
            </div>
          ) : filteredKeywords.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
              {search ? "No keywords match your search." : "No default keywords yet."}
            </div>
          ) : (
            filteredKeywords.map((kw) => {
              const isExact = kw.match_type === "exact";
              const isTogglingThis = togglingMatchType.has(kw.keyword);
              return (
                // Inline article instead of MobileDataCard so the match-type
                // toggle row sits below the title outside any subtitle clamp.
                <article
                  key={kw.keyword}
                  style={{
                    background: "var(--mobile-surface)",
                    borderBottom: "1px solid var(--mobile-divider)",
                    padding: "12px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    cursor: "pointer",
                  }}
                  onClick={() => setConfirmRemoveKeyword(kw.keyword)}
                >
                  {/* Row 1: keyword title + EXACT badge + Remove button */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: "var(--mobile-text)",
                        lineHeight: 1.2,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {kw.keyword}
                      {isExact && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                          textTransform: "uppercase", padding: "1px 5px",
                          borderRadius: 6, background: ORANGE, color: "#fff",
                          flexShrink: 0,
                        }}>
                          Exact
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmRemoveKeyword(kw.keyword);
                      }}
                      disabled={!!removingKeyword}
                      style={{
                        flexShrink: 0,
                        minHeight: 32,
                        padding: "0 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(229,62,62,0.4)",
                        background: "var(--mobile-surface)",
                        color: "#e53e3e",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: removingKeyword ? "wait" : "pointer",
                        opacity: removingKeyword ? 0.6 : 1,
                        fontFamily: "inherit",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Remove
                    </button>
                  </div>

                  {/* Row 2: added date */}
                  <span style={{ fontSize: 11, color: "var(--mobile-text-faint)" }}>
                    Added {formatDateBR(kw.created_at)}
                  </span>

                  {/* Row 3: match-type toggle — lives outside any line-clamp wrapper */}
                  <label
                    title="When enabled, only whole-word matches trigger an alert. Useful for short/generic terms like 'Vibra'."
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: isTogglingThis ? "wait" : "pointer",
                      userSelect: "none",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      className="form-check form-switch"
                      style={{ margin: 0, paddingLeft: 0, display: "inline-block" }}
                    >
                      <input
                        className="form-check-input"
                        type="checkbox"
                        role="switch"
                        checked={isExact}
                        disabled={isTogglingThis}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleToggleMatchType(kw.keyword, kw.match_type);
                        }}
                        aria-label={`Exact match for keyword ${kw.keyword}`}
                        style={{
                          width: "2.2em", height: "1.2em",
                          cursor: isTogglingThis ? "wait" : "pointer",
                          opacity: isTogglingThis ? 0.5 : 1,
                          margin: 0,
                        }}
                      />
                    </div>
                    <span style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: isExact ? ORANGE : "var(--mobile-text-faint)",
                    }}>
                      {isTogglingThis ? "Toggling…" : "Exact match (whole word)"}
                    </span>
                  </label>
                </article>
              );
            })
          )}
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* DATA INPUT                                                          */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeSection === "data-input" && (
        <section style={{ padding: "12px 16px" }}>
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: "var(--mobile-surface)",
              border: "1px solid var(--mobile-border)",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--mobile-text)",
                marginBottom: 6,
              }}
            >
              Desktop only
            </div>
            <div style={{ fontSize: 13, color: "var(--mobile-text-muted)", lineHeight: 1.5 }}>
              The reference-table editor needs a wide layout. Open Admin Panel on a
              desktop or tablet to add, edit, or delete rows in tables like
              <code style={{ marginLeft: 4 }}>price_bands</code> and{" "}
              <code>d_g_margins</code>.
            </div>
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* FIELD STAKES                                                        */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {activeSection === "field-stakes" && (
        <section>
          {/* Sticky filter chips */}
          <div
            style={{
              position: "sticky",
              top: "calc(var(--mobile-topbar-h) + 56px)",
              zIndex: 20,
              padding: "8px 16px",
              background: "var(--mobile-glass-bg)",
              WebkitBackdropFilter: "var(--mobile-glass-blur)",
              backdropFilter: "var(--mobile-glass-blur)",
              borderBottom: "1px solid var(--mobile-glass-border)",
              display: "flex",
              gap: 6,
              overflowX: "auto",
              scrollbarWidth: "none",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {([
              { id: "all" as const,        label: "All" },
              { id: "complete" as const,   label: "✓ Complete" },
              { id: "incomplete" as const, label: "⚠ Incomplete" },
              { id: "empty" as const,      label: "○ Empty" },
            ] as const).map(({ id, label }) => {
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
                  type="button"
                  onClick={() => setStakesStatusFilter(id)}
                  aria-pressed={isActive}
                  style={{
                    flex: "0 0 auto",
                    minHeight: 32,
                    padding: "0 12px",
                    borderRadius: 999,
                    border: isActive ? `1px solid ${ORANGE}` : "1px solid var(--mobile-border)",
                    background: isActive ? ORANGE : "var(--mobile-surface)",
                    color: isActive ? "#fff" : "var(--mobile-text-muted)",
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span>{label}</span>
                  <span style={{ fontSize: 11, opacity: 0.85, fontWeight: 700 }}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Search input */}
          <div style={{ padding: "12px 16px 4px" }}>
            <div style={{ position: "relative", height: 40 }}>
              <span
                style={{
                  position: "absolute",
                  top: "50%",
                  left: 12,
                  transform: "translateY(-50%)",
                  color: "var(--mobile-text-faint)",
                  pointerEvents: "none",
                }}
              >
                <SearchIcon size={18} />
              </span>
              <input
                type="search"
                value={stakesSearchQuery}
                onChange={(e) => setStakesSearchQuery(e.target.value)}
                placeholder="Search field…"
                aria-label="Search field"
                style={{
                  width: "100%",
                  height: 40,
                  borderRadius: 10,
                  border: "1px solid var(--mobile-border)",
                  background: "var(--mobile-surface)",
                  color: "var(--mobile-text)",
                  fontFamily: "inherit",
                  fontSize: 14,
                  padding: "0 12px 0 38px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          {/* Field list — grouped by canonical name (Round 4) */}
          <div style={{ padding: "8px 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            {fieldStakesLoading ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
                Loading fields…
              </div>
            ) : groupedOverview.length === 0 ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
                No fields match the current filters.
              </div>
            ) : (
              // Canonical-grouped rendering. Single-variant groups behave like
              // the old flat row (tap → open editor sheet). Multi-variant
              // groups render a header card; tap the header to expand inline,
              // then tap any variant to open the editor on THAT variant.
              groupedOverview.map((group) => {
                const isMulti = group.n_variants > 1;
                const isExpanded = expandedCanonicals.has(group.canonical);

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
                        : "#999";
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

                // ── Single-variant: behaves exactly like the old flat row ─
                if (!isMulti) {
                  const row = group.variants[0];
                  return (
                    <button
                      key={group.canonical}
                      type="button"
                      onClick={async () => {
                        await handleSelectCampo(row.campo);
                        setFieldStakesSheetOpen(true);
                      }}
                      style={{
                        width: "100%",
                        minHeight: 64,
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: "1px solid var(--mobile-border)",
                        background: "var(--mobile-surface)",
                        color: "var(--mobile-text)",
                        fontFamily: "inherit",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        textAlign: "left",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--mobile-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.campo}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--mobile-text-muted)", marginTop: 2 }}>
                          {row.n_empresas} {row.n_empresas === 1 ? "company" : "companies"}
                          {row.has_data_in_producao ? " · prod. data" : ""}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 12,
                        background: groupStatusBg, color: groupStatusColor, whiteSpace: "nowrap", flexShrink: 0,
                      }}>
                        {groupStatusText}
                      </span>
                    </button>
                  );
                }

                // ── Multi-variant: collapsible group card ────────────────
                return (
                  <div
                    key={group.canonical}
                    style={{
                      borderRadius: 12,
                      border: "1px solid var(--mobile-border)",
                      background: "var(--mobile-surface)",
                      overflow: "hidden",
                    }}
                  >
                    {/* Group header — tap to expand/collapse */}
                    <button
                      type="button"
                      onClick={() => handleToggleCanonical(group.canonical)}
                      aria-expanded={isExpanded}
                      aria-controls={`mobile-field-stakes-group-${group.canonical}`}
                      style={{
                        width: "100%",
                        minHeight: 64,
                        padding: "10px 14px",
                        border: "none",
                        background: "transparent",
                        color: "var(--mobile-text)",
                        fontFamily: "inherit",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        textAlign: "left",
                      }}
                    >
                      {/* Chevron */}
                      <span
                        aria-hidden="true"
                        style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 16, height: 16, color: "var(--mobile-text-muted)", flexShrink: 0,
                          transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                          transition: "transform 0.12s",
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <span style={{
                            fontSize: 14, fontWeight: 700, color: "var(--mobile-text)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {group.canonical}
                          </span>
                          <span style={{
                            fontSize: 10, fontWeight: 700, color: "var(--mobile-text-muted)",
                            background: "rgba(0,0,0,0.05)", padding: "1px 6px", borderRadius: 8,
                            flexShrink: 0, whiteSpace: "nowrap",
                          }}>
                            {group.n_variants} variants
                          </span>
                        </div>
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 12,
                        background: groupStatusBg, color: groupStatusColor, whiteSpace: "nowrap", flexShrink: 0,
                      }}>
                        {groupStatusText}
                      </span>
                    </button>

                    {/* Expanded — variants stacked under the header */}
                    {isExpanded && (
                      <div
                        id={`mobile-field-stakes-group-${group.canonical}`}
                        style={{ borderTop: "1px solid var(--mobile-border)" }}
                      >
                        {group.variants.map((row) => {
                          const isEmpty = row.n_empresas === 0;
                          const status = isEmpty ? "empty" : row.is_complete ? "complete" : "incomplete";
                          const statusColor = status === "complete" ? "#38a169" : status === "incomplete" ? "#d69e2e" : "#999";
                          const statusBg = status === "complete" ? "rgba(72,187,120,0.15)" : status === "incomplete" ? "rgba(214,158,46,0.15)" : "rgba(180,180,180,0.15)";
                          const statusText = status === "complete" ? "100%" : status === "incomplete" ? `${row.soma_pct.toFixed(2)}%` : "—";
                          return (
                            <button
                              key={row.campo}
                              type="button"
                              onClick={async () => {
                                await handleSelectCampo(row.campo);
                                setFieldStakesSheetOpen(true);
                              }}
                              style={{
                                width: "100%",
                                minHeight: 56,
                                padding: "8px 14px 8px 32px",
                                border: "none",
                                borderTop: "1px solid var(--mobile-border)",
                                background: "transparent",
                                color: "var(--mobile-text)",
                                fontFamily: "inherit",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 10,
                                textAlign: "left",
                              }}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--mobile-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {row.campo}
                                </div>
                                <div style={{ fontSize: 11, color: "var(--mobile-text-muted)", marginTop: 2 }}>
                                  {row.n_empresas} {row.n_empresas === 1 ? "company" : "companies"}
                                  {row.has_data_in_producao ? " · prod. data" : ""}
                                </div>
                              </div>
                              <span style={{
                                fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 12,
                                background: statusBg, color: statusColor, whiteSpace: "nowrap", flexShrink: 0,
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
        </section>
      )}

      {/* ── Field Stakes editor sheet ─────────────────────────────────────── */}
      <BottomSheet
        open={fieldStakesSheetOpen && selectedCampo != null && activeSection === "field-stakes"}
        onClose={() => setFieldStakesSheetOpen(false)}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
              {selectedCampo ?? ""}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 12,
              background: isValidSum ? "rgba(72,187,120,0.15)" : "rgba(229,62,62,0.15)",
              color: isValidSum ? "#38a169" : "#e53e3e",
              whiteSpace: "nowrap", flexShrink: 0,
            }}>
              {currentSum.toFixed(2)}% / 100%
            </span>
          </span>
        }
        height="90vh"
      >
        {selectedCampo && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* datalist for autocomplete */}
            <datalist id="field-stakes-empresa-list-mobile">
              {fieldStakesEmpresas.map((e) => (
                <option key={e.empresa} value={e.empresa} />
              ))}
            </datalist>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px 16px" }}>
              <div style={{ fontSize: 11, color: "var(--mobile-text-faint)", marginBottom: 12 }}>
                {selectedCampoLastUpdated
                  ? `Last updated: ${formatDateBR(selectedCampoLastUpdated)}`
                  : "Not yet saved."}
              </div>

              {editorLoading ? (
                <div style={{ padding: "32px 0", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
                  Loading stakes…
                </div>
              ) : (
                <>
                  {editorStakes.length === 0 && (
                    <div style={{
                      padding: "20px 12px", textAlign: "center", color: "var(--mobile-text-muted)",
                      fontSize: 13, border: "1px dashed var(--mobile-border)", borderRadius: 10, marginBottom: 12,
                    }}>
                      No companies registered yet. Add the first one below.
                    </div>
                  )}

                  {editorStakes.map((row, idx) => (
                    <article
                      key={idx}
                      style={{
                        position: "relative", padding: "12px 12px 12px", marginBottom: 10,
                        borderRadius: 12, background: "var(--mobile-surface)",
                        border: "1px solid var(--mobile-border)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => handleRemoveEmpresaRow(idx)}
                        aria-label={`Remove ${row.empresa || "row"}`}
                        style={{
                          position: "absolute", top: 8, right: 8,
                          width: 28, height: 28, borderRadius: 6,
                          background: "transparent", border: "1px solid var(--mobile-border)",
                          color: "#e53e3e", fontFamily: "inherit", fontSize: 16, lineHeight: 1,
                          cursor: "pointer",
                        }}
                      >
                        ×
                      </button>
                      <label style={{ display: "block", fontSize: 11, color: "var(--mobile-text-faint)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
                        Company
                      </label>
                      <input
                        type="text"
                        list="field-stakes-empresa-list-mobile"
                        value={row.empresa}
                        onChange={(e) => handleChangeStake(idx, "empresa", e.target.value)}
                        placeholder="Company name"
                        style={{
                          width: "100%", minHeight: 40, padding: "0 12px", borderRadius: 8,
                          border: "1px solid var(--mobile-border)", background: "var(--mobile-bg)",
                          color: "var(--mobile-text)", fontFamily: "inherit", fontSize: 14,
                          outline: "none", boxSizing: "border-box", marginBottom: 10,
                        }}
                      />
                      <label style={{ display: "block", fontSize: 11, color: "var(--mobile-text-faint)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
                        Stake
                      </label>
                      <div style={{ position: "relative" }}>
                        <input
                          type="number"
                          step={0.001}
                          min={0}
                          max={100}
                          value={Number.isFinite(row.stake_pct) ? row.stake_pct : 0}
                          onChange={(e) => handleChangeStake(idx, "stake_pct", e.target.value)}
                          style={{
                            width: "100%", minHeight: 40, padding: "0 36px 0 12px", borderRadius: 8,
                            border: "1px solid var(--mobile-border)", background: "var(--mobile-bg)",
                            color: "var(--mobile-text)", fontFamily: "inherit", fontSize: 14,
                            outline: "none", boxSizing: "border-box", textAlign: "right",
                          }}
                        />
                        <span style={{
                          position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                          color: "var(--mobile-text-faint)", fontSize: 14, pointerEvents: "none",
                        }}>
                          %
                        </span>
                      </div>
                    </article>
                  ))}

                  {/* + Add company card */}
                  <article style={{
                    padding: 12, marginBottom: 10, borderRadius: 12,
                    background: "var(--mobile-surface)",
                    border: "1px dashed var(--mobile-border)",
                  }}>
                    <label style={{ display: "block", fontSize: 11, color: "var(--mobile-text-faint)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
                      Add company
                    </label>
                    <input
                      type="text"
                      list="field-stakes-empresa-list-mobile"
                      value={newEmpresaInput}
                      onChange={(e) => setNewEmpresaInput(e.target.value)}
                      placeholder="Company name"
                      style={{
                        width: "100%", minHeight: 40, padding: "0 12px", borderRadius: 8,
                        border: "1px solid var(--mobile-border)", background: "var(--mobile-bg)",
                        color: "var(--mobile-text)", fontFamily: "inherit", fontSize: 14,
                        outline: "none", boxSizing: "border-box", marginBottom: 8,
                      }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ position: "relative", flex: 1 }}>
                        <input
                          type="number"
                          step={0.001}
                          min={0}
                          max={100}
                          value={newEmpresaPctInput}
                          onChange={(e) => setNewEmpresaPctInput(e.target.value)}
                          placeholder="0.00"
                          style={{
                            width: "100%", minHeight: 40, padding: "0 36px 0 12px", borderRadius: 8,
                            border: "1px solid var(--mobile-border)", background: "var(--mobile-bg)",
                            color: "var(--mobile-text)", fontFamily: "inherit", fontSize: 14,
                            outline: "none", boxSizing: "border-box", textAlign: "right",
                          }}
                        />
                        <span style={{
                          position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                          color: "var(--mobile-text-faint)", fontSize: 14, pointerEvents: "none",
                        }}>
                          %
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddEmpresaRow}
                        style={{
                          minWidth: 96, minHeight: 40, padding: "0 14px",
                          borderRadius: 8, border: "none",
                          background: ORANGE, color: "#fff", fontFamily: "inherit",
                          fontSize: 14, fontWeight: 700, cursor: "pointer",
                        }}
                      >
                        Add
                      </button>
                    </div>
                  </article>

                  <button
                    type="button"
                    onClick={() => handleDeleteCampo(selectedCampo)}
                    disabled={savingStakes}
                    style={{
                      width: "100%", minHeight: 44, padding: "0 14px", marginTop: 8,
                      borderRadius: 10, border: "1px solid rgba(229,62,62,0.4)",
                      background: "transparent", color: "#e53e3e", fontFamily: "inherit",
                      fontSize: 13, fontWeight: 600, cursor: savingStakes ? "not-allowed" : "pointer",
                      opacity: savingStakes ? 0.5 : 1,
                    }}
                  >
                    Delete all stakes for this field
                  </button>
                </>
              )}
            </div>

            {/* Sticky footer */}
            <div
              style={{
                padding: "12px 16px calc(var(--mobile-safe-bottom) + 12px)",
                borderTop: "1px solid var(--mobile-divider)",
                background: "var(--mobile-surface)",
              }}
            >
              {stakesError && (
                <div style={{
                  padding: "8px 10px", borderRadius: 8, marginBottom: 10,
                  background: "#fff5f5", border: "1px solid rgba(229,62,62,0.3)",
                  color: "#c0392b", fontSize: 12, lineHeight: 1.4,
                }}>
                  {stakesError}
                </div>
              )}
              <button
                type="button"
                onClick={handleSaveStakes}
                disabled={!isValidSum || savingStakes || !pendingChanges}
                style={{
                  width: "100%", minHeight: 48, padding: "0 16px", borderRadius: 12, border: 0,
                  background: (!isValidSum || savingStakes || !pendingChanges) ? "var(--mobile-border)" : ORANGE,
                  color: (!isValidSum || savingStakes || !pendingChanges) ? "var(--mobile-text-muted)" : "#fff",
                  fontFamily: "inherit", fontSize: 15, fontWeight: 700,
                  cursor: (!isValidSum || savingStakes || !pendingChanges) ? "not-allowed" : "pointer",
                }}
              >
                {savingStakes ? "Saving…" : !isValidSum ? "Sum must equal 100%" : !pendingChanges ? "No changes" : "Save"}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* ── Confirm-delete campo sheet ────────────────────────────────────── */}
      <BottomSheet
        open={deleteCampoConfirm != null}
        onClose={handleCancelDeleteCampo}
        title="Delete all stakes"
        height="auto"
      >
        {deleteCampoConfirm && (
          <div style={{ padding: "12px 16px 16px" }}>
            <div style={{ fontSize: 13, color: "var(--mobile-text-muted)", marginBottom: 4 }}>
              Delete all stakes for:
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "var(--mobile-text)",
                marginBottom: 16,
                wordBreak: "break-all",
              }}
            >
              {deleteCampoConfirm}
            </div>
            <div style={{ fontSize: 12, color: "var(--mobile-text-muted)", marginBottom: 16, lineHeight: 1.5 }}>
              Every (company, stake %) row registered for this field will be removed.
              This action cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={handleCancelDeleteCampo}
                disabled={savingStakes}
                style={{
                  flex: 1, minHeight: 44, borderRadius: 10,
                  border: "1px solid var(--mobile-border)",
                  background: "var(--mobile-surface)", color: "var(--mobile-text)",
                  fontFamily: "inherit", fontSize: 14, fontWeight: 600,
                  cursor: savingStakes ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCampo}
                disabled={savingStakes}
                style={{
                  flex: 1, minHeight: 44, borderRadius: 10, border: 0,
                  background: "#e53e3e", color: "#fff",
                  fontFamily: "inherit", fontSize: 14, fontWeight: 700,
                  cursor: savingStakes ? "wait" : "pointer", opacity: savingStakes ? 0.6 : 1,
                }}
              >
                {savingStakes ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* ── Role picker (Members section) ─────────────────────────────────── */}
      <BottomSheet
        open={rolePickerUser != null}
        onClose={() => setRolePickerUserId(null)}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            Change role
          </span>
        }
        height="auto"
      >
        {rolePickerUser && (() => {
          const u = rolePickerUser;
          const currentRole = (localRoles[u.id] ?? u.role) as "Admin" | "Client";
          const isSaving = savingUser === u.id;
          return (
            <div style={{ padding: "12px 0 8px" }}>
              <div style={{ padding: "0 16px 14px" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--mobile-text)" }}>
                  {u.full_name || "No name"}
                </div>
                <div style={{ fontSize: 12, color: "var(--mobile-text-muted)" }}>{u.email}</div>
              </div>
              {(["Admin", "Client"] as const).map((opt) => {
                const selected = currentRole === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={isSaving || selected}
                    onClick={async () => {
                      await handleRoleChange(u.id, opt);
                      setRolePickerUserId(null);
                    }}
                    style={{
                      width: "100%",
                      minHeight: 56,
                      padding: "0 16px",
                      background: selected ? "rgba(255,80,0,0.08)" : "var(--mobile-surface)",
                      border: 0,
                      borderTop: "1px solid var(--mobile-divider)",
                      color: selected ? ORANGE : "var(--mobile-text)",
                      fontFamily: "inherit",
                      fontSize: 15,
                      fontWeight: selected ? 700 : 500,
                      cursor: isSaving || selected ? "default" : "pointer",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span>{opt}</span>
                    {selected && <CheckIcon size={14} strokeWidth={2.5} />}
                  </button>
                );
              })}
            </div>
          );
        })()}
      </BottomSheet>

      {/* ── Confirm-remove keyword sheet ──────────────────────────────────── */}
      <BottomSheet
        open={confirmRemoveKeyword != null}
        onClose={() => setConfirmRemoveKeyword(null)}
        title="Remove keyword"
        height="auto"
      >
        {confirmRemoveKeyword && (() => {
          const isRemoving = removingKeyword === confirmRemoveKeyword;
          return (
            <div style={{ padding: "12px 16px 16px" }}>
              <div style={{ fontSize: 13, color: "var(--mobile-text-muted)", marginBottom: 4 }}>
                You are about to remove:
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--mobile-text)",
                  marginBottom: 16,
                  wordBreak: "break-all",
                }}
              >
                {confirmRemoveKeyword}
              </div>
              <div style={{ fontSize: 12, color: "var(--mobile-text-muted)", marginBottom: 16, lineHeight: 1.5 }}>
                This keyword will be removed from the default set. Anonymous News Hunter
                visitors will no longer see articles matched by this term.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setConfirmRemoveKeyword(null)}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 10,
                    border: "1px solid var(--mobile-border)",
                    background: "var(--mobile-surface)",
                    color: "var(--mobile-text)",
                    fontFamily: "inherit",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveKeyword(confirmRemoveKeyword)}
                  disabled={isRemoving}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 10,
                    border: 0,
                    background: "#e53e3e",
                    color: "#fff",
                    fontFamily: "inherit",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: isRemoving ? "wait" : "pointer",
                    opacity: isRemoving ? 0.6 : 1,
                  }}
                >
                  {isRemoving ? "Removing…" : "Remove"}
                </button>
              </div>
            </div>
          );
        })()}
      </BottomSheet>

      {/* ── Confirm-remove recipient sheet ────────────────────────────────── */}
      <BottomSheet
        open={confirmRemoveId != null}
        onClose={() => setConfirmRemoveId(null)}
        title="Remove recipient"
        height="auto"
      >
        {confirmRemoveId && (() => {
          const r = recipients.find((x) => x.id === confirmRemoveId);
          const isRemoving = removingId === confirmRemoveId;
          if (!r) return null;
          return (
            <div style={{ padding: "12px 16px 16px" }}>
              <div style={{ fontSize: 13, color: "var(--mobile-text-muted)", marginBottom: 4 }}>
                You are about to remove:
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--mobile-text)",
                  marginBottom: 16,
                  wordBreak: "break-all",
                }}
              >
                {r.email}
              </div>
              <div style={{ fontSize: 12, color: "var(--mobile-text-muted)", marginBottom: 16, lineHeight: 1.5 }}>
                They will stop receiving automated notifications immediately.
                This action cannot be undone.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setConfirmRemoveId(null)}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 10,
                    border: "1px solid var(--mobile-border)",
                    background: "var(--mobile-surface)",
                    color: "var(--mobile-text)",
                    fontFamily: "inherit",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveRecipient(r.id)}
                  disabled={isRemoving}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 10,
                    border: 0,
                    background: "#e53e3e",
                    color: "#fff",
                    fontFamily: "inherit",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: isRemoving ? "wait" : "pointer",
                    opacity: isRemoving ? 0.6 : 1,
                  }}
                >
                  {isRemoving ? "Removing…" : "Remove"}
                </button>
              </div>
            </div>
          );
        })()}
      </BottomSheet>
    </div>
  );
}
