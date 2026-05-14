# Incident Response

## Severity Levels

| Sev | Definition | Initial response SLA |
|---|---|---|
| 1 | Confirmed data breach / unauthorized admin escalation / leaked token | 15 min |
| 2 | Exploitable vulnerability in prod / suspicious activity in audit log | 1 h |
| 3 | Non-exploitable vulnerability / high-severity dependency CVE / config drift | 24 h |
| 4 | Backlog / informational | 1 week |

## Detection Sources

- Vercel Web Analytics (error rate spikes)
- Supabase Auth logs (login failures > 50/h)
- Sentry JS error tracking (to be configured)
- Automated issue opened by `security_audit.yml` workflow
- Suspicious row in `admin_audit_log`

## Response Steps (Sev 1)

### 1. Triage (≤15 min)
- Confirm incident is real (not false positive)
- Identify affected asset(s) and scope
- Page CTO: eduardo.mendes@itaubba.com

### 2. Containment
- **Rotate service key**: Supabase Dashboard → Settings → API → Service Role → Reset
- **Update GitHub Secret** `SUPABASE_SERVICE_KEY` in:
  - `https://github.com/IBBAOG/SectorData/settings/secrets/actions`
  - `https://github.com/IBBAOG/news-hunter-scanner/settings/secrets/actions`
- **Force sign-out of all users**: Supabase Dashboard → Auth → Users → Sign out all (or per-user)
- **Emergency token invalidation** (if Supabase exposes this endpoint in the future — currently manual via dashboard)

### 3. Eradication
- Identify root cause via `admin_audit_log` + Vercel logs + Supabase Auth logs
- Remove malicious access / revoke compromised credential
- Patch vulnerability or disable affected endpoint

### 4. Recovery
- Restore from PITR (Point-in-Time Recovery) if data corruption confirmed
- Re-run ETL pipelines if ingestion was interrupted
- Re-enable features disabled during containment
- Monitor for 24h post-recovery

### 5. Postmortem
- Write blameless postmortem in `docs/security/postmortems/YYYY-MM-incident.md`
- Identify control gaps
- Update threat model and backlog

## Communication

| Audience | Channel | Deadline |
|---|---|---|
| CTO + DPO (eduardo.mendes@itaubba.com) | Email | ≤30 min after confirmed incident |
| Affected clients (personal data compromised) | Email | ≤24h (LGPD Art. 48) |
| ANPD (if >100 data subjects affected) | Official notification | ≤72h (LGPD Art. 48) |

## Emergency Contacts

| Contact | Channel |
|---|---|
| CTO / DPO | eduardo.mendes@itaubba.com |
| Supabase support | Supabase Dashboard → Support tab |
| Vercel support | vercel.com/help |
