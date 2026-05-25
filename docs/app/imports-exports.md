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
| Products | Diesel, Gasoline, Crude Oil (single-select radio, server-side filter) |
| Tabs | Imports (default) / Exports |

This dashboard **consolidates** the 3 deprecated dashboards:
- `/anp-daie` (sub-PRD: `docs/app/_deprecated/anp-daie.md`)
- `/anp-desembaracos` (sub-PRD: `docs/app/_deprecated/anp-desembaracos.md`)
- `/anp-painel-importacoes` (sub-PRD: `docs/app/_deprecated/anp-painel-importacoes.md`)

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

All 5 RPCs: `LANGUAGE sql / plpgsql`, `STABLE`, `SECURITY INVOKER`, granted to `anon, authenticated`. Source: migration `20260525000010_imports_exports_enrichment.sql`.

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

### `get_imports_exports_exports_serie(p_unified_products text[], p_ano_inicio, p_ano_fim)`

Returns `(ano int, mes int, produto text, volume_m3 numeric, valor_usd numeric)`.

- Filters `anp_daie.operacao = 'EXPORTAÇÃO'` (uppercase with diacritic — exact DB value).
- UI always requests all 3 products; visibility filtering is client-side via `exportsProductsVisible`.
- Volume toggle: `volume_m3 / 1e3 = mil m³`. Value toggle: `valor_usd` raw. **Labels must match divisor.**

---

## Layout — Desktop

```
┌─ DashboardHeader ─────────────────────────────────────────────────────────┐
│  Title: "Imports & Exports"                                               │
│  Sub: "Brazilian fuel trade flows — by origin country and importer group" │
│  Period badge (yyyy – yyyy)                       ExportPanel (rightSlot)  │
├───────────────────────────────────────────────────────────────────────────┤
│  SegmentedToggle: [Imports] [Exports]                                     │
├──────────────┬────────────────────────────────────────────────────────────┤
│  Sidebar     │ Imports tab:                                                │
│  (220px)     │   ChartSection "By Origin Country"                         │
│              │     Plotly stacked bar — x: YYYY-MM, stack: countries      │
│  Product     │     Unit: kt (total_kg / 1e6)                              │
│  radio       │   YoY table (entity | last 12m kt | prior 12m kt | YoY%)  │
│              │                                                             │
│  Period      │   ChartSection "By Importer (Brazil)"                      │
│  select      │     Plotly stacked bar — x: YYYY-MM, stack: importers      │
│              │     Unit: mil m³ (pre-converted by RPC)                    │
│              │   YoY table (entity | last 12m mil m³ | prior | YoY%)      │
│              │   Empty state if 0 rows (pre-backfill sentinel)             │
│              │                                                             │
│              │ Exports tab:                                                │
│              │   Product visibility pills [Diesel] [Gasoline] [Crude Oil] │
│              │   SegmentedToggle: Volume (mil m³) / Value (USD)           │
│              │   ChartSection "Exports — Fuel Trade"                      │
│              │     Plotly multi-line — 1 trace per product                │
└──────────────┴────────────────────────────────────────────────────────────┘
```

---

## Mobile Adaptation

- `MobileTabBar` for Imports / Exports.
- Sidebar collapses into `FilterDrawer` (product radio + period selects).
- Charts rendered at 280px height via Plotly (no `MobileChart` wrapper needed — Plotly itself is responsive).
- YoY rows rendered as `MobileDataCard` list (title = entity, subtitle = prior 12m, rightSlot = last 12m + YoY% in color).
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

7. **Exports tab has no country/importer dimension** — source is `anp_daie` which doesn't carry those fields. A note is shown in the UI.

---

## Future Work

- **Tier 2 export upgrade**: if users request full raw `anp_desembaracos` dumps (60k–200k rows), add `get_imports_exports_export_count` RPC + `ExportModal` + `useExportSize` integration.
- **`importer_group_map` population**: after Worktree B backfill completes and real CNPJs are discovered, `worker_supabase` populates the mapping table via DML migration. Panel B then shows named groups (Vibra, Ipiranga, Raízen, etc.) instead of cleaned-up razão social strings.
- **PeriodSlider**: replace the sidebar `<select>` dropdowns with the shared `PeriodSlider` (rc-slider) component for a richer UX, once the years array is derived from `filtros.ano_min / ano_max`.
