# Imports & Exports — Sub-PRD

**Route:** `/imports-exports`
**Category:** Fuel Distribution
**Owner:** `worker_dash-imports-exports`
**NavBar:** Added by Worktree D (same reform wave).
**Module slug:** `imports-exports` (registered in `module_visibility` via migration `20260525000010`).

---

## Identity

| Field | Value |
|---|---|
| Page title | Imports & Exports |
| Subtitle | Brazilian fuel trade flows — by origin country and importer group |
| Period badge | Month range derived from slider (`MMM YYYY – MMM YYYY`); collapses to `MMM YYYY` when `start === end` (single-month view) |
| Products | Diesel, Gasoline, Crude Oil (global pill toggle — single-select, brand orange active state, content-sized pills) |
| Tabs | Imports (default) / Exports |

This dashboard **consolidates** the 4 deprecated dashboards:
- `/anp-daie` (sub-PRD: `docs/app/_deprecated/anp-daie.md`)
- `/anp-desembaracos` (sub-PRD: `docs/app/_deprecated/anp-desembaracos.md`)
- `/anp-painel-importacoes` (sub-PRD: `docs/app/_deprecated/anp-painel-importacoes.md`)
- `/mdic-comex` (sub-PRD: `docs/app/_deprecated/mdic-comex.md`) — absorbed by Panel C ("Import Price") on 2026-05-25

---

## Data Sources

### Primary tables (read-only, via RPCs only — never direct queries)

| Table | Scope | Key columns |
|---|---|---|
| `anp_desembaracos` | Imports source | `ano`, `mes`, `ncm_codigo`, `pais_origem`, `cnpj`, `importador`, `uf_cnpj`, `quantidade_kg` |
| `anp_daie` | Exports source | `ano`, `mes`, `produto`, `operacao`, `volume_m3`, `valor_usd` |

`anp_desembaracos` enriched by Worktree B ETL: columns `importador`, `cnpj`, `uf_cnpj` added; PK now `(ano, mes, ncm_codigo, pais_origem, cnpj)`. Pre-backfill rows carry `cnpj='__legacy__'` sentinel.

### Auxiliary tables (seeds, read via RPC JOINs)

| Table | Purpose |
|---|---|
| `imports_product_map` | Maps DAIE produto strings and Desembaracos NCM codes → unified product (`Diesel`, `Gasoline`, `Crude Oil`) |
| `importer_group_map` | Maps CNPJ → unified importer group label (e.g. all Vibra subsidiaries → "Vibra Energia"). Empty at migration time; populated post-backfill |
| `ncm_densidade_kg_m3` | Maps NCM code → density (kg/m³). Used server-side for kg → m³ conversion |

### NCM codes and density assumptions

| Product | NCM | Density (kg/m³) |
|---|---|---|
| Diesel | `27101921` | 840 |
| Gasoline | `27101931` | 740 |
| Crude Oil | `27090010` | 850 |

These are approximations. The `ncm_densidade_kg_m3` table allows refinement without code changes.

---

## RPCs

