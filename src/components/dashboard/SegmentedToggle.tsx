"use client";

// Segmented (pill) toggle with sliding orange background.
//
// Replaces the inline JSX duplicated across:
//   - sales-volumes / market-share : View Mode (Individual / Big-3 / Others)
//   - navios-diesel : AIS On / AIS Off
//   - price-bands : YTD year selector
//   - anp-cdp-bsw / anp-cdp-depletion : View / X axis / Plot style (sidebar)
//
// Visual identity preserved byte-for-byte:
//   - background pill: #f0f0f0
//   - active background: #ff5000 (brand orange)
//   - 0.22s cubic-bezier slide
//   - Arial (configurable size; default 12 for full, 11 for compact)
//   - active text white + 700, inactive #555 + 500
//
// Equal-cell guarantee (2026-05-25):
//   - All option cells share the SAME width regardless of which option is
//     selected. The pill slides between identical cells, never resizes.
//   - Cell width = widest label + 2 × CELL_HORIZONTAL_PAD when it fits the
//     container; otherwise = (container - 8) / N (equal share of available
//     width).
//   - When cell width is too tight for the longest label at the base font,
//     the entire toggle's font scales down (down to MIN_FONT_SIZE) so all
//     labels fit without ellipsis truncation. Below that floor, ellipsis +
//     `title` tooltip kick in (only happens in pathologically narrow
//     containers).
//   - Text is centered both horizontally and vertically inside every cell
//     (`text-align: center` + `justify-content: center` + `align-items:
//     center` on the inline-flex button).

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export interface SegmentedToggleOption<T extends string | number | boolean> {
  value: T;
  label: ReactNode;
}

export interface SegmentedToggleProps<T extends string | number | boolean> {
  options: SegmentedToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** "compact" matches navios-diesel / price-bands; "full" stretches like the View Mode pill. */
  variant?: "compact" | "full";
  /** Override font size (default 12 for full, 11 for compact). Acts as the upper bound for auto-shrink. */
  fontSize?: number;
  /** Optional outer container style overrides. */
  style?: CSSProperties;
  /** Per-button horizontal padding override (default 0 for full, "12px" for compact). */
  buttonPadding?: string;
}

// Horizontal margin (each side) added around the widest label in the IDEAL
// (uncrammed) layout. 12px matches the breathing room the design identity
// expects for sidebar toggles.
const CELL_HORIZONTAL_PAD = 12;
// Minimum margin reserved each side when the container is cramped and the
// font has been shrunk to fit — keeps the pill from hugging the text.
const CELL_HORIZONTAL_PAD_MIN = 4;
// Smallest acceptable font size before we give up shrinking and fall back to
// ellipsis truncation.
const MIN_FONT_SIZE = 10;

function labelTitle(label: ReactNode): string {
  if (typeof label === "string" || typeof label === "number") return String(label);
  return "";
}

