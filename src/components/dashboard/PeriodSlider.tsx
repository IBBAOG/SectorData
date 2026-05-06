"use client";

// Period slider used by Phase 3+ dashboards.
//
// Two modes via discriminated props:
//
//   • Years mode (default — Phase 3/4 dashboards):
//       <PeriodSlider years={[2018, 2019, ...]} value={[0, 5]} onChange={...} />
//     Lightweight wrapper with year labels below the rc-slider track.
//
//   • Dates mode (Phase 4 Bis — for price-bands):
//       <PeriodSlider dates={["2023-06-01", ...]} value={[0, 50]} onChange={...} />
//     Drop-in replacement for the legacy src/components/PeriodSlider.tsx:
//       - smooth dragging (parent only learns the new value on release)
//       - per-handle date label rendered above each thumb
//       - year tick marks at January of every year present
//       - optional `fmtLabel(date)` and `sliderId`.
//
// Visual layouts are kept distinct so the existing 10 Phase 4 pages don't drift.

import Slider, { type SliderProps } from "rc-slider";
import "rc-slider/assets/index.css";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PeriodSliderProps =
  | {
      years: number[];
      dates?: never;
      value: [number, number];
      onChange: (next: [number, number]) => void;
      disabled?: boolean;
      sliderId?: never;
      fmtLabel?: never;
    }
  | {
      years?: never;
      dates: string[];
      value: [number, number];
      onChange: (next: [number, number]) => void;
      disabled?: boolean;
      sliderId?: string;
      fmtLabel?: (d: string) => string;
    };

export default function PeriodSlider(props: PeriodSliderProps) {
  if ("dates" in props && props.dates !== undefined) {
    return <DateRangeSlider {...(props as DatePropsConcrete)} />;
  }
  return <YearRangeSlider {...(props as YearPropsConcrete)} />;
}

// ── Years mode (Phase 4 default) ──────────────────────────────────────────────

interface YearPropsConcrete {
  years: number[];
  value: [number, number];
  onChange: (next: [number, number]) => void;
  disabled?: boolean;
}

function YearRangeSlider({ years, value, onChange, disabled }: YearPropsConcrete) {
  if (!years.length) return null;
  const yMin = years[value[0]];
  const yMax = years[value[1]];
  return (
    <>
      <div style={{ marginTop: 18, marginBottom: 10, paddingLeft: 4, paddingRight: 4 }}>
        <Slider
          range
          min={0}
          max={years.length - 1}
          value={value}
          disabled={disabled}
          onChange={(v) => {
            const arr = v as number[];
            onChange([arr[0], arr[1]]);
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "#555",
          fontFamily: "Arial",
        }}
      >
        <span style={{ fontWeight: 600 }}>{yMin}</span>
        <span style={{ fontWeight: 600 }}>{yMax}</span>
      </div>
    </>
  );
}

// ── Dates mode (Phase 4 Bis — for price-bands) ────────────────────────────────

interface DatePropsConcrete {
  dates: string[];
  value: [number, number];
  onChange: (next: [number, number]) => void;
  disabled?: boolean;
  sliderId?: string;
  fmtLabel?: (d: string) => string;
}

function defaultFmt(d: string): string {
  // "2024-03-15" → "Mar 15, 2024"
  try {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const m = parseInt(d.slice(5, 7), 10);
    const day = parseInt(d.slice(8, 10), 10);
    return `${months[m - 1]} ${day}, ${d.slice(0, 4)}`;
  } catch {
    return d;
  }
}

function DateRangeSlider({ dates, value, onChange, disabled, fmtLabel }: DatePropsConcrete) {
  const formatLabel = fmtLabel ?? defaultFmt;

  const [dragging, setDragging] = useState(false);
  const [localRange, setLocalRange] = useState<[number, number]>(value);
  const prevValue = useRef(value);

  // Sync from parent when not dragging (e.g. after "Reset" resets)
  useEffect(() => {
    if (!dragging && (prevValue.current[0] !== value[0] || prevValue.current[1] !== value[1])) {
      prevValue.current = value;
      setLocalRange(value);
    }
  }, [dragging, value]);

  const displayRange = dragging ? localRange : value;

  const marks = useMemo(() => {
    type Mark = { label: string; style: { fontSize: string; color: string } };
    const m: Record<string, Mark> = {};
    const seen = new Set<string>();
    dates.forEach((d, i) => {
      try {
        const y = parseInt(d.slice(0, 4), 10);
        const month = parseInt(d.slice(5, 7), 10);
        if (month === 1 && y % 2 === 1 && !seen.has(String(y))) {
          m[i] = {
            label: String(y),
            style: { fontSize: "10px", color: "#888" },
          };
          seen.add(String(y));
        }
      } catch {
        // ignore invalid dates
      }
    });
    return m;
  }, [dates]);

  const handleChange = useCallback((v: number | number[]) => {
    const arr = Array.isArray(v) ? v : [localRange[0], localRange[1]];
    setLocalRange([arr[0] as number, arr[1] as number]);
  }, [localRange]);

  const handleBeforeChange = useCallback(() => {
    setDragging(true);
  }, []);

  const handleAfterChange = useCallback((v: number | number[]) => {
    const arr = Array.isArray(v) ? v : [localRange[0], localRange[1]];
    const final: [number, number] = [arr[0] as number, arr[1] as number];
    setDragging(false);
    setLocalRange(final);
    prevValue.current = final;
    onChange(final);
  }, [localRange, onChange]);

  if (!dates || dates.length === 0) {
    return (
      <div>
        <div className="alert alert-warning mb-2" style={{ fontFamily: "Arial" }}>
          Unable to load the period.
        </div>
      </div>
    );
  }

  const min = 0;
  const max = dates.length - 1;

  const rangeProps = {
    min,
    max,
    value: displayRange,
    step: 1,
    marks,
    disabled,
    onChange: handleChange,
    onChangeComplete: handleAfterChange,
    onBeforeChange: handleBeforeChange,
    handleRender: (node: React.ReactElement, info: { value: number }) => {
      const label = dates[info.value] ? formatLabel(dates[info.value]) : "";
      return React.cloneElement(node, {}, (
        <span className="slider-handle-label">
          {label}
        </span>
      ));
    },
  } satisfies SliderProps;

  return (
    <div style={{ marginBottom: 16, marginTop: 32, paddingLeft: 18, paddingRight: 18 }}>
      <Slider range {...rangeProps} />
    </div>
  );
}
