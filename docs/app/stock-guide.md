# `/stock-guide` — sub-PRD

Owner: `worker_dash-stock-guide`. Reports to `worker_subgerente-app`.

> **Visual identity note:** Stock Guide is **NOT** the Market Watch / trading-terminal module. It uses the **standard dashboard identity** (brand orange `#ff5000`, Arial, liquid-glass cards) exactly like `/subsidy-tracker` and the other Fase-3 dashboards — never the scoped `.stocks-dark` / `.stocks-light` theme owned by `/stocks`. The only thing it borrows from Market Watch is the Yahoo quote proxy (`/api/stocks/quote`) and the `useStockQuote` hook.

## Overview

Equities-research module for the Brazilian Oil & Gas + Fuel Distribution coverage universe. Two analyses, one shared brain:

1. **Comps table** — one row per covered company with the headline research numbers: target price, recommendation (OP/MP/UP), and six forward column pairs (EV/EBITDA, P/E, FCFE Yield, Div Yield, EBITDA, Volumes), each split into two forward years (`config.y1_label` / `config.y2_label`, e.g. 2026E / 2027E). **Market cap**, **upside**, and the **four price-sensitive multiples (EV/EBITDA, P/E, FCFE Yield, Div Yield)** are computed LIVE (never stored) — see below. Only EBITDA and Volumes are direct data.
2. **Per-company sensitivity** — a freeform 2D matrix (admin-defined axes/labels/cells) for the selected company, opened below the table (desktop) or in a BottomSheet (mobile).

Targets, shares, the **fundamentals** (net debt, EBITDA, net income, FCFE, dividends), volumes, sensitivities and config are **admin-only inputs** maintained in the Admin Panel → Stock Guide section. The four price-sensitive multiples are **NOT stored** — they are always derived live from the price + fundamentals (no admin override). Any company can be **hidden** (regulatory restriction); hidden companies are removed from the table and listed only by name in a "Currently restricted" footnote — their financials never reach a non-admin browser.

Audience: **Client + Admin**, hidden from anonymous public (`is_visible_for_public=false`). One-click reconfigurable in Admin Panel → Permissions.

Slug / URL: `stock-guide` → `/stock-guide`. NavBar placement: **standalone top-level NavBar entry** ("Stock Guide", alongside Market Watch / News Hunter), not under any dropdown.

## Live derivations (frontend, in the hook)

Computed per visible row from the batched Yahoo quote + the admin-input fundamentals — **not** stored server-side. **All monetary inputs are BRL million**, so EV/EBITDA and P/E are dimensionless and the yields are ×100 for percent points.

| Field | Formula | Null-safety |
|---|---|---|
| `livePrice` | `quote.regularMarketPrice` matched on `yahoo_symbol` (fallback `ticker`) | `null` if the quote is missing |
| `marketCapBrlMn` | `shares_outstanding × livePrice / 1e6` (BRL mn) | `null` if either input is `null` |
| `upsidePct` | `target_price / livePrice − 1` | `null` unless `livePrice > 0` and `target_price` present |
| `evBrlMnY1` / `evBrlMnY2` | `marketCapBrlMn + net_debt_yN` (BRL mn). Net debt is **forward, per year**; either may be negative (net cash → lowers EV). Market cap stays a single current value. | `null` if either input is `null` |
| `evEbitdaY1` / `evEbitdaY2` | `evBrlMnYN / ebitda_yN` | `null` unless `ebitda_yN > 0` (EBITDA ≤ 0 → not meaningful → `—`) |
| `peY1` / `peY2` | `marketCapBrlMn / net_income_yN` | `null` unless `net_income_yN > 0` (non-positive earnings → P/E not meaningful → `—`) |
| `fcfeYieldY1` / `fcfeYieldY2` | `(fcfe_yN / marketCapBrlMn) × 100` percent | `null` unless `marketCapBrlMn > 0`; FCFE may be negative → negative yield shown |
| `divYieldY1` / `divYieldY2` | `(dividends_yN / marketCapBrlMn) × 100` percent | `null` unless `marketCapBrlMn > 0` |

