"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useUserProfile } from "../context/UserProfileContext";
import type { Role } from "../types/profile";

/**
 * Redirects to /home if the authenticated user does not have the required role.
 * Renders nothing (returns loading=true) until the profile fetch completes,
 * preventing a flash of protected UI before the redirect fires.
 *
 * Usage:
 *   const { allowed, loading } = useRoleGuard("Admin");
 *   if (loading || !allowed) return null;
 */
export function useRoleGuard(requiredRole: Role): {
  allowed: boolean;
  loading: boolean;
} {
  const { profile, loading } = useUserProfile();
  const router = useRouter();

  const allowed = !loading && profile?.role === requiredRole;

  useEffect(() => {
    // Only redirect once loading is complete to avoid redirecting during
    // the initial profile fetch.
    if (!loading && !allowed) {
      router.replace("/home");
    }
  }, [loading, allowed, router]);

  return { allowed, loading };
}
