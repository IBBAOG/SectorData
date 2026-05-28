# Sub-PRD — `/alerts`

Dashboard de User-Facing Email Subscriptions. Owner: [`worker_dash-alerts`](../../.claude/agents/worker_dash-alerts.md).

> Único módulo do produto onde **anônimos podem se cadastrar** (double opt-in). Coordena com o backend Alerts Product ([`worker_alerts-product`](../../.claude/agents/worker_alerts-product.md)) que faz detection → fanout → delivery via Resend, e com o Admin Panel ([`worker_dash-admin`](../../.claude/agents/worker_dash-admin.md)) que tem uma tab "Alerts" para gerenciar subscribers e auditar email log.

## Status

- **PRD aprovado:** 2026-05-25 ([`plans/quero-criar-um-novo-synchronous-reddy.md`](../../../.claude/plans/quero-criar-um-novo-synchronous-reddy.md)).
- **Frontend MVP complete** (see commit hash in git log — `alerts(frontend): build /alerts dual-view + confirm + unsubscribe flows`).
- **Em produção:** não. Aguarding `module_visibility` row (worker_dash-admin) + Resend API key sanity test + `ALERTS_FRONTEND_URL` GHA secret.

### Frontend MVP scope (2026-05-25)

Files created:
- `src/app/(dashboard)/alerts/page.tsx` — viewport router (useIsMobile)
- `src/app/(dashboard)/alerts/useAlertsData.ts` — shared hook (all RPC calls, state, types)
- `src/app/(dashboard)/alerts/desktop/View.tsx` — desktop layout (two-column: catalog + mgmt panel)
- `src/app/(dashboard)/alerts/mobile/View.tsx` — mobile layout (tabs + BottomSheet catalog + sticky CTA) — **deleted 2026-05-27** (mobile reform wave 2; module is desktop-only)
- `src/app/(dashboard)/alerts/confirm/page.tsx` — double opt-in confirmation landing
- `src/app/(dashboard)/alerts/unsubscribe/page.tsx` — one-click unsubscribe landing
- `src/app/(dashboard)/alerts/page.module.css` — scoped styles
- `src/types/alerts.ts` — shared TypeScript types
- `src/lib/rpc.ts` — 9 alert RPC wrappers added (Alerts RPCs section)
- `src/components/NavBar.tsx` — "Alerts" top-level entry added (between Market Watch and News Hunter)

## View structure (desktop-only — mobile excluded)

`/alerts` is **desktop-only** by CTO decision (mobile reform wave 2, § 3.1). Mobile visitors are
redirected to `/home?excluded=alerts` with an informational toast via `MobileExcludedRedirect`.

Transactional sub-pages (`/alerts/confirm`, `/alerts/unsubscribe`) are explicitly exempted from
the mobile redirect — users must be able to confirm subscriptions or unsubscribe from a mobile
device clicking an email link.

```
src/app/(dashboard)/alerts/
├── page.tsx                  Mounts MobileExcludedRedirect (redirect on mobile, no-op on
│                               desktop) + renders DesktopView unconditionally.
├── useAlertsData.ts          SINGLE BRAIN: source catalog fetch, subscription CRUD,
│                               confirmation/unsubscribe handlers, recent alerts feed.
│                               DesktopView consumes this hook; no direct supabase-js calls
│                               inside View files.
├── desktop/View.tsx          Desktop UX (≥769px) — expandable category cards,
│                               side-by-side Active Subs panel + Recent Feed.
│                               (mobile/View.tsx deleted — wave 2 mobile reform 2026-05-27)
├── confirm/
│   └── page.tsx              /alerts/confirm?token=... — double opt-in landing (mobile-safe)
├── unsubscribe/
│   └── page.tsx              /alerts/unsubscribe?token=... — one-click unsubscribe (mobile-safe)
└── page.module.css           Scoped styles
```

Confirmation and unsubscribe pages are **single-view** (centered card, no dual-view divergence
needed) — they are transactional landing pages that must work on all devices.

## Tiers de acesso