Everything renders `—` (never `NaN`) when null. Every divide-by-zero / non-positive denominator is guarded. Market cap and EV land in BRL because `shares_outstanding` is the absolute share count and the live price is in BRL; net debt and the per-year fundamentals are all BRL mn. **EV convention:** `EV(year) = Market cap + Net Debt(year)` — net debt is now **forward per year** (`net_debt_y1` / `net_debt_y2`), so EV is computed per forward year. Market cap remains a single current value. **No override:** the four multiples are *always* computed — there is no admin-stored fallback.

The 4 live multiples render `—` while `quotesLoading` (they depend on the live price); EBITDA and Volumes are direct data and never gate on the quote.

### Live-quote wiring & cadence

- The hook collects the `yahoo_symbol` (fallback `ticker`) of **visible** rows into one de-duplicated list and passes it to `useStockQuote(symbols)` → a single batched `GET /api/stocks/quote?tickers=…` request (the proxy auto-appends `.SA` for B3 tickers and returns an array).
- Cadence: **one-shot fetch on load + a manual "Refresh quotes" button** (desktop only). **No polling ticker** — comps are snapshots and the Yahoo proxy is per-IP rate-limited.
- Hidden companies have a `null` `yahoo_symbol` AND are excluded from `visibleRows`, so a restricted ticker is structurally absent from the quote request — the browser cannot fetch a restricted name's price even if it tried.

## Data model — 3 tables

Source-of-truth migrations: `supabase/migrations/20260603200000_stock_guide.sql` (initial) + `supabase/migrations/20260603300000_stock_guide_fundamentals.sql` (2026-06-01 rework: stored multiples → fundamentals; owner: `worker_supabase`, both applied live). Pattern cloned from `field_stakes` (admin-curated, RLS-enabled, reads via SECURITY DEFINER RPCs, writes gated by `is_admin()`).

| Table | PK | Key columns |
|---|---|---|
| `stock_guide_companies` | `ticker text` | `company_name`, `yahoo_symbol`, `sector` (`oil_gas`/`fuel_distribution`), `volume_unit` (`kbpd`/`thousand_m3`), `shares_outstanding numeric`, `net_debt_y1 numeric` + `net_debt_y2 numeric` (forward net debt per year, BRL mn, may be negative = net cash), `last_update date`, `target_price numeric`, `recommendation` (`OP`/`MP`/`UP`/NULL), the FUNDAMENTALS `ebitda_y1/y2`, `net_income_y1/y2`, `fcfe_y1/y2` (FCFE value, not a yield), `dividends_y1/y2` (total dividends BRL mn), `volumes_y1/y2`, `is_visible boolean DEFAULT true`, `display_order int`, `updated_at`, `updated_by uuid`. **Dropped 2026-06-01:** the stored multiple pairs `ev_ebitda_*`, `pe_*`, `fcfe_yield_*`, `div_yield_*` (now derived live). |
| `stock_guide_sensitivity` | `ticker text` (FK → companies, `ON DELETE CASCADE`) | `grid jsonb` of shape `{ row_axis_title, col_axis_title, value_label, row_labels[], col_labels[], cells[][] }` (`cells[r][c]`) |
| `stock_guide_config` | `id int DEFAULT 1 CHECK (id=1)` (singleton) | `y1_label` (default `2026E`), `y2_label` (default `2027E`), `assumptions_note text`, `updated_at`, `updated_by` |

Registered in `module_visibility('stock-guide', clients=true, public=false, home=true)`. Seeded with 10 companies — 6 visible (`PETR4` Petrobras, `PRIO3` PRIO, `RECV3` PetroReconcavo, `OPCT3` OceanPact, `VBBR3` Vibra Energia, `UGPA3` Ultrapar) and 4 restricted (`BRAV3` BRAVA Energia, `RAIZ4` Raízen, `CSAN3` Cosan, `BRKM4` Braskem). Financial fields are empty at seed time — the Admin Panel fills them.

## Hide-aware RLS posture

The three tables have **RLS enabled with NO SELECT policy and NO write policy** (deliberately stricter than `field_stakes`). With RLS on + zero policies, direct PostgREST returns **0 rows** for non-superusers — `supabase.from('stock_guide_companies').select('*')` yields `[]` for anon/client. All access flows through SECURITY DEFINER RPCs, which is what keeps hidden financials server-side.

