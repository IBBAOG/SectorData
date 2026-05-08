# Sub-PRD — `/anp-cdp-bsw`

ANP CDP — BSW by Well dashboard (Oil & Gas). Owner: [`worker_dash-anp-cdp-bsw`](../../.claude/agents/worker_dash-anp-cdp-bsw.md).

> Item of the **Oil & Gas** dropdown in the NavBar (alongside `/anp-cdp` and `/anp-cdp-diaria`). One chart, one filter (field), one toggle (per-well vs field average).
>
> **Scope**: this dashboard is restricted to **offshore** fields only (`local IN ('PreSal','PosSal')`). Onshore/terra fields are intentionally excluded — both at the dropdown level (via `get_anp_cdp_bsw_campos`) and inside the data RPCs (defense-in-depth).

## Code scope

```
src/app/(dashboard)/anp-cdp-bsw/
  page.tsx
```

RPC wrappers: `rpcGetAnpCdpBswCampos`, `rpcGetAnpCdpBswScatter`, `rpcGetAnpCdpBswFieldAggregate` in [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (section "ANP CDP — BSW by Well").

## Product

Plots **BSW (water cut)** versus **months since first production**, with two view modes selectable from a pill toggle above the chart:

| View | Granularity | RPC | Renderer | Trace style |
|---|---|---|---|---|
| **Per well** (default) | one point per (well × month) | `get_anp_cdp_bsw_scatter` | `scattergl` (WebGL) | `mode: "markers"`, size 4, opacity 0.55 |
| **Field average** | one point per (field × month-since-t0), volume-weighted across wells | `get_anp_cdp_bsw_field_aggregate` | `scatter` (SVG, low volume) | `mode: "lines+markers"`, marker size 6 |

Each selected field is rendered as its own colored trace using the shared 16-color `PALETTE`, in selection order. Colors are stable while a session is open (the chart-trace color matches the chip color in the sidebar).

- **Y axis**: `BSW = agua_bbl_dia / (petroleo_bbl_dia + agua_bbl_dia)` (range 0–1, formatted as percentage on hover).
- **X axis**: months since the first month where `petroleo_bbl_dia > 0` for that well (linear, `rangemode: "tozero"`).
- **Single filter**: searchable multi-select of field (`campo`), in a left sidebar.
- **No export, no period slider, no additional filters** — by design.

When no field is selected, the chart renders an instructional empty state ("Select one or more fields to plot BSW evolution.").

### Tooltips

- **Per well**: well code, reference month (`ano-mm`), BSW, and months-since-start.
- **Field average**: field name, **reference month** (`ref_ano-ref_mes`, the most recent calendar month among contributors to that aggregate point — argmax of `ano*12+mes`), months-since-start, volume-weighted BSW, wells contributing, and total volume in bbl/d.

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
| `get_anp_cdp_bsw_campos()` | own (sidebar dropdown) | Returns an alphabetically ordered `text[]` of offshore field names (`local IN ('PreSal','PosSal')`). Source for the sidebar's field multi-select — replaces the previous reuse of `get_anp_cdp_filtros`, which mixed onshore and offshore fields. |
| `get_anp_cdp_bsw_scatter(p_campos text[])` | own (per-well view) | Returns one row per (well × month) for the filtered fields, with server-computed `bsw` and `mes_desde_t0`. Filters internally to `local IN ('PreSal','PosSal')` (defense-in-depth). Capped at 500k points server-side. |
| `get_anp_cdp_bsw_field_aggregate(p_campos text[])` | own (field-average view) | Returns one row per (field × month-since-t0) with volume-weighted BSW, well count, total volume, and the reference (`ref_ano`, `ref_mes`) — the (year, month) with the maximum `ano*12 + mes` among the wells contributing to that aggregate point (i.e., the most recent calendar month any contributor had data for that month-since-t0). Filters internally to `local IN ('PreSal','PosSal')`. Low-volume output (one row per month per field). |

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
  mes_desde_t0: number;
  bsw: number;           // 0..1 (volume-weighted across wells)
  n_pocos: number;       // wells contributing at this month-since-t0
  volume_total: number;  // total liquid (oil + water) volume — weight used
  ref_ano: number;       // reference year (argmax of ano*12+mes among contributors)
  ref_mes: number;       // reference month (argmax of ano*12+mes among contributors)
};
```

The wrappers pass `{ p_campos: string[] }` and return `AnpCdpBswPoint[]` / `AnpCdpBswFieldPoint[]` (or `[]` on RPC error).

## Tables / Views

| Object | Volume | Populated by |
|---|---|---|
| `anp_cdp_producao` | ~1.8M rows | ETL `scripts/pipelines/anp/cdp/01_extract.py` (Selenium + ddddocr CAPTCHA) → `02_upload.py` |

Schema columns relevant to this dashboard: `poco, campo, ano, mes, petroleo_bbl_dia, agua_bbl_dia`. Both RPCs compute BSW and `mes_desde_t0` server-side via window functions on `(poco)` ordered by `(ano, mes)`. The aggregate RPC additionally groups by `(campo, mes_desde_t0)` weighting BSW by `(petroleo_bbl_dia + agua_bbl_dia)`.

## Filters available (UI)

| Filter | Component | Behavior |
|---|---|---|
| Field | `SearchableMultiSelect` (in sidebar) | Server-side via `p_campos`. Empty selection → empty state. Each selected field gets a color from `PALETTE` in selection order. The "Selected fields" section below lists chips with the same colors. |
| View mode | `SegmentedToggle` (above chart) | "Per well" (default) calls `get_anp_cdp_bsw_scatter`; "Field average" calls `get_anp_cdp_bsw_field_aggregate`. Both fetches are debounced 400ms via `useDebouncedFetch`. |

## Reused components

- [`DashboardHeader`](../../src/components/dashboard/DashboardHeader.tsx) — title + subtitle, no period badge, no rightSlot (no export).
- [`SearchableMultiSelect`](../../src/components/SearchableMultiSelect.tsx) — search + multi-checkbox dropdown for the field list (handles hundreds of fields without UI clutter).
- [`SegmentedToggle`](../../src/components/dashboard/SegmentedToggle.tsx) — `compact` variant for the per-well/field-average pill, positioned above the chart, right-aligned.
- [`ChartSection`](../../src/components/dashboard/ChartSection.tsx) — chart wrapper with "updating…" hint while debounced fetch is in flight.
- [`PlotlyChart`](../../src/components/PlotlyChart.tsx) — `type: "scattergl"` for per-well, `type: "scatter"` for field average.
- [`BarrelLoading`](../../src/components/dashboard/BarrelLoading.tsx) — initial filter-list spinner.
- [`useModuleVisibilityGuard("anp-cdp-bsw")`](../../src/hooks/useModuleVisibilityGuard.ts) — role/visibility guard.
- [`useDebouncedFetch`](../../src/hooks/useDebouncedFetch.ts) — 400ms debounce on field-selection / view-mode changes (one hook per view).
- [`PALETTE`](../../src/lib/plotlyDefaults.ts) — shared 16-color palette (consistent with `/sindicom`, `/anp-painel-importacoes`).

Sidebar visual classes (`#sidebar`, `.sidebar-section-label`, `.sidebar-filter-section`, `.sidebar-filter-label`) come from `src/app/globals.css` — same identity as `/anp-cdp`.

