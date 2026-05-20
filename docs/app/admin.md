# Sub-PRD — Bundle Admin (`/home` + `/profile` + `/admin-panel`)

Bundle administrativo. Owner: [`worker_dash-admin`](../../.claude/agents/worker_dash-admin.md).

3 páginas pequenas/médias com natureza administrativa, agrupadas num agente único.

## Escopo de código

```
src/app/(dashboard)/
  home/
    page.tsx                        Server Component (fetches card_previews, renders HomeRouter)
    HomeRouter.tsx                  Client viewport router (useIsMobile → desktop or mobile)
    HomeClient.tsx                  Legacy (kept as reference; superseded by desktop/View.tsx)
    useHomeData.ts                  Shared hook — visibility filter, search, collapsed sections
    desktop/View.tsx                Desktop view (grid of image cards, hover reveal)
    mobile/View.tsx                 Mobile view (category sections, gradient thumbs, search)
  profile/page.tsx                  Perfil do user (nome, email, role badge)
  admin-panel/page.tsx              Gestão de roles + visibilidade de módulos
```

RPC wrappers: [`src/lib/profileRpc.ts`](../../src/lib/profileRpc.ts) (perfil) + seção em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (admin).

## Dual-view structure

This bundle is being migrated to the dual-view pattern (desktop + mobile) in waves.

### Wave 4 — `/home` (completed 2026-05-20)

`/home` is now a full dual-view module. File layout:

```
home/
├── page.tsx            Server Component — fetches card_previews (service role), renders HomeRouter
├── HomeRouter.tsx      "use client" — useIsMobile → DesktopView | MobileView
├── HomeClient.tsx      Legacy client component (kept, no longer rendered)
├── useHomeData.ts      Brain hook — visibility filter, search, section-collapse state
├── desktop/View.tsx    Desktop: grid of 220px image cards with hover-reveal animation
└── mobile/View.tsx     Mobile: 4 collapsible category sections (Markets / Oil & Gas /
                         Fuel Distribution / Admin), gradient thumbnails, sticky search
```

**Desktop view** — identical to original HomeClient. 3-column Bootstrap grid (`col-md-6 col-lg-4`), hover `translateY(-5px)` + description reveal. Server-fetched previews (`initialPreviews` prop) override static paths.

**Mobile view** — per `mockups/home-mobile.html`. Components used:
- `MobileTopBar` (wordmark + avatar initials)
- `MobileBottomTabBar` (Home / Discover / Saved / Profile; Profile tab navigates to `/profile`)
- Inline sticky section headers (no separate component — matched mockup exactly)
- Per-slug SVG icons per mockup

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
- Owns ALL state: `activeSection`, `localVis`, `localHomeVis`, `localPreviews`, `users`/`localRoles`, `recipients`, plus all `saving*`/`saved*`/`*Error` flags
- Owns ALL handlers: `handleToggle`, `handleHomeToggle`, `handlePreviewUpload`, `handleRoleChange`, `handleAddRecipient`, `handleToggleRecipient`, `handleRemoveRecipient`
- Owns pure helpers `isValidEmail` and `formatDateBR`
- Exports `SECTIONS` (id, label, shortLabel, description) and `MODULE_LABELS` (slug, label, description) as static module-level constants so both Views render the same catalog

**Desktop view** — identical to original. Dark left sidebar (220px wide, 5 buttons + Analytics link), white content panel with section header + module-specific cards.

