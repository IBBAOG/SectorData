# PRD — Alerts Product (cloud, multi-recipient)

Backend master doc do produto **Alerts Product**. Owner: [`worker_alerts-product`](../../.claude/agents/worker_alerts-product.md).

> **Não confundir com [`docs/alertas/PRD.md`](../alertas/PRD.md)** — esse doc cobre o sistema LOCAL-ONLY (gitignored, single-recipient Eduardo via Gmail API), owned por [`worker_alertas`](../../.claude/agents/worker_alertas.md). Os dois coexistem durante cutover (confirmado pelo CEO 2026-05-25). Eventualmente o local-only será descontinuado.

> Sub-PRD do frontend está em [`docs/app/alerts.md`](../app/alerts.md), owned por [`worker_dash-alerts`](../../.claude/agents/worker_dash-alerts.md).

---

## Status

- **Plan approved:** 2026-05-25
- **Scaffold:** COMPLETE (2026-05-25 — `worker_alerts-product` built full backend)
- **In production:** no. Pending: `RESEND_WEBHOOK_SECRET` GHA secret (post-webhook-route-deploy) + sanity test run in GHA (RESEND_API_KEY is set in GHA secrets but not local .env).

### Initialization checklist (verified 2026-05-25)

- [x] `docs/alerts/PRD.md` read — source of truth confirmed
- [x] `scripts/alerts/` directory scaffold complete (20 detectors, fanout, delivery, canary, CLI)
- [x] `requirements.txt` updated — added `jinja2>=3.1`; `supabase` already present; Resend uses raw `requests` (no SDK coupling)
- [x] GHA secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` exist; `RESEND_API_KEY` added by CEO 2026-05-25
- [x] `RESEND_WEBHOOK_SECRET` — pending (create after deploying webhook route, see Setup step 5)
- [x] 20 detectors in `DETECTOR_REGISTRY` (registry verified: `python -c "from scripts.alerts.detection import DETECTOR_REGISTRY; print(len(DETECTOR_REGISTRY))"` → 20)
- [x] PRD lists 18 detector slugs + `anp_ppi` (adapter) + `anp_precos_produtores` (adapter) = 20 total
- [x] Template renders verified locally: `alert_instant`, `alert_coalesced`, `confirmation` all PASS
- [x] CLI `python -m scripts.alerts.cli --help` loads cleanly
- [x] `worker_alertas` path (`alertas/`) untouched — coexists during cutover

### Sanity test send-test result

- **Status:** CANNOT RUN LOCALLY — `RESEND_API_KEY` is in GHA secrets only, not in `.env.local`.
- **Action required:** After first GHA workflow run, or after adding key to `.env.local`, run:
  ```
  python -m scripts.alerts.cli send-test --to=eduardomendes07122@gmail.com
  ```
- **Expected:** PASS if `onboarding@resend.dev` → arbitrary Gmail works on Resend free tier.
- **Fallback:** If FAIL with "domain not verified", see PRD § "Migration path" (buy domain ~US$10/yr, configure DKIM/SPF/DMARC in Resend dashboard).

## Architecture (cloud, multi-recipient)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        GitHub Actions (alerts_monitor.yml)                  │
│                       cron-job.org trigger every ~2h                        │
│                                                                             │
│  ┌──────────────────┐    ┌────────────────────┐    ┌───────────────────┐   │
│  │   DETECTION     │ →  │      FANOUT         │ →  │     DELIVERY      │   │
│  │  scripts/alerts/│    │  scripts/alerts/    │    │ scripts/alerts/   │   │
│  │   detection/    │    │     fanout.py       │    │   delivery/       │   │
│  │     *.py        │    │                     │    │  send_outbox.py   │   │
│  └────────┬────────┘    └──────────┬──────────┘    └────────┬──────────┘   │
│           │                        │                        │              │
└───────────┼────────────────────────┼────────────────────────┼──────────────┘
            │                        │                        │
            ▼                        ▼                        ▼
        ┌────────────┐         ┌─────────────┐         ┌──────────────┐
        │  alert_   │         │   alert_    │         │    Resend    │
        │  events    │  ──→   │   outbox    │  ──→   │     API      │
        │ (immutable │         │ (fan-out    │         │              │
        │   log)     │         │  queue)     │         │              │
        └────────────┘         └─────────────┘         └──────────────┘
                                                              │
                                                              ▼
                                                       ┌──────────────┐
                                                       │  Subscriber │
                                                       │    inbox     │
                                                       └──────────────┘
                                                              │
                                                              ▼ (bounce/open/click)
                                                       ┌──────────────┐
                                                       │ Resend webhook│
                                                       │   /api/      │
                                                       │   alerts/   │
                                                       │   resend-   │
                                                       │   webhook    │
                                                       └──────┬───────┘
                                                              │
                                                              ▼
                                                       ┌──────────────┐
                                                       │ alert_email_ │
                                                       │     log      │
                                                       │ (audit)      │
                                                       └──────────────┘
```

