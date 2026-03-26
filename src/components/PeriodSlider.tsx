"use client";

import Slider, { type SliderProps } from "rc-slider";
import "rc-slider/assets/index.css";

import { useMemo } from "react";
import { fmtData } from "../lib/filterUtils";

export default function PeriodSlider(props: {
  datas: string[];
  value: [number, number];
  onChange: (next: [number, number]) => void;
  sliderId?: string;
}) {
  const { datas, value, onChange } = props;

  const displayText = useMemo(() => {
    if (!datas || datas.length === 0) return "";
    const [a, b] = value;
    const start = datas[a] ? fmtData(datas[a]) : "";
    const end = datas[b] ? fmtData(datas[b]) : "";
    return `${start}  →  ${end}`;
  }, [datas, value]);

  const marks = useMemo(() => {
    type Mark = { label: string; style: { fontSize: string; color: string } };
    const m: Record<string, Mark> = {};
    const seen = new Set<string>();

    datas.forEach((d, i) => {
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
  }, [datas]);

  if (!datas || datas.length === 0) {
    return (
      <div>
        <div className="alert alert-warning mb-2" style={{ fontFamily: "Arial" }}>
          Unable to load the period.
        </div>
      </div>
    );
  }

  const min = 0;
  const max = datas.length - 1;

  const rangeProps = {
    min,
    max,
    value,
    step: 1,
    marks,
    onChange: (v) => {
      const arr = Array.isArray(v) ? v : [value[0], value[1]];
      onChange([arr[0] as number, arr[1] as number]);
    },
  } satisfies SliderProps;

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          fontFamily: "Arial",
          fontSize: 11,
          color: "#FF5000",
          fontWeight: 600,
          textAlign: "center",
          background: "#fff3ee",
          borderRadius: 4,
          padding: "3px 6px",
          marginBottom: 8,
        }}
      >
        {displayText}
      </div>

      <Slider range {...rangeProps} />
    </div>
  );
}

