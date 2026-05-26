# Sub-PRD — Bundle Admin (`/home` + `/profile` + `/admin-panel`)

Bundle administrativo. Owner: [`worker_dash-admin`](../../.claude/agents/worker_dash-admin.md).

3 páginas pequenas/médias com natureza administrativa, agrupadas num agente único.

## Escopo de código

```
src/app/(dashboard)/
  home/
    page.tsx                        Server Component (renders HomeRouter)
    HomeRouter.tsx                  Client viewport router (useIsMobile → desktop or mobile)
    useHomeData.ts                  Shared hook — visibility filter, search, collapsed sections
    desktop/View.tsx                Desktop view (grid of image cards, hover reveal)
    mobile/View.tsx                 Mobile view (category sections, gradient thumbs, search)
  profile/
    page.tsx                        Client viewport router (useIsMobile → desktop or mobile)
    useProfileData.ts               Shared hook — profile, email, inline name-edit state, save
    desktop/View.tsx                Desktop view (profile card, info rows, inline edit)
    mobile/View.tsx                 Mobile view (hero avatar, info rows, sticky save footer)
  admin-panel/page.tsx              Gestão de roles + visibilidade de módulos
```

RPC wrappers: [`src/lib/profileRpc.ts`](../../src/lib/profileRpc.ts) (perfil) + seção em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (admin) + [`src/lib/alertsAdminRpc.ts`](../../src/lib/alertsAdminRpc.ts) (Alerts product admin — 7 wrappers + 2 PostgREST helpers).

## Dual-view structure

This bundle is being migrated to the dual-view pattern (desktop + mobile) in waves.

### Wave 4 — `/home` (completed 2026-05-20)

`/home` is now a full dual-view module. File layout:

```
home/
├── page.tsx            Server Component — renders HomeRouter (no server-side data fetch)
├── HomeRouter.tsx      "use client" — useIsMobile → DesktopView | MobileView
├── useHomeData.ts      Brain hook — visibility filter, search, section-collapse state
├── desktop/View.tsx    Desktop: icon-list rows + DataSourcesTable panel (70/30 split)
└── mobile/View.tsx     Mobile: 4 collapsible category sections, icon rows, sticky search
```

**Desktop view** — redesigned 2026-05-26 (icon list). Vertical list of compact rows inside the left 70% column. One card per row: 40×40px rounded icon bubble + module name + optional badge + chevron. Icon glows orange on hover (`#ff5000`, glow shadow), row translates right 4px, left accent bar animates in. Categories (Markets / Oil & Gas / Fuel Distribution / Admin) are separated by a `SectionHeader` with a category-color bar + divider line.

**Mobile view** — redesigned 2026-05-26 (icon list, same analysis as desktop). Components used:
- `MobileTopBar` (wordmark + avatar initials / Sign-in pill for anon)
- `MobileBottomTabBar` (Home / Discover / Saved / Profile; Profile tab navigates to `/profile`)
- Inline sticky section headers with category-color dot
- Per-slug SVG icons from `src/data/moduleIcons.tsx` (centralized registry, shared with desktop)
- `ModuleRow` component: 44×44 touch target, icon bubble (glow on press), module name, chevron. No more gradient thumbnails.

**Shared hook (`useHomeData`):**
- Reads `moduleVisibility` + `homeVisibility` + `profile` from `UserProfileContext`
- Applies two-axis visibility filter (same logic as original HomeClient)
- `search` state: live-filters title + description across all cards
- `collapsed` state: per-category expand/collapse (mobile only; desktop ignores it)
- `cardsByCategory`: `Record<HomeCategory, HomeCardDef[]>` for mobile category sections
  - Admin section appends static cards (`/profile`, `/admin-panel`) not in `module_visibility`

**Divergence from mockup** — the mockup's `MDIC Comex` card is in the Oil & Gas section. This reflects the module's dual classification (`Estatísticas / Oil & Gas` and `Fuel Distribution`). In code, `mdic-comex` is assigned `oilgas` category (matching mockup) even though it also covers fuel distribution.

### Wave 5 — `/admin-panel` (completed 2026-05-20)

`/admin-panel` is now a full dual-view module. File layout:

```
admin-panel/
├── page.tsx               "use client" — useIsMobile → DesktopView | MobileView
├── useAdminPanelData.ts   Brain hook — RPCs, all state, all handlers,
│                           SECTIONS & MODULE_LABELS metadata
├── desktop/View.tsx       Desktop: sidebar (5 sections) + content panel
│                           (verbatim port of original page.tsx body)
└── mobile/View.tsx        Mobile: sticky horizontal pill row for sections +
                            search bar + MobileDataCard rows per item
```

**Shared hook (`useAdminPanelData`):**
- Owns `useRoleGuard("Admin")` invocation (MFA-aware) — both Views early-return `null` if not allowed
- Owns ALL state: `activeSection`, `localVis`, `localHomeVis`, `users`/`localRoles`, `recipients`, plus all `saving*`/`saved*`/`*Error` flags
- Owns ALL handlers: `handleToggle`, `handleHomeToggle`, `handleRoleChange`, `handleAddRecipient`, `handleToggleRecipient`, `handleRemoveRecipient`
- Owns pure helpers `isValidEmail` and `formatDateBR`
- Exports `SECTIONS` (id, label, shortLabel, description) and `MODULE_LABELS` (slug, label, description) as static module-level constants so both Views render the same catalog

**Desktop view** — identical to original. Dark left sidebar (220px wide, 5 buttons + Analytics link), white content panel with section header + module-specific cards.

