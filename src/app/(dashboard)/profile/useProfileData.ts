"use client";

// Brain hook for /profile (dual-view pattern).
//
// Owns:
//   - profile data sourced from UserProfileContext (read-only mirror)
//   - authenticated user's email (resolved from supabase.auth.getSession)
//   - inline-edit state for the user's full name (editing flag, draft value,
//     saving flag, save error flag)
//   - the save handler that upserts the new name via rpcUpsertMyProfile and
//     then refreshes the profile in context so NavBar/avatar update
//
// Views NEVER call Supabase directly — they read this hook. Both desktop/View
// and mobile/View consume exactly this contract.

import { useCallback, useEffect, useMemo, useState } from "react";

import { useUserProfile } from "../../../context/UserProfileContext";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { getInitials, formatMemberSince } from "../../../lib/avatarUtils";
import { rpcUpsertMyProfile } from "../../../lib/profileRpc";
import type { UserProfile } from "../../../types/profile";

// ---- Types ------------------------------------------------------------------

export interface UseProfileData {
  /** Profile row from UserProfileContext (null until loaded). */
  profile: UserProfile | null;
  /** Authenticated user's email (null until session resolves). */
  email: string | null;
  /** True while profile context is still loading. */
  loading: boolean;
  /** True when role === "Admin". */
  isAdmin: boolean;

  /** Display string preferring full_name → email → "User". */
  displayName: string;
  /** Two-letter uppercase initials for the avatar bubble. */
  initials: string;
  /** Human-readable "Month YYYY" of profile.created_at, or "—". */
  memberSince: string;

  // Inline name-edit state ----------------------------------------------------
  /** True when the user has tapped the pencil to edit the name. */
  editing: boolean;
  /** Current draft text in the name input. */
  editName: string;
  /** True while the RPC upsert is in-flight. */
  saving: boolean;
  /** True when the most-recent save attempt failed. */
  saveError: boolean;
  /** Open the editor (seeds the draft from current full_name). */
  startEdit: () => void;
  /** Close the editor without saving. */
  cancelEdit: () => void;
  /** Controlled-input setter; also clears the saveError flag. */
  setEditName: (next: string) => void;
  /** True when the Save button should be enabled. */
  canSave: boolean;
  /** Persist the trimmed draft via rpcUpsertMyProfile and refresh context. */
  saveName: () => Promise<void>;
}

// ---- Hook -------------------------------------------------------------------

export function useProfileData(): UseProfileData {
  const { profile, loading, refreshProfile } = useUserProfile();
  const supabase = getSupabaseClient();

  // Resolve email from session (not in UserProfileContext).
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null);
    });
  }, [supabase]);

  // Inline name-edit state.
  const [editing, setEditing] = useState<boolean>(false);
  const [editName, setEditNameState] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<boolean>(false);

  const setEditName = useCallback((next: string) => {
    setEditNameState(next);
    setSaveError(false);
  }, []);

  const startEdit = useCallback(() => {
    setEditNameState(profile?.full_name ?? "");
    setSaveError(false);
    setEditing(true);
  }, [profile?.full_name]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setSaveError(false);
  }, []);

  const saveName = useCallback(async (): Promise<void> => {
    const trimmed = editName.trim();
    if (!trimmed || !supabase) return;
    setSaving(true);
    setSaveError(false);
    const result = await rpcUpsertMyProfile(
      supabase,
      trimmed,
      profile?.avatar_url ?? null,
    );
    setSaving(false);
    if (!result) {
      setSaveError(true);
      return;
    }
    await refreshProfile();
    setEditing(false);
  }, [editName, supabase, profile?.avatar_url, refreshProfile]);

  // Derived helpers used by both Views ----------------------------------------
  const initials = useMemo(() => getInitials(profile, email), [profile, email]);
  const displayName = useMemo(
    () => profile?.full_name ?? email ?? "User",
    [profile?.full_name, email],
  );
  const isAdmin = profile?.role === "Admin";
  const memberSince = useMemo(
    () => (profile?.created_at ? formatMemberSince(profile.created_at) : "—"),
    [profile?.created_at],
  );
  const canSave = !saving && editName.trim().length >= 2;

  return {
    profile,
    email,
    loading,
    isAdmin,
    displayName,
    initials,
    memberSince,
    editing,
    editName,
    saving,
    saveError,
    startEdit,
    cancelEdit,
    setEditName,
    canSave,
    saveName,
  };
}
