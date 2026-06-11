# Charts reference

The full Plotly recipe for this project. Every chart is built on shared defaults
from `src/lib/plotlyDefaults.ts`, colored by `src/lib/charts/colors.ts`, and
rendered through `src/components/PlotlyChart.tsx` (which auto-runs the
`validateTraces` lock). Never use `react-plotly.js` directly.

## Layout & axis conventions

From `COMMON_LAYOUT` / `AXIS_LINE` in `src/lib/plotlyDefaults.ts`:

- **Canvas**: `paper_bgcolor` and `plot_bgcolor` are `"white"`.
- **Font**: `{ family: "Arial", size: 12, color: "#000000" }`.
- **Hover label**: white-95% background, soft grey border, Arial 12, dark text,
  `namelength: -1`. `PlotlyChart` additionally rounds the hover box corners
  (`rx/ry = 8`) via a `MutationObserver`.
- **Axes** (`AXIS_LINE`): `showgrid: false`, `zeroline: false`, `showline: true`,
  `linecolor: "#000000"`, `linewidth: 1`. No gridlines; a single black axis line.

```ts
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "@/lib/plotlyDefaults";

const layout: Partial<Layout> = {
  ...COMMON_LAYOUT,
  height: 360,
  margin: { t: 20, b: 40, l: 50, r: 16 },
  xaxis: { ...AXIS_LINE },
  yaxis: { ...AXIS_LINE, title: { text: "Volume (thousand m³)" } },
};
```

Use `emptyPlot(height, message)` for the no-data state.

## Assigning colors — `assignSeriesColors`

Feed entities **in the order you want them stacked / legended**. Resolution per
entity: (1) `leader` highlight override → orange for the first entity; (2)
canonical pin from the supplied map if free; (3) next free `PALETTE` color
(collision-skipping). `Others` is forced to `#808080` and pushed last.

```ts
import {
  assignSeriesColors,
  applyStackedLegendOrder,
  toColorMap,
} from "@/lib/charts/colors";
import { COMPANY_COLORS, COMMON_LAYOUT } from "@/lib/plotlyDefaults";

// orderedEntities is the desired stack/legend order, Others last.
const assignment = assignSeriesColors(orderedEntities, {
  canonical: COMPANY_COLORS,
  othersLabel: "Others",
});
const colorOf = toColorMap(assignment); // { entity: color }

// Build traces in the SAME order as `assignment`.
const data: Partial<PlotData>[] = assignment.map(({ entity }) => ({
  type: "bar",
  name: entity,
  x: months,
  y: seriesByEntity[entity],
  marker: { color: colorOf[entity] },
}));
```

If you pass more distinct non-Others entities than the palette can color
(>11 — 12 colors minus the reserved grey), `assignSeriesColors` **throws**. That
is intentional: collapse the long tail into an `Others` bucket instead of
repeating a color (see the wrap rule below).

## Registering a chart with the `validateTraces` lock

`PlotlyChart` runs `validateTraces(data, layout, ctx)` automatically. The lock
only **enforces** charts whose `ctx` is on `MIGRATED_CTX` in
`src/lib/charts/validateTraces.ts`:

- migrated `ctx`, dev/CI: **throws** on a color collision or an unpinned stacked
  legend order.
- migrated `ctx`, production: **auto-corrects** (reassigns the colliding color to
  the next free palette color; forces `legend.traceorder: "normal"`) and
  `console.error`s — the user's chart never breaks.
- unmigrated `ctx` (or `ctx` undefined): a strict **no-op** (dev: a soft
  `console.warn` only). This is deliberate — some unmigrated charts legitimately
  repeat a color distinguished by dash style (e.g. `/price-bands`).

To migrate a chart, pass a stable `ctx` and add it to `MIGRATED_CTX`:

```tsx
<PlotlyChart data={data} layout={layout} ctx="imports-exports:by-importer" />
```

```ts
// src/lib/charts/validateTraces.ts
export const MIGRATED_CTX: ReadonlySet<string> = new Set<string>([
  "imports-exports:by-origin-country",
  "imports-exports:by-importer",
  // ...add your chart's ctx here when it adopts assignSeriesColors.
]);
```

## Stacked bars

- Build traces in stack order; pass the layout through
  `applyStackedLegendOrder(layout)` so the legend reads bottom→top instead of
  Plotly's stacked default of `traceorder: "reversed"`.
- `Others` is always the last (top) stack segment and the last legend entry.

```ts
const stackedLayout = applyStackedLegendOrder({ ...COMMON_LAYOUT, barmode: "stack" });
```

## Lines, scatter & area

- **Lines**: color via `line.color`. Avoid `#D2FF00` Yellow as a thin line
  (legibility) — pick another rotation color, or thicken it.
- **Scatter / markers**: color via `marker.color`. A per-point color *array* is
  allowed (the lock skips array markers).
- **Area / fills**: color via `fillcolor`. Pale `BACKGROUND_TINTS` are acceptable
  as a soft area fill behind a line — but never as the line/series color itself.

## The `leader: true` highlight pattern

When a chart lets the user select one series to "pop", force it to brand orange:

```ts
const assignment = assignSeriesColors(fields, { leader: true });
// assignment[0].color === BRAND_ORANGE; the rest take the rotation.
```

This is distinct from the default positional leader (which is `#000512`). Used by
BSW and `/anp-cdp-diaria` (the "Company total" headline line is always orange, so
its field traces filter orange out of their sequence).

## Wrap rule (>12 visible series)

The palette has 12 colors, one reserved for `Others` → at most **11** distinct
non-Others series. If a chart would render more, **bucket the long tail into
`Others` (`#808080`)** — never repeat a color and never extend the palette. The
runtime lock + `assignSeriesColors` throw guarantee this is caught in dev/CI.
