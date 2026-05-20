"use client";

// Generic ~88-96px tall data card. The atomic row that powers stocks lists,
// home gallery items, news feed items, navios cards, etc.
//
// Visual source of truth:
//   mockups/stocks-mobile.html (.card with sparkline + price)
//   mockups/home-mobile.html   (.module-card with thumb)
//   mockups/news-hunter-mobile.html (.article with snippet)
//   mockups/navios-diesel-mobile.html (.vessel with status pill)
//
// Layout (default / "compact" / "expanded"):
//   default  : icon (56px) · title + subtitle · rightSlot
//   compact  : icon (40px) · title only · rightSlot   (min-height 64)
//   expanded : same as default + larger min-height for line-clamp 2 subtitles
//
// Sparkline is intentionally inline SVG (not Plotly) — Plotly is too heavy
// when rendered N times in a list. Matches the implementation in
// mockups/stocks-mobile.html#sparkline().

import type { ReactNode } from "react";

export type MobileDataCardVariant = "default" | "compact" | "expanded";

export interface MobileDataCardStatus {
  /** Display label shown inside the pill. */
  label: string;
  /** One of the named statuses with mobile-status-* tokens. */
  tone: "unloading" | "anchored" | "enroute" | "completed" | "neutral";
}

export interface MobileDataCardProps {
  /** Left-side icon / avatar / thumb. ~56px by default. */
  leftIcon?: ReactNode;
  /** Main title (single line, ellipsis). */
  title: ReactNode;
  /** Secondary line (single line by default, 2 lines in "expanded"). */
  subtitle?: ReactNode;
  /** Right slot — typically price+delta, chevron, badge, etc. */
  rightSlot?: ReactNode;
  /** Tap handler — fires when the whole row is pressed. */
  onClick?: () => void;
  /** Optional status pill rendered above the right slot. */
  status?: MobileDataCardStatus;
  /** Sparkline data series; rendered as an inline 76×32 SVG. */
  sparkline?: number[];
  /** Sparkline colour. Defaults to brand orange. */
  sparklineColor?: string;
  variant?: MobileDataCardVariant;
  /** When true, dim the card (e.g. completed / disabled items). */
  dim?: boolean;
  /** Use uniform horizontal padding (default 16px) — override sparingly. */
  paddingX?: number;
  className?: string;
}

function statusColors(tone: MobileDataCardStatus["tone"]): {
  bg: string;
  fg: string;
} {
  switch (tone) {
    case "unloading":
      return {
        bg: "var(--mobile-status-unloading-bg)",
        fg: "var(--mobile-status-unloading)",
      };
    case "anchored":
      return {
        bg: "var(--mobile-status-anchored-bg)",
        fg: "var(--mobile-status-anchored)",
      };
    case "enroute":
      return {
        bg: "var(--mobile-status-enroute-bg)",
        fg: "var(--mobile-status-enroute)",
      };
    case "completed":
      return {
        bg: "var(--mobile-status-completed-bg)",
        fg: "var(--mobile-status-completed)",
      };
    default:
      return {
        bg: "var(--mobile-divider)",
        fg: "var(--mobile-text-muted)",
      };
  }
}

// Tiny inline sparkline. Mirrors mockups/stocks-mobile.html#sparkline.
function Sparkline({
  values,
  color,
  width = 76,
  height = 32,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}): React.ReactElement | null {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = innerW / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = pad + innerH - ((v - min) / span) * innerH;
    return [x, y] as const;
  });
  const line = pts
    .map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(2) + "," + p[1].toFixed(2))
    .join(" ");
  const area =
    line +
    " L" +
    pts[pts.length - 1][0].toFixed(2) +
    "," +
    (height - pad).toFixed(2) +
    " L" +
    pts[0][0].toFixed(2) +
    "," +
    (height - pad).toFixed(2) +
    " Z";

  // Soft area fill at 12% alpha — works for #rrggbb input only.
  let fillRgba = "rgba(255,80,0,0.12)";
  const hex = color.replace("#", "");
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    fillRgba = `rgba(${r},${g},${b},0.12)`;
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d={area} fill={fillRgba} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function MobileDataCard(
  props: MobileDataCardProps,
): React.ReactElement {
  const {
    leftIcon,
    title,
    subtitle,
    rightSlot,
    onClick,
    status,
    sparkline,
    sparklineColor,
    variant = "default",
    dim = false,
    paddingX = 16,
    className,
  } = props;

  const isCompact = variant === "compact";
  const isExpanded = variant === "expanded";
  const minHeight = isCompact ? 64 : isExpanded ? 104 : 88;
  const iconSize = isCompact ? 40 : 56;
  const subtitleLineClamp = isExpanded ? 2 : 1;

  // Build a 3-column grid: icon · body · right. When sparkline is present, it
  // takes the right column above the rightSlot. We replicate the stocks layout
  // ("id price spark" 3-col) when sparkline is provided without rightSlot.
  const gridTemplate = sparkline
    ? leftIcon
      ? "auto 1fr auto 76px"
      : "1fr auto 76px"
    : leftIcon
      ? "auto 1fr auto"
      : "1fr auto";

  return (
    <article
      onClick={onClick}
      className={className}
      style={{
        minHeight,
        padding: `${isExpanded ? 14 : 12}px ${paddingX}px`,
        display: "grid",
        gridTemplateColumns: gridTemplate,
        columnGap: 12,
        alignItems: "center",
        background: "var(--mobile-surface)",
        color: "var(--mobile-text)",
        borderBottom: "1px solid var(--mobile-divider)",
        cursor: onClick ? "pointer" : "default",
        transition: "background 0.12s ease",
        opacity: dim ? 0.62 : 1,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
      onPointerDown={(e) => {
        if (!onClick) return;
        (e.currentTarget as HTMLElement).style.background =
          "var(--mobile-row-press)";
      }}
      onPointerUp={(e) => {
        (e.currentTarget as HTMLElement).style.background =
          "var(--mobile-surface)";
      }}
      onPointerLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background =
          "var(--mobile-surface)";
      }}
    >
      {leftIcon && (
        <div
          aria-hidden="true"
          style={{
            width: iconSize,
            height: iconSize,
            borderRadius: "var(--mobile-radius-lg)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--mobile-text)",
            flexShrink: 0,
          }}
        >
          {leftIcon}
        </div>
      )}

      <div style={{ minWidth: 0 }}>
        {status && (
          <div style={{ marginBottom: 4 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 9px",
                borderRadius: "var(--mobile-radius-full)",
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: statusColors(status.tone).bg,
                color: statusColors(status.tone).fg,
                whiteSpace: "nowrap",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: statusColors(status.tone).fg,
                }}
              />
              {status.label}
            </span>
          </div>
        )}
        <div
          style={{
            fontSize: isCompact ? 14 : 16,
            fontWeight: 600,
            color: "var(--mobile-text)",
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: "var(--mobile-text-muted)",
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: subtitleLineClamp,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {subtitle}
          </div>
        )}
      </div>

      {rightSlot && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
            color: "var(--mobile-text-faint)",
          }}
        >
          {rightSlot}
        </div>
      )}

      {sparkline && (
        <div style={{ height: 32 }}>
          <Sparkline
            values={sparkline}
            color={sparklineColor ?? "var(--mobile-accent)"}
          />
        </div>
      )}
    </article>
  );
}
