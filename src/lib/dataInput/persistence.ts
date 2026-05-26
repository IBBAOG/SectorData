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

  // Allowlist of column keys safe to send back to Postgres for this table.
  // Includes:
  //   - `id` (so edits target the right row on upsert)
  //   - every registry column (`config.columns`)
  //   - every conflict column (in case it isn't already in `columns`)
  // Everything else — including DB-computed columns like
  // `bba_import_parity_w_subsidy` and `petrobras_price_w_subsidy` (populated by
  // SQL triggers from ANP data) — is stripped so we don't round-trip stale
  // server values back into the table on edit.
  const allowedKeys = new Set<string>(["id"]);
  for (const col of config.columns) allowedKeys.add(col.key);
  for (const col of config.conflictColumns) allowedKeys.add(col);

  // Edited existing rows — merge full original row so conflict-key columns
  // (e.g. "product"+"date" for price_bands, "fuel_type"+"week" for d_g_margins)
  // are always present in the payload. Without them PostgREST cannot match the
  // ON CONFLICT target and either fails or inserts a duplicate instead of updating.
  for (const [id, partial] of editedRows) {
    const original: Row = state.rows.find((r) => r.id === id) ?? ({ id } as Row);
    const merged: Record<string, unknown> = { ...original, ...partial };
    // Coerce edited number cells (inputs always yield strings)
    for (const col of config.columns) {
      if (col.key in partial) {
        merged[col.key] = coerceValue(partial[col.key as keyof typeof partial], col.type);
      }
    }
    // Strip columns not declared in the registry (see allowlist comment above).
    const filtered: Record<string, unknown> = {};
    for (const key of Object.keys(merged)) {
      if (allowedKeys.has(key)) filtered[key] = merged[key];
    }
    toUpsert.push(filtered);
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

    // Same allowlist as above — drop any stray keys not declared in the registry.
    const filteredDraft: Record<string, unknown> = {};
    for (const key of Object.keys(payload)) {
      if (allowedKeys.has(key)) filteredDraft[key] = payload[key];
    }
    toUpsert.push(filteredDraft);
  }

  // ── Upsert: split edits (have id) and drafts (no id) into separate calls ──
  //
  // PostgREST serializes a mixed array by computing the UNION of all object
  // keys, then builds a single INSERT column list. Rows missing "id" are sent
  // with an explicit NULL for that column — but Postgres only auto-generates
  // IDENTITY values when the column is *omitted* from the INSERT list entirely,
  // not when an explicit NULL is provided. Splitting guarantees each batch has
  // a uniform key set so neither batch includes "id" for drafts.
  const editsPayload = toUpsert.filter(
    (r) => "id" in r && (r.id as number) > 0
  );
  const draftsPayload = toUpsert.filter((r) => !("id" in r));

  if (editsPayload.length > 0) {
    const { error: editsError } = await supabase
      .from(config.tableName)
      .upsert(editsPayload, { onConflict: config.conflictColumns.join(",") });

    if (editsError) {
      return { inserted: 0, updated: 0, deleted: 0, error: editsError.message };
    }

    updated = editedRows.size;
  }

  if (draftsPayload.length > 0) {
    const { error: draftsError } = await supabase
      .from(config.tableName)
      .upsert(draftsPayload, { onConflict: config.conflictColumns.join(",") });

    if (draftsError) {
      return { inserted: 0, updated, deleted: 0, error: draftsError.message };
    }

    inserted = drafts.length;
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
