import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — SectorData",
};

// DRAFT — Requires legal review before production use.
export default function PrivacyPage() {
  return (
    <main className="container py-5" style={{ fontFamily: "Arial", maxWidth: 800 }}>
      <h1 style={{ fontWeight: 700, marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ color: "#888", fontSize: 14, marginBottom: 8 }}>Last updated: 2026-05-14</p>
      <div
        className="alert"
        style={{
          background: "#fff3cd",
          border: "1px solid #ffc107",
          borderRadius: 6,
          fontSize: 13,
          marginBottom: 32,
        }}
      >
        <strong>DRAFT</strong> — This document has not been reviewed by legal counsel. Do not rely on
        it in production until formally approved.
      </div>

      <section className="mb-4">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>1. Data Controller &amp; DPO</h2>
        <p>
          The data controller for personal data processed through SectorData is{" "}
          <strong>Itaú BBA O&amp;G (IBBA O&amp;G)</strong>. The Data Protection Officer (DPO) can
          be reached at:{" "}
          <a href="mailto:eduardo.mendes@itaubba.com">eduardo.mendes@itaubba.com</a>.
        </p>
      </section>

      <section className="mb-4">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>2. Data We Collect</h2>
        <p>We collect and process the following categories of personal data:</p>
        <ul>
          <li>
            <strong>Account data:</strong> email address, full name (optional), avatar image
            (optional), and assigned role (Admin or Client).
          </li>
          <li>
            <strong>Usage data:</strong> page views, data exports, and login events recorded in the{" "}
            <code>app_events</code> table. No IP addresses or device fingerprints are stored.
          </li>
          <li>
            <strong>User-generated content:</strong> News Hunter search keywords and stock
            portfolio configurations, both scoped to the authenticated user and not shared with
            other users.
          </li>
        </ul>
      </section>

      <section className="mb-4">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>3. Purpose of Processing</h2>
        <p>
          Personal data is processed to: (a) provide and maintain access to the Service dashboards;
          (b) personalise the user experience (display name, avatar, portfolios); and (c) improve
          service quality through aggregated, anonymised usage analytics.
        </p>
      </section>

      <section className="mb-4">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>4. Legal Basis</h2>
        <p>Processing is based on:</p>
        <ul>
          <li>
            <strong>Performance of contract</strong> (Art. 7º, V, Lei 13.709/2018 — LGPD): account
            and access data are necessary to provide the Service.
          </li>
          <li>
            <strong>Legitimate interest</strong> (Art. 7º, IX, LGPD): usage analytics to measure
            and improve platform quality, with administrator usage excluded from aggregates.
          </li>
        </ul>
      </section>

      <section className="mb-4">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>5. Data Retention</h2>
        <ul>
          <li>
            <strong>Account data:</strong> retained for the duration of the account plus 30 days
            after account deletion.
          </li>
          <li>
            <strong>Usage events (<code>app_events</code>):</strong> retained for 12 months from
            the event date.
          </li>
          <li>
            <strong>Admin audit log:</strong> retained for 5 years to comply with applicable legal
            and regulatory requirements.
          </li>
        </ul>
      </section>

      <section className="mb-4">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>6. Data Sharing</h2>
        <p>
          Personal data is not sold or shared with third parties for commercial purposes. Data is
          shared only with the following sub-processors necessary to operate the Service:
        </p>
        <ul>
          <li>
            <strong>Supabase, Inc.</strong> — database and authentication infrastructure, hosted on
            AWS (US-East-1 region).
          </li>
          <li>
            <strong>Vercel, Inc.</strong> — application hosting and global edge delivery.
          </li>
        </ul>
      </section>

      <section className="mb-4">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>7. Data Subject Rights (LGPD Art. 18)</h2>
        <p>
          Under the Lei Geral de Proteção de Dados (LGPD), you have the right to: access your
          personal data; correct inaccurate or incomplete data; anonymise, block, or delete
          unnecessary data; data portability; deletion of data processed with your consent; and
          revocation of consent at any time. To exercise any of these rights, contact the DPO at{" "}
          <a href="mailto:eduardo.mendes@itaubba.com">eduardo.mendes@itaubba.com</a>. Requests will
          be processed within 15 business days.
        </p>
      </section>

      <section className="mb-4">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>8. International Transfers</h2>
        <p>
          Your data may be stored and processed in the United States of America, where Supabase
          (AWS US-East) and Vercel maintain infrastructure. Such transfers are covered by standard
          contractual clauses or equivalent safeguards as required by applicable law.
        </p>
      </section>

      <section className="mb-4">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>9. Security</h2>
        <p>
          We implement appropriate technical and organisational measures including: TLS encryption
          for all data in transit; AES-256 encryption for data at rest (Supabase managed);
          row-level security (RLS) policies that ensure users access only their own data;
          optional multi-factor authentication; and audit logging of admin actions.
        </p>
      </section>

      <section className="mb-4">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>10. Cookies</h2>
        <p>
          The Service uses only technically necessary cookies: a Supabase authentication session
          cookie (required for login) and Vercel infrastructure cookies (required for edge routing).
          No tracking or advertising cookies are used.
        </p>
      </section>

      <section className="mb-4">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>11. Changes to This Policy</h2>
        <p>
          If we make material changes to this Privacy Policy, we will notify affected users by
          email before the changes take effect. Continued use of the Service after the effective
          date constitutes acceptance of the updated policy.
        </p>
      </section>

      <section className="mb-4">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>12. Contact</h2>
        <p>
          For any privacy-related questions or to exercise your rights, contact the DPO at:{" "}
          <a href="mailto:eduardo.mendes@itaubba.com">eduardo.mendes@itaubba.com</a>.
        </p>
      </section>
    </main>
  );
}
