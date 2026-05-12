// Persistence layer for Data Input: load and save rows via PostgREST (anon key).
// RLS policies grant Admins INSERT/UPDATE/DELETE — see migration
//   supabase/migrations/20260512000000_data_input_admin_policies.sql

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EditableTableConfig, EditState, Row, SaveResult } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Coerce a raw cell value (always a string from <input>) to the correct JS type
 * expected by PostgREST:
 *   - "number" columns → JavaScript number (NaN stays as-is; PostgREST rejects it)
 *   - everything else → keep the string (PostgREST casts date/text itself)
 *
 * Null/undefined passthrough so required-field guards can detect missing values.
 */
function coerceValue(
  value: unknown,
  type: import("./types").ColumnType
): unknown {
  if (value === null || value === undefined) return value;
  if (type === "number") {
    const n = Number(value);
    return isNaN(n) ? null : n;
  }
  return value;
}

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

  // New drafts — strip the negative synthetic id so Postgres auto-generates.
  // Also coerce cell values to their proper JS types (inputs always yield strings)
  // and guard required columns: if a required column is null/undefined here it
  // means the stale-closure race fired (saveDisabled was false in the old render
  // but state had already transitioned to an invalid draft). Return an error
  // immediately rather than letting Postgres surface a cryptic NOT NULL violation.
  for (const draft of drafts) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _negativeId, ...rest } = draft;

    // Build a column-typed payload
    const payload: Record<string, unknown> = { ...rest };
    for (const col of config.columns) {
      const raw = payload[col.key];
      const coerced = coerceValue(raw, col.type);
      payload[col.key] = coerced;

      // Guard: required column is null/undefined — abort before hitting Postgres
      const isEmpty =
        coerced === null ||
        coerced === undefined ||
        (typeof coerced === "string" && coerced.trim() === "");
      if (col.required && isEmpty) {
        return {
          inserted: 0,
          updated: 0,
          deleted: 0,
          error: `${col.label} is required and cannot be empty.`,
        };
      }
    }

    toUpsert.push(payload);
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
