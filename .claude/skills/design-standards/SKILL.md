---
name: design-standards
description: Canonical visual standards for this dashboard project. Load this whenever you generate or style ANY chart, data table, color decision, dashboard visual, Plotly trace, legend, or export visual. It carries the CLOSED official brand palette (15 colors), the series-order and Others rules, the #FF5000 reservation rule, the canonical entity-color maps, the PlotlyChart + assignSeriesColors + validateTraces pipeline, and the canonical data-table recipe. If you are picking a color for a series, deciding a chart layout, or building a table, read this first.
---

# Design Standards

The single source of truth for color, charts and tables across every dashboard.
All UI strings and artifacts you produce must be in **English** (project hard rule).

## 1. The official brand palette — CLOSED

The brand defined 15 official colors (2026-06-10 directive). The palette is
**closed**: no data-series color may exist outside this list, anywhere. Hex is
written UPPERCASE.

| # | Name | HEX | Role |
|---|------|-----|------|
| 1 | Very Dark Blue | `#000512` | **Series leader** (1st position); NavBar; table section headers |
| 2 | Standard Orange | `#FF5000` | Brand accent; positional **2nd** series; opt-in highlight (`leader: true`). **NEVER** a canonical entity pin |
| 3 | Light Orange | `#FFAE66` | 3rd series |
| 4 | Orange | `#FF800D` | 4th series |
| 5 | Green | `#73C6A1` | 5th series |
| 6 | Purple | `#7030A0` | 6th series |
| 7 | Blue | `#094DFF` | 7th series |
| 8 | Yellow | `#D2FF00` | 8th series (fine on bars; avoid as thin lines) |
| 9 | Brown | `#BF3F00` | 9th series |
| 10 | Light Grey | `#BFBFBF` | 10th series |
| 11 | Grey | `#A6A6A6` | 11th series |
| 12 | Dark Grey | `#808080` | 12th series **+ OTHERS_GREY** (always last) |
| 13 | Light Green | `#E2F3EC` | **Background tint only** — never a series |
| 14 | Light Blue | `#CCDAFF` | **Background tint only** — never a series |
| 15 | Light Purple | `#E6DDEC` | **Background tint only** — never a series |

12-color series rotation (the order of `PALETTE` in `src/lib/plotlyDefaults.ts`):
`#000512, #FF5000, #FFAE66, #FF800D, #73C6A1, #7030A0, #094DFF, #D2FF00, #BF3F00, #BFBFBF, #A6A6A6, #808080`.

## 2. Series order

- The positional **leader (1st series)** is `#000512` Very Dark Blue.
- `#FF5000` Standard Orange is the **2nd series**.
- After that, follow the rotation order above.
- **"Others"** is `#808080` Dark Grey and is **ALWAYS the last series AND the
  last legend entry**. It never borrows a series slot earlier in the rotation.

## 3. The `#FF5000` reservation rule

Never pin Standard Orange to a named entity (company / product / country /
region / segment). It exists only as:
- the **positional 2nd** series, OR
- the explicit `leader: true` highlight (a user-selected series "pops" orange).

If orange is pinned to a fixed entity it gets stolen from those two roles. A live
vitest assertion enforces that Royal FIC / Atem are never `#D2FF00`, and the
canonical maps never use `#FF5000`.

## 4. Pale tints

`#E2F3EC` (Light Green), `#CCDAFF` (Light Blue), `#E6DDEC` (Light Purple) are for
**backgrounds, row highlights, badges and area fills only** — **never a chart
trace**. They are exported from `src/lib/plotlyDefaults.ts` as `BACKGROUND_TINTS`.

## 5. Canonical entity colors

A company / product / country / region / segment that recurs across dashboards
**always** uses its canonical color, so it looks identical everywhere. These
pins live in the canonical maps in `src/lib/plotlyDefaults.ts`
(`PRODUCT_COLORS`, `COUNTRY_COLORS`, `REGION_COLORS`, `COMPANY_COLORS`,
`SEGMENT_COLORS`) — **the code file is the source of truth**. Consult a map
BEFORE the rotation; never use inline hex for an entity in chart code.

## 6. The chart pipeline (mandatory)

Every chart routes through the **`PlotlyChart`** wrapper
(`src/components/PlotlyChart.tsx`) — never `react-plotly.js` directly. Color
assignment goes through **`assignSeriesColors`** + **`applyStackedLegendOrder`**
from `src/lib/charts/colors.ts`. The runtime lock **`validateTraces`**
(`src/lib/charts/validateTraces.ts`, auto-run inside `PlotlyChart`) enforces:
- no two **visible** series share a color, and
- a stacked chart's legend order matches its stack order.

Pass a stable `ctx` (e.g. `"imports-exports:by-importer"`) and add it to
`MIGRATED_CTX` to opt the chart into dev-throw / prod-auto-correct enforcement.
See `references/charts.md` for the full recipe and real snippets.

## 7. Tables

Data tables follow the canonical recipe in `references/tables.md`, derived from
the `/well-by-well` `HeaderTable`. Section headers are `#000512` background with
white text; numeric cells right-aligned with `font-variant-numeric: tabular-nums`.

## 8. Exceptions (out of palette scope)

- **`/stocks`** Market Watch theme — exempt by design (flat, uppercase, zero
  radius, Bloomberg-style). Do not convert it to the main identity.
- **Semantic state colors** — success `#0F7A4D`, error `#C0392B`, table deltas
  positive `#197A39` / negative `#B3261E`.
- **Neutral chrome greys** — `#E0E0E0`, `#F5F5F5`, `#888…` (borders, skeletons,
  muted captions). Not data colors.

## 9. Language

Every artifact you produce — UI strings, axis titles, legend labels, code
comments, export filenames — is in **English**.

---

## When to load which reference

- **`references/colors.md`** — choosing/auditing a color, the full canonical
  maps, allowed neutral chrome, anti-patterns.
- **`references/charts.md`** — building a Plotly chart: layout/axis conventions,
  `assignSeriesColors` usage, the `validateTraces` lock, stacked/line/area
  guidance, the `leader: true` highlight, the >12-series wrap rule.
- **`references/tables.md`** — building a data table: tokens, section/category
  banding, numeric formatting, delta colors, row-highlight tints.
