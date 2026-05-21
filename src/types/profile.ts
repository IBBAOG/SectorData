// ─── Role ─────────────────────────────────────────────────────────────────────
// String union instead of enum so values serialize cleanly to/from the
// Supabase `text` column without enum-key/enum-value ambiguity.
//
// "Anon" is a derived, client-side-only role for unauthenticated visitors —
// it is NEVER persisted in the `profiles` table (where role IN ('Admin',
// 'Client')). The UserProfileContext exposes it when `profile === null` so
// downstream guards/UI can branch on a single field instead of "do I have a
// profile?" checks scattered across the app.
export type Role = "Admin" | "Client" | "Anon";

// ─── UserProfile ──────────────────────────────────────────────────────────────
// Mirrors the `profiles` Supabase table row exactly. Always represents an
// authenticated user — the DB-level role is "Admin" | "Client" only.
// Anonymous visitors are represented by `profile === null` in the context,
// which the derived `role` field surfaces as "Anon".
export interface UserProfile {
  id: string;               // uuid — matches auth.users.id
  role: "Admin" | "Client"; // narrower than the broader `Role` union — DB never stores "Anon"
  full_name: string | null; // null until the user sets a name
  avatar_url: string | null; // null until avatar upload is implemented
  created_at: string;       // ISO 8601 timestamptz string
}

// ─── ModuleConfig ─────────────────────────────────────────────────────────────
// Mirrors the `module_visibility` Supabase table row exactly.
//
// Three independent visibility axes:
//   - is_visible_for_clients  → Client tier access (Admin always sees)
//   - is_visible_on_home      → Home gallery card (applies to ALL roles incl. Admin)
//   - is_visible_for_public   → Anonymous (logged-out) tier access. Schema-level
//                                invariant: public=true ⇒ clients=true.
//
// `updated_at` is optional because the SECURITY DEFINER RPC `get_module_visibility`
// only returns the three visibility flags + module_slug (no audit columns).
export interface ModuleConfig {
  module_slug: string;
  is_visible_for_clients: boolean;
  is_visible_on_home: boolean;
  is_visible_for_public: boolean;
  updated_at?: string;       // ISO 8601 timestamptz — present on direct table reads, omitted by get_module_visibility()
}

// ─── UserWithRole ─────────────────────────────────────────────────────────────
// Returned by get_all_users_with_roles() RPC.
// Combines auth.users fields with the profiles role. Always authenticated —
// "Anon" never appears here because anonymous visitors have no auth.users row.
export interface UserWithRole {
  id: string;
  email: string;
  full_name: string;        // empty string if no profile row
  role: "Admin" | "Client";
  created_at: string;       // ISO 8601
}

// ─── Context value ────────────────────────────────────────────────────────────
// Shape of the value provided by UserProfileContext.
export interface UserProfileContextValue {
  /** The authenticated user's profile. `null` for anonymous visitors. */
  profile: UserProfile | null;
  /**
   * Derived role surfacing the tier in a single string:
   *   - "Admin" when profile.role === 'Admin'
   *   - "Client" when profile.role === 'Client'
   *   - "Anon" when profile === null (logged-out visitor)
   * Consumers should branch on this field rather than re-deriving from profile.
   */
  role: Role;
  /**
   * Module visibility map keyed by module_slug for O(1) lookup.
   * Missing key → treat as `true` (visible). Admins always see everything
   * regardless of this map.
   */
  moduleVisibility: Record<string, boolean>;
  /**
   * Home visibility map keyed by module_slug (uses CARDS[].slug, not href).
   * Missing key → treat as `true` (visible). Applies to ALL users including Admins.
   * Controlled via the "Show on Home" toggle in Admin Panel > Card Images.
   */
  homeVisibility: Record<string, boolean>;
  /**
   * Public visibility map keyed by module_slug. Missing key → `true` (visible).
   * Used by `useModuleVisibilityGuard` and NavBar filtering when `role === 'Anon'`.
   * Constraint enforced at the DB level: public=true ⇒ clients=true.
   */
  publicVisibility: Record<string, boolean>;
  /**
   * HttpOnly visitor cookie value (`sd_visitor_id`) read once via /api/visitor-id.
   * Null while the fetch is in flight or if the middleware skipped issuance
   * (e.g. bot UA). Used by `trackEvent` to attribute anonymous analytics rows.
   */
  visitorId: string | null;
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
