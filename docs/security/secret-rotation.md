# Secret Rotation

## Cadence

| Secret | Scheduled rotation | Immediate trigger |
|---|---|---|
| `SUPABASE_SERVICE_KEY` | Annual | Dev offboarding / confirmed leak / every 6 months if possible |
| `SUPABASE_ACCESS_TOKEN` | Annual | Dev offboarding / confirmed leak |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Not rotated | Only if anon key is explicitly revoked (extreme case) |
| `AISSTREAM_API_KEY` | Annual | Dev offboarding |
| `GMAIL_CREDENTIALS_JSON` | Annual | Dev offboarding |
| `GMAIL_TOKEN_JSON` | Auto-rotation via OAuth refresh | Refresh failure |
| `UPSTASH_REDIS_REST_TOKEN` | Annual | Dev offboarding |
| Vercel deploy token | N/A (Vercel-managed) | Dev offboarding |

## Procedure: SUPABASE_SERVICE_KEY

1. Supabase Dashboard → Settings → API → Service Role → "Reset"
2. Copy new value
3. Update GitHub Secret `SUPABASE_SERVICE_KEY` in:
   - `https://github.com/IBBAOG/SectorData/settings/secrets/actions`
   - `https://github.com/IBBAOG/news-hunter-scanner/settings/secrets/actions`
4. Re-run any workflows that failed during the rotation window:
   ```
   gh workflow run etl_anp_vendas.yml
   gh workflow run etl_navios_lineup.yml
   # etc. — check GHA run history for failures
   ```
5. Update `.env.local` on dev machines
6. Log rotation in `docs/security/rotation-log.md` (date + reason + who)

## Procedure: SUPABASE_ACCESS_TOKEN

1. Supabase Dashboard → Account → Access Tokens → Revoke old → Generate new
2. Update GitHub Secret `SUPABASE_ACCESS_TOKEN` in `SectorData` repo
3. Trigger `supabase_deploy.yml` to confirm `supabase db push` still works
4. Log in `docs/security/rotation-log.md`

## Dev Onboarding / Offboarding

| Event | Action |
|---|---|
| Onboarding | Never share secrets via chat — use 1Password or equivalent secure channel |
| Offboarding | Rotate ALL secrets the dev had access to within 24h of departure |

## Rotation Log

Maintain `docs/security/rotation-log.md` with a row per rotation:

| Date | Secret | Reason | Done by |
|---|---|---|---|
| (first entry when first rotation occurs) | — | — | — |