| Tier | Pode ver `/alerts`? | Pode subscribe? | Auth flow |
|------|---------------------|-----------------|-----------|
| **Anon** | ✅ Sim (`is_visible_for_public=true`) | ✅ Sim, com double opt-in (link de confirmação por email) | RPC `subscribe_to_alerts` cria row com `is_confirmed=false`; user clica link → `confirm_subscription(token)` |
| **Client** | ✅ Sim | ✅ Sim. Se email matches `auth.users.email`: instant confirm. Se override: double opt-in. | Pre-filled email field. RPC same. |
| **Admin** | ✅ Sim | ✅ Sim (mesmo flow do Client) + acesso a tab "Alerts" no `/admin-panel` para gerenciar subscribers globais | Same. |

## UI flow (subscribe)

```
1. User abre /alerts
2. Vê página com:
   - Header: "Subscribe to data updates"
   - Email input (pre-filled se logado)
   - 4 category cards expandidos por default (Fuel Distribution / Oil & Gas / Vessels / Proprietary)
     com checkboxes per source
   - "Select all" buttons (per-category + top-level)
   - Submit button: "Subscribe to N selected sources"
3. User seleciona N sources e clica Submit
4. Frontend chama RPC subscribe_to_alerts(email, source_slugs[])
5. Backend:
   - Se logged + email = auth.email: rows criadas com is_confirmed=true. UI mostra "Subscribed!"
   - Se anon OR logged + email override:
     - Rows criadas com is_confirmed=false + confirmation_token
     - Backend enqueue 1 outbox row "synthetic confirmation event"
     - delivery worker manda 1 email com link /alerts/confirm?token=...
     - UI mostra "Check your inbox to confirm your subscription"
6. User clica link no inbox → /alerts/confirm?token=...
7. Frontend chama RPC confirm_subscription(token)
8. Backend: SET is_confirmed=true, NULL confirmation_token. Próximo event detectado vai gerar outbox normal.
9. UI mostra success card: "Your subscriptions are now active. You'll receive alerts as new data arrives."
```

## UI flow (manage existing — logged users only)

```
1. Active Subscriptions panel (right side desktop, separate tab mobile):
   - List de rows com source name + frequency_hint + toggle (pause/resume) + Unsubscribe button
   - Top-level "Unsubscribe from all" button
2. Toggle pause: RPC update_subscription_active(source_slug, is_active)
3. Unsubscribe button: RPC unsubscribe(unsubscribe_token) — confirmation modal first
4. Recent Alerts feed (read-only):
   - List de últimos 20 events que user recebeu (via list_my_recent_alerts)
   - Cada row: source, period detected, timestamp sent, "View source data" link
   - Status pill: delivered/opened/bounced (from alert_email_log via outbox.id JOIN)
```

## UI flow (unsubscribe via email link — anon-safe)

```
1. User clica "Unsubscribe from this source" link no rodapé do email
2. URL: /alerts/unsubscribe?token=<unsubscribe_token>&source=<source_slug>
3. Frontend chama RPC unsubscribe(token)
4. Backend: SET is_active=false. Idempotente (re-clicks são no-op).
5. UI mostra: "You've been unsubscribed from <source>. [Manage all subscriptions]"

OR

1. User clica "Unsubscribe from all" link
2. URL: /alerts/unsubscribe?token=<unsubscribe_token>&all=1
3. Frontend chama RPC unsubscribe_all(token)
4. Backend: SET is_active=false WHERE email matches subscriber.email
5. UI mostra: "You've been unsubscribed from all alerts. [Re-subscribe]"
```

## RPCs consumidas

Documentadas em [`docs/alerts/PRD.md`](../alerts/PRD.md). Wrappers em `src/lib/rpc.ts` seção "Alerts RPCs":

```typescript
// Public (anon + authenticated)
listAlertSources()                              // GET catalog
subscribeToAlerts(email, sourceSlugs)           // SUBSCRIBE atomic
confirmSubscription(token)                      // CONFIRM double opt-in
resendConfirmation(email, sourceSlugs)          // RESEND (rate-limited)
unsubscribe(token)                              // single source via token
unsubscribeAll(token)                           // all sources via token

// Authenticated only (RLS: user_id = auth.uid())
listMySubscriptions()                           // Active panel
listMyRecentAlerts(limit = 20)                  // Feed
updateSubscriptionActive(sourceSlug, isActive)  // pause/resume toggle
```

## Componentes compartilhados

Use components do `src/components/dashboard/` (compartilhados com outros dashboards):
- `DashboardHeader` — title "Alerts" + subtitle "Receive email notifications when data sources update"
- `BarrelLoading` — para estados de loading

