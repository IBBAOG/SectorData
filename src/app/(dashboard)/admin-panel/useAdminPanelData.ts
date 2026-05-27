"use client";

// Brain hook for /admin-panel (dual-view pattern).
//
// Owns ALL state, RPC calls, and handlers used by both desktop/View.tsx and
// mobile/View.tsx. Views are pure presentation layers — they MUST NOT call
// Supabase or `profileRpc` directly. If a View needs a value the other doesn't
// have yet, you add it here first.
//
// Sections covered:
//   • Members           — list all users; promote/demote Admin ↔ Client
//   • Permissions       — three-column visibility per module:
//                         Public (anon), Clients (logged-in), Home (gallery card)
//   • Alert Emails      — manage automatic notification recipients
//   • Default Keywords  — manage default News Hunter keywords for anonymous visitors
//   • Data Input        — edit reference tables (desktop-only editor)
//
// RPCs touched: get_module_visibility (via UserProfileContext), set_module_visibility,
// set_module_home_visibility, set_module_public_visibility, get_all_users_with_roles,
// set_user_role, admin_list_default_news_keywords, admin_add_default_news_keyword,
// admin_remove_default_news_keyword.
// Plus direct PostgREST on alert_recipients.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRoleGuard } from "../../../hooks/useRoleGuard";
import { useUserProfile } from "../../../context/UserProfileContext";
import {
  rpcSetModuleVisibility,
  rpcSetModuleHomeVisibility,
  rpcSetModulePublicVisibility,
  rpcGetAllUsersWithRoles,
  rpcSetUserRole,
} from "../../../lib/profileRpc";
import {
  rpcAdminListDefaultNewsKeywords,
  rpcAdminAddDefaultNewsKeyword,
  rpcAdminSetDefaultNewsKeywordMatchType,
  rpcAdminRemoveDefaultNewsKeyword,
  rpcGetFieldStakesOverview,
  rpcGetFieldStakes,
  rpcGetFieldStakesEmpresas,
  rpcAdminUpsertFieldStakes,
  rpcAdminDeleteFieldStakes,
  type DefaultNewsKeyword,
} from "../../../lib/rpc";
import type {
  FieldStakeOverview,
  FieldStakeEmpresa,
  FieldStakeInput,
} from "../../../types/fieldStakes";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import type { UserWithRole, UserProfile } from "../../../types/profile";
import { EDITABLE_TABLES } from "@/lib/dataInput/registry";
import {
  rpcAdminListSubscribers,
  rpcAdminForceUnsubscribe,
  rpcAdminRequeueOutbox,
  rpcAdminSendTestEvent,
  rpcAdminEmailLogRecent,
  rpcAdminSubscriberStats,
  rpcAdminToggleSourceActive,
  fetchAlertSources,
  fetchFailedOutboxRows,
  type AlertSubscriber,
  type AlertSubscriberStats,
  type AlertSource,
  type AlertEmailLogEntry,
  type AlertOutboxRow,
} from "../../../lib/alertsAdminRpc";

// Re-export Alerts types so both Views can import from a single location
export type {
  AlertSubscriber,
  AlertSubscriberStats,
  AlertSource,
  AlertEmailLogEntry,
  AlertOutboxRow,
};

// ── Section metadata ──────────────────────────────────────────────────────────

export type SectionId =
  | "members"
  | "permissions"
  | "alert-recipients"
  | "alerts-product"
  | "default-news"
  | "data-input"
  | "field-stakes";

export interface SectionMeta {
  id: SectionId;
  label: string;
  shortLabel: string;
  description: string;
}

export const SECTIONS: SectionMeta[] = [
  { id: "members",          label: "Members",               shortLabel: "Members",      description: "User roles & access" },
  { id: "permissions",      label: "Permissions",           shortLabel: "Access",       description: "Module visibility — Public, Clients, and Home" },
  { id: "alert-recipients", label: "Alert Emails",          shortLabel: "Alert Emails", description: "Notification recipients" },
  { id: "alerts-product",   label: "Alerts",                shortLabel: "Alerts",       description: "Alerts product management" },
  { id: "default-news",     label: "Default News Keywords", shortLabel: "News Defaults", description: "Keywords used by anonymous News Hunter visitors" },
  { id: "data-input",       label: "Data Input",            shortLabel: "Tables",       description: "Edit reference tables" },
  { id: "field-stakes",     label: "Field Stakes",          shortLabel: "Stakes",       description: "Working-interest per oil field (company × stake %)" },
];

// ── Module catalog ─────────────────────────────────────────────────────────────
// Each slug must match the corresponding entry in src/data/moduleIcons.tsx and have a
// matching row in the module_visibility DB. Both views render toggles from this list.

export interface ModuleLabel {
  slug: string;
  label: string;
  description: string;
}

