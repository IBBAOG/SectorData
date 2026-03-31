"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useUserProfile } from "../context/UserProfileContext";

/**
 * Guards a module page against Client users when the module has been hidden
 * by an Admin. Admins always pass through regardless of visibility settings.
 *
 * Defaults to visible=true while loading to prevent a redirect flicker on
 * initial page load (the redirect fires only after the profile/visibility
 * fetch resolves and the module is confirmed hidden).
 *
 * Usage:
 *   const { visible, loading } = useModuleVisibilityGuard("market-share");
 *   if (loading || !visible) return null;
 *
 * @param slug  The module_slug as stored in the module_visibility table
 *              (e.g. "sales", "market-share", "navios-diesel").
 */
export function useModuleVisibilityGuard(slug: string): {
  visible: boolean;
  loading: boolean;
} {
  const { profile, moduleVisibility, loading } = useUserProfile();
  const router = useRouter();

  // Admins always have access; Clients check the visibility map.
  // While loading, treat as visible to avoid premature redirect.
  const isAdmin = !loading && profile?.role === "Admin";
  const visible = loading || isAdmin || (moduleVisibility[slug] ?? true);

  useEffect(() => {
    if (!loading && !visible) {
      router.replace("/home");
    }
  }, [loading, visible, router]);

  return { visible, loading };
}