Componentes específicos de `/alerts` (em `src/app/(dashboard)/alerts/_components/`):
- `SourceCatalogCard` — uma categoria expansível com lista de sources e checkboxes
- `EmailField` — input com validação RFC 5322 + indicador de "Logged in as ..."
- `ActiveSubscriptionsTable` — desktop only; mobile usa lista em tab separado
- `RecentAlertsFeed` — read-only feed com status pills

Mobile uses `src/components/dashboard/mobile/`:
- `MobileNavBar`
- `StickyBreadcrumb`
- `BottomSheet` (para "Manage subscriptions")
- `FilterDrawer` (para chips de selected sources)

## Source catalog (atual)

Após seed de `alert_sources`, a UI carrega via `list_alert_sources()`. Categorias e display names:

### Fuel Distribution (11 sources)

| source_slug | display_name | frequency_hint |
|-------------|--------------|----------------|
| `anp_ppi` | ANP Import Parity Prices (PPI) | Weekly (Mon ~12h UTC) |
| `anp_precos_produtores` | ANP Producer Prices | Weekly (Mon ~12h UTC) |
| `anp_glp` | ANP GLP Sales | Weekly (Mon ~12h UTC) |
| `anp_lpc` | ANP Retail Fuel Prices (LPC) | Weekly (Wed ~14:30 UTC) |
| `anp_precos_distribuicao` | ANP Distribution Prices | Weekly + Monthly |
| `anp_sintese_semanal` | ANP Weekly Synthesis | Weekly |
| `anp_painel_combustiveis` | ANP Fuel Panel | Monthly |
| `anp_dados_abertos_ie` | ANP Open Data (Imports & Exports) | Variable |
| `anp_desembaracos_daie` | ANP DAIE + Customs Clearances | Monthly (1st of month, ~13h UTC) |
| `mdic_comex` | MDIC Comex (3 NCMs: crude oil, gasoline, diesel) | Daily |
| `sindicom` | SINDICOM Distribution Sector | Monthly (5th of month, ~15h UTC) |

### Oil & Gas (3 sources)

| source_slug | display_name | frequency_hint |
|-------------|--------------|----------------|
| `anp_cdp_producao` | ANP CDP Well Production (monthly) | Monthly (mid-month publication, ~2h fallback cron) |
| `anp_cdp_diaria` | ANP CDP Daily Production | 3×/day (Power BI API) |
| `anp_voip` | ANP VOIP (Reserve Bulletin) | Annual (May 1st) |

### Vessels (3 sources)

| source_slug | display_name | frequency_hint |
|-------------|--------------|----------------|
| `navios_diesel` | Diesel Vessels Lineup (5 ports) | Every 6h |
| `ais_positions` | AIS Vessel Positions | Every 6h + WebSocket |
| `ais_candidates` | AIS Import Candidates (early-warning radar) | Every 4h |

### Proprietary (3 sources)

| source_slug | display_name | frequency_hint |
|-------------|--------------|----------------|
| `d_g_margins` | Diesel & Gasoline Margins | Weekly (Mon 10h UTC, manual upload) |
| `price_bands` | Price Bands (Import/Export Parity) | Ad-hoc (manual upload) |
| `anp_subsidy` | ANP Subsidy Diesel Reference | Daily (~11:30 UTC) |