export default function SegmentedToggle<T extends string | number | boolean>({
  options,
  value,
  onChange,
  variant = "full",
  fontSize,
  style,
  buttonPadding,
}: SegmentedToggleProps<T>) {
  const activeIdx = options.findIndex((o) => o.value === value);
  const baseFs = fontSize ?? (variant === "compact" ? 11 : 12);
  const padY = variant === "compact" ? "3px" : "4px";
  const padX = buttonPadding ?? (variant === "compact" ? "12px" : "0");

  // ── Refs ────────────────────────────────────────────────────────────────
  const ghostRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ── Layout state ────────────────────────────────────────────────────────
  // `widestAtBase`: widest label width measured at the base bold font.
  // `actualCell`:   each cell's rendered width (in px).
  // `renderedFs`:   font-size we actually paint with — equals baseFs when
  //                 the ideal cell fits, smaller when shrunk to fit.
  const [widestAtBase, setWidestAtBase] = useState<number | null>(null);
  const [actualCell, setActualCell] = useState<number | null>(null);
  const [renderedFs, setRenderedFs] = useState<number>(baseFs);

  // Measure widest label at the base bold weight (the worst-case width is
  // the active state because bold glyphs are wider). Happens once per
  // option-set / base-fontSize change.
  useLayoutEffect(() => {
    let max = 0;
    for (const ref of ghostRefs.current) {
      if (!ref) continue;
      const w = ref.getBoundingClientRect().width;
      if (w > max) max = w;
    }
    setWidestAtBase(Math.ceil(max));
  }, [options, baseFs]);

  // Compute actualCell + renderedFs whenever the widest label or container
  // width changes. ResizeObserver keeps cells in sync with parent resizes
  // (window resize, Bootstrap breakpoint changes, sidebar scrollbar
  // appearing/disappearing — though `scrollbar-gutter: stable` should
  // prevent the latter for us).
  useEffect(() => {
    if (widestAtBase === null) return;
    function recalc() {
      if (widestAtBase === null) return;
      const N = options.length;
      const idealCell = widestAtBase + CELL_HORIZONTAL_PAD * 2;
      const container = containerRef.current;

      if (variant === "compact" || !container) {
        // Compact variant always grows to ideal — no parent constraint.
        setActualCell(idealCell);
        setRenderedFs(baseFs);
        return;
      }

      // "Full" variant — bounded by parent width.
      const parentWidth = container.parentElement?.getBoundingClientRect().width
        ?? container.getBoundingClientRect().width;
      const usable = Math.max(0, parentWidth - 8); // strip container's 4px+4px inner pad
      const idealTotal = idealCell * N;

      if (idealTotal <= usable) {
        // Ideal fits — cells share `usable` equally so the toggle visually
        // spans the parent, but the pill always lands on `usable/N` which
        // is ≥ idealCell (so the bold text fits with room to spare).
        setActualCell(usable / N);
        setRenderedFs(baseFs);
      } else {
        // Cramped — share what's available equally and shrink the font so
        // the longest label still fits without ellipsis.
        const cell = usable / N;
        // Required font so that widestAtBase × (newFs/baseFs) fits in
        // (cell - 2 × CELL_HORIZONTAL_PAD_MIN).
        const maxTextWidth = Math.max(0, cell - CELL_HORIZONTAL_PAD_MIN * 2);
        const fittedFs = widestAtBase > 0
          ? Math.floor((maxTextWidth / widestAtBase) * baseFs * 10) / 10
          : baseFs;
        const clampedFs = Math.max(MIN_FONT_SIZE, Math.min(baseFs, fittedFs));
        setActualCell(cell);
        setRenderedFs(clampedFs);
      }
    }
    recalc();
    const container = containerRef.current;
    if (!container) return;
    // ResizeObserver covers parent reflows that don't change viewport size.
    const ro = new ResizeObserver(recalc);
    ro.observe(container);
    if (container.parentElement) ro.observe(container.parentElement);
    // window.resize is a reliable backup for viewport changes (Bootstrap
    // breakpoints redistribute col widths but the section's
    // ResizeObserver entry was observed to skip notifications in some
    // Chromium versions when the change is purely caused by the col
    // gaining/losing % share).
    window.addEventListener("resize", recalc);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recalc);
    };
  }, [widestAtBase, options.length, variant, baseFs]);

  // Container width:
  //   - "full"    : 100% of parent. Pill = (100% - 8px) / N.
  //   - "compact" : sum of N ideal cells + 8px inner pad.
  const containerWidth =
    variant === "full"
      ? "100%"
      : actualCell !== null
        ? `${actualCell * options.length + 8}px`
        : "max-content";

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        display: variant === "full" ? "flex" : "inline-flex",
        alignItems: "stretch",
        backgroundColor: "#f0f0f0",
        borderRadius: 999,
        padding: "3px 4px",
        width: containerWidth,
        ...(actualCell !== null
          ? ({ ["--seg-cell" as string]: `${actualCell}px` } as CSSProperties)
          : {}),
        ...style,
      }}
    >
      {/* ── Hidden ghost row — measures widest label at base bold weight ─
          Spans use display:block + width:max-content so each one's
          bounding rect = its intrinsic text width. visibility:hidden keeps
          them in the layout tree (measurable via refs) but invisible. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          fontFamily: "Arial",
          fontSize: baseFs,
          fontWeight: 700,
          top: 0,
          left: 0,
          width: "max-content",
        }}
      >
        {options.map((opt, i) => (
          <span
            key={`ghost-${String(opt.value)}`}
            ref={(el) => {
              ghostRefs.current[i] = el;
            }}
            style={{
              display: "block",
              width: "max-content",
              whiteSpace: "nowrap",
            }}
          >
            {opt.label}
          </span>
        ))}
      </div>

      {/* ── Sliding orange highlight ──────────────────────────────────────
          Equal cells ⇒ pill width = (100% - 8px) / N, left offset = activeIdx × cell. */}
      <div
        style={{
          position: "absolute",
          top: 3,
          bottom: 3,
          left: `calc(4px + ${activeIdx} * (100% - 8px) / ${options.length})`,
          width: `calc((100% - 8px) / ${options.length})`,
          backgroundColor: "#ff5000",
          borderRadius: 999,
          transition: "left 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />

      {/* ── Visible buttons — all cells equal width + centered text ───── */}
      {options.map((opt) => {
        const isActive = opt.value === value;
        const title = labelTitle(opt.label);
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            title={title || undefined}
            style={{
              position: "relative",
              zIndex: 1,
              background: "transparent",
              color: isActive ? "#ffffff" : "#555555",
              border: "none",
              borderRadius: 999,
              padding: variant === "full" ? `${padY} 0` : `${padY} ${padX}`,
              flex: actualCell !== null ? `1 1 ${actualCell}px` : "1 1 auto",
              minWidth: 0,
              width: actualCell !== null ? `${actualCell}px` : undefined,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              fontFamily: "Arial",
              fontSize: renderedFs,
              fontWeight: isActive ? 700 : 500,
              cursor: "pointer",
              // Color transitions on selection. Font-size deliberately does
              // NOT transition — when the cell width changes (e.g. parent
              // resize) the auto-shrunk font snaps to the new value instead
              // of animating, which avoids the visual "settling" jitter and
              // also dodges a Chromium bug where mid-transition values are
              // not reflected in getComputedStyle.
              transition: "color 0.18s",
              lineHeight: 1.4,
              userSelect: "none",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
