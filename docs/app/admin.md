# Sub-PRD — Bundle Admin (`/home` + `/profile` + `/admin-panel`)

Bundle administrativo. Owner: [`worker_dash-admin`](../../.claude/agents/worker_dash-admin.md).

3 páginas pequenas/médias com natureza administrativa, agrupadas num agente único.

## Escopo de código

```
src/app/(dashboard)/
  home/page.tsx                     Landing — cards/imagens dos módulos
  profile/page.tsx                  Perfil do user (nome, email, role badge)
  admin-panel/page.tsx              Gestão de roles + visibilidade de módulos
```

RPC wrappers: [`src/lib/profileRpc.ts`](../../src/lib/profileRpc.ts) (perfil) + seção em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (admin).

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
