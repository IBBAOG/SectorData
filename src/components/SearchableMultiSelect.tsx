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
      <button
        type="button"
        className="dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span style={{ marginLeft: 6, fontSize: 10, color: "#888", flexShrink: 0 }}>
          {open ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {open && (
        <div className="dropdown-panel">
          <div style={{ padding: "0 8px 6px" }}>
            <input
              autoFocus
              className="dropdown-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
            />
          </div>

          <div style={{ display: "flex", gap: 8, padding: "0 8px 4px", borderBottom: "1px solid #f0f0f0" }}>
            <button
              type="button"
              className="filter-btn-link filter-btn-link--primary"
              onClick={() => { onChange([]); setSearch(""); }}
            >
              All
            </button>
            <button
              type="button"
              className="filter-btn-link filter-btn-link--secondary"
              onClick={() => { onChange(options.slice()); setSearch(""); }}
            >
              Select all
            </button>
            <button
              type="button"
              className="filter-btn-link filter-btn-link--secondary"
              onClick={() => { onChange([]); setSearch(""); }}
            >
              Clear
            </button>
          </div>

          <div style={{ maxHeight: 220, overflowY: "auto", padding: "4px 8px 0" }}>
            {filtered.length === 0 ? (
              <div style={{ fontSize: 12, color: "#888", fontFamily: "Arial", padding: "4px 0" }}>No results.</div>
            ) : (
              filtered.map((o) => (
                <label key={o} className="filter-checkbox" style={{ padding: "3px 0" }}>
                  <input
                    type="checkbox"
                    checked={value.length === 0 ? false : value.includes(o)}
                    onChange={() => toggle(o)}
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
