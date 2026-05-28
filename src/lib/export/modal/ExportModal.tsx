"use client";

// Universal export modal for the unified library.
//
// Binding contract: docs/app/export-library-contract.md.
//
// The modal handles all 3 filterSource modes:
//   • wysiwyg         — show a read-only label list of the current dashboard
//                       filters (the spec passes `currentFilters` through and
//                       the modal renders the active values).
//   • modal-editable  — render `spec.modal.filters` controls (FilterEditor),
//                       and maintain local filter state. Changes re-fire the
//                       size estimator's count RPC (debounced 300ms inside it).
//   • none            — no filter section.
//
// Footer: SizeEstimator + FormatToggle (Excel/CSV) + Download button.
// On Download:
//   • format === "excel" → downloadExcel(spec.excel, spec.filename, filters)
//   • format === "csv"   → downloadCsv  (spec.csv,   spec.filename, filters)
//
// Tracking + onComplete are fired on success.

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";

import { trackEvent } from "@/lib/tracking";

import type { ExportSpec, ExportCompleteInfo } from "../types";
import { downloadExcel } from "../core/ExcelBuilder";
import { downloadCsv } from "../core/CsvBuilder";
import SizeEstimator from "./SizeEstimator";
import FormatToggle, { type ExportFormat } from "./FormatToggle";
import FilterEditor from "./FilterEditor";

const BRAND_ORANGE = "#FF5000";

export type ExportModalProps = {
  spec: ExportSpec;
  open: boolean;
  onClose: () => void;
  /**
   * Filter snapshot used when `spec.filterSource === "wysiwyg"`. Ignored in
   * "modal-editable" mode (modal owns its own filter state).
   */
  currentFilters?: Record<string, unknown>;
  /** Optional dataset key passed through to SizeEstimator. */
  datasetKey?: string;
  /** Loading-overlay caption. */
  loadingLabel?: string;
  /** Notification after a successful download (e.g. close, toast, focus). */
  onComplete?: (info: ExportCompleteInfo) => void;
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  marginBottom: 6,
  color: "#1a1a1a",
  textTransform: "uppercase",
  letterSpacing: "0.4px",
  fontFamily: "Arial",
};

function buildDefaults(spec: ExportSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of spec.modal?.filters ?? []) {
    if (c.type === "date-range" && c.default) out[c.key] = c.default;
    else if (c.type === "multi-select" && c.default) out[c.key] = c.default;
    else if (c.type === "single-select" && c.default) out[c.key] = c.default;
    else if (c.type === "segmented" && c.default) out[c.key] = c.default;
    else if (c.type === "search") out[c.key] = "";
  }
  return out;
}

