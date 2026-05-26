"use client";

// MonthRangePicker — From/To month-year selector with optional quick-range chips.
//
// Designed for dashboards with monthly granularity where the period spans many
// years (e.g. /imports-exports has 28+ years × 12 = 336 months — a slider
// becomes unreadable with that many ticks). This control replaces PeriodSlider
// in dates mode for monthly periods.
//
// Used by:
//   - /imports-exports desktop sidebar (this PR)
//   - /imports-exports mobile FilterDrawer (this PR — replaces inline selects)
//
// Props are framework-agnostic: the parent owns state and translates between
// the {ano, mes} cursors and whatever shape its hook uses.

import React from "react";

export interface MonthCursor {
  ano: number;
  mes: number; // 1-12
}

export interface MonthRangePickerProps {
  /** Lower bound (inclusive) — typically filtros.ano_min/mes_min. */
  min: MonthCursor;
  /** Upper bound (inclusive) — typically filtros.ano_max/mes_max. */
  max: MonthCursor;
  /** Current selection (inclusive on both ends). */
  value: { start: MonthCursor; end: MonthCursor };
  /** Called with a validated, ordered range. Parent must persist. */
  onChange: (next: { start: MonthCursor; end: MonthCursor }) => void;
  /** Layout: 'sidebar' (stacked, narrow) | 'inline' (compact row). Default 'sidebar'. */
  layout?: "sidebar" | "inline";
  /** Show quick-range chips above the selects. Default true. */
  showQuickRanges?: boolean;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ── helpers ────────────────────────────────────────────────────────────────────

function cmpMonth(a: MonthCursor, b: MonthCursor): number {
  if (a.ano !== b.ano) return a.ano < b.ano ? -1 : 1;
  if (a.mes !== b.mes) return a.mes < b.mes ? -1 : 1;
  return 0;
}

function addMonths(c: MonthCursor, n: number): MonthCursor {
  const totalIdx = c.ano * 12 + (c.mes - 1) + n;
  if (totalIdx < 0) return { ano: 1, mes: 1 };
  return {
    ano: Math.floor(totalIdx / 12),
    mes: (totalIdx % 12) + 1,
  };
}

function clamp(c: MonthCursor, lo: MonthCursor, hi: MonthCursor): MonthCursor {
  if (cmpMonth(c, lo) < 0) return lo;
  if (cmpMonth(c, hi) > 0) return hi;
  return c;
}

// ── quick ranges ───────────────────────────────────────────────────────────────

type QuickRangeKey = "12m" | "24m" | "ytd" | "5y" | "all";

interface QuickRange {
  key: QuickRangeKey;
  label: string;
  compute(min: MonthCursor, max: MonthCursor): { start: MonthCursor; end: MonthCursor };
}

const QUICK_RANGES: QuickRange[] = [
  {
    key: "12m",
    label: "Last 12m",
    compute: (min, max) => ({
      start: clamp(addMonths(max, -11), min, max),
      end: max,
    }),
  },
  {
    key: "24m",
    label: "Last 24m",
    compute: (min, max) => ({
      start: clamp(addMonths(max, -23), min, max),
      end: max,
    }),
  },
  {
    key: "ytd",
    label: "YTD",
    compute: (min, max) => ({
      start: clamp({ ano: max.ano, mes: 1 }, min, max),
      end: max,
    }),
  },
  {
    key: "5y",
    label: "Last 5y",
    compute: (min, max) => ({
      start: clamp(addMonths(max, -59), min, max),
      end: max,
    }),
  },
  {
    key: "all",
    label: "All",
    compute: (min, max) => ({ start: min, end: max }),
  },
];

function detectActiveQuickRange(
  min: MonthCursor,
  max: MonthCursor,
  value: { start: MonthCursor; end: MonthCursor },
): QuickRangeKey | null {
  for (const r of QUICK_RANGES) {
    const computed = r.compute(min, max);
    if (
      cmpMonth(computed.start, value.start) === 0 &&
      cmpMonth(computed.end, value.end) === 0
    ) {
      return r.key;
    }
  }
  return null;
}

// ── component ──────────────────────────────────────────────────────────────────

export default function MonthRangePicker({
  min,
  max,
  value,
  onChange,
  layout = "sidebar",
  showQuickRanges = true,
}: MonthRangePickerProps) {
  const years = React.useMemo(() => {
    const out: number[] = [];
    for (let y = min.ano; y <= max.ano; y += 1) out.push(y);
    return out;
  }, [min.ano, max.ano]);

  const active = detectActiveQuickRange(min, max, value);

  function applyQuick(key: QuickRangeKey) {
    const r = QUICK_RANGES.find((x) => x.key === key);
    if (!r) return;
    onChange(r.compute(min, max));
  }

  function setStart(next: MonthCursor) {
    const clampedStart = clamp(next, min, max);
    // If start > end, push end to start (single-month view).
    const end =
      cmpMonth(clampedStart, value.end) > 0 ? clampedStart : value.end;
    onChange({ start: clampedStart, end });
  }

  function setEnd(next: MonthCursor) {
    const clampedEnd = clamp(next, min, max);
    // If end < start, pull start back to end (single-month view).
    const start =
      cmpMonth(clampedEnd, value.start) < 0 ? clampedEnd : value.start;
    onChange({ start, end: clampedEnd });
  }

  const selectStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid #d0d0d0",
    background: "#fff",
    fontSize: 12,
    fontFamily: "Arial",
    color: "#1a1a1a",
    cursor: "pointer",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: "#888",
    marginBottom: 4,
    fontFamily: "Arial",
    fontWeight: 600,
    letterSpacing: "0.4px",
  };

