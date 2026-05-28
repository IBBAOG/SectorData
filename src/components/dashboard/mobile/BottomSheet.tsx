"use client";

// Primitive slide-up sheet that backs FilterDrawer and any ad-hoc
// modal-like surfaces (export options, picker, etc.).
//
// Visual source of truth:
//   mockups/market-share-mobile.html (.sheet / .sheet-scrim / .sheet-handle)
//   mockups/anp-cdp-mobile.html       (filter sheet variant)
//
// Behaviour notes:
//   • Always centered to max-width 428 (matches the phone shell).
//   • Slides on translateY(100%) -> translateY(0); transition is 280ms.
//   • Scrim + the handle area + the close button on FilterDrawer all
//     fire onClose. Drag-to-close physics intentionally omitted — the
//     handle is a tap target, not a gesture surface.
//   • Body locks page scroll while open by adding overflow:hidden to <body>.
//   • Renders nothing when !open (keeps DOM cheap).

import { useEffect, type ReactNode } from "react";

export type BottomSheetHeight = "auto" | "70vh" | "90vh";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Sheet vertical sizing. "auto" lets content drive height (max 85vh). */
  height?: BottomSheetHeight;
  /** Set to false to suppress the dark scrim behind the sheet. */
  showScrim?: boolean;
  /** Accessibility label for the dialog when no title is provided. */
  ariaLabel?: string;
  /** Phone-shell max-width — defaults to 428px to match the mockups. */
  maxWidth?: number;
}

export default function BottomSheet(
  props: BottomSheetProps,
): React.ReactElement | null {
  const {
    open,
    onClose,
    title,
    children,
    footer,
    height = "auto",
    showScrim = true,
    ariaLabel,
    maxWidth = 428,
  } = props;

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const maxHeight =
    height === "auto" ? "85dvh" : height === "70vh" ? "70dvh" : "90dvh";

  return (
    <>
      {showScrim && (
        <div
          aria-hidden="true"
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--mobile-scrim)",
            // Above MobileHomePill (z-index 1000) so the floating pill cannot
            // overlap the sheet's Apply/Reset buttons. Below MobileToastHost
            // (z-index 1100) so toasts still surface above active sheets.
            zIndex: 1010,
            opacity: 1,
            transition: "opacity 0.2s ease",
          }}
        />
      )}

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : ariaLabel}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          // Paired with the scrim above MobileHomePill (z-index 1000). See
          // the scrim's zIndex note for the full stacking rationale.
          zIndex: 1020,
          maxWidth,
          margin: "0 auto",
          background: "var(--mobile-sheet-bg)",
          color: "var(--mobile-text)",
          borderTopLeftRadius: "var(--mobile-radius-xl)",
          borderTopRightRadius: "var(--mobile-radius-xl)",
          maxHeight,
          height: height === "auto" ? "auto" : maxHeight,
          display: "flex",
          flexDirection: "column",
          transform: "translateY(0)",
          transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
          boxShadow: "0 -8px 32px rgba(0, 0, 0, 0.18)",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        {/* Drag-to-close handle (tappable, not physics-driven) */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "10px 0 6px",
            background: "transparent",
            border: 0,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "var(--mobile-sheet-handle)",
              display: "block",
            }}
          />
        </button>

        {title && (
          <header
            style={{
              padding: "4px 16px 12px",
              borderBottom: "1px solid var(--mobile-divider)",
              flexShrink: 0,
              fontSize: 17,
              fontWeight: 700,
              color: "var(--mobile-text)",
              textAlign: "center",
            }}
          >
            {title}
          </header>
        )}

        <div
          style={{
            flex: "1 1 auto",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: 16,
          }}
        >
          {children}
        </div>

        {footer && (
          <footer
            style={{
              flexShrink: 0,
              borderTop: "1px solid var(--mobile-divider)",
              background: "var(--mobile-sheet-bg)",
              padding: `12px 16px calc(12px + ${"var(--mobile-safe-bottom)"})`,
            }}
          >
            {footer}
          </footer>
        )}
      </aside>
    </>
  );
}