export default function ExportModal({
  spec,
  open,
  onClose,
  currentFilters,
  datasetKey,
  loadingLabel = "Generating…",
  onComplete,
}: ExportModalProps): React.ReactElement | null {
  const pathname = usePathname();

  // Modal-editable filter state — initialise from spec defaults on first open.
  const [editableFilters, setEditableFilters] = useState<Record<string, unknown>>(
    () => buildDefaults(spec),
  );
  // Refresh defaults each time the modal re-opens with a new spec (rare, but
  // makes Storybook + tests deterministic).
  useEffect(() => {
    if (open && spec.filterSource === "modal-editable") {
      setEditableFilters(buildDefaults(spec));
    }
  }, [open, spec]);

  // Format + estimate-driven Download enable/disable.
  const [format, setFormat] = useState<ExportFormat>("excel");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<number | null>(null);

  // Close on Escape (when not busy).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  // Resolve the filter snapshot used for size estimation + download.
  const effectiveFilters: Record<string, unknown> = useMemo(() => {
    if (spec.filterSource === "modal-editable") return editableFilters;
    if (spec.filterSource === "wysiwyg") return currentFilters ?? {};
    return {};
  }, [spec.filterSource, editableFilters, currentFilters]);

  async function runDownload() {
    setBusy(true);
    try {
      if (format === "excel") {
        await downloadExcel(spec.excel, spec.filename, effectiveFilters);
      } else {
        await downloadCsv(spec.csv, spec.filename, effectiveFilters);
      }
      trackEvent("export", pathname ?? null, {
        format,
        rows: rows ?? undefined,
        dataset: datasetKey,
      });
      onComplete?.({ format, rows: rows ?? undefined });
      onClose();
    } catch (e) {
      console.error("[ExportModal] download failed", e);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const canDownload =
    !busy && (rows == null || rows > 0); // allow download even before count resolves

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      onClick={() => {
        if (!busy) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1050,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(2px)",
        fontFamily: "Arial",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-dialog modal-dialog-centered"
        style={{
          position: "relative",
          width: "min(640px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 64px)",
          margin: 0,
        }}
      >
        <div
          className="modal-content"
          style={{
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#ffffff",
            borderRadius: 10,
            boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            overflow: "hidden",
          }}
        >
          {/* Loading overlay */}
          {busy && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 5,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                backgroundColor: "rgba(255,255,255,0.92)",
                backdropFilter: "blur(4px)",
              }}
            >
              <Image src="/barrel_loading.png" alt="Loading…" width={120} height={120} />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#555",
                  letterSpacing: "0.3px",
                }}
              >
                {loadingLabel}
              </span>
            </div>
          )}

          {/* Header */}
          <div
            className="modal-header"
            style={{
              padding: "14px 20px",
              borderBottom: "1px solid #e6e6e6",
              backgroundColor: "#fafafa",
            }}
          >
            <div
              id="export-modal-title"
              className="modal-title"
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#1a1a1a",
                letterSpacing: "0.4px",
                textTransform: "uppercase",
              }}
            >
              Export — {spec.filename}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              disabled={busy}
              style={{
                border: "none",
                background: "transparent",
                fontSize: 20,
                lineHeight: 1,
                color: "#888",
                cursor: busy ? "not-allowed" : "pointer",
                padding: "0 4px",
              }}
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div
            className="modal-body"
            style={{
              padding: "16px 20px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              flex: "1 1 auto",
            }}
          >
            {spec.filterSource === "wysiwyg" && (
              <WysiwygActiveFilters filters={currentFilters ?? {}} />
            )}

            {spec.filterSource === "modal-editable" &&
              (spec.modal?.filters?.length ?? 0) > 0 && (
                <FilterEditor
                  controls={spec.modal!.filters!}
                  value={editableFilters}
                  onChange={setEditableFilters}
                  disabled={busy}
                />
              )}
          </div>

          {/* Estimate strip */}
          <div
            style={{
              padding: "10px 20px",
              borderTop: "1px solid #eee",
              backgroundColor: "#fafafa",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              fontSize: 12.5,
              color: "#444",
            }}
          >
            {spec.modal?.countRpc ? (
              <SizeEstimator
                filters={effectiveFilters}
                countRpc={spec.modal.countRpc}
                datasetKey={datasetKey}
                onEstimate={({ rows: r }) => setRows(r)}
              />
            ) : (
              <span>&nbsp;</span>
            )}
            <FormatToggle value={format} onChange={setFormat} disabled={busy} />
          </div>

          {/* Footer */}
          <div
            className="modal-footer"
            style={{
              padding: "12px 20px",
              borderTop: "1px solid #e6e6e6",
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              backgroundColor: "#ffffff",
            }}
          >
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onClose}
              disabled={busy}
              style={{ fontFamily: "Arial" }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void runDownload()}
              disabled={!canDownload}
              style={{
                fontFamily: "Arial",
                backgroundColor: BRAND_ORANGE,
                borderColor: BRAND_ORANGE,
                color: "#ffffff",
              }}
            >
              Download {format === "excel" ? "Excel" : "CSV"}
            </button>
          </div>

          {/* Brand accent bar */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              backgroundColor: BRAND_ORANGE,
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Read-only wysiwyg active-filters list ───────────────────────────────────

function WysiwygActiveFilters({
  filters,
}: {
  filters: Record<string, unknown>;
}): React.ReactElement {
  const entries = Object.entries(filters).filter(([, v]) => {
    if (v == null) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    if (typeof v === "string" && v.length === 0) return false;
    return true;
  });

  if (entries.length === 0) {
    return (
      <div style={{ fontSize: 12.5, color: "#888", fontStyle: "italic" }}>
        No active filters — the export will include the full visible dataset.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={LABEL_STYLE}>Active filters</div>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          fontSize: 12.5,
          color: "#1a1a1a",
          lineHeight: 1.6,
        }}
      >
        {entries.map(([k, v]) => (
          <li key={k}>
            <strong>{k}:</strong> {formatValue(v)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(v);
}
