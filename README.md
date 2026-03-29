# Itaú BBA Dashboard

A multi-module analytics dashboard built with Next.js, Supabase, and Plotly.js. Deployed on Vercel.

---

## Modules

| Route | File | Description |
|-------|------|-------------|
| `/` | `src/app/(dashboard)/page.tsx` | **Sales Dashboard** — product volume analysis (thousand m³) with filters by period, segment, agent, region/state |
| `/market-share` | `src/app/(dashboard)/market-share/page.tsx` | **Market Share** — temporal evolution of fuel distribution market share by distributor (Individual / Big-3 / Others modes) |
| `/diesel-gasoline-margins` | `src/app/(dashboard)/diesel-gasoline-margins/page.tsx` | **D&G Margins** — weekly fuel price composition (Diesel B & Gasoline C) broken down by component: base fuel, biofuel, taxes, distribution margin (R$/litro) |

---

## Local Setup

**1. Install dependencies**
```bash
npm install
```

**2. Configure environment variables**
```bash
cp .env.local.example .env.local
# Fill in your Supabase URL and anon key
```

**3. Run the dev server**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will be redirected to `/login` if not authenticated.

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx                    # Root HTML shell (Bootstrap CSS)
│   ├── login/page.tsx                # Login page (Supabase email/password)
│   └── (dashboard)/                  # Route group — auth guard applied to all pages inside
│       ├── layout.tsx                # Auth guard: redirects to /login if no session
│       ├── page.tsx                  # Sales Dashboard
│       ├── market-share/page.tsx     # Market Share Dashboard
│       └── template-module/page.tsx  # Starter template for new modules
├── components/
│   ├── NavBar.tsx                    # Top nav — add new modules to NAV_MODULES array
│   ├── PlotlyChart.tsx               # Plotly.js wrapper
│   ├── PeriodSlider.tsx              # Date range slider
│   ├── CheckList.tsx                 # Multi-select checkbox group
│   ├── RegionStateFilter.tsx         # Cascading region/state filter
│   └── SearchableMultiSelect.tsx     # Searchable dropdown multi-select
├── lib/
│   ├── supabaseClient.ts             # Supabase client singleton
│   ├── rpc.ts                        # All Supabase RPC wrappers (grouped by module)
│   ├── filterUtils.ts                # Date helpers, region→state map
│   └── exportExcel.ts                # Excel export for Market Share
└── types/
    └── plotly.js-dist-min.d.ts       # Type shim for plotly
```

---

## Authentication

- Supabase email/password auth via `supabase.auth.signInWithPassword()`
- All routes under `src/app/(dashboard)/` are protected by a shared layout that checks the session on mount and redirects to `/login` if unauthenticated
- Sign out is in the NavBar

---

## Supabase RPC Functions

All data fetching goes through Supabase RPC functions (PostgreSQL functions called via PostgREST). Wrappers live in `src/lib/rpc.ts`.

**Sales module:** `get_opcoes_filtros`, `get_metricas`, `get_qtd_por_ano`, `get_qtd_por_mes`, `get_qtd_por_regiao`, `get_qtd_por_uf`, `get_qtd_por_agente`, `get_qtd_por_produto`

**Market Share module:** `get_ms_opcoes_filtros`, `get_ms_serie_fast`, `get_ms_serie_others`, `get_others_players`

**D&G Margins module:** `get_dg_margins_data`, `get_dg_margins_filters`

SQL definitions are tracked in `supabase/migrations/`.

---

## Adding a New Module

1. Copy `src/app/(dashboard)/template-module/` → `src/app/(dashboard)/your-module/`
2. Rename the component inside `page.tsx`
3. Add a nav entry in `src/components/NavBar.tsx`:
   ```ts
   { href: "/your-module", label: "Your Module" }
   ```
4. Add RPC wrappers in `src/lib/rpc.ts` under a new `// ─── MODULE: ...` section
5. Auth is inherited automatically — no session checks needed in the page

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | Bootstrap 5, custom CSS |
| Charts | Plotly.js 3 |
| Database / Auth | Supabase (PostgreSQL + PostgREST) |
| Deployment | Vercel |
| Language | TypeScript 5 |
