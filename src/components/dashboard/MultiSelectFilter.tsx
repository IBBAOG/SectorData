"use client";

// Sidebar checkbox-list filter with optional color swatch and counter.
//
// Replaces inline JSX patterns repeated across Phase 3 dashboards:
//
//   <div className="sidebar-filter-section">
//     <div className="sidebar-filter-label">{label}{" "}
//       <span style={...}>(N/total)</span>
//     </div>
//     {items.map(c => <div className="form-check">...</div>)}
//     <button className="filter-btn-link">Clear</button>
//   </div>
//
// Visual matches existing dashboards: 9×9 round swatch (when `swatch` provided),
// 12px Arial font, 6px gap between items, grey "(N/total)" counter.

import type { ReactNode } from "react";

export interface MultiSelectFilterProps {
  label: ReactNode;
  items: string[];
  selected: string[];
  onToggle: (item: string) => void;
  /** Optional clear handler — only renders the "Clear" button when provided. */
  onClear?: () => void;
  /** Optional color for a 9×9 round swatch left of each label. */
  swatch?: (item: string) => string;
  /** Optional pretty label per item (e.g. PreSal → "Pre-Salt"). Falls back to item itself. */
  itemLabel?: (item: string) => ReactNode;
  /** Hides the "Clear" button while selected.length <= minSelection. Default 0. */
  minSelection?: number;
  /** Stable id prefix for input elements. */
  idPrefix?: string;
  /** Optional override for counter total (defaults to items.length). */
  counterTotal?: number;
  /** When selected is empty and counter should display total instead, set true. */
  emptyMeansAll?: boolean;
}

export default function MultiSelectFilter({
  label,
  items,
  selected,
  onToggle,
  onClear,
  swatch,
  itemLabel,
  minSelection = 0,
  idPrefix = "msf",
  counterTotal,
  emptyMeansAll = false,
}: MultiSelectFilterProps) {
  const total = counterTotal ?? items.length;
  const counter = emptyMeansAll && selected.length === 0 ? total : selected.length;
  const showClear = !!onClear && selected.length > minSelection;

  return (
    <div className="sidebar-filter-section">
      <div className="sidebar-filter-label">
        {label}{" "}
        <span style={{ color: "#888", fontWeight: 400 }}>
          ({counter}/{total})
        </span>
      </div>
      {items.map((item) => {
        const inputId = `${idPrefix}-${item}`;
        const checked = selected.includes(item);
        const swatchColor = swatch?.(item);
        return (
          <div key={item} className="form-check" style={{ marginBottom: 6 }}>
            <input
              className="form-check-input"
              type="checkbox"
              id={inputId}
              checked={checked}
              onChange={() => onToggle(item)}
            />
            <label
              className="form-check-label"
              htmlFor={inputId}
              style={{ fontFamily: "Arial", fontSize: 12, cursor: "pointer" }}
            >
              {swatchColor && (
                <span
                  style={{
                    display: "inline-block",
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    backgroundColor: swatchColor,
                    marginRight: 6,
                    verticalAlign: "middle",
                  }}
                />
              )}
              {itemLabel ? itemLabel(item) : item}
            </label>
          </div>
        );
      })}
      {showClear && (
        <button
          type="button"
          className="filter-btn-link filter-btn-link--secondary"
          style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10 }}
          onClick={onClear}
        >
          Clear
        </button>
      )}
    </div>
  );
}
