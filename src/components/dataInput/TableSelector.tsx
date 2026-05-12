"use client";

// Renders a table picker for the Data Input section.
// ≤ 4 tables → SegmentedToggle; > 4 → <select> dropdown.

import SegmentedToggle from "@/components/dashboard/SegmentedToggle";
import { EDITABLE_TABLES } from "@/lib/dataInput/registry";

interface TableSelectorProps {
  activeSlug: string;
  onChange: (slug: string) => void;
}

export function TableSelector({ activeSlug, onChange }: TableSelectorProps) {
  const options = EDITABLE_TABLES.map((t) => ({ value: t.slug, label: t.label }));

  if (options.length <= 4) {
    return (
      <div style={{ marginBottom: 20 }}>
        <SegmentedToggle
          options={options}
          value={activeSlug}
          onChange={onChange}
          variant="compact"
          buttonPadding="14px"
        />
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <select
        value={activeSlug}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontFamily: "Arial, sans-serif",
          fontSize: 13,
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid #e0e0e0",
          background: "#fff",
          cursor: "pointer",
          outline: "none",
          appearance: "auto",
          minWidth: 200,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