All RPCs: `LANGUAGE sql / plpgsql`, `STABLE`, `SECURITY DEFINER` (Pegadinha #18), `SET search_path = public, pg_temp`, granted to `anon, authenticated`.

Source migrations:
- `20260525000010_imports_exports_enrichment.sql` — original 4 (Diesel/Gasoline/Crude × DAIE/Desembaracos consolidation).
- `20260525000110_imports_exports_exports_by_country.sql` — exports stacked by destination + YoY.
- `20260526300000_imports_exports_unit_price_by_country.sql` — unit price by country (imports + exports).
- **`20260526800000_imports_exports_monthly_granularity.sql`** — temporal granularity upgrade from year to **month**. Added `(p_mes_inicio, p_mes_fim)` to the 7 RPCs whose bounds are inclusive on both ends; `get_imports_exports_filtros()` now also returns `mes_min` and `mes_max`. The 2 YoY RPCs were unchanged (they already accept `p_mes_fim`). Single-month view supported via `start === end`.

### Temporal filter — monthly granularity

The dashboard period is `{ start: { ano, mes }, end: { ano, mes } }`. The period UI is the shared `MonthRangePicker` component (`src/components/dashboard/MonthRangePicker.tsx`) — quick-range chips (`Last 12m`, `Last 24m`, `YTD`, `Last 5y`, `All`) plus four selects (FROM month / FROM year / TO month / TO year). Same component used by both `desktop/View.tsx` (sidebar) and `mobile/View.tsx` (FilterDrawer) for cross-view consistency.

The original plan was to feed `PeriodSlider` in `dates` mode the full `monthList` (~336 entries for a 28-year span). That was scrapped because `rc-slider` becomes unreadable with that many ticks (year labels collide with floating thumb labels). The hook still exposes `monthList` for forward-compat / charts that may need it, but the slider was removed.

Each chart's `xaxis.type = 'date'` + `tickformat = '%b %Y'` and `dtick` adapts to the range (`M1 ≤ 12mo`, `M3 ≤ 36mo`, `M6 ≤ 96mo`, `M12` otherwise).

Default period: **last 12 months ending at `(filtros.ano_max, filtros.mes_max)`** (clamped to ≥ `(ano_min, mes_min)`).

Period badge: `"Jan 2025 – May 2026"`, collapsing to `"May 2026"` when start == end.

`MonthRangePicker` clamps any out-of-bounds entry to the picker's `min`/`max` and auto-corrects ordering — if the user picks a FROM that is later than the current TO, the picker collapses TO to the same month (single-month view); symmetric for TO < FROM.

### `get_imports_exports_filtros()`

Returns `{ ano_min int, mes_min int, ano_max int, mes_max int, produtos text[] }`. Call once on mount; stable over the session. `produtos` is always `['Diesel','Gasoline','Crude Oil']`. `mes_min` is the earliest month observed at `ano_min`; `mes_max` is the latest at `ano_max`.

### `get_imports_exports_paises_stacked(p_unified_product, p_ano_inicio, p_mes_inicio, p_ano_fim, p_mes_fim, p_top_n DEFAULT 10)`

Returns `(ano int, mes int, pais_origem text, total_kg numeric)`.

- Server ranks countries by total kg over the period. Rows outside top-N are collapsed into `pais_origem='Others'`.
- UI converts: `total_kg / 1e6 = kt`. **Label must be "kt".**

### `get_imports_exports_importers_stacked(p_unified_product, p_ano_inicio, p_mes_inicio, p_ano_fim, p_mes_fim, p_top_n DEFAULT 10)`

Returns `(ano int, mes int, unified_importer text, total_mil_m3 numeric)`.

- Server JOINs `ncm_densidade_kg_m3` and `importer_group_map`; density conversion happens server-side.
- When all rows have `cnpj='__legacy__'`, returns 0 rows. **This is not an error** — sentinel state until Worktree B ETL backfill completes. UI renders an informational empty state.
- **Label must be "mil m³".** Never divide client-side — quantity is already in mil m³.

### `get_imports_exports_yoy_table(p_scope, p_unified_product, p_ano_fim, p_mes_fim, p_top_n DEFAULT 10)`

Returns `(entity text, last_12m numeric, prev_12m numeric, yoy_pct numeric)`.

- `p_scope`: `'paises'` → units kt; `'importers'` → units mil m³.
- **Single-month semantics (since migration `20260527000000_imports_exports_yoy_single_month.sql`):** `last_12m` holds the value of the single anchor month `(p_ano_fim, p_mes_fim)`; `prev_12m` holds the same month one year earlier `(p_ano_fim - 1, p_mes_fim)`. Column names are kept verbatim to preserve the payload contract with `src/lib/rpc.ts` wrappers — only the semantics shifted. UI labels the columns as `"<Month YYYY>"` / `"<Month YYYY-1>"` based on `period.end`.
- The UI always passes `period.end.ano` as `p_ano_fim` and `period.end.mes` as `p_mes_fim` — anchor is never data-driven (legacy "max month with non-zero data" logic in the hook was removed). User's explicit `TO` choice is honoured even when the trailing month has incomplete data (renders as `"n/a"`).
- `yoy_pct` is `NULL` when `prev_12m = 0` (no prior-year data). UI renders "n/a" in neutral color.
- `yoy_pct` color: green for positive, red for negative, neutral for null.

### `get_imports_exports_exports_paises_stacked(p_unified_product, p_ano_inicio, p_mes_inicio, p_ano_fim, p_mes_fim, p_metric DEFAULT 'volume', p_top_n DEFAULT 10)`

Returns `(ano int, mes int, pais text, value numeric)`.

- Source: `mdic_comex` (flow='export'). Migration `20260525000110_imports_exports_exports_by_country.sql`.
- `p_metric='volume'`: `value` is already in **mil m³** (server-side `kg / densidade_kg_m3 / 1000`). **Never divide client-side.**
- `p_metric='usd'`: `value` is raw FOB USD.
- Server ranks destination countries by total value over the period. Non-top-N rows collapsed into `pais='Others'`.
- Replaced the dropped `get_imports_exports_exports_serie` (migration 20260525000110).

### `get_imports_exports_exports_yoy_table(p_unified_product, p_ano_fim, p_mes_fim, p_metric DEFAULT 'volume', p_top_n DEFAULT 10)`

Returns `(entity text, last_12m numeric, prev_12m numeric, yoy_pct numeric)`.

- **Single-month semantics (since migration `20260527000000`):** identical pattern to the imports YoY RPC above — `last_12m` is the value at `(p_ano_fim, p_mes_fim)`, `prev_12m` at `(p_ano_fim - 1, p_mes_fim)`. Anchor is `period.end`; UI labels the columns as `"<Month YYYY>"` / `"<Month YYYY-1>"`.
- `last_12m` / `prev_12m` in mil m³ (`metric=volume`) or USD (`metric=usd`).
- `yoy_pct` is `NULL` when `prev_12m = 0`. UI renders "n/a" in neutral color.
- `yoy_pct` color: green for positive, red for negative, neutral for null.

> **Dropped RPC:** `get_imports_exports_exports_serie(p_unified_products text[], p_ano_inicio, p_ano_fim)` was removed in migration `20260525000110`. Any reference to it in frontend will fail at runtime. The new RPCs cover Exports end-to-end.

### `get_imports_exports_imports_unit_price(p_unified_product, p_ano_inicio, p_mes_inicio, p_ano_fim, p_mes_fim, p_top_n DEFAULT 8)`

Returns `(ano int, mes int, pais text, usd_per_m3 numeric)`.

- Source: `mdic_comex` (flow='import'). Migration `20260526300000_imports_exports_unit_price_by_country.sql`.
- Server ranks origin countries by total import volume in period; returns top-N. NOT collapsed to "Others" — each country is a distinct line.
- `usd_per_m3` is `NULL` for (pais, month) rows where volume = 0. UI uses `y=null + connectgaps` to skip those months in hover without breaking the line.
- SECURITY DEFINER (required — `mdic_comex` has RLS restricted to authenticated; without SECURITY DEFINER, anon callers get empty results).
- Default top-N = 8. Chart title: "Import Unit Price by Origin Country (USD/m³)".

### `get_imports_exports_exports_unit_price(p_unified_product, p_ano_inicio, p_mes_inicio, p_ano_fim, p_mes_fim, p_top_n DEFAULT 8)`

Returns `(ano int, mes int, pais text, usd_per_m3 numeric)`.

- Source: `mdic_comex` (flow='export'). Same migration as above.
- Server ranks destination countries by total export volume; returns top-N distinct lines.
- Same NULL semantics and SECURITY DEFINER requirement as the imports variant.
- Chart title: "Export Unit Price by Destination Country (USD/m³)".

---

## Exports tab — ranking divergence note

The stacked-area chart ("Exports — By Destination Country") ranks destination countries by **total value over the full selected period** `[p_ano_inicio, p_ano_fim]`, while the YoY table ranks countries by **last-12m only**. A country that was historically dominant but has dropped off recently can therefore appear in the chart's top-10 but be absent from the YoY table's top-10 (and vice versa). This is intentional — each artifact ranks by its own dominant axis. Both panels share the same `metric` filter (volume or USD).

---

## Layout — Desktop

```
┌─ DashboardHeader ─────────────────────────────────────────────────────────┐
│  Title: "Imports & Exports"                                               │
│  Sub: "Brazilian fuel trade flows — by origin country and importer group" │
│  Period badge (yyyy – yyyy)                       ExportPanel (rightSlot)  │
├───────────────────────────────────────────────────────────────────────────┤
│  [Diesel | Gasoline | Crude Oil]   [Imports | Exports]                    │
│  ↑ global single-select pill toggle (content-sized, brand orange active)  │
├──────────────┬────────────────────────────────────────────────────────────┤
│  Sidebar     │ Imports tab:                                                │
│  (220px)     │   ChartSection "By Origin Country"                         │
│              │     Plotly stacked bar — x: YYYY-MM, stack: countries      │
│  Period      │     Unit: kt (total_kg / 1e6)                              │
│  select      │   YoY table (entity | last 12m kt | prior 12m kt | YoY%)  │
│              │                                                             │
│              │   ChartSection "By Importer (Brazil)"                      │
│              │     Plotly stacked bar — x: YYYY-MM, stack: importers      │
│              │     Unit: mil m³ (pre-converted by RPC)                    │
│              │   YoY table (entity | last 12m mil m³ | prior | YoY%)      │
│              │   Empty state if 0 rows (pre-backfill sentinel)             │
│              │                                                             │
│              │   ChartSection "Import Price (USD/bbl | USD/m3 | USD/ton)" │
│              │     SegmentedToggle metric (compact, above chart)          │
│              │     Plotly single-line — 1 trace (active product only)     │
│              │     Source: mdic_comex. Color: matches active product       │
│              │                                                             │
│              │   ChartSection "Import Unit Price by Origin Country"       │
│              │     PillToggle: USD/ton (default) · ¢/gal (local state)    │
│              │     Plotly multi-line — 1 trace per country (NOT stacked)  │
│              │     Top 8 countries by import volume. y=null for gaps.     │
│              │     Source: mdic_comex. Colors: PALETTE rotation.           │
│              │                                                             │
│              │ Exports tab:                                                │
│              │   SegmentedToggle: Volume (mil m³) / Value (USD)           │
│              │   ChartSection "Exports — By Destination Country"          │
│              │     Plotly stacked area — x: YYYY-MM, stack: countries     │
│              │     Top-10 + Others. Unit: mil m³ (metric=volume) or USD   │
│              │   YoY table (entity | last 12m | prior 12m | YoY%)         │
│              │   Source note: MDIC Comex                                  │
│              │                                                             │
│              │   ChartSection "Export Unit Price..." (Crude Oil only)     │
│              │     Unit: USD/bbl (1 m³ = 6.2898 bbl). Hidden for Diesel  │
│              │     and Gasoline. Plotly multi-line, y=null for gaps.      │
│              │     Source: mdic_comex. Colors: PALETTE rotation.           │
└──────────────┴────────────────────────────────────────────────────────────┘
```

**Global product selector** (pill toggle, not SegmentedToggle component):
- Implemented as a custom `ProductPillToggle` component (inline in `desktop/View.tsx`) to allow content-sized pills (each pill shrinks to fit its label — no equal-width forced).
- Active state: `background: #ff5000` (brand orange), `color: #fff`.
- Inactive: `background: transparent`, `color: #555`.
- All pills use `display: inline-flex; align-items: center; justify-content: center` for vertical + horizontal centering.
- "Crude Oil" (longest label) renders at natural width without overflow.

---

## Mobile Adaptation

- `MobileTabBar` for Imports / Exports.
- **Product pill row** (horizontal scroll): single-select product toggle, sits between the sub-header and the sticky filter button. Same semantics as desktop global product toggle.
- Sidebar collapses into `FilterDrawer` (period selects only — product radio removed, replaced by the pill row).
- Charts rendered at 280px height (Panels A/B) or 240px (Panel C) via Plotly (no `MobileChart` wrapper needed — Plotly itself is responsive).
- YoY rows rendered as `MobileDataCard` list (title = entity, subtitle = prior 12m, rightSlot = last 12m + YoY% in color).
- Panel C metric toggle: horizontal-scroll pill row (USD/bbl · USD/m³ · USD/ton). Single trace for active product.
- Panel D metric toggle: pill row (USD/ton · ¢/gal). Local state, default USD/ton. Same pill style as Panel C mobile toggle.
- Exports tab: Volume/USD toggle (pill row). Stacked area chart at 280px height. YoY rows via `YoYCardList` (same MobileDataCard pattern as Imports panels). Source note below chart.
- Exports unit price panel: rendered only when product = Crude Oil. Unit: USD/bbl. No toggle (single unit for Crude Oil exports).
- `ExportFAB` triggers Excel export.
- Sticky filter button at top of scroll area opens `FilterDrawer`.

---

## Export — Tier 1 (direct download, no modal)

Decision: Tier 1 chosen because payload is aggregated (top-10 + Others), not raw rows. Even a 10-year window produces at most ~1 200 rows per panel. Upgrade to Tier 2 if use patterns show users exporting raw `anp_desembaracos` dumps.

| File | Content | Format |
|---|---|---|
| Excel sheet 1 | Panel A — imports by country (year, month, country, volume_kt) | `.xlsx` |
| Excel sheet 2 | Panel B — imports by importer (year, month, importer, volume_mil_m3) | `.xlsx` |
| CSV zip | Same 2 sheets as separate `.csv` files | `.zip` |

Filename pattern: `Imports-Exports_DD-MM-YY.xlsx` / `.zip`.

---

## Single-month chart variant

When `cmpMonth(period.start, period.end) === 0` (the user collapses `FROM` and `TO` to the same month — either by picking the same value in both selects or by the `MonthRangePicker`'s clamp-and-swap behaviour), the views switch every per-time-period chart from a stacked area / multi-line layout to a **horizontal ranked bar** at the same height:

| Chart | Multi-month layout | Single-month layout |
|---|---|---|
| Imports — By Origin Country (Panel A) | Stacked area, x=month | Horizontal bar, one bar per country, ranked desc; "Others" sinks to the bottom in grey |
| Imports — By Importer (Panel B) | Stacked area, x=month | Horizontal bar, one bar per importer group, ranked desc |
| Imports — Unit Price by Origin Country (Panel D) | Multi-line (top 8), x=month | Horizontal bar, one bar per origin country, ranked desc by converted unit |
| Exports — By Destination Country | Stacked area, x=month | Horizontal bar, one bar per destination country, ranked desc |
| Exports — Unit Price by Destination (Crude Oil) | Multi-line (top 8), x=month | Horizontal bar, one bar per destination, ranked desc by USD/bbl |
| Imports — Import Price (Panel C, single-line) | Lines+markers, x=month | Same lines+markers but with `marker.size = 14` (desktop) / `12` (mobile) — single point still legible |

The bar chart's `title.text` is the single-month label (e.g. `"Apr 2026"`) rendered as a small grey header above the bars. Hovertemplate format: `"<entity>: <value> <unit>"`. Y-axis tick labels carry the country/importer names (Plotly `automargin: true` to keep them visible). `hovermode` is `"closest"` (not `"x unified"`).

Implementation: each view declares an `isSingleMonth` flag via `cmpMonth(period.start, period.end) === 0` and an `singleMonthLabel = formatMonth(period.end.ano, period.end.mes)`. The trace builders (`buildHorizontalBarTraces`, `buildHorizontalBarTracesFromUnitPrice`) and layout helpers (`horizontalBarLayout`, `mobileHorizontalBarLayout`) live inline in each view — mobile uses tighter margins (`l:110`) and smaller font sizes than desktop (`l:160`).

## Hover tooltip — zero-suppression

Stacked-area charts (Panel A, Panel B, Exports) use `hovermode: 'x unified'`. By default Plotly shows ALL traces in the unified hover, including those with a value of 0 for that month — this pollutes the tooltip with long lists of "Country X: 0.0 kt".

**Fix (desktop/View.tsx + mobile/View.tsx):** `buildStackedTraces` generates a **per-point `hovertemplate` array** instead of a single string. Points with `value < HOVER_THRESHOLD` (0.05) emit `<extra></extra>` — Plotly treats this as "no entry" and skips the trace from the unified hover for that month. The y-value itself remains 0 (unchanged) so stacking is not affected visually.

`HOVER_THRESHOLD = 0.05` is defined as a module-level constant in both views. For volume panels the unit is mil m³ (50 m³ minimum). For USD panels the value is already in raw USD; at 0.05 this effectively suppresses true zero rows only, since any real USD export will be orders of magnitude larger. If the threshold needs tuning (e.g., suppress sub-1 kt entries), update the constant in both views.

Panel C (single-line Import Price) is unaffected — it uses a scalar `hovertemplate`, not an array, because it has no stacking.

---

## Known Facts / Gotchas

1. **Sentinel `__legacy__`** — `get_imports_exports_importers_stacked` returns 0 rows while ETL backfill hasn't run. UI shows an informational panel. Same for `get_imports_exports_yoy_table(p_scope='importers')`.

2. **`anp_daie.operacao` value** — exact string is `'EXPORTAÇÃO'` (uppercase + diacritic). RPC filters on this. Never assume lowercase or without diacritic.

3. **Crude Oil coverage** — Both Panel A and Panel B work for Crude Oil (NCM `27090010` is in `anp_desembaracos`). Different from the deprecated `/anp-painel-importacoes` which didn't cover crude.

4. **Pre-2020 importer coverage** — `anp_desembaracos.importador` column is NULL for data before 2020 (ANP XLSX didn't include it). Panel B in periods that include pre-2020 data shows proportionally fewer importers (or "Others" dominates). Expected behaviour.

5. **Density is approximate** — Diesel 840 kg/m³, Gasoline 740, Crude Oil 850. These come from `ncm_densidade_kg_m3` and can be refined via DML without a code deploy.

6. **CNPJ is stable, razão social is not** — `importer_group_map` keys on CNPJ. When a new subsidiary CNPJ appears, `worker_supabase` adds a row. No code change needed.

7. **Exports tab uses MDIC Comex, not ANP DAIE** — `get_imports_exports_exports_paises_stacked` and `get_imports_exports_exports_yoy_table` source from `mdic_comex` (migration 20260525000110). The old single-line `anp_daie` chart and its RPC (`get_imports_exports_exports_serie`) were dropped. Importer-level breakdown for exports is not available (MDIC does not carry importer identity).

---

## Panel C — Import Price (MDIC-sourced)

Added 2026-05-25 (Part 4 of imports-exports × mdic-comex unification).

### Source

`mdic_comex` (flow='import'), joined server-side with `imports_product_map` (source='mdic') and `ncm_densidade_kg_m3`. RPC: `get_imports_exports_fob_price_serie`.

### RPC signature

```
get_imports_exports_fob_price_serie(
  p_unified_product text,
  p_ano_inicio int, p_mes_inicio int,
  p_ano_fim    int, p_mes_fim    int
)
returns (
  ano int, mes int,
  total_volume_kg numeric, total_volume_m3 numeric, total_fob_usd numeric,
  fob_per_ton numeric, fob_per_m3 numeric, fob_per_bbl numeric
)
```

Returns one row per (ano, mes). NULL on the three derived `fob_per_*` columns when volume = 0. Anon grant confirmed (Part 3 of the unification project, commit `5a6f7ba6`).

### Metric toggle

`fob_per_bbl` (USD/bbl) · `fob_per_m3` (USD/m³) · `fob_per_ton` (USD/ton). Default: `fob_per_bbl`.

### Chart

Single-line (NOT stacked), one trace for the **active product** (governed by the global product pill toggle). The active product color is `#ff5000` (brand orange) — all products use the same color since only one is shown at a time. Hovertemplate shows 2 decimal places. Height 320px (desktop) / 240px (mobile). `hovermode: 'x unified'`.

Hook fetches a single RPC call (`get_imports_exports_fob_price_serie` for `stableFilters.unifiedProduct`) rather than 3 parallel calls. Switching products triggers a new fetch.

### Cross-source reconciliation

Panel A (countries) and Panel B (importers) draw from `anp_desembaracos` (importer-level granularity). Panel C draws from `mdic_comex` (FOB-bearing). The two sources agree on volumes for Diesel and Crude Oil within 1–2% on historical months; gap of up to 22% on recent months reflects `anp_desembaracos` ETL latency (monthly XLSX vs MDIC's daily cadence).

For Gasoline, the two sources disagree by design: `anp_desembaracos` tracks NCM 27101931 (Gasolina A, retail), MDIC tracks 27101259 (bulk gasoline, blending stock). **Panel C is the authoritative source for gasoline import prices.**

### Density assumptions (server-side)

Diesel 832 kg/m³ · Gasoline 745 kg/m³ · Crude Oil 870 kg/m³ — ANP standards from `ncm_densidade_kg_m3`. These are the values used in `get_imports_exports_fob_price_serie`; Panel B uses slightly different densities (840/740/850) because it sources from `anp_desembaracos` (a separate table with its own mapping). Refinement is done by updating `ncm_densidade_kg_m3`, no code change required.

### See also

- `docs/app/_deprecated/mdic-comex.md` — archived sub-PRD of the standalone `/mdic-comex` dashboard (retired 2026-05-25; its function was absorbed by Panel C above).
- Panel A / Panel B — `anp_desembaracos` based (volume, not price).

---

## Unit Price Panels — Notes

Added 2026-05-26 (migration `20260526300000`). Units updated 2026-05-26 (frontend conversion, no migration needed).

### Source

Both unit price RPCs source from `mdic_comex` (same as Panel C and the Exports stacked chart). They are **not** sourced from `anp_desembaracos` because that table has no `valor_usd` column — only `quantidade_kg`.

### RPC unit

Both RPCs return `usd_per_m3` (USD per cubic metre, FOB). All conversion to display units is done **client-side** in `desktop/View.tsx` and `mobile/View.tsx`.

### Imports unit price — Panel D

**Toggle (local state, not global filter):** USD/ton · ¢/gal. Default: USD/ton.

Conversion from `usd_per_m3`:
- USD/ton = `usd_per_m3 / (density_kg_m3 / 1000)` — density by product:
  - Diesel: 832 kg/m³
  - Gasoline: 745 kg/m³
  - Crude Oil: 870 kg/m³
- ¢/gal = `(usd_per_m3 / 264.172) * 100` (1 m³ = 264.172 US liquid gallons)

Expected sanity-check ranges (approximate, will vary by period):
- Diesel imports: ~$700–$1 200/ton or ~200–340 ¢/gal
- Gasoline imports: ~$650–$1 100/ton or ~190–310 ¢/gal
- Crude Oil imports: ~$350–$700/ton (density 870 kg/m³)

### Exports unit price — Crude Oil only

**Visibility:** Panel is **only shown when selected product = Crude Oil**. For Diesel and Gasoline, the panel is hidden entirely (not rendered). The RPC fetch in the hook still runs for all products; suppression is UI-only.

**Unit:** USD/bbl. Conversion: `usd_per_m3 / 6.2898` (1 m³ = 6.2898 bbl, international petroleum standard).

Expected sanity-check range:
- Crude Oil exports: ~$45–$95/bbl

If values appear ~6× too high, the divisor `6.2898` may have been applied incorrectly (multiplied instead of divided). If values are in the $20 000+/bbl range, check for m³ vs litres confusion in the RPC volume.

**Density constants (frontend, declared identically in both views):**

```ts
const PRODUCT_DENSITY_KG_M3: Record<string, number> = {
  Diesel: 832,
  Gasoline: 745,
  "Crude Oil": 870,
};
const M3_PER_BBL = 6.2898;
const GAL_PER_M3 = 264.172;
```

These mirror the `ncm_densidade_kg_m3` values used server-side by `get_imports_exports_fob_price_serie`.

### "Gulf of Mexico ≈ Estados Unidos" proxy

ANP registers cargo origin as the **country of the loading port**, not the cargo's ultimate geographic source. US Gulf Coast refineries (the primary source of diesel imports into Brazil) ship from the United States. Therefore:

- In `anp_desembaracos` (volume source): `pais_origem = 'Estados Unidos'`
- In `mdic_comex` (price/value source): `pais = 'Estados Unidos'`

The term "Golfo do México" used in trade journalism maps to `pais = 'Estados Unidos'` in MDIC data. This approximation is documented here; no separate mapping or alias is needed.

### Top-N ranking

The RPC ranks countries by **total import/export volume (m³) over the full selected period**, then returns only those top-N countries. There is no "Others" bucket — the chart always shows exactly the top-N lines (fewer if fewer countries have data). This differs from Panels A/B which collapse non-top-N into "Others".

### SECURITY DEFINER requirement

`mdic_comex` has RLS policies restricted to `authenticated` only. Without `SECURITY DEFINER` on the RPCs, `anon` callers get `[]` with no error (pegadinha #18). Both unit price RPCs are `SECURITY DEFINER + SET search_path = public, pg_catalog`.

### Mobile adaptation

Same traces, same data, mobile-tuned layout (240px height, no markers, tighter margins). `unitPriceMobileLayout` is shared between the two unit price panels on mobile for DRY layout definition.

---

## Future Work

- **Tier 2 export upgrade**: if users request full raw `anp_desembaracos` dumps (60k–200k rows), add `get_imports_exports_export_count` RPC + `ExportModal` + `useExportSize` integration.
- **`importer_group_map` population**: after Worktree B backfill completes and real CNPJs are discovered, `worker_supabase` populates the mapping table via DML migration. Panel B then shows named groups (Vibra, Ipiranga, Raízen, etc.) instead of cleaned-up razão social strings.
- **Panel C export**: add a 3rd sheet/CSV to the export containing the FOB price series (product, year, month, fob_per_bbl, fob_per_m3, fob_per_ton).
