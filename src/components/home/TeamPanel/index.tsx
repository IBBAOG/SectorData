"use client";

// TeamPanel — glass card showing team contact entries.
// Positioned above DataSourcesTable in the right column of /home desktop.
// Desktop-only: mobile/View.tsx does not render the right column.

import styles from "./TeamPanel.module.css";

const TEAM: { name: string; email: string }[] = [
  { name: "Monique Greco", email: "monique.greco@itaubba.com" },
  { name: "Eric de Mello", email: "eric.mello@itaubba.com" },
  { name: "Eduardo Mendes", email: "eduardo.mendes@itaubba.com" },
];

export default function TeamPanel(): React.ReactElement {
  return (
    <div className={styles.root}>
      {/* Header — same visual as "DATA SOURCES" in DataSourcesTable */}
      <div className={styles.header}>TEAM</div>

      {/* Contact entries */}
      {TEAM.map(({ name, email }) => (
        <div key={email} className={styles.entry}>
          <a
            href={`mailto:${email}`}
            className={styles.row}
            aria-label={`Send email to ${name}`}
          >
            <span className={styles.name}>{name}</span>
            <span className={styles.emailLine}>
              <span className={styles.email}>{email}</span>
              {/* Envelope icon — Bootstrap Icons; appears on hover via CSS */}
              <i className={`bi bi-envelope ${styles.icon}`} aria-hidden="true" />
            </span>
          </a>
        </div>
      ))}
    </div>
  );
}