**Mobile view** — list-based archetype:
- `MobileTopBar` with "Admin" pill + "Admin Panel" title + avatar (initials)
- Sticky horizontal scroll of section pills (Members / Access / Cards / Alerts / Tables) — pill row needed because 5 tabs don't fit in `MobileTabBar` container variant
- Per-section search bar (placeholder adapts: "Search by name, email, or role" / "Search modules" / "Search recipients")
- **Members**: `MobileDataCard` per user with avatar, name+email, role pill. Tapping the row opens a `BottomSheet` with the Admin/Client picker.
- **Permissions**: `MobileDataCard` (expanded variant) per module with switch on the right.
- **Card Images**: custom card per module with two rows — thumb+label+slug, then a controls row with Show-on-Home switch + Upload button. Inline error message under the row when upload fails.
- **Alert Emails**: Add form (input + button, 44px min-height for touch), then `MobileDataCard` per recipient with status pill + Enable/Disable button. Removing opens a `BottomSheet` with a confirm prompt (replaces the inline "Are you sure?" pattern from desktop, which doesn't fit on a 320px row).
- **Data Input**: shows a desktop-only notice because `EditableTableEditor` needs a wide layout.

**Divergence from desktop** (`[mobile-only]` deltas):
- The desktop's Analytics sidebar link is omitted on mobile — navigation to `/admin-analytics` happens through `/home`.
- Inline "Are you sure?" confirm for recipient removal becomes a `BottomSheet` with explicit Cancel/Remove buttons.
- Recipient row's primary action (tap whole row) is "remove" (opens confirm sheet); secondary action (button) is "Disable/Enable". On desktop both are inline buttons.
- `Data Input` section shows a placeholder explaining desktop-only; the embedded `EditableTableEditor` is not rendered on mobile.
- Per-section search filter is mobile-only (desktop has no search; the sidebar's narrow nav makes it unnecessary).
- The original Portuguese string `"Remover"` in the recipients list was corrected to `"Remove"` in BOTH views (English-only policy).

### Wave 5 — `/profile` (parallel)

`/profile` dual-view refactor is in flight on a parallel worktree (Wave 5).

## Páginas — descrição rápida

### `/home`
Landing visual. Mostra cards/imagens dos módulos disponíveis pro user (filtrado por role + visibility). **Cada módulo deve ter imagem própria.**

> **Memória persistente do CEO**: TODO módulo novo precisa de upload de imagem aqui. Sem isso, `/home` fica com placeholder genérico.

### `/profile`
Perfil do usuário logado. Edição inline do nome (`profile-name-edit-icon-btn`). Mostra: avatar (iniciais), full_name, email, role badge.

### `/admin-panel`
Protegida por `useRoleGuard("Admin")`. Funcionalidades (5 seções na sidebar):
- **Members** — listar todos os users com role; promover/demover Admin ↔ Client.
- **Permissions** — toggle `is_visible_for_clients` por módulo; afeta só Clients. Admin sempre vê tudo.
- **Card Images** — upload de imagem por módulo (home page cards) + toggle **"Show on Home"** (`is_visible_on_home`): liga/desliga a exibição do card na galeria `/home` para TODOS os usuários (incluindo Admin). Default `true`. Controles independentes: pode ter `is_visible_on_home=false` (card some do Home pra todos) e `is_visible_for_clients=true` (não afeta, já sumiu). Ou `is_visible_on_home=true` + `is_visible_for_clients=false` (Admin vê no Home, Client não vê).
- **Alert Emails** — gerenciar destinatários de alertas automáticos.
- **Data Input** — editar linhas de tabelas de referência diretamente via PostgREST (ver seção abaixo).

## RPCs

| RPC | Tipo | Página |
|---|---|---|
| `get_my_profile` | leitura | profile |
| `upsert_my_profile` | escrita | profile (edição de nome) |
| `get_module_visibility` | leitura | admin-panel + UserProfileContext — retorna `(module_slug, is_visible_for_clients, is_visible_on_home)` |
| `set_module_visibility` | escrita | admin-panel → aba Permissions |
| `set_module_home_visibility` | escrita | admin-panel → aba Card Images (Show on Home toggle) |
| `get_all_users_with_roles` | leitura | admin-panel |
| `set_user_role` | escrita | admin-panel |
| `seed_my_news_hunter_keywords` | escrita | first-login (chamada por dash-admin para popular keywords default no novo user) |

## Tabelas

### `profiles`
- PK: `id` (UUID, FK pra `auth.users.id`, ON DELETE CASCADE)
- Colunas: `role TEXT NOT NULL` ∈ {Admin, Client}, `full_name`, `avatar_url`, `created_at`
- RLS: cada user lê o próprio. Admin lê todos via RPC com `SECURITY DEFINER`.

### `module_visibility`
- PK: `module_slug`
- Colunas: `is_visible_for_clients BOOLEAN`, `is_visible_on_home BOOLEAN NOT NULL DEFAULT true`
- RLS: read pra authenticated, write pra Admin via RPC.
- `is_visible_for_clients`: controls Client visibility only (Admin always sees). Managed via Permissions tab.
- `is_visible_on_home`: controls Home gallery visibility for ALL users including Admin. Managed via Card Images tab "Show on Home" toggle. Default `true` (backward-compatible).

> **Tech debt**: ambas criadas via [`sql/create_profiles_and_visibility.sql`](../../sql/create_profiles_and_visibility.sql) aplicado direto no Dashboard, **não em migration versionada**.

## Slugs gerenciados em `module_visibility`

Lista completa dos slugs atualmente registrados na tabela `module_visibility` (todos com `is_visible_for_clients = true` e `is_visible_on_home = true` por padrão):

> **Nota de slug**: `MODULE_LABELS` em `admin-panel/page.tsx` usa `sales` (não `sales-volumes`) para alinhar com `CARDS[].slug` em `HomeClient.tsx` e com a chave real em `module_visibility`. O href `/sales-volumes` é mapeado para slug `sales` via `hrefToSlug()` em `HomeClient.tsx`.

| Slug | Categoria | Label na UI |
|---|---|---|
| `sales` | Fuel Distribution | Sales Volumes |
| `market-share` | Fuel Distribution | Market Share |
| `navios-diesel` | Fuel Distribution | Diesel Imports Line-Up |
| `diesel-gasoline-margins` | Fuel Distribution | Diesel and Gasoline Margins |
| `price-bands` | Fuel Distribution | Price Bands |
| `mdic-comex` | Estatísticas / Fuel Distribution | MDIC Comex |
| `anp-ppi` | Estatísticas / Fuel Distribution | ANP PPI |
| `anp-precos-produtores` | Estatísticas / Fuel Distribution | ANP Preços Produtores |
| `anp-precos-distribuicao` | Estatísticas / Fuel Distribution | ANP Preços Distribuição |
| `anp-glp` | Estatísticas / Fuel Distribution | ANP GLP |
| `anp-daie` | Estatísticas / Fuel Distribution | ANP Dados Abertos IE |
| `anp-desembaracos` | Estatísticas / Fuel Distribution | ANP Desembaraços |
| `anp-painel-importacoes` | Estatísticas / Fuel Distribution | ANP Painel Importações |
| `anp-lpc` | Estatísticas / Fuel Distribution | ANP LPC Preços |
| `sindicom` | Estatísticas / Fuel Distribution | SINDICOM |
| `anp-cdp` | Estatísticas / Oil & Gas | ANP CDP Produção |
| `anp-cdp-diaria` | Estatísticas / Oil & Gas | ANP CDP Diária |
| `anp-cdp-bsw` | Estatísticas / Oil & Gas | ANP CDP — BSW by Well |
| `anp-cdp-depletion` | Estatísticas / Oil & Gas | ANP CDP — Depletion |
| `stocks` | Other | Market Watch |
| `news-hunter` | Other | News Hunter |

> Os toggles no `/admin-panel` (seção Permissions) e os slots de imagem (seção Card Images) são gerados automaticamente a partir de `MODULE_LABELS` em `admin-panel/page.tsx`. Os cards na `/home` são definidos em `HomeClient.tsx` (array `CARDS`).

## Sua RESPONSABILIDADE ESPECIAL — onboarding de dashboard novo

Workflow disparado pelo Subgerente APP quando ele cria um dashboard novo:

### Passos

1. **Inserir em `module_visibility`:**
   ```sql
   INSERT INTO module_visibility (module_slug, is_visible_for_clients)
   VALUES ('<slug>', true)
   ON CONFLICT (module_slug) DO NOTHING;
   ```

2. **Garantir toggle no `/admin-panel`** — a UI de admin-panel idealmente faz auto-discovery via query a `module_visibility`. Se não, adicionar explicitamente.

3. **Foto/imagem na `/home`** — adicionar slot pro módulo novo:
   - Componente de card na home aceita `module_slug` e busca imagem em `public/images/modules/<slug>.png` (ou padrão equivalente).
   - Se a imagem ainda não existe, mostrar placeholder mas garantir que o slot exista.
   - Admin tem opção de upload no `/admin-panel` (a confirmar implementação atual).

4. **Avisar Subgerente APP** que onboarding terminou.

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
