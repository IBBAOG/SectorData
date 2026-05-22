"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useUserProfile } from "../context/UserProfileContext";

/**
 * Guards a module page against the three user tiers.
 *
 *   - Admin   → always visible
 *   - Client  → checks `moduleVisibility[slug]`  (is_visible_for_clients)
 *   - Anon    → checks `publicVisibility[slug]`  (is_visible_for_public)
 *
 * Defaults to `visible=true` while loading to prevent a redirect flicker on
 * initial page load; the redirect fires only after the profile/visibility
 * fetch resolves and the module is confirmed hidden for the current tier.
 *
 * Missing visibility-map keys default to `true` (safe degradation): a freshly
 * deployed module without a `module_visibility` row stays accessible until
 * an Admin explicitly toggles it off.
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
  const { role, moduleVisibility, publicVisibility, loading } = useUserProfile();
  const router = useRouter();

  // While loading, treat as visible to avoid premature redirect.
  let visible: boolean;
  if (loading) {
    visible = true;
  } else if (role === "Admin") {
    visible = true;
  } else if (role === "Anon") {
    visible = publicVisibility[slug] ?? true;
  } else {
    // Client
    visible = moduleVisibility[slug] ?? true;
  }

  useEffect(() => {
    if (!loading && !visible) {
      router.replace("/home");
    }
  }, [loading, visible, router]);

  return { visible, loading };
}