**Lateral channels:**
- **Frontend `/alerts`** (owned por `worker_dash-alerts`) consome RPCs `subscribe_to_alerts`, `confirm_subscription`, etc. → INSERT/UPDATE em `alert_subscribers`.
- **Admin panel** (owned por `worker_dash-admin`) consome RPCs admin (`admin_list_subscribers`, `admin_force_unsubscribe`, `admin_send_test_event`).
- **Resend webhook** atualiza `alert_subscribers.is_active=false` em hard bounce/complaint, audit em `alert_email_log`.

## Database schema

Owned por [`worker_supabase`](../../.claude/agents/worker_supabase.md). Migrations em `supabase/migrations/`. Schema canônico:

### `alert_sources`

Catálogo declarativo. Seed table (rows criadas em migration de seed; admin pode ativar/desativar via RPC).

```sql
CREATE TABLE alert_sources (
  source_slug TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('Fuel Distribution', 'Oil & Gas', 'Vessels', 'Proprietary')),
  display_name TEXT NOT NULL,
  description TEXT,
  frequency_hint TEXT,
  detection_module TEXT NOT NULL,                  -- 'scripts.alerts.detection.anp_ppi:AnpPpi'
  metadata JSONB DEFAULT '{}'::jsonb,              -- {coalesce_above: 10, frontend_route: '/anp-ppi'}
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `alert_subscribers`

Per (user|anon) per source. Heart of subscription model.

```sql
CREATE TABLE alert_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL for anonymous
  email TEXT NOT NULL,
  source_slug TEXT NOT NULL REFERENCES alert_sources(source_slug),
  is_confirmed BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  filters JSONB DEFAULT '{}'::jsonb,                          -- v2: {product:['diesel'], region:['SE']}
  confirmation_token UUID UNIQUE,                            -- NULL once confirmed
  confirmation_sent_at TIMESTAMPTZ,
  confirmation_expires_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  unsubscribe_token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  source_ip INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (email, source_slug)
);
```

**RLS policies:**
- SELECT/INSERT/DELETE: `user_id = auth.uid()` for authenticated users
- Anon: nothing direct; goes through SECURITY DEFINER RPCs only
- Admin: full via `public.is_admin()` SECURITY DEFINER

### `alert_signup_rate`

Anti-abuse rate limit (per-IP, sliding hour window).

```sql
CREATE TABLE alert_signup_rate (
  source_ip INET NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,                -- truncated to hour
  attempts INT NOT NULL DEFAULT 1,
  PRIMARY KEY (source_ip, window_start)
);
-- Enforce max 10 signups/IP/hour at RPC level
```

### `alert_events`

Immutable log de cada update detectado. Source of truth for "what was detected when".

```sql
CREATE TABLE alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug TEXT NOT NULL REFERENCES alert_sources(source_slug),
  event_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source_slug, event_key)                    -- IDEMPOTENCY ANCHOR
);
```

**`event_key` patterns (canônico):**
- Por período mensal: `period:YYYY-MM`
- Por período semanal: `weeks:YYYY-MM-DD..YYYY-MM-DD`
- Por dia: `day:YYYY-MM-DD`
- Por campo (ANP CDP): `field:<nome-campo>:<ambiente>` (`field:URUGUA:S`)
- Por candidate (AIS): `candidate:<imo>:<discovered_at_hour>`
- Por confirmation (synthetic): `confirmation:<subscriber_id>`

### `alert_outbox`

Fanout queue per (subscriber, event).

```sql
CREATE TABLE alert_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES alert_subscribers(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','skipped')),
  send_attempts SMALLINT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  error TEXT,
  UNIQUE (subscriber_id, event_id)                   -- IDEMPOTENCY ANCHOR
);

