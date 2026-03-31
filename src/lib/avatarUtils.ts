/**
 * Shared avatar/initials helpers used by NavBar and ProfilePage.
 * Pure functions — no imports, no side effects.
 */

import type { UserProfile } from "../types/profile";

/**
 * Derives up to 2 uppercase initials from a profile or email fallback.
 *
 * Priority:
 *   1. profile.full_name — split on spaces, take first letter of first two words
 *   2. email local-part — everything before '@', take first two characters
 *   3. "?" as last resort
 *
 * Examples:
 *   "Test Admin"      → "TA"
 *   "João Silva Neto" → "JS"
 *   "admin@test.com"  → "AD"
 *   null, null        → "?"
 */
export function getInitials(
  profile: UserProfile | null,
  email?: string | null,
): string {
  const name = profile?.full_name?.trim();

  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }

  if (email) {
    const local = email.split("@")[0] ?? "";
    return local.slice(0, 2).toUpperCase();
  }

  return "?";
}

/**
 * Formats an ISO 8601 date string as "Month YYYY" (e.g. "January 2025").
 * Used on the profile page to display "Member since".
 */
export function formatMemberSince(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } catch {
    return "—";
  }
}
