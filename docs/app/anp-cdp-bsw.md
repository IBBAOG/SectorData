# Sub-PRD — `/anp-cdp-bsw`

BSW by Well dashboard (Oil & Gas). Owner: [`worker_dash-anp-cdp-bsw`](../../.claude/agents/worker_dash-anp-cdp-bsw.md). Source: ANP CDP (`anp_cdp_producao`) + ANP VOIP (`anp_voip`).

> Item of the **Oil & Gas** dropdown in the NavBar (alongside `/anp-cdp` and `/anp-cdp-diaria`). One chart, one filter (field), one toggle (per-well vs field average).
>
> **Scope**: all campos (Mar + Terra) with a published VOIP in `anp_voip` are available. The previous offshore-only restriction (`local IN ('PreSal','PosSal')`) was removed in migration `20260508000015_anp_cdp_bsw_depletion_allow_onshore.sql`. Onshore/terra fields now appear alongside offshore fields in the dropdown and in all RPCs.

## Code scope

```
src/app/(dashboard)/anp-cdp-bsw/
├── page.tsx                  ← viewport router (useIsMobile → desktop | mobile)
├── useAnpCdpBswData.ts       ← THE BRAIN (RPCs, filters, derivations, chart/table)
├── desktop/View.tsx          ← desktop UX (sidebar + chart + 12-month table)
└── mobile/View.tsx           ← mobile UX (hero chart + filter chips + 12-month table)

src/lib/charts/bsw.ts         ← SHARED chart builders (also consumed by /well-by-well drill-down)
```

