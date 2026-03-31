// ─── Role ─────────────────────────────────────────────────────────────────────
// String union instead of enum so values serialize cleanly to/from the
// Supabase `text` column without enum-key/enum-value ambiguity.
export type Role = "Admin" | "Client";

// ─── UserProfile ──────────────────────────────────────────────────────────────
// Mirrors the `profiles` Supabase table row exactly.
// Extend this interface as new columns are added (e.g. preferences, locale).
export interface UserProfile {
  id: string;               // uuid — matches auth.users.id
  role: Role;
  full_name: string | null; // null until the user sets a name
  avatar_url: string | null; // null until avatar upload is implemented
  created_at: string;       // ISO 8601 timestamptz string
}

// ─── ModuleConfig ─────────────────────────────────────────────────────────────
// Mirrors the `module_visibility` Supabase table row exactly.
export interface ModuleConfig {
  module_slug: string;
  is_visible_for_clients: boolean;
  updated_at: string;       // ISO 8601 timestamptz string
}

// ─── UserWithRole ─────────────────────────────────────────────────────────────
// Returned by get_all_users_with_roles() RPC.
// Combines auth.users fields with the profiles role.
export interface UserWithRole {
  id: string;
  email: string;
  full_name: string;        // empty string if no profile row
  role: Role;
  created_at: string;       // ISO 8601
}

// ─── Context value ────────────────────────────────────────────────────────────
// Shape of the value provided by UserProfileContext.
export interface UserProfileContextValue {
  /** The authenticated user's profile, or null if not yet loaded / no row. */
  profile: UserProfile | null;
  /**
   * Module visibility map keyed by module_slug for O(1) lookup.
   * Missing key → treat as `true` (visible). Admins always see everything
   * regardless of this map.
   */
  moduleVisibility: Record<string, boolean>;
  /** True while either profile or visibility is still being fetched. */
  loading: boolean;
  /**
   * Re-fetches module_visibility from Supabase and updates the context map.
   * Call this after an Admin saves a toggle in /settings so the change
   * propagates to the home page within the same session.
   */
  refreshVisibility: () => Promise<void>;
  /**
   * Re-fetches the user's own profile row and updates the context.
   * Call this after saving a name change so NavBar and other consumers update.
   */
  refreshProfile: () => Promise<void>;
}
