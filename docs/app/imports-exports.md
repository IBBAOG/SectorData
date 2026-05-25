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
| Period badge | Year range derived from slider (`YYYY – YYYY`) |
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

All 6 RPCs: `LANGUAGE sql / plpgsql`, `STABLE`, `SECURITY INVOKER`, granted to `anon, authenticated`. RPCs 1–5: migration `20260525000010_imports_exports_enrichment.sql`. RPC 6 (`get_imports_exports_fob_price_serie`): Part 3 of imports-exports × mdic-comex unification (commit `5a6f7ba6`).

### `get_imports_exports_filtros()`

Returns `{ ano_min int, ano_max int, produtos text[] }`. Call once on mount; stable over the session. `produtos` is always `['Diesel','Gasoline','Crude Oil']`.

### `get_imports_exports_paises_stacked(p_unified_product, p_ano_inicio, p_ano_fim, p_top_n DEFAULT 10)`

Returns `(ano int, mes int, pais_origem text, total_kg numeric)`.

- Server ranks countries by total kg over the period. Rows outside top-N are collapsed into `pais_origem='Others'`.
- UI converts: `total_kg / 1e6 = kt`. **Label must be "kt".**

### `get_imports_exports_importers_stacked(p_unified_product, p_ano_inicio, p_ano_fim, p_top_n DEFAULT 10)`

Returns `(ano int, mes int, unified_importer text, total_mil_m3 numeric)`.

- Server JOINs `ncm_densidade_kg_m3` and `importer_group_map`; density conversion happens server-side.
- When all rows have `cnpj='__legacy__'`, returns 0 rows. **This is not an error** — sentinel state until Worktree B ETL backfill completes. UI renders an informational empty state.
- **Label must be "mil m³".** Never divide client-side — quantity is already in mil m³.

### `get_imports_exports_yoy_table(p_scope, p_unified_product, p_ano_fim, p_mes_fim, p_top_n DEFAULT 10)`

Returns `(entity text, last_12m numeric, prev_12m numeric, yoy_pct numeric)`.

- `p_scope`: `'paises'` → units kt; `'importers'` → units mil m³.
- Rolling 12m window ending at `(p_ano_fim, p_mes_fim)`. UI passes `period[1]` as `p_ano_fim` and `12` as `p_mes_fim`.
- `yoy_pct` is `NULL` when `prev_12m = 0` (no prior-year data). UI renders "n/a" in neutral color.
- `yoy_pct` color: green for positive, red for negative, neutral for null.

### `get_imports_exports_exports_paises_stacked(p_unified_product, p_ano_inicio, p_ano_fim, p_metric DEFAULT 'volume', p_top_n DEFAULT 10)`

Returns `(ano int, mes int, pais text, value numeric)`.

- Source: `mdic_comex` (flow='export'). Migration `20260525000110_imports_exports_exports_by_country.sql`.
- `p_metric='volume'`: `value` is already in **mil m³** (server-side `kg / densidade_kg_m3 / 1000`). **Never divide client-side.**
- `p_metric='usd'`: `value` is raw FOB USD.
- Server ranks destination countries by total value over the period. Non-top-N rows collapsed into `pais='Others'`.
- Replaced the dropped `get_imports_exports_exports_serie` (migration 20260525000110).

### `get_imports_exports_exports_yoy_table(p_unified_product, p_ano_fim, p_mes_fim, p_metric DEFAULT 'volume', p_top_n DEFAULT 10)`

Returns `(entity text, last_12m numeric, prev_12m numeric, yoy_pct numeric)`.

- Rolling 12m window ending at `(p_ano_fim, p_mes_fim)`. UI passes `period[1]` as `p_ano_fim` and the max month observed in `exportsPaisesData` for that year (fallback 12) as `p_mes_fim`.
- `last_12m` / `prev_12m` in mil m³ (`metric=volume`) or USD (`metric=usd`).
- `yoy_pct` is `NULL` when `prev_12m = 0`. UI renders "n/a" in neutral color.
- `yoy_pct` color: green for positive, red for negative, neutral for null.

> **Dropped RPC:** `get_imports_exports_exports_serie(p_unified_products text[], p_ano_inicio, p_ano_fim)` was removed in migration `20260525000110`. Any reference to it in frontend will fail at runtime. The new RPCs cover Exports end-to-end.

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
│              │ Exports tab:                                                │
│              │   SegmentedToggle: Volume (mil m³) / Value (USD)           │
│              │   ChartSection "Exports — By Destination Country"          │
│              │     Plotly stacked area — x: YYYY-MM, stack: countries     │
│              │     Top-10 + Others. Unit: mil m³ (metric=volume) or USD   │
│              │   YoY table (entity | last 12m | prior 12m | YoY%)         │
│              │   Source note: MDIC Comex                                  │
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
- Exports tab: Volume/USD toggle (pill row). Stacked area chart at 280px height. YoY rows via `YoYCardList` (same MobileDataCard pattern as Imports panels). Source note below chart.
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
  p_ano_inicio int,
  p_ano_fim int
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

## Future Work

- **Tier 2 export upgrade**: if users request full raw `anp_desembaracos` dumps (60k–200k rows), add `get_imports_exports_export_count` RPC + `ExportModal` + `useExportSize` integration.
- **`importer_group_map` population**: after Worktree B backfill completes and real CNPJs are discovered, `worker_supabase` populates the mapping table via DML migration. Panel B then shows named groups (Vibra, Ipiranga, Raízen, etc.) instead of cleaned-up razão social strings.
- **PeriodSlider**: replace the sidebar `<select>` dropdowns with the shared `PeriodSlider` (rc-slider) component for a richer UX, once the years array is derived from `filtros.ano_min / ano_max`.
- **Panel C export**: add a 3rd sheet/CSV to the export containing the FOB price series (product, year, month, fob_per_bbl, fob_per_m3, fob_per_ton).
