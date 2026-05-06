"use client";

// Segmented (pill) toggle with sliding orange background.
//
// Replaces the inline JSX duplicated across:
//   - sales-volumes / market-share : View Mode (Individual / Big-3 / Others)
//   - navios-diesel : AIS On / AIS Off
//   - price-bands : YTD year selector
//
// Visual identity preserved byte-for-byte:
//   - background pill: #f0f0f0
//   - active background: #ff5000 (brand orange)
//   - 0.22s cubic-bezier slide
//   - Arial 12px (configurable via `size`)
//   - active text white + 700, inactive #555 + 500

import type { CSSProperties, ReactNode } from "react";

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
  /** Override font size (default 12 for full, 11 for compact). */
  fontSize?: number;
  /** Optional outer container style overrides. */
  style?: CSSProperties;
  /** Per-button horizontal padding override (default 0 for full, "3px 12px" for compact). */
  buttonPadding?: string;
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
  const fs = fontSize ?? (variant === "compact" ? 11 : 12);
  const padY = variant === "compact" ? "3px" : "4px";
  const padX = buttonPadding ?? (variant === "compact" ? "12px" : "0");
  const flex = variant === "full" ? 1 : undefined;
  const width = variant === "full" ? "100%" : undefined;

  return (
    <div
      style={{
        position: "relative",
        display: variant === "full" ? "flex" : "inline-flex",
        alignItems: "center",
        backgroundColor: "#f0f0f0",
        borderRadius: 999,
        padding: "3px 4px",
        width,
        ...style,
      }}
    >
      {/* sliding orange highlight */}
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
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              position: "relative",
              zIndex: 1,
              background: "transparent",
              color: isActive ? "#ffffff" : "#555555",
              border: "none",
              borderRadius: 999,
              padding: variant === "full" ? `${padY} 0` : `${padY} ${padX}`,
              flex,
              textAlign: "center",
              fontFamily: "Arial",
              fontSize: fs,
              fontWeight: isActive ? 700 : 500,
              cursor: "pointer",
              transition: "color 0.18s",
              lineHeight: 1.4,
              userSelect: "none",
              whiteSpace: "nowrap",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
