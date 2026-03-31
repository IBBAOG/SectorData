"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  rpcGetModuleVisibility,
  rpcGetMyProfile,
} from "../lib/profileRpc";
import type { UserProfile, UserProfileContextValue } from "../types/profile";

/* ── Context ─────────────────────────────────────────────────────────────────── */

const UserProfileContext = createContext<UserProfileContextValue>({
  profile: null,
  moduleVisibility: {},
  loading: true,
  refreshVisibility: async () => {},
  refreshProfile: async () => {},
});

/* ── Provider ────────────────────────────────────────────────────────────────── */

/**
 * Wrap the dashboard children with this provider after the auth check passes.
 * It fetches the user profile and module visibility in a single Promise.all,
 * then exposes both via context to all child components.
 *
 * `supabase` is passed as a prop (not created internally) so the singleton
 * from getSupabaseClient() is reused — no extra Supabase client instances.
 */
export function UserProfileProvider({
  supabase,
  children,
}: {
  supabase: SupabaseClient;
  children: React.ReactNode;
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [moduleVisibility, setModuleVisibility] = useState<
    Record<string, boolean>
  >({});
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    const profileData = await rpcGetMyProfile(supabase);
    setProfile(profileData ?? null);
  }, [supabase]);

  // Convert the ModuleConfig array into a flat slug→boolean map
  const loadVisibility = useCallback(async () => {
    const rows = await rpcGetModuleVisibility(supabase);
    const map: Record<string, boolean> = {};
    for (const row of rows) {
      map[row.module_slug] = row.is_visible_for_clients;
    }
    setModuleVisibility(map);
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([loadProfile(), loadVisibility()]).then(() => {
      if (cancelled) return;
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [loadProfile, loadVisibility]);

  return (
    <UserProfileContext.Provider
      value={{
        profile,
        moduleVisibility,
        loading,
        refreshVisibility: loadVisibility,
        refreshProfile: loadProfile,
      }}
    >
      {children}
    </UserProfileContext.Provider>
  );
}

/* ── Consumer hook ───────────────────────────────────────────────────────────── */

/**
 * Returns the current user's profile and module visibility state.
 * Must be used inside a component that is a descendant of UserProfileProvider.
 */
export function useUserProfile(): UserProfileContextValue {
  return useContext(UserProfileContext);
}