  const chipBaseStyle: React.CSSProperties = {
    padding: "3px 10px",
    borderRadius: 999,
    border: "1px solid #d0d0d0",
    background: "#fff",
    color: "#555",
    fontFamily: "Arial",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
    lineHeight: 1.5,
  };
  const chipActiveStyle: React.CSSProperties = {
    background: "#ff5000",
    color: "#fff",
    border: "1px solid #ff5000",
  };

  const groupGap = layout === "inline" ? 6 : 8;
  const sectionGap = layout === "inline" ? 8 : 12;

  return (
    <div data-testid="month-range-picker">
      {showQuickRanges && (
        <div
          data-testid="month-range-quick-chips"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: sectionGap,
          }}
        >
          {QUICK_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => applyQuick(r.key)}
              style={{
                ...chipBaseStyle,
                ...(active === r.key ? chipActiveStyle : {}),
              }}
              aria-pressed={active === r.key}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: layout === "inline" ? "row" : "column",
          gap: sectionGap,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={labelStyle}>FROM</div>
          <div style={{ display: "flex", gap: groupGap }}>
            <select
              data-testid="month-range-from-month"
              aria-label="From month"
              value={value.start.mes}
              onChange={(e) =>
                setStart({ ano: value.start.ano, mes: Number(e.target.value) })
              }
              style={selectStyle}
            >
              {MONTH_LABELS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              data-testid="month-range-from-year"
              aria-label="From year"
              value={value.start.ano}
              onChange={(e) =>
                setStart({ ano: Number(e.target.value), mes: value.start.mes })
              }
              style={selectStyle}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={labelStyle}>TO</div>
          <div style={{ display: "flex", gap: groupGap }}>
            <select
              data-testid="month-range-to-month"
              aria-label="To month"
              value={value.end.mes}
              onChange={(e) =>
                setEnd({ ano: value.end.ano, mes: Number(e.target.value) })
              }
              style={selectStyle}
            >
              {MONTH_LABELS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              data-testid="month-range-to-year"
              aria-label="To year"
              value={value.end.ano}
              onChange={(e) =>
                setEnd({ ano: Number(e.target.value), mes: value.end.mes })
              }
              style={selectStyle}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
