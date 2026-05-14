# Decision: Auth Token Storage

## Context

Supabase SDK stores `access_token` and `refresh_token` in localStorage by default. OWASP audit identified exfiltration risk via XSS.

## Options

### A — Keep localStorage + harden CSP (CHOSEN, 2026-05-14)

- Cost: zero (CSP already applied in F1.2)
- Mitigation: CSP `default-src 'self'` + controlled `script-src` blocks arbitrary injection
- Residual risk: XSS via compromised transitive dependency could still exfiltrate token
- Trigger for Option B: confirmed XSS incident or compliance requirement

### B — httpOnly cookies via @supabase/ssr + Next.js middleware

- Cost: ~2 dev-days of refactor
- Mitigation: token inaccessible to JS; XSS cannot exfiltrate
- Trade-off: requires SSR rework, impacts Vercel preview deployments

## Decision

Option A. Revisit quarterly.

## Owner

`worker_subgerente-app`
