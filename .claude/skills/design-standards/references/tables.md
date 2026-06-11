# Tables reference

The canonical data-table recipe, derived from the `/well-by-well` `HeaderTable`
(`src/app/(dashboard)/well-by-well/HeaderTable.tsx`) and updated to the official
palette. Use it for any PDF-style / banded statistical table.

## Style tokens

```ts
const COLORS = {
  sectionBg:  "#000512",  // Very Dark Blue — full-width section banner
  sectionFg:  "#ffffff",  // white text on the banner
  categoryBg: "#e2e2e6",  // light grey category band
  categoryFg: "#1a1a1a",
  rowBg:      "#ffffff",  // normal sub-rows
  border:     "#c0c0c0",  // strong cell border
  borderSoft: "#e5e5e5",  // soft inner border between sub-rows
  headerBg:   "#ffffff",  // column-header row background
  headerFg:   "#1a1a1a",
  deltaPos:   "#197a39",  // green — positive delta
  deltaNeg:   "#b3261e",  // red — negative delta
  muted:      "#888888",  // empty-state caption
  bodyFg:     "#1a1a1a",
};
```

> Update vs. the legacy HeaderTable: `sectionBg` is now `#000512` (the official
> Very Dark Blue / series leader) instead of the old `#1a2030`. White foreground.

## Row taxonomy

A banded table has three row kinds:

1. **Section header** — full-width banner spanning all columns. `#000512`
   background, white **bold** text, uppercase, slight letter-spacing
   (`0.6px`). Used for the top-level group (e.g. `BRAZIL`, `PETROBRAS`).
2. **Category header** — a labelled row carrying the category totals. `#e2e2e6`
   light-grey band, **bold**, no indent (e.g. `Oil (kbpd)`).
3. **Sub-row** — indented (~`28px` left padding), white background, normal
   weight (bold only if it is a total). Carries a bucket or item name.

## Cell conventions

- **Font**: Arial. Body cells `font-size: 11px` (acceptable range **10.5–12px**);
  column headers `10.5px`, `font-weight: 700`.
- **Numeric cells**: **right-aligned** with `font-variant-numeric: tabular-nums`
  so digits align across rows. Format integers with the locale thousands
  separator; render `NULL` as `—`.
- **Borders**: `border-bottom: 1px solid #e5e5e5` (soft) between sub-rows;
  `1px solid #c0c0c0` (strong) around the table and under section banners; the
  column-header row uses a `2px solid #c0c0c0` bottom border.
- **Padding**: ~`5px 8px` for body cells, `6px 8px` for header cells, `8px 12px`
  for section banners.

## Delta columns

Percent-change columns (`Δ MoM`, `Δ YoY`) render an integer percent with sign
(`+3%`, `-1%`, `0%`); blank when `NULL`. Color the value:
- positive → `#197a39` (green),
- negative → `#b3261e` (red),
- `NULL`/zero → inherit the row's foreground (no color).

These are semantic state colors, not palette series colors.

## Row highlights

For an emphasized/selected row, use a pale background **tint** from
`BACKGROUND_TINTS` (`#E2F3EC` / `#CCDAFF` / `#E6DDEC`) — these exist for exactly
this purpose. Never use a saturated series color as a row background.

## Skeleton & empty states

- **Loading, no rows yet** → shimmer skeleton rows (a `linear-gradient` sweep,
  `#ececec → #f5f5f5 → #ecececec`).
- **Loading, rows present** → drop the table to `opacity: 0.7`.
- **No data, not loading** → a centered muted caption (`#888888`, ~12px),
  e.g. "No data for this reference month." (English, per project rule).

## Reference implementation

See `src/app/(dashboard)/well-by-well/HeaderTable.tsx` for a complete, shared
desktop+mobile implementation of this recipe (section/category/sub-row rendering,
formatters, horizontal-scroll affordance on mobile via `min-width`).
