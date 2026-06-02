"use client";

// Shared presentational helpers for /alerts — used by BOTH desktop/View.tsx and
// mobile/View.tsx so the cadence badge, status pill, toggle switch, and
// date/period formatting stay identical across the two Views.
//
// These are pure presentation (no data fetching, no RPC). All real analysis
// lives in useAlertsData.ts. Desktop styles come from page.module.css; the
// toggle uses inline styles so it renders identically inside mobile's own
// surface tokens.

import type { AlertCadence, AlertStatus } from "@/types/alerts";
import styles from "./page.module.css";

// ─── Cadence badge (read-only) ───────────────────────────────────────────────

export function CadenceBadge({
  cadence,
}: {
  cadence: AlertCadence;
}): React.ReactElement {
  const immediate = cadence === "immediate";
  return (
    <span
      className={`${styles.badge} ${immediate ? styles.badgeImmediate : styles.badgeDigest}`}
      title={
        immediate
          ? "Sent as soon as new data lands"
          : "Bundled into one daily email"
      }
    >
      {immediate ? "Immediate" : "Daily digest"}
    </span>
  );
}

// ─── Status pill ──────────────────────────────────────────────────────────────

const PILL_CLASS: Record<string, string> = {
  sent: styles.pillSent,
  delivered: styles.pillDelivered,
  bounced: styles.pillBounced,
  failed: styles.pillFailed,
  pending: styles.pillPending,
};

export function StatusPill({ status }: { status: AlertStatus }): React.ReactElement {
  const cls = PILL_CLASS[status] ?? styles.pillPending;
  return (
    <span className={`${styles.pill} ${cls}`} aria-label={`Status: ${status}`}>
      {status}
    </span>
  );
}

// ─── Toggle switch (subscribe = on) ──────────────────────────────────────────

export function ToggleSwitch({
  on,
  disabled,
  ariaLabel,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (next: boolean) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`${styles.toggle} ${on ? styles.toggleOn : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className={styles.toggleKnob} aria-hidden="true" />
    </button>
  );
}

// ─── Date / period formatting ────────────────────────────────────────────────

/** Format the engine's period key into a friendly label.
 *  Handles: "YYYY-MM" → "Apr 2026", "YYYY-MM-DD" → "Apr 30, 2026",
 *  "YYYY-Www" → "Week 18, 2026", "YYYY" → "2026", ISO timestamp → date.
 *  Falls back to the raw value for anything unrecognized. */
export function formatPeriod(period: string | null | undefined): string | null {
  if (!period) return null;
  const p = String(period).trim();
  if (!p) return null;

  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  // YYYY-MM
  let m = /^(\d{4})-(\d{2})$/.exec(p);
  if (m) {
    const mon = parseInt(m[2], 10);
    if (mon >= 1 && mon <= 12) return `${MONTHS[mon - 1]} ${m[1]}`;
  }

  // YYYY-Www (ISO week)
  m = /^(\d{4})-W(\d{1,2})$/i.exec(p);
  if (m) return `Week ${parseInt(m[2], 10)}, ${m[1]}`;

  // YYYY-MM-DD (optionally with a time component)
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(p);
  if (m) {
    const mon = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (mon >= 1 && mon <= 12) return `${MONTHS[mon - 1]} ${day}, ${m[1]}`;
  }

  // Bare year
  if (/^\d{4}$/.test(p)) return p;

  return p;
}

/** Compact relative time, e.g. "just now", "12 min ago", "3 h ago",
 *  "2 d ago", else an absolute date. Returns "—" for null. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.round(hr / 24);
  if (day <= 7) return `${day} d ago`;
  // Absolute fallback for anything older than a week.
  const d = new Date(then);
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