RPC wrappers: `rpcGetAnpCdpBswCampos`, `rpcGetAnpCdpBswScatter`, `rpcGetAnpCdpBswFieldAggregate` in [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (section "ANP CDP — BSW by Well").

### Shared chart module — `src/lib/charts/bsw.ts`

Extracted 2026-05-27 to avoid logic duplication when `/well-by-well` drill-down adds a BSW tab.

Exports:
- `buildPerWellChart(wellPoints, selectedCampos, lineStyle)` → `{ data, layout }`
- `buildFieldAverageChart(fieldPoints, selectedCampos, lineStyle)` → `{ data, layout }`
- `plotlyMode(style)` — maps `LineStyle` toggle to Plotly `mode` string
- `type AnpCdpBswPoint` — re-exported from `rpc.ts`
- `type AnpCdpBswFieldPoint` — re-exported from `rpc.ts`
- `type LineStyle` — `"markers" | "markers+lines"`

`useAnpCdpBswData.ts` imports `buildPerWellChart` and `buildFieldAverageChart` from here; `buildMobileChart` stays in the hook (mobile-only, not shared). Do not add desktop layout concerns to the mobile builder or vice versa.

## Dual-view structure

`/anp-cdp-bsw` is a **dual-view dashboard** (see [`CLAUDE.md` § Dual-view policy](../../CLAUDE.md) and [`docs/app/dual-view-pattern.md`](dual-view-pattern.md)).

| Concern | File |
|---|---|
| Viewport router (`useIsMobile`) | `page.tsx` |
| Data fetching, filters, view/style state, chart traces, 12-month table model, format helpers | `useAnpCdpBswData.ts` |
| Desktop UX — Bootstrap sidebar (`#sidebar`) with `SearchableMultiSelect`, two `SegmentedToggle`s (View, Plot style), chart via `PlotlyChart`, history table | `desktop/View.tsx` |
| Mobile UX — `MobileTopBar` + page heading + `MobileTabBar` (underline variant — View toggle) + sticky filter chips + hero `MobileChart` (leader-trace BRAND_ORANGE) + 12-month BSW table card; `FilterDrawer` with chip-cloud field picker + plot-style pills | `mobile/View.tsx` |

Both Views consume `useAnpCdpBswData()` exclusively — neither touches Supabase or `rpc.ts`. The hook is the single source of truth:

- All three RPCs (`get_anp_cdp_bsw_campos`, `get_anp_cdp_bsw_scatter`, `get_anp_cdp_bsw_field_aggregate`) run in the hook.
- Both view modes (Per well / Field average), the Plot-style toggle (Markers / Markers+lines), and the single-/multi-select rules for the field filter live in the hook.
- The hook also exposes `mobileChartTraces` (layout-less, mobile-tuned: 12-well cap, BRAND_ORANGE leader, smaller markers), `chart` (desktop-tuned with full layout), `tableModel` (12-month history), `fmtBsw` / `fmtDelta` / `computeDeltas` helpers — so both views render the same numbers from the same code path.

**Binding sync rule**: any meaningful change to one View (new filter, chart, KPI, copy) lands in the OTHER View in the SAME commit, OR the commit message declares `[desktop-only]` / `[mobile-only]` with an explicit reason.

### Mobile-specific adaptations (mobile is "same analysis, adapted clothing")

| Adaptation | Reason |
|---|---|
| 12-well cap in `Per well` mode trace count | Mobile chart is ~340px wide — beyond 12 traces the legend collapses and the curves become indistinguishable |
| Leader trace gets `BRAND_ORANGE` (instead of palette index 0) | Mobile mockup parity (`mockups/anp-cdp-mobile.html`); the desktop sidebar already uses palette index for swatches, so this is a mobile-only visual emphasis |
| Chip-cloud field picker (instead of `SearchableMultiSelect` dropdown) | Touch-friendly; chip swatches double as color legend |
| Plot-style toggle moves into the `FilterDrawer` | Mobile viewport doesn't have room for two visible toggles |
| Per-well legend hint ("N wells in this field") rendered below chart instead of in the sidebar | Sidebar doesn't exist on mobile |
| No `ExportFAB` | Same as desktop — this dashboard has no export by design |

## Product

Plots **BSW (water cut)** versus a depletion / age proxy that depends on the view mode:

| View | X axis | Granularity | RPC | Renderer | Trace style |
|---|---|---|---|---|---|
| **Per well** (default) | months since first production for that well | one point per (well × month) | `get_anp_cdp_bsw_scatter` | `scattergl` (WebGL) | mode driven by Plot-style toggle, marker size 4, opacity 0.7 |
| **Field average** | **% of VOIP recovered** for that field (cumulative oil ÷ VOIP) | one point per (field × calendar month), volume-weighted across wells | `get_anp_cdp_bsw_field_aggregate` | `scatter` (SVG, low volume) | mode driven by Plot-style toggle, marker size 6 |

**Plot-style toggle** — sidebar `SegmentedToggle` with two options: **Markers** and **Markers + lines** (default). The toggle is shared by both views: switching between Per well and Field average preserves the chosen plot style. The Plotly `mode` is `"markers"` or `"lines+markers"` accordingly. Renderer choice (`scattergl` vs `scatter`) is independent of the toggle: per-well stays on WebGL even with lines (Chrome/Firefox handle this fine; performance is preferred over edge-case compatibility).

Each selected field is rendered as its own colored trace using the shared 16-color `PALETTE`, in selection order. Colors are stable while a session is open (the chart-trace color matches the chip color in the sidebar).

- **Y axis**: `BSW = agua_bbl_dia / (petroleo_bbl_dia + agua_bbl_dia)` (auto-scaled, minimum pinned at 0 via `rangemode: "tozero"`, formatted as percentage). The range is **not** fixed at 0–100%: Plotly scales the ceiling to the data, so early-stage or low-water-cut fields (BSW < 10%) use the full vertical resolution instead of being compressed at the bottom.
- **X axis (Per-well mode)**: months since the first month where `petroleo_bbl_dia > 0` for that well (linear, `rangemode: "tozero"`).
- **X axis (Field-average mode)**: `pct_voip = cumulative(petroleo_bbl_dia × dias_do_mês) / voip_bbl_atual`, formatted with `tickformat: ",.1%"`. This is a more physical/geological X than raw time and lets fields of very different sizes share a comparable depletion curve. Plotly auto-ranges the axis — most fields stay in `[0, 1]` but a value can occasionally exceed 100% if the published VOIP is conservative; the auto-range absorbs that without clipping.
- **Single filter**: searchable multi-select of field (`campo`), in a left sidebar. **Fields without a corresponding row in `anp_voip` are hidden from the dropdown** (the field-aggregate RPC inner-joins against `anp_voip` and `get_anp_cdp_bsw_campos` mirrors that filter).
- **No export, no period slider, no additional filters** — by design.

When no field is selected, the chart renders an instructional empty state ("Select one or more fields to plot BSW evolution.").

### Tooltips

- **Per well**: well code, reference month (`ano-mm`), BSW, and months-since-start.
- **Field average**: field name, **reference month** (`ref_ano-ref_mes`, the most recent calendar month among contributors to that aggregate point — argmax of `ano*12+mes`), VOIP recovered (`pct_voip`), volume-weighted BSW, cumulative oil in bbl (stock, not converted), wells active, and daily volume in **kbpd** (thousand barrels per day — converted from `volume_total` bbl/day at customdata-pack time).

## Layout

Two-column layout matching `/anp-cdp` and `/anp-cdp-diaria` (Bootstrap `col-xxl-2 col-md-3` sidebar + `col-xxl-10 col-md-9` content):

```
┌──────────────┬────────────────────────────────────────────┐
│  Sidebar     │  DashboardHeader                           │
│  (Filters)   │                                            │
│              │                       [Per well | Field avg] │
│  - Field     │  ┌────────────────────────────────────┐    │
│    [search]  │  │                                    │    │
│              │  │            Plotly chart            │    │
│  - Selected  │  │                                    │    │
│    chips     │  └────────────────────────────────────┘    │
└──────────────┴────────────────────────────────────────────┘
```

The "Selected fields" section in the sidebar shows colored chips matching the chart trace colors — useful when the legend is dense.

## RPCs

| RPC | Type | Purpose |
|---|---|---|
| `get_anp_cdp_bsw_campos()` | own (sidebar dropdown) | Returns an alphabetically ordered `text[]` of all field names (Mar + Terra) **that have a published VOIP in `anp_voip`**. Source for the sidebar's field multi-select. |
| `get_anp_cdp_bsw_scatter(p_campos text[], p_expand_canonical bool DEFAULT false)` | own (per-well view) | Returns one row per (well × month) for the filtered fields, with server-computed `bsw` and `mes_desde_t0`. Capped at 500k points server-side. **`p_expand_canonical` (default `false`):** when `true`, expands `p_campos` via the `canonical_field_name()` helper (Round 4 of `/well-by-well`) — every field whose canonical matches any input is included (e.g. `p_campos=['TUPI']` aggregates `{TUPI, SUL DE TUPI, AnC_TUPI}`). Dashboard `/anp-cdp-bsw` always uses the default `false` — standalone behavior is unchanged. |
| `get_anp_cdp_bsw_field_aggregate(p_campos text[], p_expand_canonical bool DEFAULT false)` | own (field-average view) | Returns one row per (field × calendar month) with volume-weighted BSW, well count, daily volume, **cumulative oil produced** (in bbl), **% of VOIP recovered** (`cumulative_oil_bbl / voip_bbl`), and the reference (`ref_ano`, `ref_mes`). Inner-joins against `anp_voip` so fields without a published VOIP are silently dropped. Low-volume output (one row per calendar month per field). Same `p_expand_canonical` semantics as the scatter variant — `/anp-cdp-bsw` uses default `false`; `/well-by-well` drill-down popup uses `true` via the wrapper `rpcGetAnpCdpBswFieldAggregateCanonical`. |

> **Cross-dashboard usage (Phase 2 of `/well-by-well` drill-down, 2026-05-30):** the 2 BSW RPCs are now also consumed by the BSW tab of the field drill-down modal in `/well-by-well`, through canonical-aware wrappers in `src/lib/rpc.ts` (`rpcGetAnpCdpBswScatterCanonical` / `rpcGetAnpCdpBswFieldAggregateCanonical`) that pass `p_expand_canonical=true`. The chart builders `buildPerWellChart` and `buildFieldAverageChart` were extracted into [`src/lib/charts/bsw.ts`](../../src/lib/charts/bsw.ts) so both dashboards render with identical visual logic — any change to the builders affects both call sites. Migration: [`supabase/migrations/20260530000000_cdp_rpcs_canonical_expansion.sql`](../../supabase/migrations/20260530000000_cdp_rpcs_canonical_expansion.sql).

### Output contracts

```ts
type AnpCdpBswPoint = {
  poco: string;          // well identifier (e.g. "1-RJS-001")
  campo: string;         // field name (used to colorize trace)
  mes_desde_t0: number;  // 0, 1, 2, ... months since first production
  bsw: number;           // 0..1 water cut
  ano: number;           // calendar year of the data point
  mes: number;           // calendar month (1..12) of the data point
};

type AnpCdpBswFieldPoint = {
  campo: string;
  pct_voip: number;            // cumulative_oil_bbl / voip_bbl, fraction 0..1
  bsw: number;                 // 0..1 (volume-weighted across wells)
  n_pocos: number;             // wells contributing at this reference month
  volume_total: number;        // total liquid (oil + water) volume — weight used
  cumulative_oil_bbl: number;  // cumulative oil up to ref_ano/ref_mes (bbl)
  ref_ano: number;             // reference year (argmax of ano*12+mes among contributors)
  ref_mes: number;             // reference month (argmax of ano*12+mes among contributors)
};
```

The wrappers pass `{ p_campos: string[] }` and return `AnpCdpBswPoint[]` / `AnpCdpBswFieldPoint[]` (or `[]` on RPC error).

## Tables / Views

| Object | Volume | Populated by |
|---|---|---|
| `anp_cdp_producao` | ~1.8M rows | ETL `scripts/pipelines/anp/cdp/01_extract.py` (Selenium + ddddocr CAPTCHA) → `02_upload.py` |
| `anp_voip` | ~hundreds of rows (one per field × year) | ETL `scripts/pipelines/anp/voip_sync.py` — pulls the yearly VOIP (Volume Original In Place) bulletin from ANP. The field-aggregate RPC joins to the **most recent** VOIP per field. |

Schema columns relevant to this dashboard: `poco, campo, ano, mes, petroleo_bbl_dia, agua_bbl_dia`. The per-well RPC computes BSW and `mes_desde_t0` server-side via window functions on `(poco)` ordered by `(ano, mes)`. The aggregate RPC groups by `(campo, ano, mes)` weighting BSW by `(petroleo_bbl_dia + agua_bbl_dia)`, accumulates oil as `petroleo_bbl_dia × dias_do_mês` over `(ano, mes)`, and divides by the latest `voip_bbl` from `anp_voip` to yield `pct_voip`.

## Filters available (UI)

| Filter | Component | Behavior |
|---|---|---|
| Field | `SearchableMultiSelect` (in sidebar) | Server-side via `p_campos`. Empty selection → empty state. Each selected field gets a color from `PALETTE` in selection order. The "Selected fields" section below lists chips with the same colors. |
| View mode | `SegmentedToggle` (sidebar) | "Per well" (default) calls `get_anp_cdp_bsw_scatter`; "Field average" calls `get_anp_cdp_bsw_field_aggregate`. Both fetches are debounced 400ms via `useDebouncedFetch`. |
| Plot style | `SegmentedToggle` (sidebar, below View) | "Markers" or "Markers + lines" (default). Pure client-side: maps to Plotly `mode: "markers"` vs `"lines+markers"` on every trace. Shared by both views — preserves choice when switching Per well ↔ Field average. |

## Reused components

- [`DashboardHeader`](../../src/components/dashboard/DashboardHeader.tsx) — title + subtitle, no period badge, no rightSlot (no export).
- [`SearchableMultiSelect`](../../src/components/SearchableMultiSelect.tsx) — search + multi-checkbox dropdown for the field list (handles hundreds of fields without UI clutter).
- [`SegmentedToggle`](../../src/components/dashboard/SegmentedToggle.tsx) — `compact` variant for the per-well/field-average pill, positioned above the chart, right-aligned.
- [`ChartSection`](../../src/components/dashboard/ChartSection.tsx) — chart wrapper with "updating…" hint while debounced fetch is in flight.
- [`PlotlyChart`](../../src/components/PlotlyChart.tsx) — `type: "scattergl"` for per-well, `type: "scatter"` for field average.
- [`BarrelLoading`](../../src/components/dashboard/BarrelLoading.tsx) — initial filter-list spinner.
- [`useModuleVisibilityGuard("anp-cdp-bsw")`](../../src/hooks/useModuleVisibilityGuard.ts) — role/visibility guard.
- [`useDebouncedFetch`](../../src/hooks/useDebouncedFetch.ts) — 400ms debounce on field-selection / view-mode changes (one hook per view).
- [`PALETTE`](../../src/lib/plotlyDefaults.ts) — shared 16-color palette (consistent with `/imports-exports`).

Sidebar visual classes (`#sidebar`, `.sidebar-section-label`, `.sidebar-filter-section`, `.sidebar-filter-label`) come from `src/app/globals.css` — same identity as `/anp-cdp`.

## Cross-dept dependencies

| Source | How it depends |
|---|---|
| `worker_supabase` | Owns the `get_anp_cdp_bsw_campos`, `get_anp_cdp_bsw_scatter` and `get_anp_cdp_bsw_field_aggregate` SQL functions, the `anp_voip` table + RLS, and the `module_visibility` row for `anp-cdp-bsw`. The aggregate function was delivered in migration `20260508000003_anp_cdp_bsw_aggregate.sql`; the previous offshore restriction was introduced in `20260508000004_anp_cdp_bsw_offshore.sql` and **reverted** in `20260508000015_anp_cdp_bsw_depletion_allow_onshore.sql`. |
| ETL (`scripts/pipelines/anp/cdp/` and `scripts/pipelines/anp/voip_sync.py`) | Populates `anp_cdp_producao` monthly and `anp_voip` yearly. Schema/columns must include `petroleo_bbl_dia`, `agua_bbl_dia`. The `voip_sync.py` pipeline parses ANP's annual VOIP bulletin and upserts into `anp_voip`. |
| `worker_dash-admin` | Visibility toggle in `/admin-panel` + home image. |
| Designer | Visual identity (Arial 12, brand orange `#FF5000`, axis line style, sidebar section/label classes). |

## Performance / limitations

- **Per-well server-side cap**: `get_anp_cdp_bsw_scatter` returns at most ~500k points. With many fields selected (e.g., a basin with hundreds of wells over ~20 years of monthly data), that cap can be hit; `mes_desde_t0` and `bsw` are pre-computed in SQL so the client does no heavy work.
- **`scattergl` renderer**: WebGL-backed Plotly trace, scales to hundreds of thousands of markers without DOM-node explosion.
- **Field-average is low-volume**: one row per (field × month-since-t0) — a few hundred points total. We use plain `scatter` (SVG) with `lines+markers` for crisp line rendering.
- **Two independent fetches**: per-view useDebouncedFetch hooks each guard with `viewMode !== "<their-view>" → []`, so the inactive view doesn't fire requests when the user toggles.
- **Debounce 400ms** on field selection / view-mode change — avoids hammering the DB during checkbox bursts.
- **No export by design** — for analyses that need raw data, use `/anp-cdp` (Tier 2 export with all dimensions).

## Display units (kbpd vs raw bbl/day)

The Field-average tooltip's **Daily volume** is shown in **kbpd** (thousand barrels per day). The aggregate RPC `get_anp_cdp_bsw_field_aggregate` continues to emit `volume_total` in raw **bbl/day**; the page divides by 1000 via `bblDiaToKbpd()` from [`src/lib/units.ts`](../../src/lib/units.ts) when packing Plotly customdata, and the hovertemplate formats with 1 decimal in kbpd. The BSW ratio itself is dimensionless and unaffected by the display unit. `cumulative_oil_bbl` is a stock (not a flow) and stays in raw bbl on the tooltip.

## Anti-patterns

- Calling `anp_cdp_producao` directly from the client. Always go through one of the two RPCs.
- Multiplying `bsw` by 100 in the front-end — `tickformat: ",.0%"` already formats the 0..1 range as a percentage.
- Adding an `ExportPanel` "for symmetry" with the rest of `/anp-*` — this dashboard intentionally has no export.
- Adding a `PeriodSlider` — the X axis IS depletion (% VOIP recovered) or well-age (months since first production), never calendar time, so a calendar period slider is meaningless here.
- Multiplying `pct_voip` by 100 in the front-end — `tickformat: ",.1%"` already formats the 0..1 range as a percentage on the axis, and `:.1%` does the same in the hovertemplate.
- Re-fetching the filtros list on every render — it loads once on mount.
- Re-using `MultiSelectFilter` for the field list — with hundreds of fields the horizontal grid becomes unusable; prefer `SearchableMultiSelect`.
- Using `scattergl` for the field-average view — its volume is too low to justify WebGL, and lines render crisper in SVG.