`get_stock_guide_comps()` is the hide-aware core: it returns one row per company in `display_order`, but for hidden rows seen by a non-admin it forces **every** field except `ticker` / `company_name` / `is_visible` / `display_order` to NULL (including `sector`, `volume_unit`, `yahoo_symbol`, `shares_outstanding` and all comps). Admins (`is_admin()`) receive every field through the same call. `get_stock_guide_sensitivity(ticker)` returns `{}` for a hidden company unless the caller is an admin.

## RPC contract (locked — already live)

All reads are `SECURITY DEFINER SET search_path = public, pg_temp`; admin functions start with the `is_admin()` guard (`RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'`).

**Public reads** (GRANT `anon`, `authenticated`):

| RPC | Returns |
|---|---|
| `get_stock_guide_comps()` | `TABLE(ticker text, company_name text, is_visible boolean, display_order int, sector text, volume_unit text, yahoo_symbol text, shares_outstanding numeric, net_debt_y1 numeric, net_debt_y2 numeric, last_update date, target_price numeric, recommendation text, ebitda_y1 numeric, ebitda_y2 numeric, net_income_y1 numeric, net_income_y2 numeric, fcfe_y1 numeric, fcfe_y2 numeric, dividends_y1 numeric, dividends_y2 numeric, volumes_y1 numeric, volumes_y2 numeric)` |
| `get_stock_guide_sensitivity(p_ticker text)` | `jsonb` grid (`{}` if hidden/non-admin) |
| `get_stock_guide_config()` | `TABLE(y1_label text, y2_label text, assumptions_note text)` |

**Admin reads** (GRANT `authenticated`, `is_admin()`-guarded): `admin_get_stock_guide_companies()` → `TABLE(all cols incl hidden + shares_outstanding + updated_at + updated_by)`; `admin_get_stock_guide_sensitivity(p_ticker text)` → `jsonb`.

**Admin writes** (GRANT `authenticated`, `is_admin()`-guarded): `admin_upsert_stock_guide_company(p_ticker text, p_data jsonb)` → `void`; `admin_upsert_stock_guide_sensitivity(p_ticker text, p_grid jsonb)` → `void` (validates grid dimensions); `admin_set_stock_guide_visibility(p_ticker text, p_is_visible boolean)` → updated row; `admin_upsert_stock_guide_config(p_y1 text, p_y2 text, p_note text)` → `void`; `admin_delete_stock_guide_company(p_ticker text)` → `void` (sensitivity cascades).

### Frontend wrappers (`src/lib/rpc.ts` § "MODULE: Stock Guide")

Single-writer section. All 10 wrappers coerce Postgres `numeric` (arrives as a string over PostgREST) → `number | null` via `toNumOrNull`; JSONB params are passed as plain JS objects (no `JSON.stringify`).

| Wrapper | Return type |
|---|---|
| `rpcGetStockGuideComps` | `Promise<StockGuideCompany[]>` |
| `rpcGetStockGuideSensitivity` | `Promise<SensitivityGrid \| null>` |
| `rpcGetStockGuideConfig` | `Promise<StockGuideConfig>` |
| `rpcAdminGetStockGuideCompanies` | `Promise<StockGuideAdminCompany[]>` |
| `rpcAdminGetStockGuideSensitivity` | `Promise<SensitivityGrid \| null>` |
| `rpcAdminUpsertStockGuideCompany` | `Promise<void>` |
| `rpcAdminUpsertStockGuideSensitivity` | `Promise<void>` |
| `rpcAdminSetStockGuideVisibility` | `Promise<StockGuideAdminCompany \| null>` |
| `rpcAdminUpsertStockGuideConfig` | `Promise<void>` |
| `rpcAdminDeleteStockGuideCompany` | `Promise<void>` |

Types live in `src/types/stockGuide.ts`: `StockGuideCompany` (raw comps row, carrying the fundamentals `net_debt_y1/y2` / `net_income_y1/y2` / `fcfe_y1/y2` / `dividends_y1/y2` instead of the dropped stored multiples), `StockGuideComputedRow` (adds `livePrice` / `marketCapBrlMn` / `upsidePct` / `evBrlMnY1/Y2` / `evEbitdaY1/Y2` / `peY1/Y2` / `fcfeYieldY1/Y2` / `divYieldY1/Y2`), `SensitivityGrid`, `StockGuideConfig`, `StockGuideAdminCompany`, plus the enums `StockGuideSector` / `StockGuideVolumeUnit` / `StockGuideRecommendation`.

