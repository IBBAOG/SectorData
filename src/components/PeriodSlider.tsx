"use client";

import Slider, { type SliderProps } from "rc-slider";
import "rc-slider/assets/index.css";

import React, { useMemo, useState, useRef, useCallback } from "react";
import { fmtData } from "../lib/filterUtils";

export default function PeriodSlider(props: {
  datas: string[];
  value: [number, number];
  onChange: (next: [number, number]) => void;
  sliderId?: string;
}) {
  const { datas, value, onChange } = props;

  // Internal state for smooth dragging — only propagates on release
  const [dragging, setDragging] = useState(false);
  const [localRange, setLocalRange] = useState<[number, number]>(value);
  const prevValue = useRef(value);

  // Sync from parent when not dragging (e.g. after "Clear" resets)
  if (!dragging && (prevValue.current[0] !== value[0] || prevValue.current[1] !== value[1])) {
    prevValue.current = value;
    setLocalRange(value);
  }

  const displayRange = dragging ? localRange : value;

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
    value: displayRange,
    step: 1,
    marks: {},
    onChange: handleChange,
    onChangeComplete: handleAfterChange,
    onBeforeChange: handleBeforeChange,
    handleRender: (node: React.ReactElement, info: { value: number }) => {
      const label = datas[info.value] ? fmtData(datas[info.value]) : "";
      return React.cloneElement(node, {}, (
        <span className="slider-handle-label">
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
