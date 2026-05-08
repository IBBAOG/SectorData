"use client";

// Header export panel — "EXPORT DATA" card with Excel/CSV buttons.
//
// Replaces the inline markup duplicated across sales-volumes, market-share,
// diesel-gasoline-margins, and price-bands. The loading overlay
// (centered barrel-loading image + spinner caption) is also handled here.
//
// Buttons are passed declaratively via `actions`, each with its own onClick
// + busy flag. The panel is responsible for the layout, panel chrome, and
// the floating loading indicator.
//
// The `onClick` handler decides what happens — either run the export
// immediately, or flip a parent-managed modal open state. The component
// itself does not branch on action "mode".

import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { trackEvent } from "@/lib/tracking";
import type { ExportCompleteInfo, ExportFormat } from "./exportTypes";

// Local alias kept for backwards compatibility with existing imports — the
// canonical type lives in `./exportTypes` and is shared with `ExportModal`.
export type ExportActionKind = ExportFormat;
export type { ExportCompleteInfo } from "./exportTypes";

export interface ExportAction {
  kind: ExportActionKind;
  label: ReactNode;
  onClick: () => void | Promise<void>;
  /** When true, the action button is disabled. */
  disabled?: boolean;
  /** When true, the loading overlay shows with `loadingLabel`. */
  busy?: boolean;
  /** Caption shown in the loading overlay. */
  loadingLabel?: string;
}

export interface ExportPanelProps {
  /** Card heading — defaults to "EXPORT DATA". */
  heading?: string;
  actions: ExportAction[];
  /** Extra style for the outer relative wrapper (e.g. minWidth tuning). */
  style?: React.CSSProperties;
  /**
   * Optional callback fired after a successful download. The component
   * resolves `onClick` and only fires the callback if no error was thrown.
   * Also automatically dispatches a `track_event('export', route, ...)`
   * with the same info — callers do not need to instrument tracking
   * themselves.
   */
  onExportComplete?: (info: ExportCompleteInfo) => void;
}

const EXCEL_ICON = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    style={{ marginRight: 5, verticalAlign: "middle" }}
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
    style={{ marginRight: 5, verticalAlign: "middle" }}
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="3" y="2" width="18" height="20" rx="2" fill="#1565C0" />
    <rect x="6" y="7" width="12" height="1.5" rx="0.75" fill="#ffffff" />
    <rect x="6" y="11" width="12" height="1.5" rx="0.75" fill="#ffffff" />
    <rect x="6" y="15" width="8" height="1.5" rx="0.75" fill="#ffffff" />
  </svg>
);

export default function ExportPanel({
  heading = "Export Data",
  actions,
  style,
  onExportComplete,
}: ExportPanelProps) {
  const busyAction = actions.find((a) => a.busy);
  const pathname = usePathname();

  async function runAction(a: ExportAction) {
    try {
      await a.onClick();
      // Tracking — fire-and-forget. Rows/bytes unknown at this layer (Tier 1
      // dashboards download directly without a size precount), so we emit
      // the event without those fields and let the consumer enrich it via
      // `onExportComplete` if it knows the count.
      trackEvent("export", pathname ?? null, { format: a.kind });
      onExportComplete?.({ format: a.kind });
    } catch (err) {
      // Log + re-throw. Callers' own onClick handlers manage user-facing
      // error UI and busy-state reset via try/finally; swallowing here would
      // hide failures from upstream error boundaries and from any
      // unhandledrejection telemetry.
      console.error("[ExportPanel] export handler threw", err);
      throw err;
    }
  }

  return (
    <div style={{ position: "relative", minWidth: 180, ...style }}>
      {busyAction && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            zIndex: 20,
            border: "1px solid #e0e0e0",
            borderRadius: 12,
            padding: "24px 32px",
            backgroundColor: "rgba(255,255,255,0.97)",
            backdropFilter: "blur(8px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Image src="/barrel_loading.png" alt="Loading..." width={120} height={120} />
          <span
            style={{
              fontFamily: "Arial",
              fontSize: 13,
              fontWeight: 600,
              color: "#555",
              letterSpacing: "0.3px",
            }}
          >
            {busyAction.loadingLabel ?? "Generating…"}
          </span>
        </div>
      )}
      <div
        style={{
          border: "1px solid #d0d0d0",
          borderRadius: 6,
          padding: "10px 16px",
          backgroundColor: "#fafafa",
        }}
      >
        <div
          style={{
            fontFamily: "Arial",
            fontSize: 11,
            fontWeight: 700,
            color: "#1a1a1a",
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          {heading}
        </div>
        <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
          {actions.map((a, i) => (
            <button
              key={i}
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => void runAction(a)}
              disabled={a.disabled}
              style={{ fontFamily: "Arial" }}
            >
              {a.kind === "excel" ? EXCEL_ICON : CSV_ICON}
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
