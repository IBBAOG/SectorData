# Sub-PRD — `/anp-cdp-depletion`

ANP CDP — Depletion dashboard (Oil & Gas). Owner: [`worker_dash-anp-cdp-depletion`](../../.claude/agents/worker_dash-anp-cdp-depletion.md).

> Item of the **Oil & Gas** dropdown in the NavBar (alongside `/anp-cdp`, `/anp-cdp-diaria`, and `/anp-cdp-bsw`). One chart, one filter (field), three toggles (View, X axis, Plot style), plus reactive Recent / Prior period inputs that drive both the chart Y axis (rolling depletion %) and the comparison table.

## Code scope

```
src/app/(dashboard)/anp-cdp-depletion/
  page.tsx
```

RPC wrappers: `rpcGetAnpCdpDepletionCampos`, `rpcGetAnpCdpDepletionScatter`, `rpcGetAnpCdpDepletionFieldAggregate` in [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (section "ANP CDP — Depletion").

## Product

Plots **rolling depletion %** of uptime-normalized monthly oil production (NP) versus time, with two view modes and two X-axis options. The Y axis is computed entirely client-side from the NP series returned by the RPCs (no SQL change).

### NP formula (server-side)

NP normalizes monthly production for the share of the month the well was actually running and expresses the result as a **per-day** flow in **kbpd** (thousand barrels per day). It answers: "what is the well's average daily flow over the days it was actually producing?"

```
Per well:
  np_bbl_mes = (petroleo_bbl_dia × dias_cal × dias_cal × 24)
             / NULLIF(tempo_prod_hs_mes, 0)            -- intermediate, monthly bbl
  np_kbpd    = (np_bbl_mes / (tempo_prod_hs_mes / 24)) / 1000

Per field (aggregate):
  np_kbpd    = sum(np_poco_bbl_mes) × 24
             / (sum(hs_op_poco) × 1000)
```

Where:
- `petroleo_bbl_dia` — average daily oil production reported for the month (bbl/day, but only over the hours the well was up).
- `dias_cal` — calendar days in the month (28..31).
- `dias_cal × 24` — calendar hours in the month.
- `tempo_prod_hs_mes` (`hs_op`) — actual production hours in the month.

The intermediate `np_bbl_mes` first scales the reported daily flow up by `dias_cal × 24 / tempo_prod_hs_mes` (the inverse of the uptime fraction). Dividing again by the actual production days `(tempo_prod_hs_mes / 24)` yields a per-day flow that is normalized by **days produced**, not by calendar days. Finally, `/ 1000` converts to kbpd. When `tempo_prod_hs_mes = 0` the row produces NULL (filtered upstream).

For the field-aggregate view the total monthly bbl across active wells is divided by the total production days across the same wells (and then by 1000), so the field-level kbpd represents the mean per-day flow weighted by each well's uptime.

> **Breaking change (2026-05-08).** The RPCs `get_anp_cdp_depletion_scatter` and `get_anp_cdp_depletion_field_aggregate` were updated to return `np_kbpd` (in kbpd) **in place of** the legacy column `np_bbl_mes` (monthly bbl). Frontend types `AnpCdpDepletionPoint` / `AnpCdpDepletionFieldPoint` and the table renderer were updated accordingly. The chart Y axis is unchanged because rolling depletion is a ratio, but the table columns are now displayed as kbpd with two decimals.

### Rolling depletion (Y axis, client-side)

For each item (well or field) and each reference month `t` in its series:

```
recent_window  = NP at points [t − N + 1 … t]      (N most recent available points up to t)
prior_window   = NP at points [t − N − M + 1 … t − N]   (M points immediately before recent)
avg_recent_t   = mean(NP, recent_window)
avg_prior_t    = mean(NP, prior_window)
depletion_t    = (avg_recent_t − avg_prior_t) / avg_prior_t
```

`N = recentMonths`, `M = priorMonths` from the sidebar inputs (1..60 each, defaults `12 / 12`).

A point `t` is rendered on the chart **only when both windows are full**, i.e. the item has at least `N + M` points up to and including `t`. Points without a full back-history are silently omitted from the chart (they still contribute to the Depletion comparison table at the latest month).

> **Caveat on calendar gaps.** Windows are over the N+M most recent **available** points in the series, not over N+M consecutive **calendar** months. ANP CDP series can have gaps (a well stops for one or more months). Treating gaps as missing-data is acceptable for v1 — the alternative would be to fill missing months with 0, which would skew the averages downward. A future iteration may move this computation server-side with calendar-aware windows.

The Y axis uses Plotly `tickformat: ",.1%"` and shows a zero line. Hovertemplate displays `Depletion: %{y:.2%}` with the reference month and (in % VOIP mode) the VOIP fraction.

The helper is implemented as `rollingDepletion(items, nRecent, nPrior)` in `page.tsx`. It is called once per series during chart memoization; the depletion is keyed by `(ano, mes)` so the % VOIP X mode can re-sort rendered points by `pct_voip` without losing the calendar-anchored computation.

### View modes

| View | Granularity | RPC | Renderer | Trace style |
|---|---|---|---|---|
| **Per well** (default) | one point per (well × month) | `get_anp_cdp_depletion_scatter` | `scattergl` (WebGL) | mode driven by Plot-style toggle, marker size 4, opacity 0.7 |
| **Field average** | one point per (field × calendar month), summed across active wells | `get_anp_cdp_depletion_field_aggregate` | `scatter` (SVG, low volume) | mode driven by Plot-style toggle, marker size 6 |

In Field-average mode the underlying NP metric is **summed**, not averaged: it's the field's total uptime-normalized monthly production across all reporting wells. `n_pocos` and `pct_voip` are emitted alongside for context (tooltip + table). The chart Y axis is then the rolling depletion of that field-level NP sum (computed client-side per the formula above).

### X-axis toggle

| Option | When available | Meaning |
|---|---|---|
| **Calendar** (default) | both views | calendar date `YYYY-MM-01` (Plotly `xaxis.type = "date"`) |
| **% VOIP recovered** | both views | `cumulative_oil_bbl / voip_bbl` of the field for the row's `(ano, mes)`, formatted `,.1%` (Plotly `xaxis.type = "linear"`) |

In **Field-average** mode the X coordinate is the field's own `pct_voip` for that calendar month. In **Per-well** mode each point inherits `pct_voip_poco` — the same field-level fraction propagated from `voip_latest` per `(campo, ano, mes)` — so all wells of a field share the X scale used by the Field-average view. Points whose `pct_voip_poco` is null (no VOIP record for the field) are dropped from the % VOIP plot but still rendered in Calendar mode. The toggle value is independent of the view-mode toggle.

### Plot-style toggle

`SegmentedToggle` with **Markers** and **Markers + lines** (default). The toggle is shared by both views and maps to Plotly `mode` `"markers"` or `"lines+markers"`. Renderer choice (`scattergl` vs `scatter`) is independent of the toggle.

### Period comparison

Two number inputs in the sidebar:

| Input | Default | Range |
|---|---|---|
| **Recent (m)** | 12 | 1..60 |
| **Prior (m)** | 12 | 1..60 |

These windows feed **both** the chart Y axis (rolling depletion %) and the **Depletion comparison** table below the chart. Changes are reactive — no extra RPC fetch; `useMemo` recomputes the chart synchronously.

#### Date-range helper text

Directly below the two inputs (and before the **Filters** section) the page renders a dynamic helper that resolves the absolute calendar months the windows map to, using the latest `(ano, mes)` available in the currently fetched points (`wellPoints` in Per-well mode, `fieldPoints` in Field-average mode).

Format:

```
Comparing last N months (YYYY-MM → YYYY-MM)
vs prior M months (YYYY-MM → YYYY-MM).
```

Example — if the latest data is `2026-04`, `recent = 12`, `prior = 24`:

```
Comparing last 12 months (2025-05 → 2026-04)
vs prior 24 months (2023-05 → 2025-04).
```

Empty / loading state (no field selected, or fetch hasn't returned yet):

```
Select a field to see the comparison range.
```

When at least one selected item has a shorter history than the prior window (its earliest `(ano, mes)` is later than `prior_start`), a subtle clipping warning is appended on a second line (color `#b8860b`):

```
Prior window clipped to K months for "<item>" (data starts YYYY-MM) — limited window.
```

The helper recomputes synchronously whenever `recentMonths`, `priorMonths`, `viewMode`, or the active points list changes. It does not affect the table calculation — the table still slices `series.slice(-nRecent)` / `series.slice(priorStart, priorEnd)`; the helper only mirrors those slices in absolute calendar terms for the user.

Style: `font-size: 11px; color: #666; font-family: Arial; margin-top: 6px; line-height: 1.4`, matching the other sidebar hints (e.g. "Each field gets a chart color in selection order").

### Depletion comparison table

| Item | NP last month (kbpd) | Avg recent (Nm, kbpd) | Avg prior (Mm, kbpd) | Depletion % | YoY % |

Where:
- **Item** — well code (Per-well) or field name (Field average), with the chart trace's color swatch.
- **NP last month (kbpd)** — `np_kbpd` of the latest month available for that item.
- **Avg recent (Nm, kbpd)** — `mean(np_kbpd)` over the last `recentMonths` points (chronological tail).
- **Avg prior (Mm, kbpd)** — `mean(np_kbpd)` over the `priorMonths` points immediately preceding the recent slice.
- **Depletion %** — `(avg_recent − avg_prior) / avg_prior × 100` (ratio — unit-independent).
- **YoY %** — `(NP_last / NP_last_minus_12 − 1) × 100`, where `NP_last_minus_12` is the NP exactly 12 calendar months before the latest available month (calendar lookup in the series, not positional).

#### Color semantics (INVERSE of `/anp-cdp-bsw`)

For NP, **rising = good** (the asset is producing more): green (`#28a745`).
**Falling = depletion**: red (`#dc3545`).

This is the opposite of BSW where falling water-cut is good. The page's `fmtDelta` helper hard-codes this inversion.

NP values are formatted as `,.2f kbpd` (two decimals — field-typical kbpd ranges from 0.5 to ~500). Percentages use 2 decimals with a leading sign for positives.

### Tooltips

- **Per well — Calendar**: well code, reference month (`ano-mm`), depletion as `%{y:.2%}`.
- **Per well — % VOIP recovered**: well code, reference month, % VOIP recovered (formatted `,.1%`), depletion as `%{y:.2%}`.
- **Field average — Calendar / % VOIP**: field name, reference month, depletion as `%{y:.2%}`, wells active, VOIP recovered, cumulative oil in bbl.

When no field is selected, the chart renders an instructional empty state ("Select one or more fields to plot rolling depletion.").

## Layout

Two-column layout matching `/anp-cdp-bsw` (Bootstrap `col-xxl-2 col-md-3` sidebar + `col-xxl-10 col-md-9` content):

```
┌──────────────┬────────────────────────────────────────────┐
│  Sidebar     │  DashboardHeader                           │
│              │                                            │
│  - View      │  ┌────────────────────────────────────┐    │
│  - X axis    │  │            Plotly chart            │    │
│  - Plot style│  └────────────────────────────────────┘    │
│  - Period    │                                            │
│    [recent]  │  Depletion comparison                      │
│    [prior]   │  ┌────────────────────────────────────┐    │
│  - Field     │  │  Item | NP last | recent | prior |…│    │
│  - Selected  │  └────────────────────────────────────┘    │
│    chips     │                                            │
└──────────────┴────────────────────────────────────────────┘
```

The "Selected fields" section in the sidebar shows colored chips matching the chart trace colors.

## RPCs

| RPC | Type | Purpose |
|---|---|---|
| `get_anp_cdp_depletion_campos()` | own (sidebar dropdown) | Returns alphabetically ordered `text[]` of all field names (Mar + Terra) that have a published VOIP in `anp_voip`. The previous offshore-only restriction (`local IN ('PreSal','PosSal')`) was removed in migration `20260508000015_anp_cdp_bsw_depletion_allow_onshore.sql`. |
| `get_anp_cdp_depletion_scatter(p_campos text[])` | own (per-well view) | Returns one row per (well × month) for the filtered fields, with server-computed `np_kbpd` (uptime-normalized daily flow, kbpd) and `mes_desde_t0`. RETURNS TABLE. Capped at 500k points server-side. |
| `get_anp_cdp_depletion_field_aggregate(p_campos text[])` | own (field-average view) | Returns one row per (field × calendar month) with `np_kbpd` (field-aggregate kbpd), `n_pocos`, `pct_voip` (cumulative oil ÷ VOIP), and `cumulative_oil_bbl`. RETURNS jsonb (single row, single column) to bypass PostgREST default `max_rows=1000`. |

### Output contracts

```ts
type AnpCdpDepletionPoint = {
  poco: string;
  campo: string;
  ano: number;
  mes: number;
  mes_desde_t0: number;        // months since first month with petroleo_bbl_dia > 0
  np_kbpd: number;             // uptime-normalized daily oil production, kbpd (RENAMED from np_bbl_mes — breaking change 2026-05-08)
  pct_voip_poco: number | null; // field-level VOIP fraction inherited per (campo, ano, mes); null only when the field has no VOIP record
};

type AnpCdpDepletionFieldPoint = {
  campo: string;
  ano: number;
  mes: number;
  np_kbpd: number;             // field-aggregate uptime-normalized daily oil production, kbpd (RENAMED from np_bbl_mes — breaking change 2026-05-08)
  n_pocos: number;             // wells contributing in this calendar month
  pct_voip: number;            // cumulative_oil_bbl / voip_bbl, fraction 0..1
  cumulative_oil_bbl: number;  // cumulative oil up to (ano,mes), bbl
};
```

The `Scatter` wrapper passes `{ p_campos: string[] }` and uses `.limit(500000)`. The `FieldAggregate` wrapper passes the same param but **does not** call `.limit()` — the response is a single jsonb row that supabase-js automatically deserializes into the array.

## Tables / Views

| Object | Volume | Populated by |
|---|---|---|
| `anp_cdp_producao` | ~1.8M rows | ETL `scripts/pipelines/anp/cdp/01_extract.py` (Selenium + ddddocr CAPTCHA) → `02_upload.py` |
| `anp_voip` | ~hundreds of rows (one per field × year) | ETL `scripts/pipelines/anp/voip_sync.py` — yearly VOIP bulletin from ANP. The field-aggregate RPC inner-joins to the most recent VOIP per field. |

Schema columns relevant to this dashboard: `poco, campo, ano, mes, petroleo_bbl_dia, tempo_prod_hs_mes`. The per-well RPC computes the intermediate `np_bbl_mes` then divides by the well's actual production days `(tempo_prod_hs_mes / 24)` and by 1000 to yield `np_kbpd`; `mes_desde_t0` is computed via window functions on `(poco)` ordered by `(ano, mes)`. The aggregate RPC computes `np_kbpd` per `(campo, ano, mes)` as `sum(np_poco_bbl_mes) × 24 / (sum(hs_op_poco) × 1000)`, accumulates oil as `petroleo_bbl_dia × dias_do_mês` over `(ano, mes)`, and divides by the latest `voip_bbl` from `anp_voip` to yield `pct_voip`.

## Filters available (UI)

| Filter | Component | Behavior |
|---|---|---|
| Field | `SearchableMultiSelect` (in sidebar) | Server-side via `p_campos`. Empty selection → empty state. Each selected field gets a color from `PALETTE` in selection order. The "Selected fields" section below lists chips with the same colors. |
| View mode | `SegmentedToggle` (sidebar) | "Per well" (default) calls `get_anp_cdp_depletion_scatter`; "Field average" calls `get_anp_cdp_depletion_field_aggregate`. Both fetches are debounced 400ms via `useDebouncedFetch`. |
| X axis | `SegmentedToggle` (sidebar) | "Calendar" (default) or "% VOIP recovered". Pure client-side. Both options apply to both view modes — Per-well points inherit `pct_voip_poco` from the field-level VOIP fraction. |
| Plot style | `SegmentedToggle` (sidebar) | "Markers" or "Markers + lines" (default). Pure client-side. |
| Period comparison | Two number inputs (sidebar) | Recent / Prior windows in months (1..60 each). Drives **both** the chart Y axis (rolling depletion %) and the depletion table — no extra fetch. |

## Reused components

- [`DashboardHeader`](../../src/components/dashboard/DashboardHeader.tsx) — title + subtitle, no period badge, no rightSlot (no export).
- [`SearchableMultiSelect`](../../src/components/SearchableMultiSelect.tsx) — search + multi-checkbox dropdown for the field list.
- [`SegmentedToggle`](../../src/components/dashboard/SegmentedToggle.tsx) — pill toggles for View, X axis, and Plot style.
- [`ChartSection`](../../src/components/dashboard/ChartSection.tsx) — chart wrapper with "updating…" hint while debounced fetch is in flight.
- [`PlotlyChart`](../../src/components/PlotlyChart.tsx) — `type: "scattergl"` for per-well, `type: "scatter"` for field average.
- [`BarrelLoading`](../../src/components/dashboard/BarrelLoading.tsx) — initial filter-list spinner.
- [`useModuleVisibilityGuard("anp-cdp-depletion")`](../../src/hooks/useModuleVisibilityGuard.ts) — role/visibility guard.
- [`useDebouncedFetch`](../../src/hooks/useDebouncedFetch.ts) — 400ms debounce on field-selection / view-mode changes (one hook per view).
- [`PALETTE`](../../src/lib/plotlyDefaults.ts) — shared 16-color palette.

Sidebar visual classes (`#sidebar`, `.sidebar-section-label`, `.sidebar-filter-section`, `.sidebar-filter-label`) come from `src/app/globals.css`.

## Cross-dept dependencies

| Source | How it depends |
|---|---|
| `worker_supabase` | Owns the `get_anp_cdp_depletion_campos`, `get_anp_cdp_depletion_scatter`, and `get_anp_cdp_depletion_field_aggregate` SQL functions, and the `module_visibility` row for `anp-cdp-depletion`. Reuses the `anp_voip` table introduced for `/anp-cdp-bsw`. The offshore-only restriction was **reverted** in migration `20260508000015_anp_cdp_bsw_depletion_allow_onshore.sql` — all campos (Mar + Terra) are now included. |
| ETL (`scripts/pipelines/anp/cdp/` and `scripts/pipelines/anp/voip_sync.py`) | Populates `anp_cdp_producao` monthly and `anp_voip` yearly. Schema must include `petroleo_bbl_dia` and `tempo_prod_hs_mes` for NP to be computable. |
| `worker_dash-admin` | Visibility toggle in `/admin-panel` + home image. |
| Designer | Visual identity (Arial 12, brand orange `#FF5000`, axis line style, sidebar section/label classes). |

## Performance / limitations

- **Per-well server-side cap**: `get_anp_cdp_depletion_scatter` returns at most ~500k points.
- **`scattergl` renderer**: WebGL-backed Plotly trace, scales to hundreds of thousands of markers.
- **Field-average is low-volume**: a few hundred points total; `scatter` (SVG) renders crisper lines.
- **Two independent fetches**: per-view useDebouncedFetch hooks each guard with `viewMode !== "<their-view>" → []`.
- **Debounce 400ms** on field selection / view-mode change.
- **Period inputs are client-only**: no fetch round-trip when adjusting Recent/Prior windows. Both the chart (rolling depletion Y) and the table recompute via `useMemo` on the cached series.
- **No export by design** — for analyses that need raw data, use `/anp-cdp` (Tier 2 export with all dimensions).

## Display units (kbpd)

This dashboard now reports NP as a per-day flow in **kbpd** (thousand barrels per day), aligning with the rest of the Oil & Gas dashboards (`/anp-cdp`, `/anp-cdp-diaria`, `/anp-cdp-bsw`):

- **Y axis** is rolling **depletion %** (a unitless ratio — unaffected by the unit change).
- **NP** values (table columns "NP last month (kbpd)", "Avg recent (Nm, kbpd)", "Avg prior (Mm, kbpd)") are uptime-normalized **per-day** flows in kbpd, formatted as `,.2f kbpd` via `fmtNp`. Two decimals are sufficient because field-typical kbpd ranges from 0.5 to ~500.
- **Cumulative oil** in field-average tooltips is still a stock measured in **bbl total**, kept as-is.

Historical note: prior to 2026-05-08 the RPCs returned `np_bbl_mes` (uptime-normalized monthly bbl); the table headers were "NP last month / Avg recent N / Avg prior M" with values formatted as `k/M/B bbl`. The migration to `np_kbpd` is a breaking change in the RPC signature.

## Anti-patterns

- Calling `anp_cdp_producao` directly from the client. Always go through one of the three RPCs.
- Computing NP client-side. The formula is owned by `worker_supabase` — request changes via the Subgerente. Note: rolling depletion **is** computed client-side, on top of NP returned by the RPC, because it depends on UI-controlled window sizes.
- Adding an `ExportPanel` "for symmetry" with the rest of `/anp-*` — this dashboard intentionally has no export (consistent with `/anp-cdp-bsw`).
- Adding a `PeriodSlider` — the Recent / Prior inputs in the sidebar already drive the comparison; calendar slicing of NP itself is not in scope (use `/anp-cdp` for that).
- Using the BSW color convention (red for rising, green for falling). For NP it is **inverted**: green for rising, red for falling. `fmtDelta` in `page.tsx` hard-codes this and should not be re-used between BSW and Depletion.
- Re-fetching the campos list on every render — it loads once on mount.
- Re-using `MultiSelectFilter` for the field list — with hundreds of fields the horizontal grid becomes unusable; prefer `SearchableMultiSelect`.
- Calling `.limit(500000)` on the field-aggregate wrapper — that RPC returns a single jsonb row; `.limit()` would interfere. Only the per-well wrapper uses `.limit(500000)`.
- Using `scattergl` for the field-average view — its volume is too low to justify WebGL.
