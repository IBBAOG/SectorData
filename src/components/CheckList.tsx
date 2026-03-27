"use client";

import { useMemo } from "react";

export default function CheckList(props: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  allLabel?: string;
  clearLabel?: string;
}) {
  const { options, value, onChange } = props;
  const allValue = useMemo(() => options.slice(), [options]);

  function toggle(o: string) {
    if (value.includes(o)) onChange(value.filter((x) => x !== o));
    else onChange(Array.from(new Set([...value, o])));
  }

  return (
    <div>
      <div className="filter-chip-actions">
        <button
          type="button"
          className="filter-btn-link filter-btn-link--secondary"
          onClick={() => onChange(allValue)}
        >
          {props.allLabel ?? "All"}
        </button>
        <button
          type="button"
          className="filter-btn-link filter-btn-link--secondary"
          onClick={() => onChange([])}
        >
          {props.clearLabel ?? "Clear"}
        </button>
      </div>

      {options.length === 0 ? (
        <div style={{ fontSize: 12, color: "#888", fontFamily: "Arial" }}>
          No options available.
        </div>
      ) : (
        <div className="filter-chip-group">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              className={`filter-chip${value.includes(o) ? " filter-chip--active" : ""}`}
              onClick={() => toggle(o)}
            >
              {String(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
