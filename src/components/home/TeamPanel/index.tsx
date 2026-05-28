"use client";

// TeamPanel — glass card showing team contact entries.
// Positioned above DataSourcesTable in the right column of /home desktop.
// Desktop-only: mobile/View.tsx does not render the right column.
//
// Each row: name + email text (non-tappable, left) + two icon action buttons (right):
//   WhatsApp (#25D366 brand green, inline SVG matching mobile TeamCard) and
//   Envelope (Bootstrap Icons bi-envelope, always visible).

import styles from "./TeamPanel.module.css";

const TEAM: { name: string; email: string; phone: string }[] = [
  { name: "Monique Greco",  email: "monique.greco@itaubba.com",  phone: "5511912709638" },
  { name: "Eric de Mello",  email: "eric.mello@itaubba.com",     phone: "5511997854839" },
  { name: "Eduardo Mendes", email: "eduardo.mendes@itaubba.com", phone: "5511998414617" },
];

export default function TeamPanel(): React.ReactElement {
  return (
    <div className={styles.root}>
      {/* Header — same visual as "DATA SOURCES" in DataSourcesTable */}
      <div className={styles.header}>TEAM</div>

      {/* Contact entries */}
      {TEAM.map(({ name, email, phone }) => (
        <div key={email} className={styles.entry}>
          <div className={styles.row}>
            {/* Left: name + email — non-tappable text block */}
            <span className={styles.textBlock}>
              <span className={styles.name}>{name}</span>
              <span className={styles.email}>{email}</span>
            </span>

            {/* Right: icon action buttons — always visible */}
            <span className={styles.actions}>
              {/* WhatsApp */}
              <a
                href={`https://wa.me/${phone}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`WhatsApp ${name}`}
                className={styles.iconBtn}
                style={{ color: "#25D366" }}
              >
                <WhatsAppIcon />
              </a>

              {/* Envelope */}
              <a
                href={`mailto:${email}`}
                aria-label={`Send email to ${name}`}
                className={styles.iconBtn}
              >
                <i className="bi bi-envelope" aria-hidden="true" />
              </a>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── WhatsApp SVG — identical glyph used in mobile TeamCard ───────────────────

function WhatsAppIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.118 1.535 5.845L.057 23.487a.5.5 0 0 0 .611.611l5.638-1.479A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.9a9.893 9.893 0 0 1-5.031-1.369l-.36-.214-3.738.98.998-3.648-.235-.374A9.862 9.862 0 0 1 2.1 12C2.1 6.534 6.534 2.1 12 2.1c5.467 0 9.9 4.434 9.9 9.9 0 5.467-4.433 9.9-9.9 9.9z" />
    </svg>
  );
}
