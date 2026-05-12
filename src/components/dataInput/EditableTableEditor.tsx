"use client";

// Inline spreadsheet-style editor for a single Supabase table.
// Supports: add rows (draft), edit cells, mark for deletion, save all (upsert + delete).
// No external libs beyond Bootstrap 5 + React.

import { useCallback, useEffect, useRef, useState } from "react";

import BarrelLoading from "@/components/dashboard/BarrelLoading";
import SegmentedToggle from "@/components/dashboard/SegmentedToggle";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { EditableTableConfig, DraftRow, Row } from "@/lib/dataInput/types";
import { loadRows, saveChanges } from "@/lib/dataInput/persistence";
import { validateRow } from "@/lib/dataInput/validation";

interface EditableTableEditorProps {
  config: EditableTableConfig;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function cellString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EditableTableEditor({ config }: EditableTableEditorProps) {
  const supabase = getSupabaseClient();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Edit buckets ──────────────────────────────────────────────────────────
  const [editedRows, setEditedRows] = useState<Map<number, Partial<Row>>>(new Map());
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());

  // ── Partition (SegmentedToggle when partitionBy is set) ───────────────────
  const firstPartitionValue = config.partitionBy?.values[0]?.value ?? "";
  const [activePartition, setActivePartition] = useState<string>(firstPartitionValue);

