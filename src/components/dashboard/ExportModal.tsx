"use client";

// Export modal for heavy datasets.
//
// Used by dashboards whose ingestion tables are large enough that exporting
// "everything currently visible" would be ambiguous or expensive. The modal
// gives the user a chance to:
//
//   1. Re-confirm filters (the dashboard passes its own filter UI through
//      the `filters` slot — usually a stack of `MultiSelectFilter` /
//      `PeriodSlider` / `RegionStateFilter` components).
//   2. See a real-time size estimate ("~12.4 MB · 87 200 linhas") that
//      updates as filters change, courtesy of `useExportSize`.
//   3. Pick Excel or CSV.
//
// The modal is purely presentational — it does NOT own the filter state
// (the parent owns it and passes `currentFilters` snapshot through), and
// it does NOT own the export logic (the parent passes `onExportExcel` /
// `onExportCsv` handlers). This keeps the modal reusable across the 17
// dashboards in Fase B.

import { useEffect, type ReactNode } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useExportSize } from "@/hooks/useExportSize";
import { formatBytes } from "@/lib/exportSizeHeuristics";
import { trackEvent } from "@/lib/tracking";

const BRAND_ORANGE = "#ff5000";
const HARD_LIMIT_ROWS = 200_000;

export type ExportFormat = "excel" | "csv";

export interface ExportCompleteInfo {
  format: ExportFormat;
  rows?: number;
  bytes?: number;
}

export type ExportModalProps = {
  open: boolean;
  onClose: () => void;
  /** Modal title — e.g. "Exportar Vendas ANP". */
  title: string;
  /** Dataset key (used by `useExportSize` to pick the heuristic). */
  datasetKey: string;
  /** Filter UI rendered above the size estimate. */
  filters: ReactNode;
  /** Current filter state — passed to `countFetcher` as-is. */
  currentFilters: unknown;
  /** Returns the row count for `currentFilters`. */
  countFetcher: (filters: unknown) => Promise<number>;
  /** Triggered when the user clicks the Excel button. */
  onExportExcel: () => Promise<void> | void;
  /** Triggered when the user clicks the CSV button. */
  onExportCsv: () => Promise<void> | void;
  /** Loading state for the Excel button. */
  excelBusy?: boolean;
  /** Loading state for the CSV button. */
  csvBusy?: boolean;
  /** Caption shown in the loading overlay. */
  loadingLabel?: string;
  /**
   * Optional callback fired after a successful download. The modal also
   * automatically emits `track_event('export', route, { format, rows, bytes })`
   * using the live size estimate — callers do not need to instrument
   * tracking themselves.
   */
  onExportComplete?: (info: ExportCompleteInfo) => void;
};

const EXCEL_ICON = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    style={{ marginRight: 6, verticalAlign: "middle" }}
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2" y="2" width="20" height="20" rx="3" fill="#217346" />
    <text x="4" y="17" fontFamily="Arial" fontWeight="bold" fontSize="12" fill="#ffffff">
      X
    </text>
  </svg>
);

const CSV_ICON = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    style={{ marginRight: 6, verticalAlign: "middle" }}
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="3" y="2" width="18" height="20" rx="2" fill="#1565C0" />
    <rect x="6" y="7" width="12" height="1.5" rx="0.75" fill="#ffffff" />
    <rect x="6" y="11" width="12" height="1.5" rx="0.75" fill="#ffffff" />
    <rect x="6" y="15" width="8" height="1.5" rx="0.75" fill="#ffffff" />
  </svg>
);

function formatRows(n: number): string {
  // Brazilian thousand separator (non-breaking thin space).
  return new Intl.NumberFormat("pt-BR").format(n);
}

export default function ExportModal({
  open,
  onClose,
  title,
  datasetKey,
  filters,
  currentFilters,
  countFetcher,
  onExportExcel,
  onExportCsv,
  excelBusy = false,
  csvBusy = false,
  loadingLabel = "Gerando…",
  onExportComplete,
}: ExportModalProps) {
  const { estimate, loading, error } = useExportSize(
    currentFilters,
    countFetcher,
    datasetKey,
  );
  const pathname = usePathname();

  async function runExport(format: ExportFormat) {
    const handler = format === "excel" ? onExportExcel : onExportCsv;
    try {
      await handler();
      const rows = estimate?.rows;
      const bytes = format === "excel" ? estimate?.bytesXlsx : estimate?.bytesCsv;
      trackEvent("export", pathname ?? null, {
        format,
        rows,
        bytes,
        dataset: datasetKey,
      });
      onExportComplete?.({ format, rows, bytes });
    } catch (err) {
      console.error(`[ExportModal] ${format} export failed`, err);
    }
  }

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !excelBusy && !csvBusy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, excelBusy, csvBusy]);

  if (!open) return null;

  const busy = excelBusy || csvBusy;
  const overLimit = estimate !== null && estimate.rows > HARD_LIMIT_ROWS;

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
        style={{
          position: "relative",
          width: "min(640px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#ffffff",
          borderRadius: 10,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        {/* Loading overlay (matches ExportPanel chrome) */}
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
            <Image
              src="/barrel_loading.png"
              alt="Carregando..."
              width={120}
              height={120}
            />
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
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #e6e6e6",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: "#fafafa",
          }}
        >
          <div
            id="export-modal-title"
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#1a1a1a",
              letterSpacing: "0.4px",
              textTransform: "uppercase",
            }}
          >
            {title}
          </div>
          <button
            type="button"
            aria-label="Fechar"
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
          style={{
            padding: "16px 20px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            flex: "1 1 auto",
          }}
        >
          <div>{filters}</div>
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
          <div>
            {error ? (
              <span style={{ color: "#c0392b" }}>
                Erro ao calcular tamanho: {error}
              </span>
            ) : loading || estimate === null ? (
              <span style={{ color: "#888" }}>Calculando…</span>
            ) : estimate.rows === 0 ? (
              <span style={{ color: "#888" }}>Nenhuma linha para os filtros atuais.</span>
            ) : (
              <span>
                <strong style={{ color: "#1a1a1a" }}>
                  ~{formatBytes(estimate.bytesXlsx)} (Excel)
                </strong>
                {" · "}
                <span>{formatBytes(estimate.bytesCsv)} (CSV)</span>
                {" · "}
                <span>{formatRows(estimate.rows)} linhas</span>
              </span>
            )}
          </div>
          {overLimit && (
            <div
              style={{
                color: "#a06800",
                backgroundColor: "#fff3cd",
                border: "1px solid #ffe69c",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: 11.5,
                fontWeight: 600,
              }}
              title="Volume alto — pode demorar ou falhar no navegador"
            >
              Volume alto — pode demorar/falhar
            </div>
          )}
        </div>

        {/* Footer */}
        <div
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
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void runExport("csv")}
            disabled={busy || !!error || !estimate || estimate.rows === 0}
            style={{
              fontFamily: "Arial",
              backgroundColor: "#1565C0",
              borderColor: "#1565C0",
              color: "#ffffff",
            }}
          >
            {CSV_ICON}
            CSV
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void runExport("excel")}
            disabled={busy || !!error || !estimate || estimate.rows === 0}
            style={{
              fontFamily: "Arial",
              backgroundColor: "#217346",
              borderColor: "#217346",
              color: "#ffffff",
            }}
          >
            {EXCEL_ICON}
            Excel
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
  );
}