## Cross-dept dependencies

| Source | How it depends |
|---|---|
| `worker_supabase` | Owns the `get_anp_cdp_bsw_campos`, `get_anp_cdp_bsw_scatter` and `get_anp_cdp_bsw_field_aggregate` SQL functions + `module_visibility` row for `anp-cdp-bsw`. The aggregate function is delivered in migration `20260508000003_anp_cdp_bsw_aggregate.sql`; the offshore-only field list + internal `local IN ('PreSal','PosSal')` filter on the existing RPCs is delivered in `20260508000004_anp_cdp_bsw_offshore.sql`. |
| ETL (`scripts/pipelines/anp/cdp/`) | Populates `anp_cdp_producao` monthly. Schema/columns must include `petroleo_bbl_dia`, `agua_bbl_dia`, and `local` (used to filter offshore fields). |
| `worker_dash-admin` | Visibility toggle in `/admin-panel` + home image. |
| Designer | Visual identity (Arial 12, brand orange `#FF5000`, axis line style, sidebar section/label classes). |

## Performance / limitations

- **Per-well server-side cap**: `get_anp_cdp_bsw_scatter` returns at most ~500k points. With many fields selected (e.g., a basin with hundreds of wells over ~20 years of monthly data), that cap can be hit; `mes_desde_t0` and `bsw` are pre-computed in SQL so the client does no heavy work.
- **`scattergl` renderer**: WebGL-backed Plotly trace, scales to hundreds of thousands of markers without DOM-node explosion.
- **Field-average is low-volume**: one row per (field × month-since-t0) — a few hundred points total. We use plain `scatter` (SVG) with `lines+markers` for crisp line rendering.
- **Two independent fetches**: per-view useDebouncedFetch hooks each guard with `viewMode !== "<their-view>" → []`, so the inactive view doesn't fire requests when the user toggles.
- **Debounce 400ms** on field selection / view-mode change — avoids hammering the DB during checkbox bursts.
- **No export by design** — for analyses that need raw data, use `/anp-cdp` (Tier 2 export with all dimensions).

## Anti-patterns

- Calling `anp_cdp_producao` directly from the client. Always go through one of the two RPCs.
- Multiplying `bsw` by 100 in the front-end — `tickformat: ",.0%"` already formats the 0..1 range as a percentage.
- Adding an `ExportPanel` "for symmetry" with the rest of `/anp-*` — this dashboard intentionally has no export.
- Adding a `PeriodSlider` — the X axis IS time-since-production, not calendar time, so a calendar period slider is meaningless here.
- Re-fetching the filtros list on every render — it loads once on mount.
- Re-using `MultiSelectFilter` for the field list — with hundreds of fields the horizontal grid becomes unusable; prefer `SearchableMultiSelect`.
- Using `scattergl` for the field-average view — its volume is too low to justify WebGL, and lines render crisper in SVG.
