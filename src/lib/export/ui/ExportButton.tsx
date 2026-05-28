"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ExportButton.tsx — The single entry component every dashboard consumes for
// data export. Owns the visual identity (Excel green + CSV blue + hover orange)
// and the Tier 1 / Tier 2 branching logic. Dashboards never import the core
// builders or the modal directly — they only ever render <ExportButton spec={…}/>.
//
// Behavior (from `docs/app/export-library-contract.md` § "ExportButton.tsx public API"):
//   - Tier 1: render 2 buttons side-by-side (Excel + CSV). Each click invokes
//             the corresponding `downloadExcel` / `downloadCsv` core helper
//             immediately. No modal.
//   - Tier 2: render 1 button "Export ↓". Click opens the universal
//             `ExportModal`, which handles filters + size estimation + format
//             toggle + download.
//   - Mobile: return null. Export is desktop-only per Mobile reform v2.
//
// Hover state: orange (#FF5000) border + soft orange box-shadow. Implemented
// with local React state (onMouseEnter / onMouseLeave) so the markup is
// self-contained and survives any future CSS-modules refactor.
//
// Tracking: fires `trackEvent("export", pathname, { format, rows? })` on each
// successful download, mirroring the legacy ExportPanel/ExportModal call shape.
// Failures are logged and re-thrown so upstream error boundaries can surface
// them; tracking is fire-and-forget by design.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useState, type CSSProperties, type JSX, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useIsMobile } from "@/hooks/useIsMobile";
import { trackEvent } from "@/lib/tracking";
import { downloadExcel, downloadCsv } from "@/lib/export";
import ExportModal from "@/lib/export/modal/ExportModal";
import type { ExportSpec } from "@/lib/export/types";
import { ExcelIcon, CsvIcon, DownloadIcon } from "./icons";

// ─── Public API ──────────────────────────────────────────────────────────────

export type ExportButtonProps = {
  spec: ExportSpec;
  onComplete?: (info: { format: "excel" | "csv"; rows?: number }) => void;
};

// ─── Visual constants ────────────────────────────────────────────────────────

const BRAND_ORANGE = "#FF5000";

const BUTTON_BASE_STYLE: CSSProperties = {
  fontFamily: "Arial",
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  transition: "border-color 120ms ease, box-shadow 120ms ease",
};

const BUTTON_HOVER_STYLE: CSSProperties = {
  borderColor: BRAND_ORANGE,
  boxShadow: `0 0 0 0.15rem rgba(255, 80, 0, 0.18)`,
};

// ─── Internal hover-aware button ─────────────────────────────────────────────

type HoverButtonProps = {
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  children: ReactNode;
  ariaLabel: string;
};

function HoverButton({ onClick, disabled, children, ariaLabel }: HoverButtonProps): JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="btn btn-outline-secondary btn-sm"
      onClick={() => void onClick()}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        ...BUTTON_BASE_STYLE,
        ...(hover && !disabled ? BUTTON_HOVER_STYLE : null),
      }}
    >
      {children}
    </button>
  );
}

// ─── ExportButton ────────────────────────────────────────────────────────────

export function ExportButton({ spec, onComplete }: ExportButtonProps): JSX.Element | null {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState<null | "excel" | "csv">(null);

  // Mobile: export is desktop-only per Mobile reform v2 (2026-05-27).
  // Returning null keeps `DashboardHeader.rightSlot` empty without forcing
  // every dashboard to branch on viewport.
  const handleComplete = useCallback(
    (format: "excel" | "csv", rows?: number) => {
      trackEvent("export", pathname ?? null, rows === undefined ? { format } : { format, rows });
      onComplete?.(rows === undefined ? { format } : { format, rows });
    },
    [onComplete, pathname],
  );

  const runDirect = useCallback(
    async (format: "excel" | "csv") => {
      if (busy) return;
      setBusy(format);
      try {
        // Tier 1 has no modal-editable filters; the spec's `rowsAsync`
        // closures own their filter binding (typically against the
        // dashboard's `useXxxData` hook). We pass an empty object as the
        // filter snapshot — the core builders accept it as the "no
        // explicit filters" signal.
        if (format === "excel") {
          await downloadExcel(spec.excel, spec.filename, {});
        } else {
          await downloadCsv(spec.csv, spec.filename, {});
        }
        handleComplete(format);
      } catch (err) {
        // Surface the failure to the console so error boundaries / Sentry
        // can capture it. Re-throw so any wrapping try/catch in callers
        // (none today, but future-proof) is not silently swallowed.
        console.error(`[ExportButton] ${format} download failed`, err);
        throw err;
      } finally {
        setBusy(null);
      }
    },
    [busy, handleComplete, spec.csv, spec.excel, spec.filename],
  );

  if (isMobile) return null;

  // ─── Tier 1: two direct buttons (Excel + CSV) ──────────────────────────
  if (spec.tier === 1) {
    return (
      <div style={{ display: "inline-flex", gap: 8 }}>
        <HoverButton
          ariaLabel="Download as Excel"
          onClick={() => void runDirect("excel")}
          disabled={busy !== null}
        >
          <ExcelIcon />
          <span>{busy === "excel" ? "Generating…" : "Excel"}</span>
        </HoverButton>
        <HoverButton
          ariaLabel="Download as CSV"
          onClick={() => void runDirect("csv")}
          disabled={busy !== null}
        >
          <CsvIcon />
          <span>{busy === "csv" ? "Generating…" : "CSV"}</span>
        </HoverButton>
      </div>
    );
  }

  // ─── Tier 2: single "Export ↓" trigger → modal ─────────────────────────
  return (
    <>
      <HoverButton
        ariaLabel="Open export options"
        onClick={() => setModalOpen(true)}
      >
        <DownloadIcon />
        <span>Export ↓</span>
      </HoverButton>
      <ExportModal
        spec={spec}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onComplete={(info: { format: "excel" | "csv"; rows?: number }) =>
          handleComplete(info.format, info.rows)
        }
      />
    </>
  );
}
