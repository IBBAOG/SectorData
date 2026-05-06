"use client";

// Year-based period slider used by Phase 3 dashboards.
//
// Distinct from the older src/components/PeriodSlider.tsx which works on
// arbitrary date strings. This wrapper takes a list of years and a [from, to]
// index pair, and renders the rc-slider with bold min/max labels below.
//
// The visual layout mirrors the inline markup in anp-cdp / anp-glp / anp-ppi:
//   <div style={{ marginTop: 18, marginBottom: 10, paddingLeft: 4, paddingRight: 4 }}>
//     <Slider range min={0} max={years.length-1} value={value} onChange={...} />
//   </div>
//   <div style={{ display: "flex", justifyContent: "space-between", ... }}>
//     <span>yMin</span><span>yMax</span>
//   </div>

import Slider from "rc-slider";
import "rc-slider/assets/index.css";

export interface PeriodSliderProps {
  years: number[];
  value: [number, number];
  onChange: (next: [number, number]) => void;
  disabled?: boolean;
}

export default function PeriodSlider({ years, value, onChange, disabled }: PeriodSliderProps) {
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
