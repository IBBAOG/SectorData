# Sub-PRD — `/alerts`

Logged-in-only email subscription dashboard. Owner: [`worker_dash-alerts`](../../.claude/agents/worker_dash-alerts.md).

> A Client toggles which data **bases** they want email alerts for. The subscriber's email is **implicit** (their auth email) — there is **no anonymous signup, no email field, no double opt-in, no confirmation token**. Toggling a base IS the subscribe. Backend detection → fanout → delivery is owned by [`worker_alerts-product`](../../.claude/agents/worker_alerts-product.md); the Admin "Alerts" tab (subscriber management) by [`worker_dash-admin`](../../.claude/agents/worker_dash-admin.md).

## Status

- **Rebuilt (Phase 4):** dual-view (desktop + mobile) logged-in-only dashboard. Replaces the deprecated Fase 0 double-opt-in product (anonymous signup, email field, confirmation/unsubscribe tokens) — all of which were deleted.
- **Backend:** new schema + RPCs deployed in `supabase/migrations/20260608100000_alerts_rebuild_new_schema.sql`.
- **Visibility:** `module_visibility('alerts')` is `clients=true` / `public=false` — Anon visitors are redirected to `/home` by `useModuleVisibilityGuard("alerts")`.

## Access tiers

| Tier | Can view `/alerts`? | Can subscribe? |
|------|---------------------|----------------|
| **Anon** | ❌ No — redirected to `/home` (clients-only module) | — |
| **Client** | ✅ Yes | ✅ Yes — toggling a base subscribes the auth email |
| **Admin** | ✅ Yes (+ `/admin-panel` "Alerts" tab) | ✅ Yes |

## Dual-view structure

Follows the canonical dual-view template ([`docs/app/dual-view-pattern.md`](dual-view-pattern.md)) — `page.tsx` → `useIsMobile()` → `desktop/View.tsx` | `mobile/View.tsx`, with a single shared `useAlertsData.ts` hook as the only source of truth.

```
src/app/(dashboard)/alerts/
├── page.tsx              Viewport router (useIsMobile). Anon redirected by the guard.
├── useAlertsData.ts      SINGLE BRAIN — catalog fetch, subscription state (optimistic
│                           toggle + bulk), recent feed (60s poll), category grouping.
│                           Both Views consume this; no direct supabase-js in Views.
├── shared.tsx            Pure presentation shared by both Views: CadenceBadge, StatusPill,
│                           ToggleSwitch, formatPeriod, formatRelative.
├── desktop/View.tsx      Desktop UX (≥769px) — two columns: catalog (left) +
│                           My Subscriptions / Recent Alerts (right).
├── mobile/View.tsx       Mobile UX (≤768px) — two tabs: Browse | My alerts.
├── unsubscribe/
│   └── page.tsx          /alerts/unsubscribe?token=<uuid> — one-click unsubscribe landing
│                           (single centered card, mobile-safe, no confirm step).
└── page.module.css       Scoped styles (light-only, brand orange #ff5000).
```

`src/types/alerts.ts` — clean TypeScript shapes for the 6 RPCs. `src/lib/rpc.ts` "MODULE: Alerts" section — 6 typed wrappers (errors propagate; no silent `try/catch + return []`).

The unsubscribe landing page is **single-view** (transactional, works on all devices — a user clicks the email-footer link from a phone) and exempt from any mobile redirect.

## Analyses (both Views — binding sync rule)

1. **Header** — title "Alerts", subtitle "Get an email the moment a data source you follow updates."
2. **Browse & subscribe** — bases grouped by category (Fuel Distribution → Oil & Gas → Vessels → Proprietary). Each base row: `display_name` + `description` + a read-only **cadence badge** (Immediate / Daily digest) + a toggle (on = subscribed). Per-category **Select all / Clear**. Toggling calls `set_my_subscription` (optimistic, reverts on failure); category actions call `set_my_subscriptions`. No email input, no submit button.
3. **My Subscriptions** — the user's active subscriptions from `list_my_subscriptions` (`display_name`, `category`, `effective_cadence` badge, Unsubscribe). Empty state: "You're not subscribed to any alerts yet — pick some above."
4. **Recent Alerts** — read-only feed from `list_my_recent_alerts` (last 20): `display_name`, period (`payload.period`), relative sent time, a status pill (sent / delivered / bounced / failed / pending), and a "View data →" deep link to `payload.frontend_route`. Polled every 60s. Empty state: "No alerts sent yet."

Loading → `BarrelLoading`; fetch errors → `DataErrorBoundary` (catalog) / soft-fail (feed) / optimistic revert + `app-toast` (writes).

Desktop = two columns (catalog left; My Subscriptions + Recent Alerts right, sticky). Mobile = two tabs (Browse | My alerts) with count badges. Both Views share the same hook and the same `shared.tsx` helpers, so they stay structurally in sync by construction.

## RPC contract (all SECURITY DEFINER)

Wrappers in `src/lib/rpc.ts` "MODULE: Alerts". Migration: `20260608100000_alerts_rebuild_new_schema.sql`.

| RPC | Grant | Purpose |
|-----|-------|---------|
| `list_subscribable_bases()` | authenticated | Catalog + the user's flags (`is_subscribed`, `sub_is_active`, `cadence`, …). |
| `set_my_subscription(p_source_slug, p_active)` | authenticated | Subscribe / unsubscribe one base. |
| `set_my_subscriptions(p_source_slugs[], p_active)` | authenticated | Bulk (per-category Select all / Clear). |
| `list_my_subscriptions()` | authenticated | The user's active/paused subscriptions. |
| `list_my_recent_alerts(p_limit=20)` | authenticated | Read-only recent feed; `payload` carries `frontend_route` + `period`. |
| `unsubscribe_by_token(p_token)` | anon + authenticated | Email-footer one-click unsubscribe (idempotent). |

> `set_my_subscription_cadence` exists but is **intentionally not exposed** in v1. The backend engine honors the **source-level** cadence only; the UI shows cadence as a READ-ONLY badge. Do NOT add a per-subscription immediate-vs-digest toggle.

## Source catalog

Loaded live via `list_subscribable_bases()`; seeded in the rebuild migration. 21 bases across 4 categories (Fuel Distribution, Oil & Gas, Vessels, Proprietary). Daily/AIS sources are `digest`; everything else is `immediate`. `payload.frontend_route` (from `alert_sources.metadata`) drives the "View data →" deep link.

## Anti-patterns

- Reintroducing the deleted double-opt-in product (`subscribe_to_alerts`, `confirm_subscription`, `confirmation_token`, an email-field signup, a `/alerts/confirm` page).
- Adding an email input or a submit button — toggling IS the subscribe.
- Exposing a per-subscription cadence toggle (cadence is source-level + read-only).
- Calling `supabase.rpc(...)` from a View — all RPC calls live in `useAlertsData.ts`.
- Diverging the two Views (new control/copy in one but not the other) without a `[desktop-only]` / `[mobile-only]` commit tag.
- Aggressive feed polling (> 1×/60s).
- Leaking an unsubscribe token into the visible DOM beyond the URL it arrived in.

## Telemetry (future)

Optional `track_event('alerts.toggle', '/alerts', { source_slug, active })` on subscribe/unsubscribe; adoption dashboard in `/admin-analytics` (MAU, subscribed bases per user, churn).