**Mobile view** — list-based archetype:
- `MobileTopBar` with "Admin" pill + "Admin Panel" title + avatar (initials)
- Sticky horizontal scroll of section pills (Members / Access / Cards / Alerts / Tables) — pill row needed because 5 tabs don't fit in `MobileTabBar` container variant
- Per-section search bar (placeholder adapts: "Search by name, email, or role" / "Search modules" / "Search recipients")
- **Members**: `MobileDataCard` per user with avatar, name+email, role pill. Tapping the row opens a `BottomSheet` with the Admin/Client picker.
- **Permissions**: `MobileDataCard` (expanded variant) per module with switch on the right.
- **Home Visibility**: one row per module — label+description on the left, Show-on-Home switch on the right. Upload UI removed 2026-05-26 (images no longer rendered in `/home`).
- **Alert Emails**: Add form (input + button, 44px min-height for touch), then `MobileDataCard` per recipient with status pill + Enable/Disable button. Removing opens a `BottomSheet` with a confirm prompt (replaces the inline "Are you sure?" pattern from desktop, which doesn't fit on a 320px row).
- **Data Input**: shows a desktop-only notice because `EditableTableEditor` needs a wide layout.

**Divergence from desktop** (`[mobile-only]` deltas):
- The desktop's Analytics sidebar link is omitted on mobile — navigation to `/admin-analytics` happens through `/home`.
- Inline "Are you sure?" confirm for recipient removal becomes a `BottomSheet` with explicit Cancel/Remove buttons.
- Recipient row's primary action (tap whole row) is "remove" (opens confirm sheet); secondary action (button) is "Disable/Enable". On desktop both are inline buttons.
- `Data Input` section shows a placeholder explaining desktop-only; the embedded `EditableTableEditor` is not rendered on mobile.
- Per-section search filter is mobile-only (desktop has no search; the sidebar's narrow nav makes it unnecessary).
- The original Portuguese string `"Remover"` in the recipients list was corrected to `"Remove"` in BOTH views (English-only policy).

### Wave 5 — `/profile` (completed 2026-05-20)

`/profile` is now a full dual-view module. File layout:

```
profile/
├── page.tsx              Client viewport router — useIsMobile → DesktopView | MobileView
├── useProfileData.ts     Brain hook — profile mirror, email resolution, name-edit FSM, save handler
├── desktop/View.tsx      Desktop: profile card with inline name edit + Security section (verbatim move)
├── mobile/View.tsx       Mobile: hero avatar + Account/Security sections + sticky save footer
└── mfa/page.tsx          (Unchanged) MFA enrollment screen, owned by Supabase/security path
```

**Shared hook (`useProfileData`)** owns:
- `profile` (mirrored from `UserProfileContext`), `loading`, `isAdmin`
- `email` (resolved from `supabase.auth.getSession()` since context does not expose it)
- Inline name-edit FSM: `editing`, `editName`, `saving`, `saveError`, `canSave` plus `startEdit / cancelEdit / setEditName / saveName`
- Derived helpers used by both Views: `displayName`, `initials`, `memberSince`

Both Views call `saveName()` and `refreshProfile()` is invoked inside the hook on success — NavBar avatar updates without manual plumbing.

**Desktop view** is a verbatim move of the previous `page.tsx`. Same layout (`profile-card`, `role-badge--*`, `profile-info-row`, `profile-name-edit-*` classes), same Security panel, same inline pencil edit. Only difference: all `useState` / `useEffect` / RPC plumbing now lives in the hook.

**Mobile view** is a single-screen edit page (no `MobileBottomTabBar` — users return to home via the top-left back button or the system back gesture). Structure:
- `MobileTopBar` with custom `leftSlot` = back button + "Profile" title
- Hero card: 96 px avatar bubble, display name, role pill
- "Account" `SectionCard`: 4 rows (Email, Name with pencil/inline form, Role, Member since), each row uses a local `InfoRow` (44 px+ touch targets, matching mobile rhythm)
- "Security" `SectionCard`: single tap row navigating to `/profile/mfa` (chevron right + shield icon)
- Sticky save footer (`position: fixed` bottom): only rendered while `editing === true`. Cancel + Save buttons, glass background. Page body adds bottom padding equal to footer height so the last row is never hidden.

**Mobile design choices vs. desktop**:
- Inline edit uses a full-width input (`font-size: 16px` to prevent iOS focus auto-zoom) and a sticky two-button footer instead of an inline submit/cancel pair. Saves are easier to commit one-handed.
- Avatar moves from 72 px (desktop `.profile-avatar-circle`) to 96 px in the hero. Visual hierarchy: the avatar is the screen's centrepiece, not buried inside a card.
- Security section is presented as a tap row (mobile metaphor) instead of a button-anchor (desktop metaphor).
- The "My Account" badge from the desktop page header is dropped — the topbar title already labels the screen.

No `[mobile-only]` tag needed for this commit: the mobile view is a fresh redesign of the same data the desktop view exposes, and the hook is the single source of truth for both.

### Wave — Anonymous access (3-tier visibility) (added 2026-05-21)

The login-required gate is being relaxed in favour of a 3-tier visibility model. Per-module access is split into three independent flags in `module_visibility`:

| Flag | Tier | UI surface |
|---|---|---|
| `is_visible_for_public` | Anon (logged-out visitors) | Permissions tab — new toggle |
| `is_visible_for_clients` | Client (logged-in non-Admin) | Permissions tab — existing toggle |
| `is_visible_on_home` | All roles (controls Home gallery card) | Home Visibility tab (formerly "Card Images") — existing toggle |

**Invariant (Public ⇒ Clients):** a module visible to anonymous visitors must also be visible to Clients (otherwise a user would lose access on sign-in). The database enforces this in two places:
1. A `CHECK` constraint (`module_visibility_public_implies_clients_chk`) rejects pathological inserts.
2. A `BEFORE INSERT/UPDATE` trigger coerces `is_visible_for_clients = TRUE` whenever `is_visible_for_public = TRUE`, so the constraint never fires in normal flow.

**UI parity with the trigger.** `handlePublicToggle` in `useAdminPanelData.ts` mirrors the coercion: when Public is turned ON while Clients is OFF, it flips the local Clients state to ON optimistically, calls `set_module_public_visibility`, then explicitly calls `set_module_visibility(slug, true)` so the global `UserProfileContext.moduleVisibility` map (consumed by NavBar / `useModuleVisibilityGuard`) refreshes within the same session. Without that second call, the trigger would have updated the DB but the React tree would still see the old `is_visible_for_clients=false`. The Clients toggle is rendered visually locked ON (disabled, 0.5 opacity) while Public is ON.

**Permissions tab layout (both views).**
- Desktop: 3-column grid — *Module* | *Public* | *Clients*, with a header row showing column labels and an explanatory paragraph above ("Public = anonymous visitors. Clients = logged-in tier. Enabling Public also enables Clients.").
- Mobile: each module renders as a single card with a title + description block, then two stacked rows ("Public — Anonymous visitors" / "Clients — Logged-in Client tier"), each with its own switch. When Public is ON, the Clients row's sub-label changes to "Locked on (Public is enabled)" and the switch is disabled.

**New RPC wrappers** (in `src/lib/profileRpc.ts`):
- `rpcSetModulePublicVisibility(supabase, slug, isVisible)` — calls `set_module_public_visibility(p_slug, p_is_visible)` (Admin-only via `require_admin_mfa()` server-side).
- `rpcGetModuleVisibility` already returns the new `is_visible_for_public` column from the rebuilt `get_module_visibility()` RPC. `ModuleConfig.is_visible_for_public` is an optional field on the type so older envs without the migration still typecheck.

**Hook-side fetching.** `useAdminPanelData` calls `rpcGetModuleVisibility` directly on mount to populate `localPublicVis`, independently of `UserProfileContext`. This keeps the admin-panel change isolated from Phase B's wider context expansion; once Phase B's `publicVisibility` map lands in context, the local fetch can be replaced with a context read.

**Dual-view sync.** Both views in the same commit. No `[desktop-only]` / `[mobile-only]` tag — both views received the new Public toggle, the constraint visual ("locked on"), and the updated descriptive paragraph.

## Páginas — descrição rápida

### `/home`
Landing visual. Shows module cards (icon list, not image cards since 2026-05-26) filtered by role + visibility. **Each module needs an icon entry in `src/data/moduleIcons.tsx`.**

> **Memória persistente do CEO (updated 2026-05-26)**: TODO módulo novo precisa de ícone em `src/data/moduleIcons.tsx`. O upload de imagem foi removido — home agora usa ícones SVG inline, não imagens carregadas pelo admin.

#### Data Sources live table (2026-05-26, `[desktop-only]`)

Desktop layout is now a **70/30 split**: module cards (left column, `2fr`) + Data Sources live table (right column, `1fr`).
Mobile view is **unchanged** — still shows cards only. The table is explicitly desktop-only.

**Component tree:**
```
src/
  data/dataSources.ts                 — 17-entry TS catalog (DataSource interface + DATA_SOURCES array)
  components/home/DataSourcesTable/
    index.tsx                          — wrapper, groups by category, single-expand accordion
    DataSourcesTable.module.css        — glass + pulse styles; consumes only existing globals.css tokens
    SectionHeader.tsx                  — translucent "── ANP PRODUCTION ──" divider
    SourceRow.tsx                      — collapsed row: Status · Name · Source · Last update · Actions
    ExpandedRow.tsx                    — expanded panel: description + schedule + next run + action buttons + download
    StatusDot.tsx                      — colored dot (fresh/stale/overdue); real-time sources get .ds-pulse class
    LastUpdateCell.tsx                 — "2h ago" / "3 days ago" via relative time helper
    DashboardPicker.tsx                — dropdown when source feeds ≥2 dashboards; direct Link when only 1
    useDataSourcesFreshness.ts         — hook: calls get_data_sources_freshness() every 60s, returns Map<key, {lastUpdate, rowCount}>
```

**RPC:** `get_data_sources_freshness()` — migration `20260526200000_data_sources_freshness.sql`. Returns `(source_key, last_update, row_count)` for all 22 ETL-fed tables. SECURITY DEFINER, accessible to `anon` + `authenticated`. Wrapper: `rpcGetDataSourcesFreshness` in `src/lib/rpc.ts`.

**Note on catalog vs. RPC key count:** The RPC returns 22 source_keys (one per ETL-fed table). The catalog has 17 entries — 6 "extra" DB source_keys (the 3 CDP Diária sub-tables, `anp_desembaracos`, `port_arrivals`, `import_candidates`, and `anp_subsidy_history`) are deduplicated in the catalog but still tracked by freshness. The hook silently ignores keys with no catalog entry (returns undefined → no render).

**The 17 entries** (post-deduplication; 22 Supabase source_keys still active in RPC):
- ANP Production (3): `anp_cdp_diaria` (covers all 3 Power BI tables), `anp_cdp_producao`, `anp_voip`
- ANP Distribution (6): `vendas`, `anp_precos_produtores`, `anp_glp`, `anp_lpc`, `anp_precos_distribuicao`, `anp_subsidy_diesel_reference` (covers history too)
- Imports & Exports (2): `mdic_comex`, `anp_daie` (covers Desembaraços too)
- Vessels (2): `navios_diesel`, `vessel_positions` (covers arrivals + candidates)
- Proprietary Data (2): `d_g_margins`, `price_bands`
- News & Markets (2): `news_articles`, `yahoo_finance`

**Status derivation** (computed client-side from `DataSource.staleAfterHours` / `overdueAfterHours`):
- `fresh` (green) — `now - last_update < staleAfterHours × 3600 × 1000`
- `stale` (yellow) — between stale and overdue thresholds
- `overdue` (red) — `now - last_update ≥ overdueAfterHours × 3600 × 1000`
- `unknown` — `last_update` is null (yahoo_finance always shows "live" not a timestamp)

**Real-time pulse** (`.ds-pulse` CSS class, defined in globals.css): applied to `vessel_positions`, `port_arrivals`, `import_candidates`, `news_articles`, and `yahoo_finance`.

**Download:** uses `ExportModal` (Tier 2). Visible only to logged-in users. Anonymous users see a disabled "Sign in to download" button. Yahoo Finance has no `supabaseTable` → download button hidden entirely.

**Visibility:** table is visible to all roles (anon, client, admin) — it serves as a product transparency/robustness showcase.

### `/profile`
Perfil do usuário logado. Edição inline do nome (`profile-name-edit-icon-btn`). Mostra: avatar (iniciais), full_name, email, role badge.

### `/admin-panel`
Protegida por `useRoleGuard("Admin")`. Funcionalidades (7 seções na sidebar):
- **Members** — listar todos os users com role; promover/demover Admin ↔ Client.
- **Permissions** — 3-tier visibility per module:
  - `is_visible_for_public` toggle — affects anonymous (logged-out) visitors.
  - `is_visible_for_clients` toggle — affects logged-in Client tier users. Forced ON whenever Public is ON (DB invariant + UI lock).
  - Admin always has access regardless of these flags.
- **Home Visibility** (tab ID `card-images`) — toggle **"Show on Home"** (`is_visible_on_home`) per module: controls whether the module card appears in the `/home` gallery for ALL users (including Admin). Default `true`. Independent from access flags: a module can be `is_visible_on_home=false` (card gone from Home for everyone) while `is_visible_for_clients=true` (direct URL still works). Or `is_visible_on_home=true` + `is_visible_for_clients=false` (Admin sees the card, Client cannot access the route). Image upload UI removed in 2026-05-26 (images no longer rendered in `/home` — icon list replaced image cards).
- **Alert Emails** — gerenciar destinatários de alertas automáticos (legado local).
- **Alerts** — Alerts Product management (cloud, multi-recipient). 5 sub-sections:
  - **Subscriber Stats** — total/active/unconfirmed counts, bounce/complaint rates (7d), per-source active count.
  - **Subscribers** — full subscriber table with source filter and Force Unsubscribe action.
  - **Sources** — toggle `is_active` per source; Send Test Event button for QA.
  - **Email Log** — recent delivery events (sent/bounced/complained/failed) with status filter.
  - **Outbox Repair** — failed outbox rows with Requeue button (resets status → queued, attempts → 0).
- **Default News Keywords** — manage the `news_hunter_default_keywords` table. These keywords are used by anonymous visitors of the News Hunter dashboard and as the seed for new authenticated users (via `seed_my_news_hunter_keywords`). See section below.
- **Data Input** — editar linhas de tabelas de referência diretamente via PostgREST (ver seção abaixo).

## RPCs

| RPC | Tipo | Página |
|---|---|---|
| `get_my_profile` | leitura | profile |
| `upsert_my_profile` | escrita | profile (edição de nome) |
| `get_module_visibility` | leitura | admin-panel + UserProfileContext — retorna `(module_slug, is_visible_for_clients, is_visible_on_home, is_visible_for_public)` (Phase A) |
| `set_module_visibility` | escrita | admin-panel → aba Permissions (Clients toggle) |
| `set_module_home_visibility` | escrita | admin-panel → aba Card Images (Show on Home toggle) |
| `set_module_public_visibility` | escrita | admin-panel → aba Permissions (Public toggle); Admin-only, MFA-gated |
| `get_all_users_with_roles` | leitura | admin-panel |
| `set_user_role` | escrita | admin-panel |
| `seed_my_news_hunter_keywords` | escrita | first-login (chamada por dash-admin para popular keywords default no novo user) |
| `admin_list_default_news_keywords()` | leitura | admin-panel → Default News Keywords — `RETURNS TABLE(keyword text, match_type text, created_at timestamptz)` |
| `admin_add_default_news_keyword(p_keyword text, p_match_type text DEFAULT 'substring')` | escrita | admin-panel → Default News Keywords — idempotent; `RETURNS void` |
| `admin_set_default_news_keyword_match_type(p_keyword text, p_match_type text)` | escrita | admin-panel → Default News Keywords — `RETURNS void` |
| `admin_remove_default_news_keyword(p_keyword text)` | escrita | admin-panel → Default News Keywords — `RETURNS void` |
| `admin_list_subscribers(p_source_slug, p_limit)` | leitura | admin-panel → Alerts → Subscribers |
| `admin_force_unsubscribe(p_subscriber_id)` | escrita | admin-panel → Alerts → Subscribers (Force Unsubscribe) |
| `admin_requeue_outbox(p_outbox_id)` | escrita | admin-panel → Alerts → Outbox Repair (Requeue) |
| `admin_send_test_event(p_source_slug)` | escrita | admin-panel → Alerts → Sources (Send Test Event) |
| `admin_email_log_recent(p_limit)` | leitura | admin-panel → Alerts → Email Log |
| `admin_subscriber_stats()` | leitura | admin-panel → Alerts → Subscriber Stats |
| `admin_toggle_source_active(p_source_slug, p_is_active)` | escrita | admin-panel → Alerts → Sources (toggle is_active) |
| `get_data_sources_freshness()` | leitura | `/home` Data Sources live table — returns `(source_key, last_update, row_count)` for all ETL-fed tables; SECURITY DEFINER, anon + authenticated; migration `20260526200000` |

## Tabelas

### `profiles`
- PK: `id` (UUID, FK pra `auth.users.id`, ON DELETE CASCADE)
- Colunas: `role TEXT NOT NULL` ∈ {Admin, Client}, `full_name`, `avatar_url`, `created_at`
- RLS: cada user lê o próprio. Admin lê todos via RPC com `SECURITY DEFINER`.

### `module_visibility`
- PK: `module_slug`
- Colunas: `is_visible_for_clients BOOLEAN`, `is_visible_on_home BOOLEAN NOT NULL DEFAULT true`, `is_visible_for_public BOOLEAN NOT NULL DEFAULT true` (added 2026-05-21 via migration `20260522000001_anonymous_access.sql`)
- RLS: read for anon + authenticated (Phase A opened anon SELECT), write only via Admin RPC.
- `is_visible_for_public`: controls anonymous (logged-out) visitor access. Managed via Permissions tab "Public" toggle. RPC: `set_module_public_visibility` (Admin-only, MFA-gated).
- `is_visible_for_clients`: controls Client tier visibility only (Admin always sees). Managed via Permissions tab "Clients" toggle. RPC: `set_module_visibility`.
- `is_visible_on_home`: controls Home gallery visibility for ALL users including Admin. Managed via Home Visibility tab (tab ID `card-images`) "Show on Home" toggle. Default `true` (backward-compatible). RPC: `set_module_home_visibility`.
- **Invariant:** `is_visible_for_public = true` ⇒ `is_visible_for_clients = true`. Enforced by both a `CHECK` constraint (`module_visibility_public_implies_clients_chk`) and a `BEFORE INSERT/UPDATE` trigger that coerces clients=TRUE when public flips ON.

> **Tech debt**: ambas criadas via [`sql/create_profiles_and_visibility.sql`](../../sql/create_profiles_and_visibility.sql) aplicado direto no Dashboard, **não em migration versionada**.

## Slugs gerenciados em `module_visibility`

Lista completa dos slugs atualmente registrados na tabela `module_visibility` (todos com `is_visible_for_clients = true` e `is_visible_on_home = true` por padrão):

> **Sales Volumes deprecation (2026-05-26)**: the `sales-volumes` row was removed from `module_visibility` by migration `20260526400000_drop_sv_rpcs.sql` when `/sales-volumes` was folded into `/market-share` (% Share ↔ thousand m³ via top-level unit toggle; `/sales-volumes` 301-redirects to `/market-share?unit=volume`). The legacy `sales` label still present in `MODULE_LABELS` (`useAdminPanelData.ts`) is a residual entry pending cleanup — it has no matching `module_visibility` row, so it renders as a dead toggle in the Permissions tab. Tracked for removal.

| Slug | Categoria | Label na UI |
|---|---|---|
| `market-share` | Fuel Distribution | Market Share (absorveu Sales Volumes em 2026-05-26) |
| `navios-diesel` | Fuel Distribution | Diesel Imports Line-Up |
| `diesel-gasoline-margins` | Fuel Distribution | Diesel and Gasoline Margins |
| `price-bands` | Fuel Distribution | Price Bands |
| `anp-precos-produtores` | Estatísticas / Fuel Distribution | ANP Preços Produtores |
| `anp-precos-distribuicao` | Estatísticas / Fuel Distribution | ANP Preços Distribuição |
| `anp-glp` | Estatísticas / Fuel Distribution | ANP GLP |
| `imports-exports` | Estatísticas / Fuel Distribution | Imports & Exports |
| `anp-lpc` | Estatísticas / Fuel Distribution | ANP LPC Preços |
| `anp-cdp` | Estatísticas / Oil & Gas | Production |
| `anp-cdp-diaria` | Estatísticas / Oil & Gas | Daily Production |
| `anp-cdp-bsw` | Estatísticas / Oil & Gas | BSW by Well |
| `anp-cdp-depletion` | Estatísticas / Oil & Gas | Depletion |
| `stocks` | Other | Market Watch |
| `news-hunter` | Other | News Hunter |
| `alerts` | Tools | Alerts |

> Os toggles no `/admin-panel` (seção Permissions) e os slots de imagem (seção Card Images) são gerados automaticamente a partir de `MODULE_LABELS` em `admin-panel/page.tsx`. Os cards na `/home` são definidos em `HomeClient.tsx` (array `CARDS`).

## Sua RESPONSABILIDADE ESPECIAL — onboarding de dashboard novo

Workflow disparado pelo Subgerente APP quando ele cria um dashboard novo:

### Passos

1. **Inserir em `module_visibility`:**
   ```sql
   INSERT INTO module_visibility (module_slug, is_visible_for_clients, is_visible_on_home, is_visible_for_public)
   VALUES ('<slug>', true, true, true)
   ON CONFLICT (module_slug) DO NOTHING;
   ```
   *(default `is_visible_for_public = true` since 2026-05-21 — new modules are visible to anon by default; flip to `false` here if the module should be Client-or-Admin only at launch.)*

2. **Garantir toggle no `/admin-panel`** — a UI de admin-panel idealmente faz auto-discovery via query a `module_visibility`. Se não, adicionar explicitamente.

3. **Ícone na `/home`** — adicionar entrada em `src/data/moduleIcons.tsx` para o novo slug (SVG `getModuleIcon` registry). Home cards no longer use uploaded images — they use inline SVG icons since 2026-05-26. Without an icon entry the slot renders a generic fallback circle. The upload UI in `/admin-panel` was removed as orphan in 2026-05-26 (images are no longer rendered).

4. **Avisar Subgerente APP** que onboarding terminou.

## Alerts Product — section "alerts-product" (added 2026-05-25)

This section manages the cloud multi-recipient Alerts Product (`worker_alerts-product` domain). It is entirely separate from the legacy Alert Emails section (`alert_recipients` table) which manages local one-off notifications.

### Sub-sections

| ID | Panel | RPC / source |
|---|---|---|
| A | Subscriber Stats | `admin_subscriber_stats()` |
| B | Subscribers table | `admin_list_subscribers(p_source_slug?, p_limit)` + `admin_force_unsubscribe(id)` |
| C | Sources management | `alert_sources` (PostgREST) + `admin_toggle_source_active` + `admin_send_test_event` |
| D | Email Log | `admin_email_log_recent(p_limit)` |
| E | Outbox Repair | `alert_outbox` (PostgREST filtered by `status='failed'`) + `admin_requeue_outbox(id)` |

### RPC wrappers

All 7 RPCs + 2 PostgREST helpers are in `src/lib/alertsAdminRpc.ts`. This file is intentionally separate from `rpc.ts` (which `worker_dash-alerts` edits for user-facing wrappers) to avoid merge conflicts (Regra G).

### Module visibility

`alerts` was registered in `module_visibility` via migration `20260525230000_alerts_module_visibility.sql`:
- `is_visible_for_public = TRUE` — anonymous opt-in is the product's core value
- `is_visible_for_clients = TRUE`
- `is_visible_on_home = TRUE`

### Hook state

Loaded lazily when `activeSection === "alerts-product"`. All state lives in `useAdminPanelData`. No additional hooks needed.

### Dual-view sync

Both `desktop/View.tsx` and `mobile/View.tsx` received the Alerts section in the same commit. Mobile uses `MobileDataCard` rows for B/D/E. Desktop uses grid tables. Both use the same 5 sub-section structure.

## Default News Keywords — section "default-news"

Manages the `news_hunter_default_keywords` table, which is the single source of truth for:
1. Anonymous visitors of `/news-hunter` — served via the public RPC `get_default_news_keywords()`.
2. New authenticated users — `seed_my_news_hunter_keywords` inserts these as the user's personal starting set on first login.

### UI contract

- Header copy: "These keywords are used by anonymous visitors of the News Hunter dashboard. Logged-in users have their own personal keyword list."
- **Add form**: text input (placeholder `e.g. Petrobras, diesel, BNDES`) + "Exact match (whole word)" checkbox/toggle + "Add" button. Enter key triggers add. Button disabled while input is empty or a call is in flight. Success shows "✓ Added" for 2 seconds. After a successful add, the match type resets to `substring`.
- **Exact match (whole word) toggle**: available both in the add form (sets `match_type` for the new keyword) and on each existing keyword (toggles between `substring` and `exact` in-place via `admin_set_default_news_keyword_match_type`). Tooltip copy: "When enabled, only whole-word matches trigger an alert. Useful for short/generic terms like 'Vibra'." Disabled while a toggle is in-flight (`togglingMatchType` state).
- **"Exact" badge**: keywords with `match_type='exact'` show a small orange "EXACT" badge next to the keyword text. Desktop: displayed inside the chip, before the match-type toggle icon. Mobile: inline within the `MobileDataCard` title.
  - Desktop chip: toggle button uses `=` icon when substring (switch to exact), `≈` when exact (switch to substring), with dashed orange border when exact.
  - Mobile card: Bootstrap form-switch row below the keyword name; label reads "Exact match (whole word)" in orange when active, muted when inactive.
- **Duplicate validation**: client-side check (case-insensitive). If keyword already exists, shows a 4-second warning. RPC is idempotent so a race condition is safe.
- **Keyword list**: desktop uses chip tags with an × button (hover to reveal remove, click × to enter confirm-inline state). Mobile uses `MobileDataCard` per keyword with a "Remove" button that opens a `BottomSheet` confirm dialog.
- **Loading/empty states**: spinner while fetching, "No default keywords yet." when empty, search-aware "No keywords match your search." when search is active.
- **Error states**: banner above the list for load/remove errors; inline message below the input for add errors.

> **TODO — scanner repo** (`IBBAOG/news-hunter-scanner`): keywords with `match_type='exact'` should match only as whole-word (regex `\b<keyword>\b`, case-insensitive). Currently the scanner applies the same substring matching to all keywords — updating the scanner to respect `match_type` is **out of scope** for this task and must be done in the separate scanner repo.

### RPC wrappers (in `src/lib/rpc.ts`)

| Wrapper | RPC | Return type |
|---|---|---|
| `rpcAdminListDefaultNewsKeywords(supabase)` | `admin_list_default_news_keywords()` | `DefaultNewsKeyword[]` (keyword, match_type, created_at) — **throws on RPC error** (caller must catch) |
| `rpcAdminAddDefaultNewsKeyword(supabase, keyword, matchType?)` | `admin_add_default_news_keyword(p_keyword, p_match_type)` | `boolean` (success); `matchType` defaults to `'substring'` |
| `rpcAdminSetDefaultNewsKeywordMatchType(supabase, keyword, matchType)` | `admin_set_default_news_keyword_match_type(p_keyword, p_match_type)` | `boolean` (success) |
| `rpcAdminRemoveDefaultNewsKeyword(supabase, keyword)` | `admin_remove_default_news_keyword(p_keyword)` | `boolean` (success) |

All four RPCs are SECURITY DEFINER and call `require_admin_mfa()` server-side — Admin + verified MFA factor required.

### Hook state (in `useAdminPanelData.ts`)

Loaded on demand when `activeSection === "default-news"` (lazy, same pattern as Alert Emails).

| State | Type | Purpose |
|---|---|---|
| `defaultKeywords` | `DefaultNewsKeyword[]` | Current list from DB |
| `defaultKeywordsLoading` | `boolean` | Spinner |
| `defaultKeywordsError` | `string \| null` | Load/remove/toggle-type error banner |
| `newKeyword` | `string` | Controlled input |
| `newKeywordMatchType` | `'substring' \| 'exact'` | Match type for the next Add; resets to `'substring'` after success |
| `addingKeyword` | `boolean` | In-flight add |
| `addKeywordError` | `string \| null` | Inline add error |
| `addKeywordSuccess` | `boolean` | "✓ Added" flash |
| `removingKeyword` | `string \| null` | Currently being removed |
| `confirmRemoveKeyword` | `string \| null` | Desktop confirm-inline / mobile sheet trigger |
| `togglingMatchType` | `string \| null` | Keyword whose match_type is currently being toggled; disables all other toggle buttons while non-null |

### Dual-view sync

Both desktop and mobile were updated in the same commit. Desktop uses inline chip-tag UI with × button + confirm state. Mobile uses `MobileDataCard` rows + `BottomSheet` confirm dialog (same pattern as the existing Alert Emails section).

## Two-factor authentication (MFA TOTP) — F3.1

The platform supports TOTP-based MFA. Behaviour differs by role:

- **Admin** — MFA is **required** to perform admin actions. After enrolling and verifying a factor, the admin RPCs (`set_user_role`, `set_module_visibility`, `set_module_home_visibility`) refuse to run unless the caller has a verified factor in `auth.mfa_factors`. The DB-side guard is `public.require_admin_mfa()`. Admins reaching `/admin-panel` without a verified factor are redirected to `/profile/mfa` so they enroll before doing anything else.
- **Client** — MFA is **optional**. Clients can opt in from `/profile/mfa` for extra protection. There is no backend gate for Client RPCs.

### User-visible flow

| Step | UI |
|---|---|
| Enroll | `/profile/mfa` → "Enable MFA" → QR code + secret → enter 6-digit code → factor moves to `verified` |
| Sign-in (post-enroll) | `/login` after password challenge surfaces the `MfaChallenge` component until AAL2 is reached |
| Disable | `/profile/mfa` → "Disable". Blocked for Admins on their last verified factor |
| Admin guard | `useRoleGuard("Admin")` requires both verified factor and `currentLevel === 'aal2'`; otherwise redirects to `/profile/mfa` or `/login` |

### Pre-requisite

Supabase Dashboard → Authentication → Multi-Factor Auth → TOTP provider must be enabled. This is configured outside the codebase by the platform owner.

### Backend objects

| Object | Purpose |
|---|---|
| `public.has_verified_mfa(uuid)` | Boolean helper. SECURITY DEFINER (reads `auth.mfa_factors`). |
| `public.require_admin_mfa()` | Raises if caller has role Admin without a verified factor. Reused by admin RPCs. |
| `public.set_user_role` / `set_module_visibility` / `set_module_home_visibility` | All call `require_admin_mfa()` before mutation. |

Migration: `20260514120000_mfa_admin_required.sql`.

## Visibility flow (tempo de execução)

1. User loga.
2. `UserProfileContext` carrega `profiles` (próprio) + `module_visibility` (todos). Uma única chamada RPC `get_module_visibility` popula dois maps:
   - `moduleVisibility: Record<string, boolean>` — derivado de `is_visible_for_clients`
   - `homeVisibility: Record<string, boolean>` — derivado de `is_visible_on_home`
3. NavBar usa `moduleVisibility` pra filtrar `NAV_ENTRIES`:
   - Admin vê tudo.
   - Client vê só módulos onde `is_visible_for_clients = true`.
4. `/home` (HomeClient) aplica dois filtros combinados:
   - Primeiro: `homeVisibility[card.slug] ?? true` — para TODOS os usuários. Card com `false` some do Home inclusive pra Admin.
   - Segundo: `moduleVisibility` — só para Clients. Admin passa direto.
5. Cada módulo tem `useModuleVisibilityGuard("<slug>")` que bloqueia acesso direto via URL (não afetado pelo `homeVisibility` — é só visibilidade no Home).

## Componentes/CSS específicos

| Classe | Uso |
|---|---|
| `.role-badge--admin/--client` | Badge de role |
| `.nav-avatar-circle` | Avatar 32px na NavBar |
| `.profile-avatar-circle` | Avatar 72px no perfil |
| `.first-login-overlay`, `.first-login-modal` | Modal de "complete seu perfil" |
| `.profile-card`, `.settings-card` | Cards das páginas |
| `.profile-info-row/-label/-value` | Linhas de info |
| `.profile-name-edit-*` | Edição inline |

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| Subgerente APP | Trigger do onboarding de dashboard novo |
| dash-news-hunter | first-login chama `seed_my_news_hunter_keywords` |
| Designer | Padrão liquid glass do profile card, cores de role badge |

## Data Input — seção de edição de tabelas de referência

Arquitetura extensível baseada em registry. Substitui o workflow de editar `data/*.xlsx` localmente e rodar `scripts/manual/*_upload.py`.

### Arquivos

| Arquivo | Função |
|---|---|
| `src/lib/dataInput/types.ts` | Tipos compartilhados (`EditableTableConfig`, `ColumnConfig`, `EditState`, `SaveResult`, etc.) |
| `src/lib/dataInput/registry.ts` | `EDITABLE_TABLES: EditableTableConfig[]` — lista de tabelas editáveis |
| `src/lib/dataInput/validation.ts` | Funções puras de validação (`validateCell`, `validateRow`, `validateAll`) |
| `src/lib/dataInput/persistence.ts` | `loadRows` + `saveChanges` (upsert + delete via PostgREST anon key) |
| `src/components/dataInput/EditableTableEditor.tsx` | Editor de tabela inline (client component) |
| `src/components/dataInput/TableSelector.tsx` | Seletor de tabela (SegmentedToggle ≤4, select >4) |

### Tabelas atualmente registradas

| slug | tableName | conflictColumns | partitionBy |
|---|---|---|---|
| `price-bands` | `price_bands` | `['product', 'date']` | `product` (Diesel / Gasoline) |
| `d-g-margins` | `d_g_margins` | `['fuel_type', 'week']` | — |

### Como adicionar uma nova tabela

1. Appende uma entrada `EditableTableConfig` em `src/lib/dataInput/registry.ts`.
2. Crie uma migration com a policy RLS:
   ```sql
   CREATE POLICY "<table>_admin_write" ON public.<table>
     AS PERMISSIVE FOR ALL TO authenticated
     USING (public.is_admin()) WITH CHECK (public.is_admin());
   ```
3. Pronto — a UI pega automaticamente.

### RLS

As políticas de escrita para `price_bands` e `d_g_margins` são criadas pela migration
`supabase/migrations/20260512000000_data_input_admin_policies.sql` (worker_supabase, branch paralela).
Sem a migration, writes retornam 403 — a UI renderiza mas não persiste.

## Changelog — Drop orphan `card_previews` table + Storage bucket (2026-05-26)

Final cleanup of the `/home` icon redesign series. With all `src/` code paths to `card_previews` already deleted (commits `5eb97335`, `249a8270`, `d5f92cd9`), the matching database table and Supabase Storage bucket were also dropped.

**Database:** migration `supabase/migrations/20260526600000_drop_card_previews.sql` — `DROP TABLE IF EXISTS public.card_previews CASCADE`.

**Storage:** bucket `card-previews` deleted out-of-band (rows removed from `storage.objects` first, then row removed from `storage.buckets`). File count purged is reported in the commit body.

**Verification:** post-deploy, `SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='card_previews'` and `SELECT 1 FROM storage.buckets WHERE id='card-previews'` both return zero rows.

No frontend or backend code references either resource after this commit. Closes the `worker_supabase` follow-up noted in the previous changelog entry below.

## Changelog — Delete dead card_previews code paths (2026-05-26)

Deep cleanup following the icon redesign and admin-panel upload removal. All remaining dead code referencing the old uploaded-image system was deleted.

**Files deleted:**

| File | Reason |
|---|---|
| `src/app/(dashboard)/home/HomeClient.tsx` | Orphaned — superseded by `HomeRouter` + dual-view; not imported anywhere |
| `src/lib/cardPreviewRpc.ts` | Orphaned — `getCardPreviews` / `uploadCardPreview` helpers with no callers |
| `src/app/api/card-previews/route.ts` | API route consumed exclusively by the deleted RPC lib |
| `src/app/api/upload-card-preview/route.ts` | API route consumed exclusively by the deleted RPC lib |

**Files simplified:**

| File | Change |
|---|---|
| `src/app/(dashboard)/home/page.tsx` | Dropped `getCardPreviews()` server-side fetch + `force-dynamic`; now a thin `<HomeRouter />` wrapper |
| `src/app/(dashboard)/home/HomeRouter.tsx` | Dropped `initialPreviews` prop and `HomeRouterProps` interface |
| `src/app/(dashboard)/home/desktop/View.tsx` | Dropped `DesktopViewProps` interface and unused `initialPreviews` parameter |
| `src/app/(dashboard)/admin-panel/useAdminPanelData.ts` | Updated stale comment pointing to `HomeClient` → `src/data/moduleIcons.tsx` |

**Note:** `card_previews` DB table and `card-previews` Storage bucket remain intact (no data deleted). Cleanup of those is a separate `worker_supabase` task.

## Changelog — Remove orphan image upload from Card Images tab (2026-05-26)

Follow-up to the `/home` icon-list redesign. Since module cards no longer use uploaded preview images (replaced by inline SVG icons), the upload machinery in the admin panel served no purpose.

**Changes in this commit:**

| File | Change |
|---|---|
| `useAdminPanelData.ts` | Removed `localPreviews`, `uploadingSlug`, `savedPreviewSlug`, `uploadError`, `handlePreviewUpload` state and `getCardPreviews`/`uploadCardPreview` imports; removed fields from `UseAdminPanelData` interface; renamed section label from "Card Images" → "Home Visibility" |
| `desktop/View.tsx` | Removed upload UI (thumbnail + "Upload image" button + saved/error indicators); replaced heading/description; restructured to 2-column grid (Module / Show on Home); removed `Image` import |
| `mobile/View.tsx` | Removed thumbnail row and Upload button from Card Images articles; section now shows label+description + toggle only; removed `Image` import |
| `docs/app/admin.md` | Updated section description, axis table, Wave 5 notes, and onboarding step 3 |

**Orphan DB/Storage:** the `card_previews` table and `card-previews` Supabase Storage bucket are still intact — no data was deleted. The API routes `/api/card-previews` and `/api/upload-card-preview` are also still present. These are candidates for cleanup by `worker_supabase` if the bucket and table are confirmed unused.

## Changelog — Home cards redesign: icon list (2026-05-26)

**Both desktop and mobile** views were redesigned in the same commit (`feat(home): replace image cards with icon+name list`).

| Change | Desktop | Mobile |
|---|---|---|
| Layout | Vertical list, one card per row, inside the existing 70% left column | Same vertical list, replacing gradient-thumbnail cards |
| Icon source | `src/data/moduleIcons.tsx` (centralized, 18 slugs) | Same `moduleIcons.tsx` — previously each view had its own inline SVG definitions |
| Icon size | 20×20 in a 40×40 rounded bubble | 20×20 in a 40×40 rounded bubble |
| Hover/press state | Orange icon color + glow shadow + translateX(4px) + left accent bar slides in | Pressed: orange icon + accent-left bar via `inset box-shadow` + translateX(3px) on chevron |
| Category headers | `SectionHeader` with category-color bar + horizontal divider | Section header with category-color dot |
| Image cards | Removed (large 220px photo cards) | Removed (gradient thumbnail + description rows) |
| `initialPreviews` prop | Still in signature (backward-compat with `page.tsx` server fetch) but not rendered | N/A (mobile never used server-fetched previews) |

**New file:** `src/data/moduleIcons.tsx` — module-level SVG icon registry. Exports `getModuleIcon(slug, size, strokeWidth)` and individual `Icon*` named components. Covers all 18 slugs currently in `module_visibility` + profile/admin-panel static entries.

**Admin-panel Card Images tab** (upload images per module + Show on Home toggle) is **preserved** — the toggle still controls `is_visible_on_home`. The uploaded images are no longer rendered in `/home` but the upload machinery remains intact. Cleanup of the upload UI in admin-panel is tracked as a follow-up task.

## Changelog — Data Sources table QA fixes (2026-05-26)

### Ad-hoc sources: cronUtc corrected + Next-run line hidden

`anp_subsidy_history` in `src/data/dataSources.ts` was incorrectly set to `cronUtc: "30 11 * * *"` (inherited by copy-paste from `anp_subsidy_diesel_reference`). Fixed to `cronUtc: null` with an updated `cronDescription` ("Ad-hoc — updated when new subsidy decree drops"). `price_bands` was already `null`.

`ExpandedRow.tsx` already gates the "Next run" row on `src.cronUtc !== null` — no change needed there; the upstream `dataSources.ts` fix was sufficient.

### Header LIVE dot: worst-row status aggregation

`src/components/home/DataSourcesTable/status.ts` — new shared helper module:
- `deriveStatus(src, lastUpdate: string | null): SourceStatus` — single function for status derivation.
- `aggregateStatus(statuses: SourceStatus[]): SourceStatus` — returns the worst status.
- `statusToTokenVar(status): string` — maps to `--ds-status-*` CSS tokens.

`StatusDot.tsx` now imports `deriveStatus` + `statusToTokenVar` from this shared module (inline logic removed).

`index.tsx` computes `headerColor` via `useMemo` over all `DATA_SOURCES`, deriving + aggregating status for every row — the header dot's `background` and `color` inline styles now reflect the worst row status instead of hardcoded green. Pulse animation class (`ds-pulse`) is unchanged and runs continuously.

## Changelog — post-reform cleanup (2026-05-25)

After the Imports & Exports reform (`24dd2aa1`), three stale references to the retired dashboards were removed from `/home`:

| File | Change |
|---|---|
| `mobile/View.tsx` | Removed dead slug icons `anp-daie`, `anp-desembaracos`, `anp-painel-importacoes`; added `imports-exports` icon (globe + bidirectional arrows) |
| `useHomeData.ts` | Removed stale `SLUG_CATEGORY` entries for the 3 retired slugs; added `imports-exports: "fuel"` |
| `useHomeData.ts` + `HomeClient.tsx` | Softened `imports-exports` card description — now reads "ANP fuel imports and exports — origins, customs clearances, and (after backfill) importers" |

### `/mdic-comex` deprecation cleanup (2026-05-25)

`/mdic-comex` was retired (route folder deletion and RPC cleanup handled by W2). Admin-bundle references removed:

| File | Change |
|---|---|
| `HomeClient.tsx` | Removed `mdic-comex` entry from `CARDS` array |
| `useHomeData.ts` | Removed `mdic-comex` entry from `CARDS` array and `"mdic-comex": "oilgas"` from `SLUG_CATEGORY` |
| `mobile/View.tsx` | Removed `mdic-comex` icon from `CategoryIcon` slug map |
| `useAdminPanelData.ts` | Removed `{ slug: "mdic-comex", … }` row from `MODULE_LABELS` |
| `docs/app/admin.md` | Removed `mdic-comex` from slug table |

## Known bugs fixed

### `null value in column "date"` on draft save (2026-05-12)

**Symptom**: user adds a new row, fills all fields including date via the calendar picker, clicks Save — Postgres returns `null value in column "date"`.

**Root cause**: stale-closure race in React 19 concurrent mode. `handleSave` checked `saveDisabled`, a derived variable captured in the render closure. A `blur` on the date input right before the click could commit a new state (`date: null`) after the render that set `saveDisabled=false`, letting the old closure skip the guard while `drafts` already reflected the invalid state.

**Fix (commit 69a8839e)**:
- `EditableTableEditor.tsx` — `handleSave` now re-validates all drafts and edited rows from current committed state before calling `saveChanges`.
- `persistence.ts` — `saveChanges` now (a) coerces number strings to JS numbers for PostgREST, and (b) short-circuits with a clear error if any required column in a draft is null/undefined, blocking the Postgres call entirely.

## Security — Email Enumeration (F2.3, 2026-05-14)

`handleAddRecipient` in `admin-panel/page.tsx` previously differentiated error `23505` (duplicate key) with the message "This email is already registered.", enabling an Admin-credential attacker to enumerate registered emails via the Alert Emails form.

**Fix:** both error paths now return the same generic message: "Could not add recipient. Please verify the email and try again."

`loadRecipients` also exposed raw Postgres error messages via `setRecipientsError(error.message)`. Replaced with "Could not load recipients. Please try again."

`forgot-password/page.tsx` and `login/page.tsx` were audited and confirmed clean: forgot-password always shows generic success (catch also calls `setSent(true)`), and login uses a single "Incorrect email or password." message regardless of error type.

## Anti-padrões

- Páginas administrativas sem `useRoleGuard("Admin")`.
- Esquecer `module_visibility` ao onboardar módulo novo (Cliente não vê).
- Esquecer slot de imagem na home (CEO vai notar).
- Mexer no padrão de avatar / first-login modal sem consultar Designer.
- Adicionar role novo sem revisar CHECK constraint + RLS de outras tabelas.
- Expor mensagem raw de erro do Postgres no frontend — usar mensagem genérica sempre.
