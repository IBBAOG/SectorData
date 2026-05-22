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
import type {
  Role,
  UserProfile,
  UserProfileContextValue,
} from "../types/profile";

/* ── Context ─────────────────────────────────────────────────────────────────── */

const UserProfileContext = createContext<UserProfileContextValue>({
  profile: null,
  role: "Anon",
  moduleVisibility: {},
  homeVisibility: {},
  publicVisibility: {},
  visitorId: null,
  loading: true,
  refreshVisibility: async () => {},
  refreshProfile: async () => {},
});

/* ── Provider ────────────────────────────────────────────────────────────────── */

/**
 * Wraps the dashboard children. Handles three user tiers transparently:
 *
 *   - Admin    — authenticated, profile.role = 'Admin'
 *   - Client   — authenticated, profile.role = 'Client'
 *   - Anon     — no session; profile remains null; derived `role` = 'Anon'
 *
 * For anonymous visitors, `loadProfile()` returns null (the RPC `get_my_profile`
 * is not callable without auth.uid, but the wrapper soft-fails to null), and
 * `loadVisibility()` still works because `get_module_visibility` is SECURITY
 * DEFINER and granted to the `anon` role.
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
  const [homeVisibility, setHomeVisibility] = useState<Record<string, boolean>>({});
  const [publicVisibility, setPublicVisibility] = useState<Record<string, boolean>>({});
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    // Fast-path: skip the RPC when there is no session — get_my_profile would
    // simply return null, but we save a network round-trip for every anon page.
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setProfile(null);
      return;
    }
    const profileData = await rpcGetMyProfile(supabase);
    setProfile(profileData ?? null);
  }, [supabase]);

  // Convert the ModuleConfig array into three flat slug→boolean maps:
  //   - moduleVisibility (is_visible_for_clients)
  //   - homeVisibility   (is_visible_on_home)
  //   - publicVisibility (is_visible_for_public)
  const loadVisibility = useCallback(async () => {
    const rows = await rpcGetModuleVisibility(supabase);
    const clientMap: Record<string, boolean> = {};
    const homeMap: Record<string, boolean> = {};
    const publicMap: Record<string, boolean> = {};
    for (const row of rows) {
      clientMap[row.module_slug] = row.is_visible_for_clients;
      homeMap[row.module_slug] = row.is_visible_on_home;
      // is_visible_for_public is added by the anonymous-access migration. If
      // the API ever ships an old shape without it (e.g. during a partial
      // deploy), default to true so anon visitors see the module rather than
      // a confusing empty navbar.
      publicMap[row.module_slug] = row.is_visible_for_public ?? true;
    }
    setModuleVisibility(clientMap);
    setHomeVisibility(homeMap);
    setPublicVisibility(publicMap);
  }, [supabase]);

  // Read the HttpOnly visitor cookie via the API route once on mount.
  // Used by trackEvent for anonymous analytics attribution; null when bot UA
  // or middleware skipped (we never fail UX over a missing visitor id).
  const loadVisitorId = useCallback(async () => {
    try {
      const res = await fetch("/api/visitor-id", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { visitorId: string | null };
      setVisitorId(data.visitorId);
    } catch {
      // Soft-fail: tracking will silently no-op without the visitor id.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([loadProfile(), loadVisibility(), loadVisitorId()]).then(() => {
      if (cancelled) return;
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [loadProfile, loadVisibility, loadVisitorId]);

  // Derive the tier role in a single place. Consumers branch on `role`
  // instead of replicating the "profile?.role === 'Admin'" check.
  const role: Role = profile
    ? profile.role === "Admin"
      ? "Admin"
      : "Client"
    : "Anon";

  return (
    <UserProfileContext.Provider
      value={{
        profile,
        role,
        moduleVisibility,
        homeVisibility,
        publicVisibility,
        visitorId,
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