**Total: 20 sources.** (Slight overcount from the PRD's 18 because `anp_desembaracos_daie` consolida 2 fontes em 1 source de alerta — DAIE e Desembaraços rodam juntos via `etl_anp_fase3.yml`; `ais_positions` e `ais_candidates` são separados aqui mesmo embora compartilhem infra.)

## Edge cases (UI level)

| Caso | Comportamento esperado |
|------|------------------------|
| User submete email inválido (regex client-side) | Block submit; show inline error "Please enter a valid email" |
| User submete sem source selecionada | Block submit; show "Please select at least one source" |
| Anon submete; já existe row com `is_confirmed=true` (re-subscribe) | RPC retorna `already_subscribed`; UI shows "You're already subscribed" + link to manage (login prompt) |
| User clica link de confirmação >48h depois | RPC retorna `token_expired`; UI mostra "Link expired" + button "Resend confirmation" |
| User clica unsubscribe link 2× | Idempotente; UI mostra mesmo success message |
| User logged-in com email override (≠ auth.email) | Trata como anon: double opt-in para o novo email |
| Anon submete email igual à de um logged user | Backend não merge (cada subscription é por `email` no PK; user_id pode ser NULL para anon row). Se anon depois loga com mesmo email, merge é manual via RPC `merge_anon_subscriptions` (futuro v2). |
| Source desativada (`is_active=false` em `alert_sources`) | `list_alert_sources` filtra; UI nunca mostra. Existing subscriptions de source desativada pausam auto (fanout pula). |
| Suppression list bate (email já marked bounced) | Backend rejeita subscribe; UI mostra "This email has been suppressed. Contact support." |

## Performance budget

- Initial page load: <800ms (Lighthouse mobile)
- Source catalog fetch (`list_alert_sources`): <200ms (small seed table, ~20 rows)
- Subscribe RPC: <1s (includes confirmation email enqueue if anon)
- Recent feed polling: 1×/60s, incremental via `sent_at > last_seen`. Avoid full-table scans.

## Accessibility

- Source catalog: checkboxes têm `<label>` envolvendo, keyboard navigable
- Confirmation/unsubscribe landing pages: single CTA com focus default
- Status pills: contraste color + screen-reader text (`aria-label="Status: delivered"`)
- Email field: `aria-describedby` apontando para validation message
- Mobile BottomSheet: ESC fecha; tap-outside fecha

## Internacionalização

**English only** (CTO-policy). Strings hardcoded inicialmente; se i18n vier no futuro, extrair para `src/i18n/alerts.json` keyed por `t('alerts.subscribe.cta')`.

## Telemetry / analytics

- `track_event('alerts.subscribe.submit', '/alerts', { source_count, has_anon })` — quando submit RPC retorna sucesso
- `track_event('alerts.confirm.click', '/alerts/confirm', { token_valid })` — page load
- `track_event('alerts.unsubscribe.click', '/alerts/unsubscribe', { all })` — page load
- Dashboard de adoção em `/admin-analytics` (futuro): MAU, conversion rate anon→confirmed, churn rate.

## Cross-system contracts (decore)

- **`alert_sources` schema** → owned por `worker_supabase`; seed mantido por `worker_alerts-product`. Mudança de coluna = coordenação cross-dept via Gerente.
- **`subscribe_to_alerts` RPC signature** → owned por `worker_supabase`. Frontend wrapper em `src/lib/rpc.ts` segue. Mudança quebra UI se não coordenada.
- **Email templates** → owned por `worker_alerts-product`. UI deep-links nos emails ("View source data") devem matchar `useNewsHunterData`-like patterns (use `frontend_route` field se adicionar a `alert_sources.metadata`).
- **Resend webhook** → backend (worker_alerts-product) handler em `src/app/api/alerts/resend-webhook/route.ts`. Webhook updates `alert_subscribers.is_active` em hard bounce/complaint. UI vê via `list_my_subscriptions` (already reflects).

## Anti-padrões

- Submeter email sem dual validation (regex client + RPC server pre-flight).
- Mostrar `confirmation_token`/`unsubscribe_token` no DOM (vaza secret).
- Loop client-side fazendo N calls de subscribe_to_alerts (use array — atomic RPC).
- Polling agressivo do feed (mais que 1×/30s mata Supabase).
- Mostrar Recent Alerts feed para anon (auth.uid()=NULL, retorna vazio; mas remove a UI prá não confundir).
- Misturar estilos em `globals.css` em vez de `page.module.css`.
- Não usar dual-view template (CTO-policy mandatory).

## Mobile notes

`/alerts` is **desktop-only** (CTO decision, mobile reform wave 2, 2026-05-27). Mobile visitors
are redirected to `/home` via `MobileExcludedRedirect`.

Exceptions (intentional, no redirect):
- `/alerts/confirm` — user clicks email link from a phone and must be able to confirm
- `/alerts/unsubscribe` — user clicks email link from a phone and must be able to unsubscribe

## Roadmap (post-MVP)

- **v1.1:** filters por subscription (e.g., "só Diesel" em ANP LPC). Schema já tem `alert_subscribers.filters JSONB`.
- **v1.2:** anon → client merge automático no callback de signup (se email matches).
- **v1.3:** digest mode (daily/weekly) — adiciona coluna `digest_mode` em `alert_subscribers` + cron Postgres.
- **v2:** Slack / Telegram webhooks.
- **v2:** mobile push (PWA).
- **v2:** in-app notification center (badge no NavBar).