## UI

### Comps table (desktop)

- Wide table with a **sticky Company column + sticky 2-level header**, `overflow-x:auto`.
- **Level 1** group headers: Company (rowspan) · Ticker · Last update · TP · Recomm. · Upside · Market cap (BRL mn) · then EV/EBITDA, P/E, FCFE Yield, Div Yield, EBITDA, Volumes each spanning two sub-cols.
- **Level 2**: `config.y1_label` / `config.y2_label` under each multiple group.
- Recommendation rendered as a colored chip (OP = green, MP = amber, UP = red). Upside colored by sign (green ↑ / red ↓). Right-aligned tabular numerics. Live cells (Market cap, Upside) show `—` while quotes load.
- Clicking a row selects that company (orange left-border highlight) and lazily loads its sensitivity grid.
- Footnotes below the table: assumptions note (from config) + the constant volume-unit note ("Volumes: oil & gas in kbpd, fuel distribution in thousand m³.") + a live-derivation note + "Currently restricted: {names}".

### Sensitivity panel (desktop)

Labeled 2D matrix: top-left cell = `value_label`; the `col_axis_title` spans all `col_labels`; the `row_axis_title` sits above the row-label column; body = `cells[r][c]`. `BarrelLoading` while the grid loads; an empty-state card when no grid is published for the selected company. Default selection = first visible row.

### Mobile

- Comps as cards (Company + Ticker + Recomm chip header; TP / live Market cap / Upside KPIs; a compact horizontal-scroll mini-table for the Y1/Y2 multiple pairs). Tap → sensitivity grid in a `BottomSheet`.
- Sector filter exposed as chips + a `FilterDrawer`.
- Restricted / assumptions footnote rendered as a small card.
- **No export** (mobile reform: export is desktop-only).

## Dual-view

- `page.tsx` routes via `useIsMobile()` → `desktop/View.tsx` | `mobile/View.tsx`.
- Single brain `useStockGuideData.ts` — both Views consume it; neither calls Supabase or fetches quotes directly.
- Binding sync rule: any new filter / column / KPI in one View must land in the other in the same commit, or carry a `[desktop-only]` / `[mobile-only]` tag. Known intentional divergences: comps render as a wide sticky table on desktop vs. cards on mobile; sensitivity is a panel below on desktop vs. a BottomSheet on mobile; the Refresh-quotes button + ExportPanel are desktop-only.

## Export

Tier 1 (direct download, no size precount), **desktop only**. Excel (`downloadGenericExcel`) + CSV (`downloadCsv`, UTF-8 BOM) of the computed **visible** table — includes live price, upside %, market cap (BRL mn), and the Y1/Y2 multiple pairs with the config labels in the headers. Mobile has no export by design.

## File map

```
src/app/(dashboard)/stock-guide/
├── page.tsx                  # useIsMobile() router
├── useStockGuideData.ts      # single brain — comps+config fetch, live quotes, derivations, drill-down, export
├── desktop/View.tsx          # wide sticky comps table + sensitivity panel + footnotes
└── mobile/View.tsx           # comps cards + BottomSheet sensitivity + FilterDrawer + footnote card
src/types/stockGuide.ts       # shared types (consumed by the dashboard + the admin-panel pass)
src/lib/rpc.ts                # § "MODULE: Stock Guide" — all 10 wrappers (single writer)
```

## History

