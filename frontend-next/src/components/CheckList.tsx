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
  const { label, options, value, onChange } = props;

  const allValue = useMemo(() => options.slice(), [options]);

  return (
    <div>
      <div className="d-flex gap-2 mb-1">
        <button
          type="button"
          className="btn btn-link p-0"
          style={{
            fontSize: 11,
            color: "#FF5000",
            fontFamily: "Arial",
            fontWeight: 600,
          }}
          onClick={() => onChange(allValue)}
        >
          {props.allLabel ?? "All"}
        </button>
        <button
          type="button"
          className="btn btn-link p-0"
          style={{
            fontSize: 11,
            color: "#888",
            fontFamily: "Arial",
            fontWeight: 600,
          }}
          onClick={() => onChange([])}
        >
          {props.clearLabel ?? "Clear"}
        </button>
      </div>
      <hr style={{ margin: "4px 0 6px 0", borderTop: "1px solid #e0e0e0" }} />

      {options.length === 0 ? (
        <div style={{ fontSize: 12, color: "#888", fontFamily: "Arial" }}>
          No options available.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontFamily: "Arial", fontSize: 12 }}>
            {options.map((o) => (
              <label
                key={o}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={value.includes(o)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked) onChange(Array.from(new Set([...value, o])));
                    else onChange(value.filter((x) => x !== o));
                  }}
                />
                <span>{String(o)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <hr style={{ margin: "8px 0 0 0", borderTop: "1px solid transparent" }} />
    </div>
  );
}