export const MODULE_LABELS: ModuleLabel[] = [
  // Fuel Distribution
  { slug: "market-share",            label: "Market Share",                 description: "Market share evolution over time broken down by distributor" },
  { slug: "navios-diesel",           label: "Diesel Imports Line-Up",       description: "Scheduled vessel arrivals and diesel import line-up by port" },
  { slug: "diesel-gasoline-margins", label: "Diesel and Gasoline Margins",  description: "Diesel and gasoline margin tracking across regions and time" },
  { slug: "price-bands",             label: "Price Bands",                  description: "Price band distribution and competitive positioning by fuel type" },
  { slug: "subsidy-tracker",         label: "Subsidy Tracker",              description: "ANP diesel subsidy tracking vs IPP and Petrobras" },
  // Statistics
  { slug: "anp-prices",              label: "ANP Prices",                   description: "Producer, distribution and retail prices for fuels — Brazilian supply chain" },
  { slug: "anp-glp",                 label: "ANP LPG",                      description: "LPG production and distribution data from ANP" },
  { slug: "imports-exports",         label: "Imports & Exports",            description: "Brazil fuel imports and exports — origins, importers, and volumes" },
  { slug: "anp-cdp",                 label: "Production",                   description: "Monthly oil and gas production by well and field (ANP CDP)" },
  { slug: "anp-cdp-diaria",          label: "Daily Production",             description: "Daily oil and gas production by field from ANP Power BI" },
  { slug: "anp-cdp-bsw",             label: "BSW by Well",                  description: "Water cut vs months since first production, by well" },
  { slug: "anp-cdp-depletion",       label: "Depletion",                    description: "Uptime-normalized oil production and decline analysis by field" },
  // Other
  { slug: "stocks",                  label: "Market Watch",                 description: "Real-time stock quotes, historical charts, and market overview" },
  { slug: "news-hunter",             label: "News Hunter",                  description: "Live oil & gas news feed with incremental polling across ~60 sources" },
  // Tools
  { slug: "alerts",                  label: "Alerts",                       description: "Email notifications for new data publications — opt-in subscriber list" },
];

// ── Alert recipient row shape ──────────────────────────────────────────────────

export interface AlertRecipient {
  id: string;
  email: string;
  is_active: boolean;
  created_at: string;
  added_by: string | null;
}

// ── Hook return shape ──────────────────────────────────────────────────────────

export interface UseAdminPanelData {
  // Role guard
  allowed: boolean;
  roleLoading: boolean;

  // Current user profile (for "You" badge and self-demote confirm)
  myProfile: UserProfile | null;

  // Section state
  activeSection: SectionId;
  setActiveSection: (id: SectionId) => void;
  activeDataInputSlug: string;
  setActiveDataInputSlug: (slug: string) => void;

  // Module visibility (Client access toggle)
  localVis: Record<string, boolean>;
  saving: string | null;
  savedSlug: string | null;
  handleToggle: (slug: string, newValue: boolean) => Promise<void>;

  // Home visibility (Show-on-Home toggle)
  localHomeVis: Record<string, boolean>;
  savingHome: string | null;
  savedHomeSlug: string | null;
  homeToggleError: { slug: string; message: string } | null;
  handleHomeToggle: (slug: string, newValue: boolean) => Promise<void>;

  // Public visibility (anonymous-visitor access toggle).
  // DB-level invariant: public=true ⇒ clients=true. The handler enforces the
  // same coercion client-side so the Clients toggle visually flips on as soon
  // as Public is enabled, without waiting for the round-trip refresh.
  localPublicVis: Record<string, boolean>;
  savingPublic: string | null;
  savedPublicSlug: string | null;
  publicToggleError: { slug: string; message: string } | null;
  handlePublicToggle: (slug: string, newValue: boolean) => Promise<void>;

  // Users / roles
  users: UserWithRole[];
  usersLoading: boolean;
  localRoles: Record<string, string>;
  savingUser: string | null;
  savedUser: string | null;
  handleRoleChange: (userId: string, newRole: "Admin" | "Client") => Promise<void>;

  // Alert recipients
  recipients: AlertRecipient[];
  recipientsLoading: boolean;
  recipientsError: string | null;
  newEmail: string;
  setNewEmail: (v: string) => void;
  addingEmail: boolean;
  addEmailError: string | null;
  addEmailSuccess: boolean;
  togglingId: string | null;
  removingId: string | null;
  confirmRemoveId: string | null;
  setConfirmRemoveId: (id: string | null) => void;
  handleAddRecipient: () => Promise<void>;
  handleToggleRecipient: (id: string, currentActive: boolean) => Promise<void>;
  handleRemoveRecipient: (id: string) => Promise<void>;

  // Alerts product management (alerts-product section)
  alertsStats: AlertSubscriberStats | null;
  alertsStatsLoading: boolean;
  alertsSubscribers: AlertSubscriber[];
  alertsSubscribersLoading: boolean;
  alertsSubscriberSourceFilter: string;
  setAlertsSubscriberSourceFilter: (v: string) => void;
  alertsSources: AlertSource[];
  alertsSourcesLoading: boolean;
  alertsEmailLog: AlertEmailLogEntry[];
  alertsEmailLogLoading: boolean;
  alertsEmailLogStatusFilter: string;
  setAlertsEmailLogStatusFilter: (v: string) => void;
  alertsOutbox: AlertOutboxRow[];
  alertsOutboxLoading: boolean;
  requeueingOutboxId: string | null;
  sendingTestSlug: string | null;
  togglingSourceSlug: string | null;
  unsubscribingId: string | null;
  handleAlertsForceUnsubscribe: (id: string) => Promise<void>;
  handleAlertsRequeueOutbox: (id: string) => Promise<void>;
  handleAlertsSendTestEvent: (sourceSlug: string) => Promise<void>;
  handleAlertsToggleSource: (sourceSlug: string, isActive: boolean) => Promise<void>;

