"use client";

// Modal for bulk .xlsx upload (upsert + preview) of a Data Input table.
// Flow: choose file → parse (ExcelJS, dynamic import) → preview insert/update
// diff + validation errors → confirm → upsert in chunks.
//
// Desktop-only (the whole /admin-panel is desktop-only). All copy in English.

import { useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BulkParseResult, EditableTableConfig, Row } from "@/lib/dataInput/types";
import { bulkUpsert, computeBulkDiff, parseWorkbook } from "@/lib/dataInput/bulkUpload";

const BRAND = "#FF5000";

interface BulkUploadModalProps {
  supabase: SupabaseClient;
  config: EditableTableConfig;
  /** Currently-loaded rows, used to classify insert vs update in the preview. */
  existingRows: Row[];
  onClose: () => void;
  /** Called after a successful upsert with the number of rows written. */
  onSuccess: (upserted: number) => void | Promise<void>;
}

type Phase = "choose" | "parsing" | "preview" | "uploading";

export function BulkUploadModal({
  supabase,
  config,
  existingRows,
  onClose,
  onSuccess,
}: BulkUploadModalProps) {
  const [phase, setPhase] = useState<Phase>("choose");
  const [fileName, setFileName] = useState<string>("");
  const [parsed, setParsed] = useState<BulkParseResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const expectedSheets = config.bulkUpload?.sheets.map((s) => s.sheetName) ?? [];

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setErrorMsg(null);
    setPhase("parsing");
    try {
      const result = await parseWorkbook(file, config);
      setParsed(result);
      setPhase("preview");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("choose");
    }
  }

  const diff =
    parsed && parsed.rows.length > 0
      ? computeBulkDiff(parsed.rows, existingRows, config.conflictColumns)
      : { insertCount: 0, updateCount: 0 };

  const hasHardErrors = (parsed?.errors.length ?? 0) > 0;
  const canConfirm = !!parsed && parsed.rows.length > 0 && !hasHardErrors && phase === "preview";

  async function handleConfirm() {
    if (!parsed || !canConfirm) return;
    setPhase("uploading");
    setErrorMsg(null);
    const { upserted, error } = await bulkUpsert(supabase, config, parsed.rows);
    if (error) {
      setErrorMsg(error);
      setPhase("preview");
      return;
    }
    await onSuccess(upserted);
  }

  const busy = phase === "parsing" || phase === "uploading";

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => !busy && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1080,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          width: "min(620px, 92vw)",
          maxHeight: "88vh",
          overflow: "auto",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          padding: 24,
        }}
      >
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h5 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#222" }}>
            Bulk upload — {config.label}
          </h5>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            disabled={busy}
            aria-label="Close"
            style={{
              border: "none",
              background: "transparent",
              fontSize: 22,
              lineHeight: 1,
              color: "#999",
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            ×
          </button>
        </div>

        {/* ── Choose file ───────────────────────────────────────────────── */}
        {(phase === "choose" || phase === "parsing") && (
          <div>
            <p style={{ fontSize: 13, color: "#555", lineHeight: 1.5, marginBottom: 12 }}>
              Upload a multi-sheet <code>.xlsx</code> workbook (one sheet per category).
              Rows are <strong>upserted</strong> on <code>{config.conflictColumns.join(" + ")}</code> —
              existing keys are updated, new keys inserted, nothing is deleted.
            </p>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
              Expected sheet{expectedSheets.length !== 1 ? "s" : ""}: {expectedSheets.map((s) => <code key={s} style={{ marginRight: 6 }}>{s}</code>)}
            </p>
            <input
              type="file"
              accept=".xlsx"
              onChange={onFileChange}
              disabled={phase === "parsing"}
              style={{ fontSize: 13 }}
            />
            {phase === "parsing" && (
              <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>Parsing {fileName}…</p>
            )}
            {errorMsg && (
              <p style={{ fontSize: 13, color: "#c0392b", marginTop: 12 }}>{errorMsg}</p>
            )}
          </div>
        )}

        {/* ── Preview ───────────────────────────────────────────────────── */}
        {(phase === "preview" || phase === "uploading") && parsed && (
          <div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
              File: <strong style={{ color: "#555" }}>{fileName}</strong>
            </div>

            {/* Sheets found */}
            <div style={{ fontSize: 13, color: "#555", marginBottom: 12 }}>
              Sheets found:{" "}
              {parsed.sheetsFound.length > 0
                ? parsed.sheetsFound.map((s) => {
                    const expected = expectedSheets.includes(s);
                    return (
                      <span
                        key={s}
                        style={{
                          display: "inline-block",
                          marginRight: 6,
                          padding: "1px 8px",
                          borderRadius: 10,
                          fontSize: 11,
                          background: expected ? "#fff1e6" : "#f0f0f0",
                          color: expected ? "#7a3d00" : "#999",
                          border: `1px solid ${expected ? "#ffd9b3" : "#e0e0e0"}`,
                        }}
                      >
                        {s}
                      </span>
                    );
                  })
                : "none"}
            </div>

            {/* Summary chips */}
            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              <SummaryChip label="Rows parsed" value={parsed.rows.length} />
              <SummaryChip label="To insert" value={diff.insertCount} accent="#1f8a4c" />
              <SummaryChip label="To update" value={diff.updateCount} accent={BRAND} />
            </div>

            {/* Warnings */}
            {parsed.warnings.length > 0 && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  color: "#92400e",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                <strong>Warnings</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {parsed.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Errors */}
            {hasHardErrors && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "#fff5f5",
                  border: "1px solid #fed7d7",
                  color: "#c53030",
                  fontSize: 12,
                  lineHeight: 1.5,
                  maxHeight: 180,
                  overflowY: "auto",
                }}
              >
                <strong>{parsed.errors.length} validation error{parsed.errors.length !== 1 ? "s" : ""} — fix the file and re-upload.</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {parsed.errors.slice(0, 100).map((e, i) => (
                    <li key={i}>
                      [{e.sheet} · row {e.rowNumber}] {e.message}
                    </li>
                  ))}
                  {parsed.errors.length > 100 && <li>… and {parsed.errors.length - 100} more.</li>}
                </ul>
              </div>
            )}

            {!hasHardErrors && parsed.rows.length === 0 && (
              <p style={{ fontSize: 13, color: "#c0392b", marginBottom: 12 }}>
                No valid rows were parsed from this file. Check the sheet names and headers.
              </p>
            )}

            {errorMsg && (
              <p style={{ fontSize: 13, color: "#c0392b", marginBottom: 12 }}>
                Upload failed: {errorMsg}
              </p>
            )}

            {/* Actions */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setParsed(null);
                  setFileName("");
                  setErrorMsg(null);
                  setPhase("choose");
                }}
                disabled={busy}
                className="btn btn-sm btn-outline-secondary"
                style={{ fontFamily: "Arial, sans-serif", fontSize: 12 }}
              >
                Choose another file
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="btn btn-sm"
                style={{
                  fontFamily: "Arial, sans-serif",
                  fontSize: 12,
                  background: canConfirm ? BRAND : "#e0e0e0",
                  color: canConfirm ? "#fff" : "#aaa",
                  border: "none",
                  cursor: canConfirm ? "pointer" : "not-allowed",
                }}
              >
                {phase === "uploading"
                  ? "Uploading…"
                  : `Confirm upload (${diff.insertCount + diff.updateCount})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── SummaryChip ───────────────────────────────────────────────────────────────

function SummaryChip({ label, value, accent = "#555" }: { label: string; value: number; accent?: string }) {
  return (
    <div
      style={{
        padding: "8px 14px",
        borderRadius: 8,
        background: "#f8f8f8",
        border: "1px solid #eee",
        minWidth: 96,
      }}
    >
      <div style={{ fontSize: 11, color: "#999", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent }}>{value}</div>
    </div>
  );
}
