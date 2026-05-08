# Sub-PRD — `/anp-cdp-bsw`

ANP CDP — BSW by Well dashboard (Oil & Gas). Owner: [`worker_dash-anp-cdp-bsw`](../../.claude/agents/worker_dash-anp-cdp-bsw.md).

> Item of the **Oil & Gas** dropdown in the NavBar (alongside `/anp-cdp` and `/anp-cdp-diaria`). The simplest dashboard in the project: one chart, one filter.

## Code scope

```
src/app/(dashboard)/anp-cdp-bsw/
  page.tsx
```

RPC wrapper: `rpcGetAnpCdpBswScatter` in [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (section "ANP CDP — BSW by Well").

## Product

Plots **BSW (water cut)** versus **months since first production**, one point per (well × month). Each selected field is rendered as its own colored trace (rotating through the 16-color shared `PALETTE`, in selection order).

- **Y axis**: `BSW = agua_bbl_dia / (petroleo_bbl_dia + agua_bbl_dia)` (range 0–1, formatted as percentage on hover).
- **X axis**: months since the first month where `petroleo_bbl_dia > 0` for that well (linear).
- **Single filter**: multi-select of field (`campo`).
- **No export, no period slider, no additional filters** — by design.

When no field is selected, the chart renders an instructional empty state ("Select one or more fields to plot BSW evolution").

## RPCs

| RPC | Type | Purpose |
|---|---|---|
| `get_anp_cdp_bsw_scatter(p_campos text[])` | own | Returns one row per (well × month) for the filtered fields, with server-computed `bsw` and `mes_desde_t0`. Capped at 500k points server-side. |
| `get_anp_cdp_filtros` | shared with `/anp-cdp` | Reused only for its `.campos` array (alphabetical list of fields). |

### Output contract (`get_anp_cdp_bsw_scatter`)

```ts
type AnpCdpBswPoint = {
  poco: string;          // well identifier (e.g. "1-RJS-001")
  campo: string;         // field name (used to colorize trace)
  mes_desde_t0: number;  // 0, 1, 2, ... months since first production
  bsw: number;           // 0..1 water cut
  ano: number;           // calendar year of the data point
  mes: number;           // calendar month (1..12) of the data point
};
```

The wrapper passes `{ p_campos: string[] }` and returns `AnpCdpBswPoint[]` (or `[]` on RPC error).

## Tables / Views

| Object | Volume | Populated by |
|---|---|---|
| `anp_cdp_producao` | ~1.8M rows | ETL `scripts/pipelines/anp/cdp/01_extract.py` (Selenium + ddddocr CAPTCHA) → `02_upload.py` |

Schema columns relevant to this dashboard: `poco, campo, ano, mes, petroleo_bbl_dia, agua_bbl_dia`. The RPC computes BSW and `mes_desde_t0` server-side via a window function on `(poco)` ordered by `(ano, mes)`.

## Filters available (UI)

| Filter | Component | Behavior |
|---|---|---|
| Field | `MultiSelectFilter` | Server-side via `p_campos`. Empty selection → empty state. Each selected field gets a color from `PALETTE` in selection order. |

## Reused components

- [`DashboardHeader`](../../src/components/dashboard/DashboardHeader.tsx) — title + subtitle, no period badge, no rightSlot (no export).
- [`MultiSelectFilter`](../../src/components/dashboard/MultiSelectFilter.tsx) — field checkboxes with color swatch (the swatch reflects the trace color in the chart).
- [`ChartSection`](../../src/components/dashboard/ChartSection.tsx) — chart wrapper with "updating…" hint while debounced fetch is in flight.
- [`PlotlyChart`](../../src/components/PlotlyChart.tsx) — `type: "scattergl"` for performance with up to 500k markers.
- [`BarrelLoading`](../../src/components/dashboard/BarrelLoading.tsx) — initial filter-list spinner.
- [`useModuleVisibilityGuard("anp-cdp-bsw")`](../../src/hooks/useModuleVisibilityGuard.ts) — role/visibility guard.
- [`useDebouncedFetch`](../../src/hooks/useDebouncedFetch.ts) — 400ms debounce on field-selection changes.
- [`PALETTE`](../../src/lib/plotlyDefaults.ts) — shared 16-color palette (consistent with `/sindicom`, `/anp-painel-importacoes`).

## Cross-dept dependencies

| Source | How it depends |
|---|---|
| `worker_supabase` | Owns the `get_anp_cdp_bsw_scatter` SQL function + `module_visibility` row for `anp-cdp-bsw`. |
| ETL (`scripts/pipelines/anp/cdp/`) | Populates `anp_cdp_producao` monthly. Schema/columns must include `petroleo_bbl_dia` and `agua_bbl_dia`. |
| `worker_dash-anp-cdp` | Owns `get_anp_cdp_filtros` (shared); changes to its return shape can break this page. |
| `worker_dash-admin` | Visibility toggle in `/admin-panel` + home image. |
| Designer | Visual identity (Arial 12, brand orange `#FF5000`, axis line style). |

## Performance / limitations

- **Server-side cap**: the RPC returns at most ~500k points. With many fields selected (e.g., a basin with hundreds of wells over ~20 years of monthly data), that cap can be hit; `mes_desde_t0` and `bsw` are pre-computed in SQL so the client does no heavy work.
- **`scattergl` renderer**: WebGL-backed Plotly trace, scales to hundreds of thousands of markers without DOM-node explosion (unlike `"scatter"`).
- **Debounce 400ms** on field selection — avoids hammering the DB during checkbox bursts.
- **No export by design** — for analyses that need raw data, use `/anp-cdp` (Tier 2 export with all dimensions).

## Anti-patterns

- Calling `anp_cdp_producao` directly from the client. Always go through `get_anp_cdp_bsw_scatter`.
- Multiplying `bsw` by 100 in the front-end — `tickformat: ",.0%"` already formats the 0..1 range as a percentage.
- Adding an `ExportPanel` "for symmetry" with the rest of `/anp-*` — this dashboard intentionally has no export.
- Adding a `PeriodSlider` — the X axis IS time-since-production, not calendar time, so a calendar period slider is meaningless here.
- Re-fetching the filtros list on every render — it loads once on mount.
