"use client";

// Controlled filter editor for the "modal-editable" export mode.
//
// Renders the FilterControl[] declared by the spec. Lifts state to the caller
// (controlled component) so the modal can drive the SizeEstimator and the
// downloadExcel/downloadCsv calls with the same filter snapshot.
//
// Supported control types per the contract:
//   • date-range     — 2 date inputs (start / end)
//   • multi-select   — checkbox list (async options)
//   • single-select  — native <select> (async options)
//   • search         — text <input>
//   • segmented      — pill group

import { useEffect, useMemo, useState } from "react";

import type { FilterControl } from "../types";

export type FilterEditorProps = {
  controls: FilterControl[];
  /** Current filter map keyed by FilterControl.key. */
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Disable every control (e.g. while a download is in progress). */
  disabled?: boolean;
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  marginBottom: 6,
  color: "#1a1a1a",
  textTransform: "uppercase",
  letterSpacing: "0.4px",
  fontFamily: "Arial",
};

const SECTION_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

export default function FilterEditor({
  controls,
  value,
  onChange,
  disabled = false,
}: FilterEditorProps): React.ReactElement {
  function set(key: string, v: unknown) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        fontFamily: "Arial",
      }}
    >
      {controls.map((c) => (
        <div key={c.key} style={SECTION_STYLE}>
          <div style={LABEL_STYLE}>{c.label}</div>
          <ControlBody
            control={c}
            value={value[c.key]}
            onChange={(v) => set(c.key, v)}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );
}

// ─── per-control bodies ──────────────────────────────────────────────────────

function ControlBody({
  control,
  value,
  onChange,
  disabled,
}: {
  control: FilterControl;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}): React.ReactElement {
  if (control.type === "date-range") {
    const tuple = (value as [string, string] | undefined) ?? control.default ?? ["", ""];
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="date"
          className="form-control form-control-sm"
          style={{ fontFamily: "Arial", maxWidth: 160 }}
          value={tuple[0]}
          min={control.min}
          max={control.max}
          onChange={(e) => onChange([e.target.value, tuple[1]] as [string, string])}
          disabled={disabled}
        />
        <span style={{ color: "#888" }}>→</span>
        <input
          type="date"
          className="form-control form-control-sm"
          style={{ fontFamily: "Arial", maxWidth: 160 }}
          value={tuple[1]}
          min={control.min}
          max={control.max}
          onChange={(e) => onChange([tuple[0], e.target.value] as [string, string])}
          disabled={disabled}
        />
      </div>
    );
  }

  if (control.type === "multi-select") {
    return (
      <AsyncMultiSelect
        loader={control.optionsAsync}
        selected={(value as string[] | undefined) ?? control.default ?? []}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  if (control.type === "single-select") {
    return (
      <AsyncSingleSelect
        loader={control.optionsAsync}
        selected={(value as string | undefined) ?? control.default ?? ""}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  if (control.type === "search") {
    return (
      <input
        type="search"
        className="form-control form-control-sm"
        style={{ fontFamily: "Arial" }}
        placeholder={control.placeholder}
        value={(value as string | undefined) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    );
  }

  // segmented
  const current = (value as string | undefined) ?? control.default ?? control.options[0]?.value ?? "";
  return (
    <div
      role="radiogroup"
      style={{
        display: "inline-flex",
        border: "1px solid #d0d0d0",
        borderRadius: 999,
        padding: 2,
        backgroundColor: "#f8f8f8",
        gap: 2,
      }}
    >
      {control.options.map((opt) => {
        const active = opt.value === current;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            style={{
              padding: "5px 12px",
              border: "none",
              borderRadius: 999,
              backgroundColor: active ? "#FF5000" : "transparent",
              color: active ? "#ffffff" : "#555",
              cursor: disabled ? "not-allowed" : "pointer",
              fontWeight: active ? 700 : 500,
              fontFamily: "Arial",
              fontSize: 12.5,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── shared async option resolvers ───────────────────────────────────────────

function useAsyncOptions(
  loader: () => Promise<{ value: string; label: string }[]>,
) {
  const [opts, setOpts] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loader()
      .then((rows) => {
        if (!cancelled) setOpts(rows);
      })
      .catch((e) => {
        console.error("[FilterEditor] async options failed", e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { opts, loading };
}

function AsyncMultiSelect({
  loader,
  selected,
  onChange,
  disabled,
}: {
  loader: () => Promise<{ value: string; label: string }[]>;
  selected: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
}): React.ReactElement {
  const { opts, loading } = useAsyncOptions(loader);
  const set = useMemo(() => new Set(selected), [selected]);
  function toggle(v: string) {
    if (set.has(v)) onChange(selected.filter((x) => x !== v));
    else onChange([...selected, v]);
  }
  if (loading) {
    return <div style={{ fontSize: 12, color: "#888" }}>Loading options…</div>;
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        maxHeight: 180,
        overflowY: "auto",
        padding: 8,
        border: "1px solid #e0e0e0",
        borderRadius: 4,
        backgroundColor: "#fff",
      }}
    >
      {opts.length === 0 ? (
        <span style={{ fontSize: 12, color: "#888" }}>No options available.</span>
      ) : (
        opts.map((o) => (
          <label
            key={o.value}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              cursor: disabled ? "not-allowed" : "pointer",
              color: "#1a1a1a",
            }}
          >
            <input
              type="checkbox"
              checked={set.has(o.value)}
              disabled={disabled}
              onChange={() => toggle(o.value)}
            />
            {o.label}
          </label>
        ))
      )}
    </div>
  );
}

function AsyncSingleSelect({
  loader,
  selected,
  onChange,
  disabled,
}: {
  loader: () => Promise<{ value: string; label: string }[]>;
  selected: string;
  onChange: (v: string) => void;
  disabled: boolean;
}): React.ReactElement {
  const { opts, loading } = useAsyncOptions(loader);
  if (loading) {
    return <div style={{ fontSize: 12, color: "#888" }}>Loading options…</div>;
  }
  return (
    <select
      className="form-select form-select-sm"
      style={{ fontFamily: "Arial", fontSize: 12.5 }}
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">—</option>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
