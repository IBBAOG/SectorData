"use client";

// DashboardPicker — small dropdown listing all dashboards that consume a source.
// Shown only when dashboards.length >= 2. If length === 1, the parent (SourceRow)
// navigates directly via a Link.

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import styles from "./DataSourcesTable.module.css";

interface Dashboard {
  slug: string;
  title: string;
}

interface DashboardPickerProps {
  dashboards: Dashboard[];
  /** Inline style for positioning the trigger button */
  style?: React.CSSProperties;
}

export default function DashboardPicker({
  dashboards,
  style,
}: DashboardPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className={styles.pickerRoot} style={style}>
      <button
        type="button"
        className={styles.pickerTrigger}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose dashboard"
      >
        {/* Dashboard icon */}
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
        <span style={{ fontSize: 11 }}>View dashboard ▾</span>
      </button>

      {open && (
        <ul className={styles.pickerDropdown} role="listbox">
          {dashboards.map((d) => (
            <li key={d.slug} role="option" aria-selected={false}>
              <Link
                href={`/${d.slug}`}
                className={styles.pickerItem}
                onClick={() => setOpen(false)}
              >
                {d.title}
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ flexShrink: 0 }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
