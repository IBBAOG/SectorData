# Colors reference

> Source of truth for the actual hex values: **`src/lib/plotlyDefaults.ts`**.
> This file mirrors those values for quick reference; if they ever disagree, the
> code wins. The palette is **CLOSED** — no data-series color outside it.

## The 15 official colors (2026-06-10 directive)

| # | Name | HEX | Role & usage guidance |
|---|------|-----|-----------------------|
| 1 | Very Dark Blue | `#000512` | Series **leader** (1st position). NavBar background. Table section headers (white text on it). |
| 2 | Standard Orange | `#FF5000` | Brand accent. Positional **2nd** series. Opt-in highlight via `leader: true`. **Never** a fixed-entity pin. |
| 3 | Light Orange | `#FFAE66` | 3rd series. Warm; reads well as a fill. |
| 4 | Orange | `#FF800D` | 4th series. |
| 5 | Green | `#73C6A1` | 5th series. Soft mint-green. |
| 6 | Purple | `#7030A0` | 6th series. |
| 7 | Blue | `#094DFF` | 7th series. Saturated royal blue. |
| 8 | Yellow | `#D2FF00` | 8th series. **Legibility caveat: fine for bars / large fills; avoid as a thin line or small marker** (low contrast on white). Returned by the 2026-06-10 directive, superseding the 2026-05-28 "no near-yellow" ban. |
| 9 | Brown | `#BF3F00` | 9th series. Deep burnt-orange/brown. |
| 10 | Light Grey | `#BFBFBF` | 10th series. |
| 11 | Grey | `#A6A6A6` | 11th series. |
| 12 | Dark Grey | `#808080` | 12th series **and** the canonical **Others** color (`OTHERS_GREY`). Always rendered last. |
| 13 | Light Green | `#E2F3EC` | **Background tint only** — never a trace. |
| 14 | Light Blue | `#CCDAFF` | **Background tint only** — never a trace. |
| 15 | Light Purple | `#E6DDEC` | **Background tint only** — never a trace. |

**Series rotation** (`PALETTE`, positions 1–12):
`#000512, #FF5000, #FFAE66, #FF800D, #73C6A1, #7030A0, #094DFF, #D2FF00, #BF3F00, #BFBFBF, #A6A6A6, #808080`.

**Background tints** (`BACKGROUND_TINTS`): `#E2F3EC, #CCDAFF, #E6DDEC` — backgrounds / row highlights / badges / area fills only.

## The five canonical entity maps

> These MIRROR the values in `src/lib/plotlyDefaults.ts`. **The code file is the
> source of truth** — if you pin an entity, import the map, do not retype hex.
> Every value is one of the 12 series colors; no map uses `#FF5000`; Royal FIC
> and Atem are never `#D2FF00` (a live vitest assertion enforces this).

### `PRODUCT_COLORS`
| Entity (+ aliases) | HEX | Name |
|---|---|---|
| Diesel / Diesel B / Diesel S10 | `#094DFF` | Blue |
| Gasoline / Gasoline C / Gasolina C | `#FF800D` | Orange |
| Crude Oil | `#000512` | Very Dark Blue |
| Ethanol / Etanol Hidratado / Hydrous Ethanol / An. Ethanol | `#73C6A1` | Green |
| Biodiesel | `#D2FF00` | Yellow |
| LPG / GLP | `#7030A0` | Purple |
| Otto-Cycle | `#BF3F00` | Brown |

### `COUNTRY_COLORS`
| Entity | HEX | Name |
|---|---|---|
| Russia | `#000512` | Very Dark Blue |
| United States | `#094DFF` | Blue |
| UAE | `#73C6A1` | Green |
| Netherlands | `#FFAE66` | Light Orange |
| India | `#7030A0` | Purple |
| Saudi Arabia | `#BF3F00` | Brown |
| Norway | `#D2FF00` | Yellow |
| Argentina | `#FF800D` | Orange |
| Others | `#808080` | Dark Grey |

### `REGION_COLORS` (all key aliases / case variants kept)
| Entity | HEX | Name |
|---|---|---|
| N / Norte / NORTE | `#73C6A1` | Green |
| NE / Nordeste / NORDESTE | `#FFAE66` | Light Orange |
| CO / Centro-Oeste / CENTRO-OESTE | `#BF3F00` | Brown |
| SE / Sudeste / SUDESTE | `#094DFF` | Blue |
| S / Sul / SUL | `#7030A0` | Purple |

### `COMPANY_COLORS` (aliases map to the same color)
| Entity | HEX | Name |
|---|---|---|
| Petrobras | `#000512` | Very Dark Blue |
| Vibra | `#73C6A1` | Green |
| Ipiranga | `#094DFF` | Blue |
| Raízen / Raizen | `#BF3F00` | Brown |
| Atem / Atem's | `#7030A0` | Purple |
| Royal FIC / Royal Fic | `#FF800D` | Orange |
| Others | `#808080` | Dark Grey |

### `SEGMENT_COLORS`
| Entity | HEX | Name |
|---|---|---|
| Producer / Refinery | `#094DFF` | Blue |
| Distribution / Distributor | `#73C6A1` | Green |
| Retail | `#FFAE66` | Light Orange |
| TRR | `#BF3F00` | Brown |
| Importer / Importador | `#7030A0` | Purple |
| Total | `#000512` | Very Dark Blue (coincides with the positional leader — acceptable, Total never co-renders with a positional 1st series) |

## Allowed neutral chrome (NOT data colors)

These are layout/UI greys, never used to color a series:
`#E0E0E0` (light borders), `#F5F5F5` (panel/skeleton bg), `#888888` (muted
captions / empty-state text), plus `white` only as paper/plot background and as
in-bar text against a dark fill.

## Semantic state colors (out of palette scope)

- Success: `#0F7A4D`
- Error: `#C0392B`
- Table delta positive: `#197A39`
- Table delta negative: `#B3261E`

These convey meaning (good/bad, up/down), not entity identity, so they live
outside the closed series palette.

## Anti-patterns (must be flagged)

- **Inline hex for a series** in chart code — import the canonical map instead.
- **Any color outside the 12-color rotation** for a data series — the palette is
  closed. (`/stocks` Market Watch is the only exempt theme.)
- **Pinning `#FF5000` to a named entity** — orange is positional-2nd / highlight
  only.
- **White or near-white as a trace / marker / line / fillcolor** — white is
  background-only.
- **A pale tint (`#E2F3EC` / `#CCDAFF` / `#E6DDEC`) as a series** — tints are
  backgrounds only.
- **`#D2FF00` Yellow as a thin line or tiny marker** — low contrast on white; use
  it for bars / large fills.
- **Inventing a new green/blue/purple variant** — escalate to the CTO before
  adding any color to the palette.
