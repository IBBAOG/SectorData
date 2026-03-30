# Itau BBA Dashboard

**Multi-module analytics dashboard for the Fuel Distribution and Oil & Gas industries, built for Itau BBA.**

Real-time data visualization, automated data pipelines, Excel export, and role-based authentication — all powered by Next.js, Supabase, and Plotly.js, deployed on Vercel.

---

## Table of Contents

- [Overview](#overview)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Modules](#modules)
  - [Home](#home)
  - [Sales Dashboard](#sales-dashboard)
  - [Market Share](#market-share)
  - [Diesel Imports Line-Up](#diesel-imports-line-up)
  - [D&G Margins](#dg-margins)
  - [Price Bands](#price-bands)
- [Database Schema](#database-schema)
- [Data Pipelines (GitHub Actions)](#data-pipelines-github-actions)
  - [Vessel Monitoring](#1-vessel-monitoring)
  - [ANP Production Extraction](#2-anp-production-extraction)
  - [D&G Margins Upload](#3-dg-margins-upload)
  - [Supabase Migration Deploy](#4-supabase-migration-deploy)
- [Authentication](#authentication)
- [Reusable Components](#reusable-components)
- [Supabase RPC Reference](#supabase-rpc-reference)
- [Excel Export](#excel-export)
- [Getting Started](#getting-started)
- [Deployment](#deployment)
- [Adding a New Module](#adding-a-new-module)
- [Environment Variables Reference](#environment-variables-reference)

---

## Overview

The Itau BBA Dashboard (internally codenamed **SectorData**) is an internal analytics platform that gives Itau BBA analysts immediate access to up-to-date data across the Brazilian fuel distribution and Oil & Gas sectors.

### What it does

- **Visualizes fuel sales volumes** broken down by product, distributor, segment, region, and time period
- **Tracks market share evolution** of major fuel distributors (Vibra, Ipiranga, Raizen) and smaller players over time
- **Monitors diesel import vessels** arriving at four Brazilian ports, with ETA, discharge status, and quantity tracking
- **Breaks down fuel price composition** into its components: base fuel, biofuel, taxes, and distribution margins
- **Compares import/export parity** against Petrobras pricing for gasoline and diesel

### Key products tracked

| Product | Description |
|---------|-------------|
| Diesel B | Diesel blended with biodiesel |
| Gasoline C | Gasoline blended with anhydrous ethanol |
| Hydrous Ethanol | Stand-alone ethanol fuel |
| Otto-Cycle | Combined gasoline + ethanol equivalent |

### Key players tracked

| Player | Type |
|--------|------|
| Vibra | Big-3 distributor |
| Ipiranga | Big-3 distributor |
| Raizen | Big-3 distributor |
| Others | All remaining distributors (aggregated) |

---

## Screenshots

The Home page acts as a module directory with preview thumbnails for each dashboard:

| Sales Dashboard | Market Share | Diesel Imports Line-Up |
|:-:|:-:|:-:|
| ![Sales](public/previews/preview-sales.jpg) | ![Market Share](public/previews/preview-market-share.jpg) | ![Navios Diesel](public/previews/preview-navios-diesel.jpg) |

| D&G Margins | Price Bands |
|:-:|:-:|
| ![D&G Margins](public/previews/preview-dg-margins.jpg) | ![Price Bands](public/previews/preview-price-bands.jpg) |

---

## Architecture

```
┌─────────────────────────┐
│    External Sources      │
│  ANP Portal, Port sites, │
│  Excel files (manual)    │
└───────────┬─────────────┘
            │  Python 3.12 (Selenium, pandas, OCR)
            ▼
┌─────────────────────────┐
│    GitHub Actions         │
│  4 scheduled workflows   │
│  (cron: 6h / weekly /    │
│   monthly / on-push)     │
└───────────┬─────────────┘
            │  CSV commit + Supabase upsert
            ▼
┌─────────────────────────┐
│    Supabase               │
│  PostgreSQL database      │
│  19 RPC functions         │
│  Row Level Security       │
│  Email/password auth      │
└───────────┬─────────────┘
            │  supabase-js client (anon key)
            ▼
┌─────────────────────────┐
│    Next.js 16 Frontend    │
│  App Router + TypeScript  │
│  Bootstrap 5 + Plotly.js  │
│  Deployed on Vercel       │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│    Browser (User)         │
│  Authenticated session    │
│  Interactive charts       │
│  Excel export             │
└─────────────────────────┘
```

### Key architectural decisions

- **No custom API routes.** All backend logic lives in PostgreSQL RPC functions, called directly from the browser via the Supabase JS client. This eliminates a Node.js API layer entirely.
- **Client-side auth.** Supabase email/password authentication with a shared layout guard that redirects unauthenticated users to `/login`.
- **Materialized views for performance.** Market Share queries hit pre-aggregated materialized views (`mv_ms_serie`, `mv_ms_serie_fast`) instead of scanning the full `vendas` table.
- **GitHub Actions as the data pipeline orchestrator.** Scheduled cron workflows scrape external sources, commit raw CSVs to the repo, and import data into Supabase — no separate ETL infrastructure required.

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.1 |
| UI Library | React + React DOM | 19.2.4 |
| Language | TypeScript | 5 |
| Styling | Bootstrap | 5.3.8 |
| Charts | Plotly.js (react-plotly.js) | 3.4.0 |
| Slider | rc-slider | 11.1.9 |
| Database & Auth | Supabase (PostgreSQL + PostgREST) | supabase-js 2.100.1 |
| Excel Export | ExcelJS + JSZip + xlsx-js-style | 4.4.0 / 3.10.1 |
| Data Pipelines | Python (pandas, selenium, beautifulsoup4, ddddocr) | 3.12 |
| CI/CD | GitHub Actions | 4 workflows |
| Deployment | Vercel | Auto-deploy on push |

---

## Project Structure

```
dashboard_projeto/
├── .github/workflows/              # CI/CD pipelines
│   ├── navios_esperados.yml        #   Every 6h: scrape port vessel data
│   ├── extrair-anp.yml             #   Monthly 5th: ANP well production extraction
│   ├── upload-dg-margins.yml       #   Weekly Monday: D&G margins upload
│   └── supabase-deploy.yml         #   On push: deploy Supabase migrations
│
├── data/                           # Source data files
│   ├── Liquidos_Vendas_Atual.csv   #   132 MB — full sales dataset
│   ├── d_g_margins.xlsx            #   Diesel & gasoline margins
│   └── price_bands.xlsx            #   Price band data
│
├── output/                         # Pipeline output (committed by GitHub Actions)
│
├── public/
│   ├── logo.png                    # Itau BBA logo
│   ├── barrel_loading.png          # Loading spinner image
│   └── previews/                   # Module preview screenshots
│
├── scripts/
│   ├── anp_auto.py                 # ANP scraper (Selenium + OCR)
│   ├── import_navios_diesel.mjs    # Node.js: CSV → Supabase importer
│   ├── upload_price_bands.py       # Price bands Excel → Supabase
│   ├── deploy_migration.mjs        # Supabase migration helper
│   └── capture-previews.mjs        # Screenshot generator for Home previews
│
├── sql/
│   └── create_price_bands.sql      # Price bands table DDL (standalone)
│
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root HTML shell (Bootstrap CSS, lang=pt-BR)
│   │   ├── globals.css             # Global styles (700+ lines)
│   │   ├── login/page.tsx          # Login page
│   │   ├── forgot-password/page.tsx
│   │   ├── reset-password/page.tsx
│   │   └── (dashboard)/            # Auth-guarded route group
│   │       ├── layout.tsx          #   Session check → redirect to /login
│   │       ├── page.tsx            #   Sales Dashboard (/)
│   │       ├── home/page.tsx       #   Home — module directory (/home)
│   │       ├── market-share/page.tsx
│   │       ├── navios-diesel/page.tsx
│   │       ├── diesel-gasoline-margins/page.tsx
│   │       ├── price-bands/page.tsx
│   │       └── template-module/page.tsx  # Starter template for new modules
│   │
│   ├── components/                 # 6 reusable UI components
│   │   ├── NavBar.tsx              #   Top nav with module links + sign-out
│   │   ├── PlotlyChart.tsx         #   Plotly.js wrapper
│   │   ├── PeriodSlider.tsx        #   Date range slider (rc-slider)
│   │   ├── CheckList.tsx           #   Multi-select checkbox group
│   │   ├── RegionStateFilter.tsx   #   Cascading region → state filter
│   │   └── SearchableMultiSelect.tsx #  Searchable dropdown multi-select
│   │
│   ├── lib/
│   │   ├── supabaseClient.ts       # Supabase client singleton
│   │   ├── rpc.ts                  # All RPC wrappers (~430 lines, grouped by module)
│   │   ├── filterUtils.ts          # Date helpers, REGIAO_UF_MAP, month names
│   │   └── exportExcel.ts          # Excel export for all modules (~690 lines)
│   │
│   └── types/
│       └── plotly.js-dist-min.d.ts # Type shim for Plotly
│
├── supabase/
│   ├── config.toml                 # Supabase local dev config
│   └── migrations/                 # SQL migrations (deployed via CI)
│       ├── 20260327174919_remote_schema.sql   # Base schema (vendas + views + RPCs)
│       ├── 20260328200000_navios_diesel.sql   # Vessel tracking table + RPCs
│       └── 20260329000000_create_d_g_margins.sql # D&G margins table + RPCs
│
├── navios_esperados.py             # Root-level vessel scraper (29 KB)
├── upload_dg_margins.py            # Root-level D&G margins uploader
├── requirements.txt                # Python dependencies
├── package.json                    # Node.js dependencies & scripts
├── tsconfig.json                   # TypeScript config (strict mode, path aliases)
├── next.config.ts                  # Next.js config (Turbopack)
└── .env.example                    # Environment variable template
```

---

## Modules

### Home

| | |
|---|---|
| **Route** | `/home` |
| **File** | `src/app/(dashboard)/home/page.tsx` |
| **Description** | Landing page and module directory |

The Home page serves as the gateway to all dashboard modules. It displays a responsive card grid where each card shows a preview thumbnail, title, and description. Cards expand on hover to reveal a description and an "Open" link. A "Coming Soon" placeholder card indicates modules under development.

---

### Sales Dashboard

| | |
|---|---|
| **Route** | `/` |
| **File** | `src/app/(dashboard)/page.tsx` |
| **Description** | Product volume analysis (thousand m3) |
| **Excel Export** | No |

The main analytics module. It displays fuel sales volumes broken down by multiple dimensions with interactive Plotly charts.

**Charts:**
- Volume by year (bar chart)
- Volume by month (line chart)
- Volume by region (pie chart)
- Volume by state/UF (bar chart)
- Volume by agent/distributor (bar chart)
- Volume by product (bar chart)

**KPI cards:** Total records, total volume (thousand m3), distinct years available.

**Filters:**
- **Period** — Date range slider with year markers
- **Segment** — B2B, Retail, TRR, Others (checklist)
- **Agent** — Distributor name (searchable multi-select)
- **Region/State** — Cascading filter (Norte, Nordeste, Centro-Oeste, Sudeste, Sul → individual UFs)

**RPC functions:** `get_opcoes_filtros`, `get_metricas`, `get_qtd_por_ano`, `get_qtd_por_mes`, `get_qtd_por_regiao`, `get_qtd_por_uf`, `get_qtd_por_agente`, `get_qtd_por_produto`

---

### Market Share

| | |
|---|---|
| **Route** | `/market-share` |
| **File** | `src/app/(dashboard)/market-share/page.tsx` |
| **Description** | Market share evolution by distributor over time |
| **Excel Export** | Yes — multi-sheet workbook per product/segment |

Tracks how fuel distribution market share evolves month over month across major distributors.

**Three display modes:**
1. **Individual** — Shows each distributor's market share as a separate time series
2. **Big-3** — Aggregates Vibra + Ipiranga + Raizen vs. Others
3. **Others** — Drills into the smaller distributors outside the Big-3

**Products:** Diesel B, Gasoline C, Hydrous Ethanol, Otto-Cycle
**Segments:** Retail, B2B, TRR (Diesel only)

**Performance optimization:** Uses materialized views (`mv_ms_serie_fast`) and paginated RPC calls (1000-row pages) to handle large datasets efficiently.

**RPC functions:** `get_ms_opcoes_filtros`, `get_ms_serie_fast`, `get_ms_serie_others`, `get_others_players`

---

### Diesel Imports Line-Up

| | |
|---|---|
| **Route** | `/navios-diesel` |
| **File** | `src/app/(dashboard)/navios-diesel/page.tsx` |
| **Description** | Vessel scheduling and diesel import tracking by port |
| **Excel Export** | Yes |

Monitors diesel import vessels arriving at four Brazilian ports. Data is automatically refreshed every 6 hours by a GitHub Actions pipeline that scrapes port websites.

**Data displayed per vessel:**
- Port name
- Vessel name and status (expected, berthed, discharging, etc.)
- Product and quantity (tons / m3)
- ETA and discharge start/end dates
- Origin and berth number

**Features:**
- Snapshot selector — browse historical collection timestamps
- Per-port summary — total vessels and quantity aggregated by port
- Automatic data refresh indicator showing the latest collection timestamp

**RPC functions:** `get_nd_ultima_coleta`, `get_nd_coletas_distintas`, `get_nd_navios`, `get_nd_resumo_portos`

---

### D&G Margins

| | |
|---|---|
| **Route** | `/diesel-gasoline-margins` |
| **File** | `src/app/(dashboard)/diesel-gasoline-margins/page.tsx` |
| **Description** | Weekly fuel price composition breakdown (R$/litro) |
| **Excel Export** | Yes |

Breaks down the retail price of Diesel B and Gasoline C into their constituent components, displayed as a horizontal stacked bar chart over weekly intervals.

**Price components:**
| Component | Diesel B | Gasoline C |
|-----------|----------|------------|
| Base fuel | Diesel A | Gasoline A |
| Biofuel component | Biodiesel | Anhydrous Ethanol |
| State tax (ICMS) | Yes | Yes |
| Federal tax (PIS/COFINS/CIDE) | Yes | Yes |
| Distribution & resale margin | Yes | Yes |

**Data updated:** Weekly on Mondays via GitHub Actions (`upload-dg-margins.yml`).

**RPC functions:** `get_dg_margins_data`, `get_dg_margins_filters`

---

### Price Bands

| | |
|---|---|
| **Route** | `/price-bands` |
| **File** | `src/app/(dashboard)/price-bands/page.tsx` |
| **Description** | Import/export parity vs. Petrobras pricing |
| **Excel Export** | Yes |

Compares BBA-calculated import and export parity prices against Petrobras' official pricing for gasoline and diesel, displayed as time-series line charts.

**Metrics per product:**
- BBA import parity (IBBA for gasoline, BBA for diesel)
- BBA import parity with subsidy (diesel only)
- BBA export parity
- Petrobras price

**RPC functions:** `get_price_bands_data`

---

## Database Schema

All tables use Row Level Security (RLS) — only authenticated users can `SELECT`. All data access from the frontend goes through RPC functions (no direct table queries).

### Tables

#### `vendas` — Fuel Sales

The core table with all historical fuel sales data.

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigint (PK) | Auto-generated |
| `ano` | bigint | Year |
| `mes` | bigint | Month |
| `agente_regulado` | text | Distributor name |
| `nome_produto` | text | Product name (Diesel B, Gasolina C, etc.) |
| `regiao_destinatario` | text | Destination region (Norte, Nordeste, etc.) |
| `uf_destino` | text | Destination state (SP, RJ, etc.) |
| `mercado_destinatario` | text | Market type |
| `quantidade_produto` | double precision | Volume sold |
| `classificacao` | text | Agent classification (Individual, Big-3, Others) |
| `date` | date | Reference date |
| `segmento` | text | Segment (B2B, Retail, TRR, Outros) |

**Indexes:** 13 indexes covering all filterable columns and composite queries.

#### `navios_diesel` — Vessel Tracking

Real-time diesel import vessel data, refreshed every 6 hours.

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigint (PK) | Auto-generated |
| `collected_at` | timestamptz | Snapshot timestamp |
| `porto` | text | Port name |
| `status` | text | Vessel status |
| `navio` | text | Vessel name |
| `produto` | text | Product (default: "Oleo Diesel") |
| `quantidade` | double precision | Original quantity |
| `unidade` | text | Unit of measure |
| `quantidade_convertida` | double precision | Quantity in standard units |
| `eta` | timestamptz | Estimated time of arrival |
| `inicio_descarga` | timestamptz | Discharge start |
| `fim_descarga` | timestamptz | Discharge end |
| `origem` | text | Origin |
| `berco` | text | Berth number |

**Unique constraint:** `(collected_at, porto, navio)` — prevents duplicate vessel entries per snapshot.

#### `d_g_margins` — Fuel Price Composition

Weekly fuel price breakdown into components.

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigint (PK) | Auto-generated |
| `fuel_type` | text | "Diesel B" or "Gasoline C" |
| `week` | text | Week/year format (e.g., "13/2026") |
| `distribution_and_resale_margin` | numeric | R$/litro |
| `state_tax` | numeric | ICMS (R$/litro) |
| `federal_tax` | numeric | PIS/COFINS/CIDE (R$/litro) |
| `biofuel_component` | numeric | Biodiesel or Anhydrous Ethanol (R$/litro) |
| `base_fuel` | numeric | Diesel A or Gasoline A (R$/litro) |
| `total` | numeric | Total retail price (R$/litro) |

**Unique constraint:** `(fuel_type, week)`

#### `price_bands` — Import/Export Parity

Daily parity pricing data.

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigint (PK) | Auto-generated |
| `date` | date | Reference date |
| `product` | text | "Gasoline" or "Diesel" |
| `bba_import_parity` | numeric(10,4) | BBA-calculated import parity |
| `bba_import_parity_w_subsidy` | numeric(10,4) | Import parity with subsidy (diesel only) |
| `bba_export_parity` | numeric(10,4) | BBA-calculated export parity |
| `petrobras_price` | numeric(10,4) | Official Petrobras price |

**Unique constraint:** `(product, date)`

### Materialized Views

| View | Purpose | Refreshed by |
|------|---------|--------------|
| `mv_ms_serie` | Monthly aggregated sales by product/segment/agent | `classificar_agentes()` function |
| `mv_ms_serie_fast` | Pre-aggregated for Individual/Big-3 modes (no agent column) | `classificar_agentes()` function |

These views dramatically speed up Market Share queries by pre-computing monthly aggregations instead of scanning the full `vendas` table on every request.

---

## Data Pipelines (GitHub Actions)

All pipelines support manual triggering via `workflow_dispatch` in addition to their scheduled runs.

### 1. Vessel Monitoring

| | |
|---|---|
| **Workflow** | `.github/workflows/navios_esperados.yml` |
| **Schedule** | Every 6 hours — 10:00, 16:00, 22:00, 04:00 UTC (07:00, 13:00, 19:00, 01:00 BRT) |
| **Scripts** | `navios_esperados.py` → `scripts/import_navios_diesel.mjs` |
| **Target table** | `navios_diesel` |

**Process:**
1. Python script scrapes 4 Brazilian port websites for diesel vessel data
2. Outputs `output/navios_diesel.csv`
3. Commits the CSV to the repository
4. Node.js script parses the CSV and upserts rows into Supabase

### 2. ANP Production Extraction

| | |
|---|---|
| **Workflow** | `.github/workflows/extrair-anp.yml` |
| **Schedule** | 5th of each month at 08:00 UTC (05:00 BRT) |
| **Script** | `scripts/anp_auto.py` |
| **Output** | `output/anp/` (CSV artifacts, 90-day retention) |

**Process:**
1. Installs Google Chrome on the runner
2. Selenium automates the ANP/CDP portal (with `ddddocr` for CAPTCHA solving)
3. Extracts well production data for the target period (defaults to 2 months ago)
4. Saves CSVs and commits to the repository

**Manual trigger inputs:**
- `periodo` — Single period (MM/YYYY)
- `periodo_de` / `periodo_ate` — Date range for batch extraction
- `ambiente` — Environment filter: Mar (offshore), Pre-Sal, Terra (onshore), or all

### 3. D&G Margins Upload

| | |
|---|---|
| **Workflow** | `.github/workflows/upload-dg-margins.yml` |
| **Schedule** | Every Monday at 10:00 UTC (07:00 BRT) |
| **Script** | `upload_dg_margins.py` |
| **Source** | `data/d_g_margins.xlsx` |
| **Target table** | `d_g_margins` |

**Process:**
1. Reads the Excel file with openpyxl
2. Parses Diesel B and Gasoline C margin components
3. Upserts rows into Supabase (unique on `fuel_type` + `week`)

### 4. Supabase Migration Deploy

| | |
|---|---|
| **Workflow** | `.github/workflows/supabase-deploy.yml` |
| **Trigger** | Push to `main` when `supabase/migrations/**` files change |

**Process:**
1. Links the Supabase CLI to the project using `SUPABASE_PROJECT_REF`
2. Marks the baseline migration as applied
3. Runs `supabase db push` to apply all pending migrations

---

## Authentication

### Flow

1. User navigates to any dashboard page
2. The `(dashboard)/layout.tsx` guard calls `supabase.auth.getSession()`
3. If no session exists, the user is redirected to `/login`
4. User enters email and password → `supabase.auth.signInWithPassword()`
5. On success, the user is redirected to `/home`

### Pages

| Route | File | Purpose |
|-------|------|---------|
| `/login` | `src/app/login/page.tsx` | Email + password login form |
| `/forgot-password` | `src/app/forgot-password/page.tsx` | Request a password reset email |
| `/reset-password` | `src/app/reset-password/page.tsx` | Set a new password (from recovery link) |

### Security

- All tables have RLS enabled — only `authenticated` users can `SELECT`
- RPC functions use `SECURITY DEFINER` to run with elevated privileges
- The frontend uses the anonymous (`anon`) key — it cannot bypass RLS
- If Supabase environment variables are missing, the dashboard shows a graceful "Missing configuration" message instead of crashing

---

## Reusable Components

All components are client-side (`"use client"`) and follow a controlled-component pattern (state is lifted to the parent page).

| Component | File | Description |
|-----------|------|-------------|
| **NavBar** | `src/components/NavBar.tsx` | Top navigation bar with links to all modules and a sign-out button. Module links are defined in the `NAV_MODULES` array. |
| **PlotlyChart** | `src/components/PlotlyChart.tsx` | Wrapper around `react-plotly.js` that applies custom tooltip styling (rounded corners, drop shadow) and hides the mode bar. |
| **PeriodSlider** | `src/components/PeriodSlider.tsx` | Date range slider built with `rc-slider`. Displays year markers along the track. Used by Sales and Market Share for period filtering. |
| **CheckList** | `src/components/CheckList.tsx` | Multi-select checkbox group with "Select All" and "Clear" quick actions. Used for segment and agent filtering. |
| **RegionStateFilter** | `src/components/RegionStateFilter.tsx` | Two-level cascading filter: select a region (Norte, Nordeste, etc.) to filter available states (UFs). Uses `REGIAO_UF_MAP` from `filterUtils.ts`. |
| **SearchableMultiSelect** | `src/components/SearchableMultiSelect.tsx` | Dropdown with a search input for filtering options, plus multi-select with checkboxes. Supports click-outside-to-close via `useRef`. |

---

## Supabase RPC Reference

All RPC wrappers live in `src/lib/rpc.ts`, grouped by module. Each wrapper calls `supabase.rpc()` with typed parameters and returns typed data (or a safe fallback on error).

### Sales Module (8 functions)

| Function | Purpose | Parameters |
|----------|---------|------------|
| `get_opcoes_filtros` | Available filter options (agents, products, segments, dates) | — |
| `get_metricas` | KPI metrics (total records, volume, distinct years) | date range, segments, agents, regions, UFs |
| `get_qtd_por_ano` | Volume aggregated by year | same filters |
| `get_qtd_por_mes` | Volume aggregated by month | same filters |
| `get_qtd_por_regiao` | Volume aggregated by region | same filters |
| `get_qtd_por_uf` | Volume aggregated by state (UF) | same filters |
| `get_qtd_por_agente` | Volume aggregated by distributor | same filters |
| `get_qtd_por_produto` | Volume aggregated by product | same filters |

### Market Share Module (4 functions)

| Function | Purpose | Parameters |
|----------|---------|------------|
| `get_ms_opcoes_filtros` | Available filter options for market share | — |
| `get_ms_serie_fast` | Pre-aggregated market share time series | product, segment, classification, date range |
| `get_ms_serie_others` | "Others" distributor breakdown | product, segment, date range |
| `get_others_players` | List of distributors in the "Others" category | product, segment |

### Navios Diesel Module (4 functions)

| Function | Purpose | Parameters |
|----------|---------|------------|
| `get_nd_ultima_coleta` | Latest data collection timestamp | — |
| `get_nd_coletas_distintas` | All distinct collection timestamps | — |
| `get_nd_navios` | Vessel rows for a given snapshot | `p_collected_at` |
| `get_nd_resumo_portos` | Per-port summary (vessel count + totals) | `p_collected_at` |

### D&G Margins Module (2 functions)

| Function | Purpose | Parameters |
|----------|---------|------------|
| `get_dg_margins_data` | Margin rows ordered chronologically | `p_fuel_type` (optional) |
| `get_dg_margins_filters` | Distinct fuel types and sorted weeks | — |

### Price Bands Module (1 function)

| Function | Purpose | Parameters |
|----------|---------|------------|
| `get_price_bands_data` | All parity rows ordered by date | `p_product` (optional) |

### Pagination

Functions returning large datasets use a `paginatedRpc()` helper that fetches data in 1,000-row pages via Supabase's `.range(offset, offset + PAGE - 1)` method, accumulating results until all rows are retrieved.

---

## Excel Export

Excel export is available in **Market Share**, **D&G Margins**, **Price Bands**, and **Navios Diesel** modules. The implementation lives in `src/lib/exportExcel.ts` (~690 lines) and uses **ExcelJS** for workbook generation and **JSZip** for compression.

### Market Share Export

Generates a multi-sheet workbook with one sheet per product/segment combination:

| Product | Segments |
|---------|----------|
| Diesel B | Retail, B2B, TRR, Total |
| Gasoline C | Retail, B2B, Total |
| Hydrous Ethanol | Retail, B2B, Total |
| Otto-Cycle | Retail, B2B, Total |

Each sheet contains monthly market share percentages per distributor, with color-coded headers:

| Player | Color |
|--------|-------|
| Vibra | `#F26522` (orange) |
| Raizen | `#1A1A1A` (black) |
| Ipiranga | `#73C6A1` (green) |
| Others | `#A9A9A9` (gray) |
| Big-3 | `#FF5000` (dark orange) |

### Other Exports

- **D&G Margins** — Exports margin component breakdown by week for selected fuel type
- **Price Bands** — Exports parity pricing data by date and product
- **Navios Diesel** — Exports vessel data for the selected snapshot

---

## Getting Started

### Prerequisites

- **Node.js** 20+ (for the Next.js frontend)
- **Python** 3.12 (only needed for data pipeline scripts)
- A **Supabase** project with tables and RPC functions deployed (see [Database Schema](#database-schema))

### 1. Clone and install

```bash
git clone <repo-url>
cd dashboard_projeto
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

You can find these values in your Supabase dashboard under **Project Settings > API**.

### 3. Deploy the database schema

Apply all migrations to your Supabase project:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Or manually run the SQL files from `supabase/migrations/` in the Supabase SQL Editor.

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will be redirected to `/login` if not authenticated.

### 5. Build for production

```bash
npm run build
npm start
```

### 6. (Optional) Set up Python pipelines

```bash
python -m venv venv
source venv/bin/activate   # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

---

## Deployment

### Frontend (Vercel)

The Next.js frontend auto-deploys to Vercel on every push to `main`. No additional configuration is needed beyond connecting the GitHub repository to a Vercel project.

### Database (Supabase)

Supabase migrations are automatically deployed via the `supabase-deploy.yml` GitHub Actions workflow whenever migration files under `supabase/migrations/` are modified on `main`.

### Required GitHub Actions Secrets

Configure these in your repository's **Settings > Secrets and variables > Actions**:

| Secret | Used by | Description |
|--------|---------|-------------|
| `SUPABASE_URL` | Pipelines | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Pipelines | Service role key (elevated privileges) |
| `SUPABASE_PROJECT_REF` | Migration deploy | Project reference ID |
| `SUPABASE_ACCESS_TOKEN` | Migration deploy | Supabase management API token |

---

## Adding a New Module

1. **Copy the template:**
   ```bash
   cp -r src/app/\(dashboard\)/template-module/ src/app/\(dashboard\)/your-module/
   ```

2. **Rename the component** inside `page.tsx` to match your module name.

3. **Add a nav entry** in `src/components/NavBar.tsx`:
   ```ts
   { href: "/your-module", label: "Your Module" }
   ```

4. **Create RPC functions** in Supabase (PostgreSQL functions) and add a migration file in `supabase/migrations/`.

5. **Add RPC wrappers** in `src/lib/rpc.ts` under a new `// ─── MODULE: ...` section.

6. **(Optional)** Add Excel export logic in `src/lib/exportExcel.ts`.

7. **(Optional)** Add a preview image to `public/previews/` and a card definition in `src/app/(dashboard)/home/page.tsx`.

8. **Auth is inherited automatically** — the `(dashboard)` route group layout handles session checks. No auth code needed in your page.

---

## Environment Variables Reference

### Frontend (`.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL (e.g., `https://xxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous/public key |

### Python Scripts / GitHub Actions

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key (full access, bypasses RLS) |
| `DG_MARGINS_XLSX` | No | Path to D&G margins Excel file (defaults to `data/d_g_margins.xlsx`) |
| `PRICE_BANDS_XLSX` | No | Path to price bands Excel file (defaults to `data/price_bands.xlsx`) |

### GitHub Actions Secrets (CI/CD)

| Secret | Used by workflow | Description |
|--------|-----------------|-------------|
| `SUPABASE_URL` | navios, dg-margins | Project URL for data imports |
| `SUPABASE_SERVICE_KEY` | navios, dg-margins | Service key for data imports |
| `SUPABASE_PROJECT_REF` | supabase-deploy | Project ref for CLI link |
| `SUPABASE_ACCESS_TOKEN` | supabase-deploy | Management API token for CLI auth |
