"use client";

// TeamCard — mobile-optimized team contacts card.
// Rendered above the "Oil & Gas" section in mobile /home view.
// Desktop equivalent: src/components/home/TeamPanel/index.tsx (glass card, right column).
//
// Design: light-only, mobile token system (--mobile-* from globals.css).
// Option A layout: section label + 3 stacked mailto rows.
// Each row: name (left, bold) + email subtitle (muted) + envelope icon (right).
// Tappable full-row <a href="mailto:..."> for one-tap email on mobile.

import styles from "./TeamCard.module.css";

const TEAM: { name: string; email: string }[] = [
  { name: "Monique Greco", email: "monique.greco@itaubba.com" },
  { name: "Eric de Mello", email: "eric.mello@itaubba.com" },
  { name: "Eduardo Mendes", email: "eduardo.mendes@itaubba.com" },
];

export default function TeamCard(): React.ReactElement {
  return (
    <section aria-label="Team contacts" className={styles.root}>
      {/* Section label — matches visual rhythm of "Oil & Gas" / "Fuel Distribution" */}
      <div className={styles.label}>Team</div>

      {/* Contact card */}
      <div className={styles.card}>
        {TEAM.map(({ name, email }, idx) => (
          <a
            key={email}
            href={`mailto:${email}`}
            className={styles.row}
            aria-label={`Email ${name}`}
            style={idx < TEAM.length - 1 ? { borderBottom: "1px solid var(--mobile-divider)" } : undefined}
          >
            {/* Left: name + email */}
            <span className={styles.info}>
              <span className={styles.name}>{name}</span>
              <span className={styles.email}>{email}</span>
            </span>

            {/* Right: envelope icon */}
            <span className={styles.iconWrap} aria-hidden="true">
              <EnvelopeIcon />
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

// Inline SVG envelope — no Bootstrap Icons dependency on mobile shell.
function EnvelopeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 7 10-7" />
    </svg>
  );
}
