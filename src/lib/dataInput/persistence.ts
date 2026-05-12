// Persistence layer for Data Input: load and save rows via PostgREST (anon key).
// RLS policies grant Admins INSERT/UPDATE/DELETE — see migration
//   supabase/migrations/20260512000000_data_input_admin_policies.sql

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EditableTableConfig, EditState, Row, SaveResult } from "./types";

/**
 * Load all rows for a table, ordered by defaultSort.
 * Returns an empty array on error (logs to console).
 * Requests up to 5000 rows (Supabase default cap is 1000 per request, so
 * `.range(0, 4999)` signals intent; the server will clamp if needed).
 */
export async function loadRows(
  supabase: SupabaseClient,
  config: EditableTableConfig
): Promise<Row[]> {
  try {
    const sort = config.defaultSort ?? { key: "id", dir: "asc" };
    const { data, error } = await supabase
      .from(config.tableName)
      .select("*")
      .order(sort.key, { ascending: sort.dir === "asc" })
      .range(0, 4999);

    if (error) {
      console.error(`[dataInput] loadRows(${config.tableName}):`, error);
      return [];
    }
    return (data ?? []) as Row[];
  } catch (e) {
    console.error(`[dataInput] loadRows(${config.tableName}) unexpected:`, e);
    return [];
  }
}

/**
 * Persist edits, drafts, and deletions to Supabase.
 *
 * Order of operations:
 *   1. Upsert edits + drafts (upsert first so failures don't roll back user work).
 *   2. Delete rows in deletedIds.
 *
 * Returns aggregate counts. Inserted/updated counts are best-effort (upsert
 * doesn't distinguish them; we split by whether the row was a draft).
 */
export async function saveChanges(
  supabase: SupabaseClient,
  config: EditableTableConfig,
  state: EditState
): Promise<SaveResult> {
  const { editedRows, drafts, deletedIds } = state;

  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  // ── Build upsert payload ──────────────────────────────────────────────────
  const toUpsert: Record<string, unknown>[] = [];

  // Edited existing rows (keep their positive id so upsert matches by id)
  for (const [id, partial] of editedRows) {
    toUpsert.push({ id, ...partial });
  }

  // New drafts — strip the negative synthetic id so Postgres auto-generates
  for (const draft of drafts) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _negativeId, ...rest } = draft;
    toUpsert.push(rest);
  }

  // ── Upsert ────────────────────────────────────────────────────────────────
  if (toUpsert.length > 0) {
    const { error: upsertError } = await supabase
      .from(config.tableName)
      .upsert(toUpsert, { onConflict: config.conflictColumns.join(",") });

    if (upsertError) {
      return { inserted: 0, updated: 0, deleted: 0, error: upsertError.message };
    }

    inserted = drafts.length;
    updated = editedRows.size;
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  if (deletedIds.size > 0) {
    const { error: deleteError } = await supabase
      .from(config.tableName)
      .delete()
      .in("id", [...deletedIds]);

    if (deleteError) {
      // Upsert already succeeded — report partial success with delete error
      return {
        inserted,
        updated,
        deleted: 0,
        error: `Delete failed: ${deleteError.message}`,
      };
    }

    deleted = deletedIds.size;
  }

  return { inserted, updated, deleted };
}
