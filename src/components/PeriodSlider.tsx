"use client";

import Slider, { type SliderProps } from "rc-slider";
import "rc-slider/assets/index.css";

import React, { useMemo } from "react";
import { fmtData } from "../lib/filterUtils";

export default function PeriodSlider(props: {
  datas: string[];
  value: [number, number];
  onChange: (next: [number, number]) => void;
  sliderId?: string;
}) {
  const { datas, value, onChange } = props;

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
    marks: {},
    onChange: (v) => {
      const arr = Array.isArray(v) ? v : [value[0], value[1]];
      onChange([arr[0] as number, arr[1] as number]);
    },
    handleRender: (node: React.ReactElement, info: { value: number }) => {
      const label = datas[info.value] ? fmtData(datas[info.value]) : "";
      return React.cloneElement(node, {}, (
        <span style={{
          position: "absolute",
          bottom: "calc(100% + 7px)",
          left: "50%",
          transform: "translateX(-50%)",
          backgroundColor: "#ff5000",
          color: "#ffffff",
          padding: "2px 6px",
          borderRadius: 3,
          fontSize: 10,
          fontWeight: 700,
          fontFamily: "Arial",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
        }}>
          {label}
        </span>
      ));
    },
  } satisfies SliderProps;

  return (
    <div style={{ marginBottom: 16, marginTop: 32, paddingLeft: 10, paddingRight: 10 }}>
      <Slider range {...rangeProps} />
    </div>
  );
}