  // ── Save state ────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── beforeunload guard ────────────────────────────────────────────────────
  const hasPendingChanges =
    editedRows.size > 0 || drafts.length > 0 || deletedIds.size > 0;

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (hasPendingChanges) {
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasPendingChanges]);

  // ── Load ──────────────────────────────────────────────────────────────────
  const fetchRows = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const data = await loadRows(supabase, config);
    setRows(data);
    setLoading(false);
  }, [supabase, config]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    // Standard data-fetch effect: fetchRows is async/useCallback; state resets are
    // intentional config-change cleanup (same pattern as admin-panel/page.tsx:212/237).
    fetchRows();
    // Reset partition to first value whenever config changes
    setActivePartition(config.partitionBy?.values[0]?.value ?? "");
    // Clear buckets when switching tables
    setEditedRows(new Map());
    setDrafts([]);
    setDeletedIds(new Set());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [fetchRows, config]);

  // ── Helpers — edits ───────────────────────────────────────────────────────

  function updateExistingCell(rowId: number, key: string, value: string) {
    setEditedRows((prev) => {
      const next = new Map(prev);
      const existing = next.get(rowId) ?? {};
      next.set(rowId, { ...existing, [key]: value === "" ? null : value });
      return next;
    });
  }

  function updateDraftCell(draftId: number, key: string, value: string) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.id === draftId ? { ...d, [key]: value === "" ? null : value } : d
      )
    );
  }

  function addDraft() {
    const minId = Math.min(0, ...drafts.map((d) => d.id));
    const newId = minId - 1;
    const base: DraftRow = { id: newId };
    // Pre-fill partition column if applicable
    if (config.partitionBy && activePartition) {
      base[config.partitionBy.column] = activePartition;
    }
    setDrafts((prev) => [base, ...prev]);
  }

  function removeDraft(draftId: number) {
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
  }

  function toggleDelete(rowId: number) {
    setDeletedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }

  function discard() {
    setEditedRows(new Map());
    setDrafts([]);
    setDeletedIds(new Set());
  }

  // ── Validation ────────────────────────────────────────────────────────────

  function getRowErrors(rowId: number, rowData: Record<string, unknown>): Map<string, string> {
    return validateRow(rowData, config.columns);
  }

  // Build all validation errors across edited rows + drafts
  const allErrors = (() => {
    const map = new Map<number, Map<string, string>>();
    for (const [id, partial] of editedRows) {
      const original = rows.find((r) => r.id === id) ?? {};
      const merged = { ...original, ...partial } as Record<string, unknown>;
      const errs = getRowErrors(id, merged);
      if (errs.size > 0) map.set(id, errs);
    }
    for (const draft of drafts) {
      const errs = getRowErrors(draft.id, draft as Record<string, unknown>);
      if (errs.size > 0) map.set(draft.id, errs);
    }
    return map;
  })();

  const hasErrors = allErrors.size > 0;
  const saveDisabled = saving || (!hasPendingChanges) || hasErrors;

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!supabase || saving) return;

    // Re-validate from current state before sending to the server.
    // The `saveDisabled` variable in scope is a derived value captured by closure
    // from the last render snapshot. In React 19 concurrent mode a blur-then-click
    // sequence can commit new state (e.g. date: null) AFTER the render that set
    // saveDisabled=false, so the closure guard is stale. Reading `drafts` and
    // `editedRows` directly here gives us the committed state at click time.
    const hasPending = editedRows.size > 0 || drafts.length > 0 || deletedIds.size > 0;
    if (!hasPending) return;

    for (const draft of drafts) {
      const errs = validateRow(draft as Record<string, unknown>, config.columns);
      if (errs.size > 0) return; // still invalid — don't send
    }
    for (const [id, partial] of editedRows) {
      const original = rows.find((r) => r.id === id) ?? {};
      const merged = { ...original, ...partial } as Record<string, unknown>;
      const errs = validateRow(merged, config.columns);
      if (errs.size > 0) return;
    }

    setSaving(true);
    const result = await saveChanges(supabase, config, { editedRows, drafts, deletedIds });
    setSaving(false);

    if (result.error) {
      setToast(`Error: ${result.error}`);
    } else {
      const parts: string[] = [];
      if (result.inserted > 0) parts.push(`${result.inserted} added`);
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      if (result.deleted > 0) parts.push(`${result.deleted} deleted`);
      setToast(parts.length > 0 ? `Saved — ${parts.join(", ")}.` : "Saved.");
      // Clear buckets and reload
      setEditedRows(new Map());
      setDrafts([]);
      setDeletedIds(new Set());
      await fetchRows();
    }

    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }

  // ── Visible rows (partition filter) ──────────────────────────────────────

  const partitionCol = config.partitionBy?.column;
  const visibleRows = partitionCol
    ? rows.filter((r) => r[partitionCol] === activePartition)
    : rows;

  const visibleDrafts = partitionCol
    ? drafts.filter((d) => d[partitionCol] === activePartition)
    : drafts;

  // ── Visible columns (filter by visibleWhen against active partition context) ─

  // For columns with visibleWhen, we check against a representative row that
  // uses the active partition value so headers stay stable per-partition tab.
  const partitionContext: Record<string, unknown> = partitionCol
    ? { [partitionCol]: activePartition }
    : {};

  const visibleColumns = config.columns.filter((col) =>
    col.visibleWhen === undefined || col.visibleWhen(partitionContext)
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <BarrelLoading />;

  const counterParts: string[] = [];
  if (editedRows.size > 0) counterParts.push(`${editedRows.size} edit${editedRows.size !== 1 ? "s" : ""}`);
  if (drafts.length > 0) counterParts.push(`${drafts.length} new`);
  if (deletedIds.size > 0) counterParts.push(`${deletedIds.size} deleted`);

  return (
    <div style={{ fontFamily: "Arial, sans-serif" }}>

      {/* ── Partition toggle ─────────────────────────────────────────────── */}
      {config.partitionBy && (
        <div style={{ marginBottom: 16 }}>
          <SegmentedToggle
            options={config.partitionBy.values}
            value={activePartition}
            onChange={setActivePartition}
            variant="compact"
            buttonPadding="16px"
          />
        </div>
      )}

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {counterParts.length > 0 && (
          <span style={{ fontSize: 12, color: "#888", marginRight: 6 }}>
            {counterParts.join(" · ")}
          </span>
        )}

        <button
          type="button"
          onClick={addDraft}
          disabled={saving}
          className="btn btn-sm btn-outline-secondary"
          style={{ fontFamily: "Arial, sans-serif", fontSize: 12 }}
        >
          + Add row
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={saveDisabled}
          className="btn btn-sm"
          style={{
            fontFamily: "Arial, sans-serif",
            fontSize: 12,
            background: saveDisabled ? "#e0e0e0" : "#FF5000",
            color: saveDisabled ? "#aaa" : "#fff",
            border: "none",
            cursor: saveDisabled ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save all"}
        </button>

        {hasPendingChanges && !saving && (
          <button
            type="button"
            onClick={discard}
            className="btn btn-sm btn-outline-secondary"
            style={{ fontFamily: "Arial, sans-serif", fontSize: 12 }}
          >
            Discard
          </button>
        )}

        {hasErrors && (
          <span style={{ fontSize: 12, color: "#c0392b" }}>
            Fix validation errors before saving.
          </span>
        )}
      </div>

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          style={{
            marginBottom: 12,
            padding: "8px 16px",
            borderRadius: 8,
            background: toast.startsWith("Error") ? "#fff5f5" : "#f0fff4",
            border: `1px solid ${toast.startsWith("Error") ? "#fed7d7" : "#c6f6d5"}`,
            color: toast.startsWith("Error") ? "#c53030" : "#276749",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {toast}
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div style={{ overflowX: "auto" }}>
        <table className="table table-sm" style={{ fontSize: 12, minWidth: 600 }}>
          <thead>
            <tr style={{ background: "#f8f8f8" }}>
              <th style={{ width: 56, fontWeight: 600, color: "#666", fontSize: 11, whiteSpace: "nowrap" }}>ID</th>
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    fontWeight: 600,
                    color: "#666",
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    width: col.width,
                  }}
                >
                  {col.label}
                  {col.required && <span style={{ color: "#c0392b", marginLeft: 2 }}>*</span>}
                  {col.helpText && (
                    <span
                      style={{ marginLeft: 4, color: "#aaa", fontSize: 10, fontWeight: 400 }}
                      title={col.helpText}
                    >
                      ({col.helpText})
                    </span>
                  )}
                </th>
              ))}
              <th style={{ width: 80 }} />
            </tr>
          </thead>

          <tbody>
            {/* ── Draft rows (new, unsaved) ─────────────────────────────── */}
            {visibleDrafts.map((draft) => {
              const draftData = draft as Record<string, unknown>;
              const rowErrors = allErrors.get(draft.id) ?? new Map<string, string>();
              return (
                <tr key={draft.id} style={{ background: "#fffbf0" }}>
                  <td style={{ fontFamily: "monospace", color: "#aaa", verticalAlign: "middle" }}>
                    new
                  </td>
                  {visibleColumns.map((col) => {
                    const err = rowErrors.get(col.key) ?? null;
                    return (
                      <td key={col.key} style={{ verticalAlign: "middle", padding: "3px 4px" }}>
                        <CellInput
                          col={col}
                          value={draftData[col.key]}
                          error={err}
                          onChange={(v) => updateDraftCell(draft.id, col.key, v)}
                        />
                      </td>
                    );
                  })}
                  <td style={{ verticalAlign: "middle", textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => removeDraft(draft.id)}
                      className="btn btn-sm btn-outline-danger"
                      style={{ fontSize: 11, padding: "1px 8px", fontFamily: "Arial, sans-serif" }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}

            {/* ── Existing rows ─────────────────────────────────────────── */}
            {visibleRows.length === 0 && visibleDrafts.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumns.length + 2}
                  style={{ textAlign: "center", color: "#bbb", padding: "24px 0" }}
                >
                  No rows. Click Add row to start.
                </td>
              </tr>
            )}

            {visibleRows.map((row) => {
              const isDeleted = deletedIds.has(row.id);
              const edits = editedRows.get(row.id) ?? {};
              const mergedData = { ...row, ...edits } as Record<string, unknown>;
              const rowErrors = allErrors.get(row.id) ?? new Map<string, string>();

              return (
                <tr
                  key={row.id}
                  style={{
                    textDecoration: isDeleted ? "line-through" : undefined,
                    opacity: isDeleted ? 0.5 : 1,
                  }}
                >
                  <td style={{ fontFamily: "monospace", color: "#999", verticalAlign: "middle", fontSize: 11 }}>
                    {row.id}
                  </td>
                  {visibleColumns.map((col) => {
                    const err = rowErrors.get(col.key) ?? null;
                    return (
                      <td key={col.key} style={{ verticalAlign: "middle", padding: "3px 4px" }}>
                        <CellInput
                          col={col}
                          value={mergedData[col.key]}
                          error={err}
                          disabled={isDeleted}
                          onChange={(v) => updateExistingCell(row.id, col.key, v)}
                        />
                      </td>
                    );
                  })}
                  <td style={{ verticalAlign: "middle", textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => toggleDelete(row.id)}
                      className={`btn btn-sm ${isDeleted ? "btn-outline-warning" : "btn-outline-danger"}`}
                      style={{ fontSize: 11, padding: "1px 8px", fontFamily: "Arial, sans-serif" }}
                    >
                      {isDeleted ? "Restore" : "Delete"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── CellInput ─────────────────────────────────────────────────────────────────

interface CellInputProps {
  col: import("@/lib/dataInput/types").ColumnConfig;
  value: unknown;
  error: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
}

function CellInput({ col, value, error, onChange, disabled = false }: CellInputProps) {
  const strValue = cellString(value);
  const baseStyle: React.CSSProperties = {
    fontFamily: "Arial, sans-serif",
    fontSize: 12,
    padding: "3px 6px",
    borderRadius: 4,
    border: `1px solid ${error ? "#e53e3e" : "#ddd"}`,
    background: disabled ? "#f8f8f8" : "#fff",
    width: "100%",
    minWidth: 60,
    boxSizing: "border-box",
    outline: "none",
  };

  if (col.type === "select" && col.options) {
    return (
      <div>
        <select
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={error ? "is-invalid" : undefined}
          style={{ ...baseStyle, appearance: "auto", cursor: disabled ? "default" : "pointer" }}
        >
          <option value="">— select —</option>
          {col.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        {error && <div className="invalid-feedback" style={{ display: "block", fontSize: 11 }}>{error}</div>}
      </div>
    );
  }

  if (col.type === "date") {
    return (
      <div>
        <input
          type="date"
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={error ? "is-invalid" : undefined}
          style={baseStyle}
        />
        {error && <div className="invalid-feedback" style={{ display: "block", fontSize: 11 }}>{error}</div>}
      </div>
    );
  }

  if (col.type === "number") {
    return (
      <div>
        <input
          type="number"
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          step={col.step ?? "any"}
          min={col.min}
          max={col.max}
          className={error ? "is-invalid" : undefined}
          style={baseStyle}
          placeholder="—"
        />
        {error && <div className="invalid-feedback" style={{ display: "block", fontSize: 11 }}>{error}</div>}
      </div>
    );
  }

  // default: text
  return (
    <div>
      <input
        type="text"
        value={strValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        pattern={col.pattern}
        className={error ? "is-invalid" : undefined}
        style={baseStyle}
        placeholder={col.helpText ?? ""}
      />
      {error && <div className="invalid-feedback" style={{ display: "block", fontSize: 11 }}>{error}</div>}
    </div>
  );
}
