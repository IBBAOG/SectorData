"use client";

import { useState, useRef, useEffect } from "react";

export default function SearchableMultiSelect({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  const allSelected = value.length === 0 || value.length === options.length;
  const label = allSelected
    ? "All"
    : value.length === 1
    ? value[0]
    : `${value.length} selected`;

  function toggle(o: string) {
    if (value.includes(o)) onChange(value.filter((x) => x !== o));
    else onChange([...value, o]);
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "5px 10px",
          border: "1px solid #d0d0d0",
          borderRadius: 6,
          background: "#fff",
          fontFamily: "Arial",
          fontSize: 12,
          color: "#1a1a1a",
          cursor: "pointer",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span style={{ marginLeft: 6, fontSize: 10, color: "#888", flexShrink: 0 }}>▼</span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 999,
            background: "#fff",
            border: "1px solid #d0d0d0",
            borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            padding: "8px 0",
          }}
        >
          {/* Search */}
          <div style={{ padding: "0 8px 6px" }}>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              style={{
                width: "100%",
                padding: "4px 8px",
                border: "1px solid #d0d0d0",
                borderRadius: 4,
                fontFamily: "Arial",
                fontSize: 12,
                outline: "none",
              }}
            />
          </div>

          {/* All / Clear */}
          <div style={{ display: "flex", gap: 8, padding: "0 8px 4px", borderBottom: "1px solid #f0f0f0" }}>
            <button
              type="button"
              onClick={() => onChange([])}
              style={{ fontFamily: "Arial", fontSize: 11, color: "#ff5000", fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer" }}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => onChange(options.slice())}
              style={{ fontFamily: "Arial", fontSize: 11, color: "#888", fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer" }}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              style={{ fontFamily: "Arial", fontSize: 11, color: "#888", fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer" }}
            >
              Clear
            </button>
          </div>

          {/* List */}
          <div style={{ maxHeight: 220, overflowY: "auto", padding: "4px 8px 0" }}>
            {filtered.length === 0 ? (
              <div style={{ fontSize: 12, color: "#888", fontFamily: "Arial", padding: "4px 0" }}>No results.</div>
            ) : (
              filtered.map((o) => (
                <label
                  key={o}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "3px 0",
                    fontFamily: "Arial",
                    fontSize: 12,
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={value.length === 0 ? false : value.includes(o)}
                    onChange={() => toggle(o)}
                    style={{ accentColor: "#ff5000" }}
                  />
                  {o}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
