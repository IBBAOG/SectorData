# Threat Model

## Assets

- Client data (profiles, news-hunter keywords, stock portfolios)
- Admin action audit log (`admin_audit_log`)
- App source code
- Secrets (SUPABASE_SERVICE_KEY, AISSTREAM_API_KEY, Gmail credentials, Upstash token)
- IBBA reputation (PR / news)

## Trust Boundaries

| Boundary | Protocol |
|---|---|
| Browser ↔ Vercel Edge | HTTPS + CSP |
| Vercel ↔ Supabase REST | PostgREST + RLS + JWT (anon key) |
| Vercel ↔ Upstash | HTTPS (rate-limit state) |
| Browser ↔ Yahoo Finance proxy | Proxied via Vercel `/api/stocks/*` (no CORS) |
| GitHub Actions ↔ Supabase | service key (bypasses RLS) |
| News Hunter scanner (separate repo) ↔ Supabase | service key |

## Adversaries

| Adversary | Capability |
|---|---|
| Malicious client (authenticated) | Privilege escalation attempt, data scraping own RLS scope |
| External attacker | DDoS, endpoint scanning, credential stuffing |
| Compromised transitive dependency | Supply-chain XSS or data exfil |
| Insider (dev with GitHub / Supabase Studio access) | Direct DB access, secret extraction from GHA logs |

## Top Risks (current)

| # | Risk | Mitigation |
|---|---|---|
| 1 | JWT token in localStorage exfil via XSS | CSP `default-src 'self'` + zero `dangerouslySetInnerHTML` in codebase |
| 2 | Service key leaked via GHA log | `permissions: read` on all workflows + GitHub Secrets (never echoed) |
| 3 | ETL pipeline injecting payload into column read by frontend | React automatic text escaping; no `dangerouslySetInnerHTML` on DB data |
| 4 | Transitive npm dependency with CVE | F3.4 weekly CI `npm audit` (security_audit.yml) |

## Controls (implemented)

- RLS enabled on all 30+ tables
- Backend role enforcement: `SECURITY DEFINER` RPCs + `IF caller_role` checks
- CSP + HSTS + `X-Frame-Options: DENY`
- Rate limiting (Upstash) on all own API routes
- MFA TOTP mandatory for Admin role (F3.1)
- Audit trail on all admin actions (F2.2)
- Retention policy: 12 months non-admin / 5 years admin (F3.2)
- Zero hardcoded secrets (all externalized via GitHub Secrets + `.env.local`)
- Email enumeration sanitized (unified error message on forgot-password)
- Password policy: 12 chars minimum + zxcvbn strength meter

## Controls (gaps / backlog)

- SRI (Subresource Integrity) on Plotly CDN
- WAF (Vercel Pro tier — not yet provisioned)
- Sentry for JS error tracking
- External penetration test (specialized firm) — quarterly cadence planned