CREATE INDEX alert_outbox_status_idx ON alert_outbox(status) WHERE status = 'queued';
```

### `alert_email_log`

Append-only audit. Webhook + delivery worker INSERT.

```sql
CREATE TABLE alert_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id UUID REFERENCES alert_outbox(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,                              -- 'sent','bounced','complained','delivered','opened','clicked'
  provider_message_id TEXT,
  provider_response JSONB,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
```

## RPCs

Owned por `worker_supabase`. Consumed por `worker_dash-alerts` (user-facing) e `worker_alerts-product` (admin/backend).

### User-facing (callable by anon + authenticated)

| RPC | Signature | Behavior |
|-----|-----------|----------|
| `list_alert_sources` | `() → SETOF alert_sources_public_v` | Returns active sources only (`is_active=true`), strips `detection_module` from response. |
| `subscribe_to_alerts` | `(p_email TEXT, p_source_slugs TEXT[]) → JSONB` | Atomic upsert. If `auth.uid() IS NOT NULL` AND `p_email = auth.users.email`: insta-confirm. Else: insert with `is_confirmed=false`, generate `confirmation_token`, INSERT synthetic confirmation event into `alert_events` (for outbox to pick up and send confirmation email). Rate-limited via `alert_signup_rate`. |
| `confirm_subscription` | `(p_token UUID) → JSONB` | Looks up `alert_subscribers WHERE confirmation_token=p_token AND confirmation_expires_at > now()`. SET `is_confirmed=true, confirmation_token=NULL, confirmed_at=now()`. Returns `{success: bool, subscribed_count: int}`. |
| `resend_confirmation` | `(p_email TEXT, p_source_slugs TEXT[]) → JSONB` | Rate-limited (max 1×/10min per email). Generates new tokens + new synthetic confirmation event. |
| `unsubscribe` | `(p_token UUID) → JSONB` | Looks up by `unsubscribe_token`. SET `is_active=false`. Idempotent. |
| `unsubscribe_all` | `(p_token UUID) → JSONB` | Looks up email by token, SET `is_active=false` for all subs of that email. |

### Authenticated-only (RLS: `user_id = auth.uid()`)

| RPC | Signature | Behavior |
|-----|-----------|----------|
| `list_my_subscriptions` | `() → SETOF alert_subscribers_my_v` | Returns rows WHERE `user_id = auth.uid() AND is_active = true` (regardless of confirmed status). |
| `list_my_recent_alerts` | `(p_limit INT DEFAULT 20) → JSONB[]` | JOIN outbox + events + email_log; returns recent sends. |
| `update_subscription_active` | `(p_source_slug TEXT, p_is_active BOOLEAN) → BOOLEAN` | Pause/resume; updates row WHERE `user_id = auth.uid() AND source_slug = p_source_slug`. |

### Admin-only (RLS: `public.is_admin()`)

| RPC | Signature | Behavior |
|-----|-----------|----------|
| `admin_list_subscribers` | `(p_source_slug TEXT DEFAULT NULL, p_limit INT DEFAULT 100) → JSONB[]` | All subscribers, optionally filtered. |
| `admin_force_unsubscribe` | `(p_subscriber_id UUID) → BOOLEAN` | SET `is_active=false`, logs audit. |
| `admin_requeue_outbox` | `(p_outbox_id UUID) → BOOLEAN` | Resets `status='queued', send_attempts=0` for a failed row. |
| `admin_send_test_event` | `(p_source_slug TEXT) → UUID` | Inserts a synthetic test event into `alert_events`; fanout will materialize outbox for active subs. |
| `admin_email_log_recent` | `(p_limit INT DEFAULT 200) → JSONB[]` | Audit query. |
| `admin_subscriber_stats` | `() → JSONB` | Counts per source, bounce rate, etc. |

## Detection layer

Localização: `scripts/alerts/detection/*.py`. Cada detector exporta:

```python
class BaseDetector(ABC):
    source_slug: str

    @abstractmethod
    def detect(self) -> list[DetectedEvent]:
        ...

@dataclass
class DetectedEvent:
    event_key: str
    payload: dict
```

### Catalog of detectors (target 18 detectors, all in MVP scope)

| source_slug | detection_module | Reuse from `alertas/`? | event_key pattern |
|-------------|------------------|------------------------|---------------------|
| `anp_ppi` | `scripts.alerts.detection.anp_ppi:AnpPpi` | ✅ adapter | `period:YYYY-MM-DD` (data_atualizacao) |
| `anp_precos_produtores` | `:AnpPrecosProdutores` | ✅ adapter | `period:YYYY-MM-DD` |
| `anp_glp` | `:AnpGlp` | ✅ adapter | `period:YYYY-MM` (mês de vendas) |
| `anp_lpc` | `:AnpLpc` | ✅ adapter | `weeks:YYYY-MM-DD..YYYY-MM-DD` (data_fim) |
| `anp_precos_distribuicao` | `:AnpPrecosDistribuicao` | ✅ adapter (já era Supabase-only) | `period:YYYY-MM-DD:weekly` ou `period:YYYY-MM:monthly` |
| `anp_sintese_semanal` | `:AnpSinteseSemanal` | ✅ adapter | `edition:NNN/YYYY` |
| `anp_painel_combustiveis` | `:AnpPainelCombustiveis` | ✅ adapter | `period:YYYY-MM:zip` ou `period:YYYY-MM:pbi` (dual signal) |
| `anp_dados_abertos_ie` | `:AnpDadosAbertosIE` | ✅ adapter | `file:<filename>` |
| `mdic_comex` | `:MdicComex` | ✅ adapter | `period:YYYY-MM` |
| `sindicom` | `:Sindicom` | ✅ adapter (heavy — runs only in `etl_sindicom.yml`) | `period:YYYY-MM` |
| `anp_cdp_producao` | `:AnpCdpProducao` | ✅ adapter (preserves baseline invariant) | `field:<nome>:<ambiente>` per campo novo |
| `anp_desembaracos_daie` | `:AnpDesembaracosDaie` | ⚠️ partial — `alertas/` só tem desembaracos, falta daie | `period:YYYY-MM` |
| `anp_cdp_diaria` | `:AnpCdpDiaria` | ❌ NEW | `day:YYYY-MM-DD` (read MAX(data) from anp_cdp_diaria) |
| `anp_voip` | `:AnpVoip` | ❌ NEW | `year:YYYY` (anual) |
| `vendas` | `:Vendas` | ❌ NEW | `period:YYYY-MM` (read MAX from vendas) |
| `navios_diesel` | `:NaviosDiesel` | ❌ NEW | `lineup:<porto>:<collected_at_hour>` (per port lineup snapshot) |
| `ais_candidates` | `:AisCandidates` | ❌ NEW | `candidate:<imo>:<last_update_hour>` (per high-score candidate) |
| `d_g_margins` | `:DGMargins` | ❌ NEW | `week:YYYY-MM-DD` (MAX week) |
| `price_bands` | `:PriceBands` | ❌ NEW | `date:YYYY-MM-DD` (MAX date) |
| `anp_subsidy` | `:AnpSubsidy` | ❌ NEW | `day:YYYY-MM-DD` (MAX data_referencia) |

**Note:** `ais_positions` separado de `ais_candidates` no frontend (`docs/app/alerts.md`) mas no backend pode ser 1 detector que emite candidates events (positions are too noisy to alert on — só candidates qualificam).

## Fanout (`scripts/alerts/fanout.py`)

```python
def fanout_pending_events() -> dict:
    """
    Para cada event novo (sem rows em outbox):
      INSERT INTO alert_outbox (subscriber_id, event_id, status)
      SELECT s.id, e.id, 'queued'
      FROM alert_events e
      JOIN alert_subscribers s ON s.source_slug = e.source_slug
      WHERE s.is_active = TRUE AND s.is_confirmed = TRUE
        AND NOT EXISTS (SELECT 1 FROM alert_outbox o
                        WHERE o.subscriber_id = s.id AND o.event_id = e.id)
      ON CONFLICT (subscriber_id, event_id) DO NOTHING
    
    Coalescing: se >coalesce_above events da mesma source para mesmo subscriber no mesmo batch,
    agrupa em 1 outbox row com payload {coalesced: true, events: [...]}.
    
    Returns: {created: int, coalesced_groups: int}
    """
```

## Delivery (`scripts/alerts/delivery/send_outbox.py`)

```python
def send_pending_outbox(batch_limit: int = 100) -> dict:
    """
    SELECT alert_outbox WHERE status='queued' ORDER BY id LIMIT batch_limit
    
    Per row:
      1. Lookup subscriber email
      2. Pre-check Resend suppressions → status='skipped' if matched
      3. Render: Jinja2 templates (HTML + plain text)
      4. POST Resend API (idempotency-key = outbox.id)
      5. Success: status='sent', sent_at=now(), provider_message_id captured
      6. Transient failure (5xx, network): send_attempts++, status stays 'queued'
      7. Permanent failure (4xx): status='failed', error captured
      8. Always: INSERT alert_email_log row (audit)
    
    Returns: {sent: int, skipped: int, failed: int, transient: int}
    """
```

## Email templates

Localização: `scripts/alerts/delivery/templates/`. Jinja2. **English only.**

| Template | Purpose |
|----------|---------|
| `confirmation.html` / `.txt` | Double opt-in confirmation email (anon flow) |
| `alert_instant.html` / `.txt` | Single event notification (most common case) |
| `alert_coalesced.html` / `.txt` | Multiple events same source same batch (ANP CDP case) |
| `_layout.html` (partial) | Shared header/footer (brand, unsubscribe links) |

**Mandatory footer:**
```
You're receiving this because you subscribed to {{ source.display_name }} alerts at
{{ frontend_url }}/alerts.

[Unsubscribe from this source]  [Unsubscribe from all alerts]
```

Links use `unsubscribe_token` from `alert_subscribers`. Tokens are UUID v4 (122 bits entropy).

## Resend webhook handler

Localização: `src/app/api/alerts/resend-webhook/route.ts`. Owned por `worker_alerts-product`.

```typescript
export async function POST(req: Request) {
  // 1. Verify HMAC signature (svix-signature header) via RESEND_WEBHOOK_SECRET
  // 2. Parse event_type
  // 3. INSERT alert_email_log
  // 4. If 'email.bounced' (hard) or 'email.complained':
  //    UPDATE alert_subscribers SET is_active=false WHERE email = event.to
  // 5. If event spike (e.g., >50 complaints/24h): trigger meta-alert
  // 6. Return 200
}
```

**Service role key** is used in the handler (server-side only). Anon key never accesses these tables directly.

## GitHub Actions workflows

### `.github/workflows/alerts_monitor.yml` (NEW)

```yaml
name: Alerts Monitor (detection + fanout + delivery)
on:
  workflow_dispatch:
  schedule:
    - cron: '0 */2 * * *'  # every 2h fallback (external cron-job.org also triggers)
jobs:
  monitor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install -r requirements.txt
      - name: Detect updates (all sources)
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: python -m scripts.alerts.cli detect --all
      - name: Fanout to outbox
        env: { ... }
        run: python -m scripts.alerts.cli fanout
      - name: Send via Resend
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
        run: python -m scripts.alerts.cli deliver --batch-limit 100
```

### `.github/workflows/alerts_meta_canary.yml` (NEW)

```yaml
name: Alerts Meta Canary
on:
  schedule:
    - cron: '0 12 * * *'  # daily 12h UTC
jobs:
  canary:
    runs-on: ubuntu-latest
    steps:
      - ... setup ...
      - name: Check stale bases
        run: python -m scripts.alerts.cli canary --stale-hours 48
```

## Required secrets and config (GitHub Actions)

| Secret / env | Purpose | Status as of 2026-05-25 |
|--------|---------|--------|
| `SUPABASE_URL` | Supabase project URL (shared) | Already exists |
| `SUPABASE_SERVICE_KEY` | Service role key for backend writes | Already exists |
| `RESEND_API_KEY` | Resend API key — generate at https://resend.com/api-keys | ✅ Done by CEO |
| `RESEND_WEBHOOK_SECRET` | HMAC secret for webhook signature verification | Pending (post-deploy of webhook route) |
| `ALERTS_SENDER_EMAIL` | From address — defaults to `onboarding@resend.dev` | Pending; default value works without GHA secret |
| `ALERTS_REPLY_TO_EMAIL` | Reply-To address — `ibbaogproject@gmail.com` | Pending; can hardcode default in code |
| `ALERTS_FRONTEND_URL` | Base URL for unsubscribe/confirm links (e.g., `https://sectordata-dashboard.vercel.app`) | Pending; CEO to confirm production URL |

**Correction note (2026-05-25):** earlier drafts of this PRD specified single-sender verification of `ibbaogproject@gmail.com`. That is a SendGrid feature, NOT Resend. Resend requires full-domain verification (DKIM/SPF/DMARC). Decision was revised to use Resend's default `onboarding@resend.dev` sender with Reply-To pointing at the Gmail account. This eliminates DNS setup entirely.

## Setup steps (CEO action items — current status)

1. ✅ **Create Resend account** at https://resend.com (free tier, no credit card needed). — DONE
2. ✅ **Generate API key:** Resend dashboard → API Keys → Create. Scope: Send + Read Suppressions. — DONE
3. ✅ **Add `RESEND_API_KEY` to GHA secrets** (`IBBAOG/SectorData` repo). — DONE
4. ⬜ **Confirm production URL** for `ALERTS_FRONTEND_URL` — needed for unsubscribe/confirm links in email body. Default candidate: `https://sectordata-dashboard.vercel.app`.
5. ⬜ **Set webhook URL** (DEFERRED to post-deploy) — `https://<production-url>/api/alerts/resend-webhook` in Resend dashboard → Webhooks. Generate signing secret → add as `RESEND_WEBHOOK_SECRET`. Without this, bounce/complaint tracking is manual but core sending still works.
6. ⬜ **Invoke `worker_alerts-product`** in new session — picks up from `Initialization checklist` in its `.md` file.

## Sender strategy (Option A — locked 2026-05-25)

- **From:** `"SectorData Alerts <onboarding@resend.dev>"`
- **Reply-To:** `ibbaogproject@gmail.com`
- **Why:** zero DNS setup, free tier OK to start. Subscriber sees `from: onboarding@resend.dev` which is less "branded" but works immediately.
- **Test plan during implementation:** worker MUST verify Resend allows sending to arbitrary recipients (not just the account owner's email) from the default `*.resend.dev` domain. Some providers gate this behind domain verification. First sanity test:
  ```python
  resend.Emails.send({
      "from": "SectorData Alerts <onboarding@resend.dev>",
      "to": ["eduardomendes07122@gmail.com"],  # not the account-owner email
      "reply_to": "ibbaogproject@gmail.com",
      "subject": "[SectorData Alerts] Sandbox test",
      "html": "<p>If you got this, sender works to arbitrary recipients.</p>"
  })
  ```
  If Resend rejects with "domain not verified" or similar, pivot immediately to buying a domain (~US$ 10/year at Cloudflare or Namecheap) and verifying in https://resend.com/domains.

## Migration path (if sandbox restriction bites OR deliverability is poor)

1. Buy a short domain (e.g., `sectordata-alerts.com`, `sectordataalerts.app`)
2. https://resend.com/domains → "Add Domain" → enter domain
3. Configure 3 DNS records (Resend dashboard shows exact values):
   - `MX` (optional, only for inbound)
   - `TXT` for SPF
   - `CNAME` for DKIM
   - `TXT` for DMARC (`v=DMARC1; p=none`)
4. Wait for Resend to verify (usually <10 min after DNS propagates)
5. Update `ALERTS_SENDER_EMAIL` env to `alerts@<your-domain>`
6. No code changes needed; templates and Reply-To stay the same.

## Runbooks

### Add a new source

1. INSERT row in `alert_sources` (migration ou admin RPC).
2. Write detector in `scripts/alerts/detection/<slug>.py` extending `BaseDetector`.
3. Set `is_active=true` in `alert_sources`.
4. Add row to catalog table in `docs/app/alerts.md`.
5. Add detector list entry in this PRD.
6. Verify in staging: subscribe a test email, inject synthetic event via `admin_send_test_event(slug)`, observe outbox → email.

### Debug missed alert (false negative)

1. Verify detector ran in latest GHA workflow log.
2. Check `alert_events` table for the period in question. If empty → detection bug; if present → fanout/delivery bug.
3. Check `alert_outbox` rows for that `event_id`. If empty → subscriber not active/confirmed.
4. Check `alert_email_log` for sends. Status `failed` → check error column.
5. Check Resend dashboard for delivery status (Sent / Bounced / Spam).

### Debug duplicate alert

1. Should be IMPOSSIBLE due to UNIQUE constraints on `(source_slug, event_key)` and `(subscriber_id, event_id)`. If happens → bug.
2. Check `alert_events` for duplicate rows with same `event_key`. UNIQUE should prevent.
3. Check `alert_outbox` for dupes per pair. UNIQUE should prevent.
4. If found → CRITICAL: bug in constraint enforcement; alert `worker_supabase`.

### Bounce/complaint spike

1. Resend dashboard → Suppressions list.
2. Query `alert_email_log WHERE status IN ('bounced','complained') AND recorded_at > now() - interval '7 days'`.
3. If specific source has high rate → check email template for issues.
4. If specific domain (gmail.com) has high rate → may be DMARC alignment issue with sender on behalf; consider pivoting to `resend.dev` subdomain.

## Cutover plan (decided by CEO 2026-05-25)

| Phase | Duration | What runs |
|-------|----------|-----------|
| **A. Parallel** | Now → MVP launch | Both `alertas/` (local, Gmail, Eduardo) AND `scripts/alerts/` (cloud, Resend, multi-recipient) run independently. Detection state is independent (alertas/ uses JSON; new uses `alert_events`). |
| **B. Canary** | 2-4 weeks post-launch | Monitor parity: every fact detected by `alertas/` must also appear in `alert_events` within same cron cycle. Drift → investigate. |
| **C. Cutover** | When parity sustained ≥4 weeks | CEO approves. `alertas/` archived (kept in repo, workflows disabled). All notifications via cloud path. `worker_alertas` becomes legacy reference. |

## Acceptance criteria (MVP launch)

- [ ] All 18 detectors implemented and tested
- [ ] All 6 RPCs (user-facing) callable from `/alerts`
- [ ] All 6 admin RPCs callable from `/admin-panel` Alerts tab
- [ ] Confirmation flow E2E: anon submits email → receives confirmation email → clicks link → subscription active
- [ ] Unsubscribe flow E2E: receives alert email → clicks unsubscribe → row deactivated → subsequent events don't generate outbox
- [ ] Webhook E2E: hard bounce → subscriber auto-deactivated
- [ ] Rate limit: 11th signup from same IP in 1h rejected
- [ ] 18-source seed in `alert_sources`
- [ ] `module_visibility` row + Card image uploaded
- [ ] NavBar entry "Alerts" visible to anon
- [ ] Dual-view: desktop + mobile both functional (CTO-policy)
- [ ] All UI strings in English (CTO-policy)
- [ ] Cron `alerts_monitor.yml` runs successfully end-to-end on staging
- [ ] Production canary: Eduardo subscribed to 3 sources receives 1 email per detection (no dupes, no missing)
- [ ] Documentation: `docs/app/alerts.md` + this file + worker .md files all in sync

## Open questions (operational, non-blocking)

See [`docs/app/alerts.md`](../app/alerts.md) § "Roadmap" for post-MVP features. Plan-level questions in [`.claude/plans/quero-criar-um-novo-synchronous-reddy.md`](../../.claude/plans/quero-criar-um-novo-synchronous-reddy.md) § "Perguntas em aberto" (Blocos 2, 3, 4).