- **2026-06-01** — Dashboard frontend created (this PRD). `worker_subgerente-app` authored the rpc.ts wrappers + types + the dual-view dashboard + NavBar "Equities" group; DB layer (3 tables + 10 RPCs + seed) was pre-built and applied live by `worker_supabase` (`20260603200000_stock_guide.sql`). The Admin Panel → Stock Guide CRUD section is a separate follow-up pass that consumes the admin wrappers + types defined here. Audience: Client + Admin, public-hidden. Live market cap/upside via the existing Yahoo proxy (one-shot fetch + manual refresh, no polling).
- **2026-06-01** — NavBar promotion: `/stock-guide` moved out of the "Oil & Gas" mega-menu (the "Equities" group was removed) and is now a **standalone top-level NavBar entry** ("Stock Guide"), placed immediately before "Market Watch" — coverage spans fuel distributors too, so it isn't exclusive to Oil & Gas. Plain text `nav-link` like Market Watch / News Hunter (no glyph). Per-slug visibility gating unchanged (`is_visible_for_public=false`, Client + Admin).
- **2026-06-01** — **Net debt per forward year.** `stock_guide_companies.net_debt` (single value) was replaced by `net_debt_y1` + `net_debt_y2` (numeric, BRL mn, may be negative = net cash) — DB applied live by `worker_supabase` (commit `64ff1fb4`, `supabase/migrations/20260603400000_stock_guide_net_debt_per_year.sql`). `get_stock_guide_comps()` / `admin_get_stock_guide_companies()` now return `net_debt_y1` + `net_debt_y2` (right after `shares_outstanding`); `admin_upsert_stock_guide_company` reads them in place of `net_debt`. Frontend: EV is now computed **per forward year** — `evBrlMnY1 = marketCapBrlMn + net_debt_y1`, `evBrlMnY2 = marketCapBrlMn + net_debt_y2` (market cap stays a single current value), feeding `evEbitdaY1 = evBrlMnY1 / ebitda_y1` and `evEbitdaY2 = evBrlMnY2 / ebitda_y2`. Touched: `src/types/stockGuide.ts` (raw row swaps `net_debt`→`net_debt_y1/y2`; `StockGuideComputedRow` swaps `evBrlMn`→`evBrlMnY1/Y2`), `src/lib/rpc.ts` § Stock Guide (mapper + upsert docstring), `useStockGuideData.ts` (per-year EV derivation + CSV `ev_brl_mn` split into `ev_brl_mn_y1`/`ev_brl_mn_y2`), both `desktop/View.tsx` + `mobile/View.tsx` (unchanged columns — still read `evEbitdaY1/Y2`, now per-year EV), and the Admin Panel editor (`useAdminPanelData.ts` + `admin-panel/desktop/View.tsx`): the single "Net Debt" input became a per-year pair (`Net Debt 2026E` / `Net Debt 2027E`) in the forward-pair layout; save `data` object swaps `net_debt`→`net_debt_y1`/`net_debt_y2`. P/E, FCFE Yield, Div Yield, market cap and upside are unchanged (they don't use net debt). Dual-view binding honored (no displayed-column change in either View). `npx tsc --noEmit` → 0 errors.
- **2026-06-01** — **Derived-multiples rework.** The 4 price-sensitive multiples (EV/EBITDA, P/E, FCFE Yield, Div Yield) are no longer admin-typed numbers — they are now **derived LIVE in the browser** (`useStockGuideData.ts`) from the Yahoo price + admin-input **fundamentals**. DB layer reworked by `worker_supabase` (`supabase/migrations/20260603300000_stock_guide_fundamentals.sql`, applied live): `stock_guide_companies` dropped `ev_ebitda_*` / `pe_*` / `fcfe_yield_*` / `div_yield_*` and added `net_debt` (single current value, BRL mn, may be negative) + `net_income_y1/y2` + `fcfe_y1/y2` (FCFE value) + `dividends_y1/y2` (all BRL mn); `get_stock_guide_comps()` / `admin_get_stock_guide_companies()` / `admin_upsert_stock_guide_company()` re-signed accordingly. Frontend: `src/types/stockGuide.ts` (raw row swaps multiples→fundamentals; `StockGuideComputedRow` gains `evBrlMn` + the 8 multiple fields), `src/lib/rpc.ts` § Stock Guide (mapper + upsert docstring), the hook's per-row derivation (`EV = Market cap + Net Debt`, dimensionless multiples, ×100 yields, all null-safe with guarded denominators), both `desktop/View.tsx` + `mobile/View.tsx` (the EV/EBITDA · P/E · FCFE Yield · Div Yield cells now read the computed values + show `—` while quotes load; columns otherwise unchanged), and the Admin Panel editor (`useAdminPanelData.ts` + `admin-panel/desktop/View.tsx`): the 4 stored-multiple input groups were replaced by a single Net Debt input + per-year Net Income / FCFE / Dividends inputs, with a hint that the 4 multiples are computed live. Dual-view binding honored (same change in both views). Audience/visibility unchanged.