  // Default News Keywords
  defaultKeywords: DefaultNewsKeyword[];
  defaultKeywordsLoading: boolean;
  defaultKeywordsError: string | null;
  newKeyword: string;
  setNewKeyword: (v: string) => void;
  newKeywordMatchType: "substring" | "exact";
  setNewKeywordMatchType: (v: "substring" | "exact") => void;
  addingKeyword: boolean;
  addKeywordError: string | null;
  addKeywordSuccess: boolean;
  removingKeyword: string | null;
  confirmRemoveKeyword: string | null;
  setConfirmRemoveKeyword: (kw: string | null) => void;
  togglingMatchType: Set<string>;
  handleAddKeyword: () => Promise<void>;
  handleRemoveKeyword: (keyword: string) => Promise<void>;
  handleToggleMatchType: (keyword: string, currentMatchType: "substring" | "exact") => Promise<void>;

  // Field Stakes
  fieldStakesOverview: FieldStakeOverview[];
  fieldStakesEmpresas: FieldStakeEmpresa[];
  fieldStakesLoading: boolean;
  selectedCampo: string | null;
  editorStakes: FieldStakeInput[];
  editorLoading: boolean;
  newEmpresaInput: string;
  setNewEmpresaInput: (v: string) => void;
  newEmpresaPctInput: string;
  setNewEmpresaPctInput: (v: string) => void;
  savingStakes: boolean;
  deleteCampoConfirm: string | null;
  stakesError: string | null;
  stakesSearchQuery: string;
  setStakesSearchQuery: (v: string) => void;
  stakesStatusFilter: "all" | "complete" | "incomplete" | "empty";
  setStakesStatusFilter: (v: "all" | "complete" | "incomplete" | "empty") => void;
  /** Sum of stake_pct across editorStakes — refreshed on every edit. */
  currentSum: number;
  /** True when |currentSum - 100| < 0.001. */
  isValidSum: boolean;
  /** True when editorStakes differs from the last server snapshot. */
  pendingChanges: boolean;
  /** Overview filtered by stakesSearchQuery + stakesStatusFilter. */
  filteredOverview: FieldStakeOverview[];
  /** Last_updated timestamp of the currently selected campo (or null). */
  selectedCampoLastUpdated: string | null;
  handleSelectCampo: (campo: string) => Promise<void>;
  handleAddEmpresaRow: () => void;
  handleRemoveEmpresaRow: (idx: number) => void;
  handleChangeStake: (
    idx: number,
    field: "empresa" | "stake_pct",
    value: string,
  ) => void;
  handleSaveStakes: () => Promise<void>;
  handleDeleteCampo: (campo: string) => void;
  handleConfirmDeleteCampo: () => Promise<void>;
  handleCancelDeleteCampo: () => void;

  // Pure helpers (re-exported for both views)
  isValidEmail: (email: string) => boolean;
  formatDateBR: (dateStr: string) => string;
}

