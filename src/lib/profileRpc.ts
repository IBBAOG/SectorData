/**
 * Supabase RPC wrappers for the profiles and module_visibility tables.
 * Follows the same try/catch/console.error pattern used in rpc.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile, ModuleConfig, UserWithRole } from "../types/profile";

// ─── Profiles ─────────────────────────────────────────────────────────────────

/**
 * Fetches the currently authenticated user's profile row.
 * Returns null if no row exists yet (new user who has not been assigned a role).
 * The frontend defaults such users to the 'Client' role.
 */
export async function rpcGetMyProfile(
  supabase: SupabaseClient,
): Promise<UserProfile | null> {
  try {
    const { data, error } = await supabase.rpc("get_my_profile");
    if (error) throw error;
    // `data` is a single object or null when no row matches
    return (data as UserProfile) ?? null;
  } catch (e) {
    console.error("[profileRpc] get_my_profile error:", e);
    return null;
  }
}

// ─── Module visibility ────────────────────────────────────────────────────────

/**
 * Fetches all rows from `module_visibility`.
 * Returns an empty array on error so the frontend defaults all modules to
 * visible (safe degradation).
 */
export async function rpcGetModuleVisibility(
  supabase: SupabaseClient,
): Promise<ModuleConfig[]> {
  try {
    const { data, error } = await supabase.rpc("get_module_visibility");
    if (error) throw error;
    return (data as ModuleConfig[]) ?? [];
  } catch (e) {
    console.error("[profileRpc] get_module_visibility error:", e);
    return [];
  }
}

// ─── User management (Admin only) ────────────────────────────────────────────

/**
 * Returns all registered users with their current role.
 * Only callable by Admins — the RPC raises an exception for other roles.
 */
export async function rpcGetAllUsersWithRoles(
  supabase: SupabaseClient,
): Promise<UserWithRole[]> {
  try {
    const { data, error } = await supabase.rpc("get_all_users_with_roles");
    if (error) throw error;
    return (data as UserWithRole[]) ?? [];
  } catch (e) {
    console.error("[profileRpc] get_all_users_with_roles error:", e);
    return [];
  }
}

/**
 * Sets the role for any user by UUID.
 * Creates the profile row if it doesn't exist yet.
 * Only callable by Admins — the RPC raises an exception for other roles.
 */
export async function rpcSetUserRole(
  supabase: SupabaseClient,
  userId: string,
  role: "Admin" | "Client",
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("set_user_role", {
      p_user_id: userId,
      p_role: role,
    });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error("[profileRpc] set_user_role error:", e);
    return false;
  }
}

/**
 * Toggles one module's visibility for Client users.
 * Only succeeds if the caller has role='Admin' (enforced server-side).
 * Returns the updated row, or null on error.
 */
export async function rpcSetModuleVisibility(
  supabase: SupabaseClient,
  slug: string,
  isVisible: boolean,
): Promise<ModuleConfig | null> {
  try {
    const { data, error } = await supabase.rpc("set_module_visibility", {
      p_slug: slug,
      p_is_visible: isVisible,
    });
    if (error) throw error;
    return (data as ModuleConfig) ?? null;
  } catch (e) {
    console.error("[profileRpc] set_module_visibility error:", e);
    return null;
  }
}
