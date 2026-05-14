"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useUserProfile } from "../context/UserProfileContext";
import { getSupabaseClient } from "../lib/supabaseClient";
import type { Role } from "../types/profile";

/**
 * Redirects to /home if the authenticated user does not have the required role.
 * Renders nothing (returns loading=true) until the profile fetch completes,
 * preventing a flash of protected UI before the redirect fires.
 *
 * For Admins, this hook additionally enforces MFA enrollment:
 * - If the Admin has no verified factor, they are redirected to /profile/mfa
 *   so they cannot reach the admin panel without enrolling.
 * - If they have a factor but the session has not been elevated to AAL2 yet
 *   (i.e. they have not passed the challenge), they are sent to /login.
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
  // MFA enforcement is checked asynchronously; until the check resolves we
  // keep callers in the loading state so they don't render protected UI.
  const [mfaChecking, setMfaChecking] = useState(requiredRole === "Admin");
  const [mfaPass, setMfaPass] = useState(false);

  const roleAllowed = !loading && profile?.role === requiredRole;

  useEffect(() => {
    if (loading) return;
    if (!roleAllowed) {
      router.replace("/home");
      return;
    }

    // Non-admin guards do not need an MFA check.
    if (requiredRole !== "Admin") {
      setMfaChecking(false);
      setMfaPass(true);
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setMfaChecking(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [{ data: factorData }, { data: aalData }] = await Promise.all([
          supabase.auth.mfa.listFactors(),
          supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        ]);
        if (cancelled) return;
        const hasVerifiedFactor =
          (factorData?.totp ?? []).some((f) => f.status === "verified") ?? false;
        const currentLevel = aalData?.currentLevel;
        if (!hasVerifiedFactor) {
          router.replace("/profile/mfa");
          return;
        }
        if (currentLevel !== "aal2") {
          router.replace("/login");
          return;
        }
        setMfaPass(true);
      } catch {
        // Fail closed.
        router.replace("/home");
      } finally {
        if (!cancelled) setMfaChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, roleAllowed, requiredRole, router]);

  return {
    allowed: roleAllowed && (requiredRole !== "Admin" ? true : mfaPass),
    loading: loading || mfaChecking,
  };
}