// ── Helpers (pure) ─────────────────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function formatDateBR(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAdminPanelData(): UseAdminPanelData {
  const { allowed, loading: roleLoading } = useRoleGuard("Admin");
  const {
    moduleVisibility,
    homeVisibility,
    publicVisibility,
    refreshVisibility,
    profile: myProfile,
  } = useUserProfile();
  const supabase = getSupabaseClient();

  // ── Section state ──────────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<SectionId>("members");
  const [activeDataInputSlug, setActiveDataInputSlug] = useState<string>(
    EDITABLE_TABLES[0]?.slug ?? "",
  );

  // ── Visibility state (all three axes declared together so handlers below
  //    can reference any of them without forward-reference issues) ─────────────

  // Client access (is_visible_for_clients)
  const [localVis, setLocalVis] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);

  // Home gallery card (is_visible_on_home)
  const [localHomeVis, setLocalHomeVis] = useState<Record<string, boolean>>({});
  const [savingHome, setSavingHome] = useState<string | null>(null);
  const [savedHomeSlug, setSavedHomeSlug] = useState<string | null>(null);
  const [homeToggleError, setHomeToggleError] = useState<{ slug: string; message: string } | null>(null);

  // Anonymous-visitor access (is_visible_for_public)
  // Source of truth is `publicVisibility` on UserProfileContext (Phase B), which
  // is loaded once per page alongside moduleVisibility/homeVisibility from a
  // single rpcGetModuleVisibility call. We mirror it locally only to support
  // optimistic updates — same pattern as `localVis` and `localHomeVis` above.
  // After a mutation, `refreshVisibility()` re-fetches the shared map; the
  // useEffect below re-seeds the local mirror from the refreshed context value.
  const [localPublicVis, setLocalPublicVis] = useState<Record<string, boolean>>({});
  const [savingPublic, setSavingPublic] = useState<string | null>(null);
  const [savedPublicSlug, setSavedPublicSlug] = useState<string | null>(null);
  const [publicToggleError, setPublicToggleError] = useState<{ slug: string; message: string } | null>(null);

  // Seed all three local mirrors whenever context visibility maps refresh
  useEffect(() => {
    setLocalVis({ ...moduleVisibility });
  }, [moduleVisibility]);

  useEffect(() => {
    setLocalHomeVis({ ...homeVisibility });
  }, [homeVisibility]);

  useEffect(() => {
    setLocalPublicVis({ ...publicVisibility });
  }, [publicVisibility]);

  // ── Visibility handlers ────────────────────────────────────────────────────

  const handleToggle = useCallback(
    async (slug: string, newValue: boolean) => {
      if (!supabase || saving) return;
      setLocalVis((prev) => ({ ...prev, [slug]: newValue }));
      // Home-invariant coercion: if both Public and Clients become false,
      // the DB trigger will force is_visible_on_home=false. Mirror that
      // optimistically so the Home toggle goes grey immediately.
      if (!newValue) {
        const isPublic = localPublicVis[slug] ?? true;
        if (!isPublic) {
          setLocalHomeVis((prev) => ({ ...prev, [slug]: false }));
        }
      }
      setSaving(slug);
      await rpcSetModuleVisibility(supabase, slug, newValue);
      await refreshVisibility();
      setSaving(null);
      setSavedSlug(slug);
      setTimeout(() => setSavedSlug((s) => (s === slug ? null : s)), 1500);
    },
    [supabase, saving, localPublicVis, refreshVisibility],
  );

  const handleHomeToggle = useCallback(
    async (slug: string, newValue: boolean) => {
      if (!supabase || savingHome) return;
      const prevValue = localHomeVis[slug] ?? true;
      // Optimistic update
      setLocalHomeVis((prev) => ({ ...prev, [slug]: newValue }));
      setSavingHome(slug);
      setHomeToggleError(null);
      const result = await rpcSetModuleHomeVisibility(supabase, slug, newValue);
      if (!result) {
        // Rollback on error
        setLocalHomeVis((prev) => ({ ...prev, [slug]: prevValue }));
        setHomeToggleError({ slug, message: "Failed to save. Please try again." });
        setTimeout(() => setHomeToggleError((e) => (e?.slug === slug ? null : e)), 4000);
      } else {
        await refreshVisibility();
        setSavedHomeSlug(slug);
        setTimeout(() => setSavedHomeSlug((s) => (s === slug ? null : s)), 1500);
      }
      setSavingHome(null);
    },
    [supabase, savingHome, localHomeVis, refreshVisibility],
  );

  // ── Public Visibility handler ──────────────────────────────────────────────

  const handlePublicToggle = useCallback(
    async (slug: string, newValue: boolean) => {
      if (!supabase || savingPublic) return;
      const prevPublic = localPublicVis[slug] ?? true;
      const prevClient = localVis[slug] ?? true;

      // Optimistic update — also flip Clients on when Public is turned on,
      // because the DB trigger enforces the invariant (public=true ⇒
      // clients=true). Reflecting this in the UI before the round-trip avoids
      // a confusing "Public on, Clients off" intermediate state.
      setLocalPublicVis((prev) => ({ ...prev, [slug]: newValue }));
      if (newValue && !prevClient) {
        setLocalVis((prev) => ({ ...prev, [slug]: true }));
      }
      // Home-invariant coercion: if Public goes false and Clients was already
      // false, both visibility flags become false — the DB trigger will force
      // is_visible_on_home=false. Mirror that optimistically.
      if (!newValue && !prevClient) {
        setLocalHomeVis((prev) => ({ ...prev, [slug]: false }));
      }
      setSavingPublic(slug);
      setPublicToggleError(null);

      const result = await rpcSetModulePublicVisibility(supabase, slug, newValue);
      if (!result) {
        // Rollback both toggles on error.
        setLocalPublicVis((prev) => ({ ...prev, [slug]: prevPublic }));
        if (newValue && !prevClient) {
          setLocalVis((prev) => ({ ...prev, [slug]: prevClient }));
        }
        setPublicToggleError({ slug, message: "Failed to save. Please try again." });
        setTimeout(() => setPublicToggleError((e) => (e?.slug === slug ? null : e)), 4000);
      } else {
        // If Public was turned on while Clients was off, the DB trigger has
        // already coerced is_visible_for_clients=TRUE — sync it explicitly so
        // the global UserProfileContext map (used by NavBar / guards) updates
        // too. Without this call, NavBar would only see the change after the
        // user reloads the page.
        if (newValue && !prevClient) {
          await rpcSetModuleVisibility(supabase, slug, true);
        }
        // Single refresh repopulates moduleVisibility, homeVisibility AND
        // publicVisibility in the context (one rpcGetModuleVisibility call
        // hydrates all three maps). The useEffect above syncs localPublicVis
        // from the updated context value.
        await refreshVisibility();
        setSavedPublicSlug(slug);
        setTimeout(() => setSavedPublicSlug((s) => (s === slug ? null : s)), 1500);
      }
      setSavingPublic(null);
    },
    [supabase, savingPublic, localPublicVis, localVis, localHomeVis, refreshVisibility],
  );

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

  useEffect(() => {
    if (allowed) loadUsers();
  }, [allowed, loadUsers]);

  const handleRoleChange = useCallback(
    async (userId: string, newRole: "Admin" | "Client") => {
      if (!supabase || savingUser) return;
      if (userId === myProfile?.id && newRole !== "Admin") {
        if (
          !confirm(
            "Are you sure you want to remove your own Admin role? You will lose access to this page.",
          )
        )
          return;
      }
      setLocalRoles((prev) => ({ ...prev, [userId]: newRole }));
      setSavingUser(userId);
      const ok = await rpcSetUserRole(supabase, userId, newRole);
      if (!ok)
        setLocalRoles((prev) => ({
          ...prev,
          [userId]: users.find((u) => u.id === userId)?.role ?? "Client",
        }));
      setSavingUser(null);
      setSavedUser(userId);
      setTimeout(() => setSavedUser((s) => (s === userId ? null : s)), 1500);
    },
    [supabase, savingUser, myProfile?.id, users],
  );

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

  const loadRecipients = useCallback(async () => {
    if (!supabase) return;
    setRecipientsLoading(true);
    setRecipientsError(null);
    const { data, error } = await supabase
      .from("alert_recipients")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setRecipientsError("Could not load recipients. Please try again.");
    else setRecipients((data as AlertRecipient[]) ?? []);
    setRecipientsLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (allowed && activeSection === "alert-recipients") loadRecipients();
  }, [allowed, activeSection, loadRecipients]);

  const handleAddRecipient = useCallback(async () => {
    if (!supabase || addingEmail || !isValidEmail(newEmail)) return;
    setAddingEmail(true);
    setAddEmailError(null);
    const { error } = await supabase.from("alert_recipients").insert({
      email: newEmail.trim().toLowerCase(),
      is_active: true,
      added_by: myProfile?.id ?? null,
    });
    if (error) {
      // Generic message — do NOT differentiate 23505 (email-enumeration fix F2.3)
      setAddEmailError("Could not add recipient. Please verify the email and try again.");
    } else {
      setNewEmail("");
      setAddEmailSuccess(true);
      setTimeout(() => setAddEmailSuccess(false), 2000);
      await loadRecipients();
    }
    setAddingEmail(false);
  }, [supabase, addingEmail, newEmail, myProfile?.id, loadRecipients]);

  const handleToggleRecipient = useCallback(
    async (id: string, currentActive: boolean) => {
      if (!supabase || togglingId) return;
      setTogglingId(id);
      await supabase.from("alert_recipients").update({ is_active: !currentActive }).eq("id", id);
      await loadRecipients();
      setTogglingId(null);
    },
    [supabase, togglingId, loadRecipients],
  );

  const handleRemoveRecipient = useCallback(
    async (id: string) => {
      if (!supabase || removingId) return;
      setRemovingId(id);
      await supabase.from("alert_recipients").delete().eq("id", id);
      setConfirmRemoveId(null);
      await loadRecipients();
      setRemovingId(null);
    },
    [supabase, removingId, loadRecipients],
  );

  // ── Alerts Product Management ──────────────────────────────────────────────
  const [alertsStats, setAlertsStats] = useState<AlertSubscriberStats | null>(null);
  const [alertsStatsLoading, setAlertsStatsLoading] = useState(false);
  const [alertsSubscribers, setAlertsSubscribers] = useState<AlertSubscriber[]>([]);
  const [alertsSubscribersLoading, setAlertsSubscribersLoading] = useState(false);
  const [alertsSubscriberSourceFilter, setAlertsSubscriberSourceFilter] = useState("");
  const [alertsSources, setAlertsSources] = useState<AlertSource[]>([]);
  const [alertsSourcesLoading, setAlertsSourcesLoading] = useState(false);
  const [alertsEmailLog, setAlertsEmailLog] = useState<AlertEmailLogEntry[]>([]);
  const [alertsEmailLogLoading, setAlertsEmailLogLoading] = useState(false);
  const [alertsEmailLogStatusFilter, setAlertsEmailLogStatusFilter] = useState("");
  const [alertsOutbox, setAlertsOutbox] = useState<AlertOutboxRow[]>([]);
  const [alertsOutboxLoading, setAlertsOutboxLoading] = useState(false);
  const [requeueingOutboxId, setRequeuingOutboxId] = useState<string | null>(null);
  const [sendingTestSlug, setSendingTestSlug] = useState<string | null>(null);
  const [togglingSourceSlug, setTogglingSourceSlug] = useState<string | null>(null);
  const [unsubscribingId, setUnsubscribingId] = useState<string | null>(null);

  const loadAlertsData = useCallback(async () => {
    if (!supabase) return;
    // Load all 5 sub-sections in parallel
    setAlertsStatsLoading(true);
    setAlertsSubscribersLoading(true);
    setAlertsSourcesLoading(true);
    setAlertsEmailLogLoading(true);
    setAlertsOutboxLoading(true);
    const [stats, subs, sources, log, outbox] = await Promise.all([
      rpcAdminSubscriberStats(),
      rpcAdminListSubscribers(),
      fetchAlertSources(),
      rpcAdminEmailLogRecent(200),
      fetchFailedOutboxRows(),
    ]);
    setAlertsStats(stats);
    setAlertsStatsLoading(false);
    setAlertsSubscribers(subs);
    setAlertsSubscribersLoading(false);
    setAlertsSources(sources);
    setAlertsSourcesLoading(false);
    setAlertsEmailLog(log);
    setAlertsEmailLogLoading(false);
    setAlertsOutbox(outbox);
    setAlertsOutboxLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (allowed && activeSection === "alerts-product") loadAlertsData();
  }, [allowed, activeSection, loadAlertsData]);

  const handleAlertsForceUnsubscribe = useCallback(
    async (id: string) => {
      if (unsubscribingId) return;
      setUnsubscribingId(id);
      await rpcAdminForceUnsubscribe(id);
      setUnsubscribingId(null);
      // Refresh subscribers and stats
      const [subs, stats] = await Promise.all([
        rpcAdminListSubscribers(alertsSubscriberSourceFilter || undefined),
        rpcAdminSubscriberStats(),
      ]);
      setAlertsSubscribers(subs);
      setAlertsStats(stats);
    },
    [unsubscribingId, alertsSubscriberSourceFilter],
  );

  const handleAlertsRequeueOutbox = useCallback(
    async (id: string) => {
      if (requeueingOutboxId) return;
      setRequeuingOutboxId(id);
      await rpcAdminRequeueOutbox(id);
      setRequeuingOutboxId(null);
      // Refresh outbox list
      const outbox = await fetchFailedOutboxRows();
      setAlertsOutbox(outbox);
    },
    [requeueingOutboxId],
  );

  const handleAlertsSendTestEvent = useCallback(
    async (sourceSlug: string) => {
      if (sendingTestSlug) return;
      setSendingTestSlug(sourceSlug);
      await rpcAdminSendTestEvent(sourceSlug);
      setSendingTestSlug(null);
    },
    [sendingTestSlug],
  );

  const handleAlertsToggleSource = useCallback(
    async (sourceSlug: string, isActive: boolean) => {
      if (togglingSourceSlug) return;
      setTogglingSourceSlug(sourceSlug);
      // Optimistic update
      setAlertsSources((prev) =>
        prev.map((s) =>
          s.source_slug === sourceSlug ? { ...s, is_active: isActive } : s,
        ),
      );
      const ok = await rpcAdminToggleSourceActive(sourceSlug, isActive);
      if (!ok) {
        // Rollback on failure
        setAlertsSources((prev) =>
          prev.map((s) =>
            s.source_slug === sourceSlug ? { ...s, is_active: !isActive } : s,
          ),
        );
      }
      setTogglingSourceSlug(null);
    },
    [togglingSourceSlug],
  );

  // ── Default News Keywords ──────────────────────────────────────────────────
  const [defaultKeywords, setDefaultKeywords] = useState<DefaultNewsKeyword[]>([]);
  const [defaultKeywordsLoading, setDefaultKeywordsLoading] = useState(false);
  const [defaultKeywordsError, setDefaultKeywordsError] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState("");
  const [newKeywordMatchType, setNewKeywordMatchType] = useState<"substring" | "exact">("substring");
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [addKeywordError, setAddKeywordError] = useState<string | null>(null);
  const [addKeywordSuccess, setAddKeywordSuccess] = useState(false);
  const [removingKeyword, setRemovingKeyword] = useState<string | null>(null);
  const [confirmRemoveKeyword, setConfirmRemoveKeyword] = useState<string | null>(null);
  const [togglingMatchType, setTogglingMatchType] = useState<Set<string>>(new Set());

  const loadDefaultKeywords = useCallback(async () => {
    if (!supabase) return;
    setDefaultKeywordsLoading(true);
    setDefaultKeywordsError(null);
    try {
      const data = await rpcAdminListDefaultNewsKeywords(supabase);
      setDefaultKeywords(data);
    } catch {
      setDefaultKeywordsError(
        "Could not load default News Hunter keywords. Try refreshing the page.",
      );
    }
    setDefaultKeywordsLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (allowed && activeSection === "default-news") loadDefaultKeywords();
  }, [allowed, activeSection, loadDefaultKeywords]);

  const handleAddKeyword = useCallback(async () => {
    const trimmed = newKeyword.trim();
    if (!supabase || addingKeyword || !trimmed) return;

    // Client-side duplicate check (warn-only; RPC is idempotent)
    if (defaultKeywords.some((k) => k.keyword.toLowerCase() === trimmed.toLowerCase())) {
      setAddKeywordError(`"${trimmed}" is already in the default keyword list.`);
      setTimeout(() => setAddKeywordError(null), 4000);
      return;
    }

    setAddingKeyword(true);
    setAddKeywordError(null);
    const ok = await rpcAdminAddDefaultNewsKeyword(supabase, trimmed, newKeywordMatchType);
    if (!ok) {
      setAddKeywordError("Could not add keyword. Please try again.");
      setTimeout(() => setAddKeywordError(null), 4000);
    } else {
      setNewKeyword("");
      setNewKeywordMatchType("substring");
      setAddKeywordSuccess(true);
      setTimeout(() => setAddKeywordSuccess(false), 2000);
      await loadDefaultKeywords();
    }
    setAddingKeyword(false);
  }, [supabase, addingKeyword, newKeyword, newKeywordMatchType, defaultKeywords, loadDefaultKeywords]);

  const handleRemoveKeyword = useCallback(
    async (keyword: string) => {
      if (!supabase || removingKeyword) return;
      setRemovingKeyword(keyword);
      const ok = await rpcAdminRemoveDefaultNewsKeyword(supabase, keyword);
      if (!ok) {
        setDefaultKeywordsError("Could not remove keyword. Please try again.");
        setTimeout(() => setDefaultKeywordsError(null), 4000);
      } else {
        setConfirmRemoveKeyword(null);
        await loadDefaultKeywords();
      }
      setRemovingKeyword(null);
    },
    [supabase, removingKeyword, loadDefaultKeywords],
  );

  const handleToggleMatchType = useCallback(
    async (keyword: string, currentMatchType: "substring" | "exact") => {
      if (!supabase || togglingMatchType.has(keyword)) return;
      const newType = currentMatchType === "exact" ? "substring" : "exact";
      setTogglingMatchType((prev) => new Set(prev).add(keyword));
      const ok = await rpcAdminSetDefaultNewsKeywordMatchType(supabase, keyword, newType);
      if (ok) {
        setDefaultKeywords((prev) =>
          prev.map((k) => (k.keyword === keyword ? { ...k, match_type: newType } : k)),
        );
      } else {
        setDefaultKeywordsError("Could not update match type. Please try again.");
        setTimeout(() => setDefaultKeywordsError(null), 4000);
      }
      setTogglingMatchType((prev) => {
        const next = new Set(prev);
        next.delete(keyword);
        return next;
      });
    },
    [supabase, togglingMatchType],
  );

  // ── Field Stakes ───────────────────────────────────────────────────────────
  const [fieldStakesOverview, setFieldStakesOverview] = useState<FieldStakeOverview[]>([]);
  const [fieldStakesEmpresas, setFieldStakesEmpresas] = useState<FieldStakeEmpresa[]>([]);
  const [fieldStakesLoading, setFieldStakesLoading] = useState(false);
  const [selectedCampo, setSelectedCampo] = useState<string | null>(null);
  const [editorStakes, setEditorStakes] = useState<FieldStakeInput[]>([]);
  const [editorLoading, setEditorLoading] = useState(false);
  const [newEmpresaInput, setNewEmpresaInput] = useState("");
  const [newEmpresaPctInput, setNewEmpresaPctInput] = useState("");
  const [savingStakes, setSavingStakes] = useState(false);
  const [deleteCampoConfirm, setDeleteCampoConfirm] = useState<string | null>(null);
  const [stakesError, setStakesError] = useState<string | null>(null);
  const [stakesSearchQuery, setStakesSearchQuery] = useState("");
  const [stakesStatusFilter, setStakesStatusFilter] = useState<
    "all" | "complete" | "incomplete" | "empty"
  >("all");
  const [selectedCampoLastUpdated, setSelectedCampoLastUpdated] = useState<string | null>(null);

  // Last-saved JSON snapshot for change-detection. A ref (not state) because
  // changing it should NOT trigger a re-render — it's compared inside the
  // pendingChanges useMemo below.
  const editorSavedSnapshotRef = useRef<string>("[]");

  const loadFieldStakesOverview = useCallback(async () => {
    if (!supabase) return;
    setFieldStakesLoading(true);
    try {
      const [overview, empresas] = await Promise.all([
        rpcGetFieldStakesOverview(supabase),
        rpcGetFieldStakesEmpresas(supabase),
      ]);
      setFieldStakesOverview(overview);
      setFieldStakesEmpresas(empresas);
    } catch (e) {
      console.error("Failed to load field stakes overview", e);
      setStakesError("Could not load field stakes. Please try again.");
      setTimeout(() => setStakesError((err) => (err?.startsWith("Could not load") ? null : err)), 4000);
    }
    setFieldStakesLoading(false);
  }, [supabase]);

  // Lazy-load: only fetch when the section becomes active for the first time.
  useEffect(() => {
    if (allowed && activeSection === "field-stakes") loadFieldStakesOverview();
  }, [allowed, activeSection, loadFieldStakesOverview]);

  const handleSelectCampo = useCallback(
    async (campo: string) => {
      if (!supabase) return;
      setSelectedCampo(campo);
      setStakesError(null);
      setNewEmpresaInput("");
      setNewEmpresaPctInput("");
      setEditorLoading(true);
      try {
        const rows = await rpcGetFieldStakes(supabase, campo);
        const editorRows: FieldStakeInput[] = rows.map((r) => ({
          empresa: r.empresa,
          stake_pct: r.stake_pct,
        }));
        setEditorStakes(editorRows);
        editorSavedSnapshotRef.current = JSON.stringify(editorRows);
        // last_updated comes from the overview row (computed as MAX(updated_at))
        const overviewRow = fieldStakesOverview.find((o) => o.campo === campo);
        setSelectedCampoLastUpdated(overviewRow?.last_updated ?? null);
      } catch (e) {
        console.error("Failed to load field stakes", e);
        setStakesError("Could not load stakes for this field. Please try again.");
        setEditorStakes([]);
        editorSavedSnapshotRef.current = "[]";
        setSelectedCampoLastUpdated(null);
      }
      setEditorLoading(false);
    },
    [supabase, fieldStakesOverview],
  );

  const handleAddEmpresaRow = useCallback(() => {
    const empresa = newEmpresaInput.trim();
    const pct = Number(newEmpresaPctInput);
    if (!empresa) {
      setStakesError("Company name is required.");
      setTimeout(() => setStakesError((e) => (e === "Company name is required." ? null : e)), 3000);
      return;
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setStakesError("Stake % must be a number between 0 and 100.");
      setTimeout(
        () => setStakesError((e) => (e === "Stake % must be a number between 0 and 100." ? null : e)),
        3000,
      );
      return;
    }
    setEditorStakes((prev) => [...prev, { empresa, stake_pct: pct }]);
    setNewEmpresaInput("");
    setNewEmpresaPctInput("");
    setStakesError(null);
  }, [newEmpresaInput, newEmpresaPctInput]);

  const handleRemoveEmpresaRow = useCallback((idx: number) => {
    setEditorStakes((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleChangeStake = useCallback(
    (idx: number, field: "empresa" | "stake_pct", value: string) => {
      setEditorStakes((prev) =>
        prev.map((row, i) => {
          if (i !== idx) return row;
          if (field === "empresa") return { ...row, empresa: value };
          // stake_pct: keep as Number (NaN allowed temporarily mid-typing)
          const parsed = value === "" ? 0 : Number(value);
          return { ...row, stake_pct: Number.isFinite(parsed) ? parsed : 0 };
        }),
      );
    },
    [],
  );

  const handleSaveStakes = useCallback(async () => {
    if (!supabase || !selectedCampo || savingStakes) return;
    setSavingStakes(true);
    setStakesError(null);
    try {
      // Normalize: trim empresa, coerce stake_pct to Number. Drop rows with
      // empty empresa (defensive — the UI also blocks adding them).
      const payload: FieldStakeInput[] = editorStakes
        .map((s) => ({ empresa: s.empresa.trim(), stake_pct: Number(s.stake_pct) || 0 }))
        .filter((s) => s.empresa.length > 0);
      await rpcAdminUpsertFieldStakes(supabase, selectedCampo, payload);
      editorSavedSnapshotRef.current = JSON.stringify(payload);
      setEditorStakes(payload);
      await loadFieldStakesOverview();
      // Refresh last_updated from the new overview snapshot
      // (loadFieldStakesOverview will set fieldStakesOverview; pick the row).
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message ?? "Save failed.")
          : "Save failed.";
      setStakesError(msg);
    }
    setSavingStakes(false);
  }, [supabase, selectedCampo, savingStakes, editorStakes, loadFieldStakesOverview]);

  // Refresh selectedCampoLastUpdated whenever the overview refreshes after a save
  useEffect(() => {
    if (!selectedCampo) return;
    const row = fieldStakesOverview.find((o) => o.campo === selectedCampo);
    if (row) setSelectedCampoLastUpdated(row.last_updated);
  }, [fieldStakesOverview, selectedCampo]);

  const handleDeleteCampo = useCallback((campo: string) => {
    setDeleteCampoConfirm(campo);
  }, []);

  const handleConfirmDeleteCampo = useCallback(async () => {
    if (!supabase || !deleteCampoConfirm) return;
    const campo = deleteCampoConfirm;
    setSavingStakes(true);
    setStakesError(null);
    try {
      await rpcAdminDeleteFieldStakes(supabase, campo);
      await loadFieldStakesOverview();
      if (selectedCampo === campo) {
        setSelectedCampo(null);
        setEditorStakes([]);
        editorSavedSnapshotRef.current = "[]";
        setSelectedCampoLastUpdated(null);
      }
      setDeleteCampoConfirm(null);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message ?? "Delete failed.")
          : "Delete failed.";
      setStakesError(msg);
    }
    setSavingStakes(false);
  }, [supabase, deleteCampoConfirm, selectedCampo, loadFieldStakesOverview]);

  const handleCancelDeleteCampo = useCallback(() => {
    setDeleteCampoConfirm(null);
  }, []);

  // Derived values
  const currentSum = useMemo(
    () => editorStakes.reduce((acc, s) => acc + (Number(s.stake_pct) || 0), 0),
    [editorStakes],
  );

  const isValidSum = useMemo(
    () => Math.abs(currentSum - 100) < 0.001,
    [currentSum],
  );

  const pendingChanges = useMemo(() => {
    // Compare current editor state against the last server-saved snapshot.
    // JSON.stringify is stable here because we always set state through the
    // same shape (no key reordering).
    return JSON.stringify(editorStakes) !== editorSavedSnapshotRef.current;
  }, [editorStakes]);

  const filteredOverview = useMemo(() => {
    const q = stakesSearchQuery.trim().toLowerCase();
    return fieldStakesOverview.filter((row) => {
      if (q && !row.campo.toLowerCase().includes(q)) return false;
      switch (stakesStatusFilter) {
        case "complete":
          return row.is_complete;
        case "incomplete":
          return !row.is_complete && row.n_empresas > 0;
        case "empty":
          return row.n_empresas === 0;
        default:
          return true;
      }
    });
  }, [fieldStakesOverview, stakesSearchQuery, stakesStatusFilter]);

  return {
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
    filteredOverview,
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
  };
}
