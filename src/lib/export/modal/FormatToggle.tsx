"use client";

// Two-pill toggle between Excel and CSV inside the export modal.
//
// Controlled component — parent owns the value. Brand-orange active state.
// Visual matches the SegmentedToggle pattern used across the platform.

export type ExportFormat = "excel" | "csv";

export type FormatToggleProps = {
  value: ExportFormat;
  onChange: (next: ExportFormat) => void;
  /** Disable both pills (e.g. while a download is in progress). */
  disabled?: boolean;
};

const BRAND_ORANGE = "#FF5000";

const OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: "excel", label: "Excel" },
  { value: "csv", label: "CSV" },
];

export default function FormatToggle({
  value,
  onChange,
  disabled = false,
}: FormatToggleProps): React.ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label="Export format"
      style={{
        display: "inline-flex",
        border: "1px solid #d0d0d0",
        borderRadius: 999,
        padding: 2,
        backgroundColor: "#f8f8f8",
        fontFamily: "Arial",
        fontSize: 12.5,
        gap: 2,
      }}
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            style={{
              padding: "5px 14px",
              border: "none",
              borderRadius: 999,
              backgroundColor: active ? BRAND_ORANGE : "transparent",
              color: active ? "#ffffff" : "#555",
              cursor: disabled ? "not-allowed" : "pointer",
              fontWeight: active ? 700 : 500,
              transition: "background-color 120ms ease",
              minWidth: 56,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
