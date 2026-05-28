# Export library contract (v1)

> Approved by CTO 2026-05-28. Owners: `worker_subgerente-app` (core + modal + types), `worker_designer` (ui/icons + ExportButton).
>
> This document is the binding contract that all `worker_dash-*` agents follow when migrating their dashboard's export to the unified library at `src/lib/export/`.
>
> When this contract changes, the owner edits this file IN THE SAME COMMIT as the code change, then notifies all `worker_dash-*` via the worker_documentador.

---

## Why this exists

Before this refactor, every dashboard rolled its own Excel/CSV download function. Result: 8 functions in `src/lib/exportExcel.ts`, inconsistent icons, inconsistent placement, inconsistent filename patterns, inconsistent modal UX, broken in most dashboards as of 2026-05-28.

The unified library:

1. Single visual identity for every export button (Excel green `#217346` + CSV blue `#1565C0` icons; placement: top-right of `DashboardHeader.rightSlot`).
2. Single Excel layout (header navy `#000512` + Arial 10 + title row in brand orange `#FF5000` + no grid).
3. Single CSV builder (3 modes: `single`, `single-with-discriminator`, `zip`).
4. Single modal for Tier 2 (filters + size calculator + format toggle + Download).
5. Spec-driven: each dashboard declares its export shape in 1 file (`src/lib/export/dashboards/<slug>.ts`).

---

## Folder layout

```
src/lib/export/
├── index.ts                     # barrel: re-exports public surface
├── types.ts                     # ExportSpec, SheetSpec, ColumnDef, FilterControl, ChartSpec
├── core/
│   ├── ExcelBuilder.ts          # downloadExcel(spec, filename) → Blob + trigger
│   ├── CsvBuilder.ts            # downloadCsv(spec, filename) → Blob (or zip) + trigger
│   ├── chartXmlBuilder.ts       # OOXML line chart helper (used by /market-share only)
│   └── style.ts                 # C (header navy / orange / cell colors), ROW_H, ARIAL_NUMS
├── modal/
│   ├── ExportModal.tsx          # universal modal — handles all 4 filterSource modes
│   ├── FilterEditor.tsx         # multi-select / date-range / search inputs (modal-editable mode)
│   ├── SizeEstimator.tsx        # debounced count RPC → "~X rows · ~Y MB"
│   └── FormatToggle.tsx         # Excel / CSV pill
├── ui/
│   ├── icons.tsx                # ExcelIcon, CsvIcon, DownloadIcon
│   └── ExportButton.tsx         # the SINGLE entry component every dashboard uses
└── dashboards/
    ├── wellByWell.ts            # owned by worker_dash-well-by-well
    ├── anpCdp.ts                # owned by worker_dash-anp-cdp
    ├── anpCdpDiaria.ts          # owned by worker_dash-anp-cdp-diaria
    ├── naviosDiesel.ts          # owned by worker_dash-navios-diesel
    ├── dgMargins.ts             # owned by worker_dash-margins
    ├── priceBands.ts            # owned by worker_dash-price-bands
    ├── subsidyTracker.ts        # owned by worker_dash-subsidy-tracker
    ├── marketShare.ts           # owned by worker_dash-market-share
    ├── anpPrices.ts             # owned by worker_subgerente-app (no dedicated dash worker yet)
    ├── anpGlp.ts                # owned by worker_dash-anp-glp
    └── importsExports.ts        # owned by worker_dash-imports-exports
```

---

## Public surface (the only imports any dashboard touches)

```ts
import { ExportButton } from "@/lib/export";
import { wellByWellExport } from "@/lib/export/dashboards/wellByWell";

// inside your desktop/View.tsx
<DashboardHeader
  title="Brazil Production Summary"
  rightSlot={<ExportButton spec={wellByWellExport} />}
/>
```

That's it. **No dashboard ever calls `downloadExcel` / `downloadCsv` / `ExportModal` directly.** They all flow through `ExportButton`.

---

## Types (`src/lib/export/types.ts`)

```ts
export type ExportSpec = {
  filename: string;                     // e.g. "BrazilProductionSummary" → "BrazilProductionSummary_DD-MM-YY.xlsx"
  tier: 1 | 2;                          // 1 = direct download (2 buttons), 2 = modal (1 button)
  excel: ExcelSpec;
  csv: CsvSpec;
  modal?: ModalSpec;                    // required when tier === 2
  filterSource: "wysiwyg" | "modal-editable" | "none";
};

export type ExcelSpec = {
  sheets: SheetSpec[];                  // 1+ sheets
};

export type SheetSpec = {
  name: string;                         // tab label (max 31 chars per Excel)
  title?: string;                       // brand-orange title in row 1
  columns: ColumnDef[];                 // ordered, drives header row + cell formatting
  rowsAsync: (filters: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  chart?: ChartSpec;                    // optional OOXML chart embed (rare — only /market-share uses today)
};

export type ColumnDef = {
  key: string;                          // row[key] lookup
  header: string;                       // English header label
  width?: number;                       // Excel column width in chars; default = max(header.length + 2, 12)
  format?: string;                      // ExcelJS numFmt (e.g. "0.00", "#,##0", "yyyy-mm-dd")
  align?: "left" | "center" | "right";  // default: center for numeric, left otherwise
};

export type CsvSpec =
  | { mode: "single"; columns: ColumnDef[]; rowsAsync: (f: Record<string, unknown>) => Promise<Record<string, unknown>[]> }
  | { mode: "single-with-discriminator"; discriminatorColumn: string; sheets: SheetSpec[] }
  | { mode: "zip"; files: { name: string; columns: ColumnDef[]; rowsAsync: (f: Record<string, unknown>) => Promise<Record<string, unknown>[]> }[] };

export type ModalSpec = {
  filters?: FilterControl[];            // empty when filterSource !== "modal-editable"
  countRpc?: (filters: Record<string, unknown>) => Promise<number>;  // size estimator, debounced 300ms
};

export type FilterControl =
  | { type: "date-range"; key: string; label: string; default?: [string, string]; min?: string; max?: string }
  | { type: "multi-select"; key: string; label: string; optionsAsync: () => Promise<{ value: string; label: string }[]>; default?: string[] }
  | { type: "single-select"; key: string; label: string; optionsAsync: () => Promise<{ value: string; label: string }[]>; default?: string }
  | { type: "search"; key: string; label: string; placeholder?: string }
  | { type: "segmented"; key: string; label: string; options: { value: string; label: string }[]; default?: string };

export type ChartSpec = {
  type: "line";                         // future: bar, area
  catColumn: string;                    // x-axis source column key
  seriesColumns: string[];              // y-axis series source column keys
  seriesColors?: Record<string, string>;
  yAxisFormat?: string;                 // e.g. '0"%"' or '0.0'
  titleColumn?: string;                 // if charts grouped by category, e.g. "segmento"
};
```

---

## Filter source semantics

| `filterSource` | What ExportButton does |
|---|---|
| `"wysiwyg"` | Reads dashboard state (the spec must wire `rowsAsync` to the dashboard's `useXxxData` hook). Modal shows filters as **read-only labels** ("Active filters: Period=Last 12M · Player=All"). User confirms then downloads. |
| `"modal-editable"` | Modal opens with `spec.modal.filters` controls. User edits, count RPC re-fires on each change. Download uses the modal's filter state, not the dashboard's. |
| `"none"` | No filters at all. Modal (if Tier 2) just shows size estimate + format toggle + Download. Tier 1 = no modal, immediate download. |

---

## ExportButton.tsx public API (owned by `worker_designer`)

```tsx
type ExportButtonProps = {
  spec: ExportSpec;
  onComplete?: (info: { format: "excel" | "csv"; rows?: number }) => void;
};

export function ExportButton(props: ExportButtonProps): JSX.Element;
```

Internal behavior:

- `spec.tier === 1`: renders 2 buttons side-by-side. Excel button = `<ExcelIcon /> Excel`. CSV button = `<CsvIcon /> CSV`. Click on Excel → `downloadExcel(spec.excel, spec.filename, currentFilters)`. Click on CSV → `downloadCsv(spec.csv, spec.filename, currentFilters)`. No modal.
- `spec.tier === 2`: renders 1 button `<DownloadIcon /> Export ↓`. Click → opens `ExportModal` with `spec.modal`.

Tracking: fires `trackEvent("export", pathname, { format, rows? })` on success.

Buttons use `btn btn-outline-secondary btn-sm` + `fontFamily: "Arial"` + `gap: 5px` between icon and label. Hover state: orange `#FF5000` border + soft orange box-shadow.

---

## Icons (owned by `worker_designer`, in `src/lib/export/ui/icons.tsx`)

```tsx
export const ExcelIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" style={{ verticalAlign: "middle" }}>
    <rect x="2" y="2" width="20" height="20" rx="3" fill="#217346" />
    <text x="4" y="17" fontFamily="Arial" fontWeight="bold" fontSize="12" fill="#fff">X</text>
  </svg>
);

export const CsvIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" style={{ verticalAlign: "middle" }}>
    <rect x="3" y="2" width="18" height="20" rx="2" fill="#1565C0" />
    <rect x="6" y="7"  width="12" height="1.5" rx="0.75" fill="#fff" />
    <rect x="6" y="11" width="12" height="1.5" rx="0.75" fill="#fff" />
    <rect x="6" y="15" width="8"  height="1.5" rx="0.75" fill="#fff" />
  </svg>
);

export const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" style={{ verticalAlign: "middle" }}>
    <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
```

**These icons are canonical. Do NOT create alternates anywhere in the codebase.**

---

## Excel visual standard (owned by `worker_subgerente-app`, in `src/lib/export/core/style.ts`)

| Element | Spec |
|---|---|
| Workbook | `wb.views = [{ showGridLines: false }]` per worksheet |
| Header row | Font Arial 10 bold, color `#FFFFFF`, fill `#000512` (navy NavBar), align center (left for first text column) |
| Title row (optional) | Font Arial 13 bold, color `#FF5000` (brand orange), no fill, vertical middle |
| Data row | Font Arial 10, color `#1A1A1A`, align per ColumnDef (default center for numeric, left for text) |
| Row height | 14pt (consistent across header, title, data) |
| Column width | `ColumnDef.width ?? max(header.length + 2, 12)` |
| Number format | `ColumnDef.format` applied via `cell.numFmt` |

---

## Filename convention

```
<spec.filename>_DD-MM-YY.<ext>
```

Examples:

- `BrazilProductionSummary_28-05-26.xlsx`
- `DieselImportsLineUp_28-05-26.csv`
- `LPGSales_28-05-26.xlsx`

For Tier 2 with sub-modes (e.g. `/anp-cdp` Aggregated by Field), append the mode after the base name:

- `MonthlyProduction_28-05-26.xlsx` (Raw)
- `MonthlyProduction_by-campo_28-05-26.xlsx` (Aggregated by Field)

For CSV `zip` mode the filename is the same but extension `.zip`.

---

## Mobile

**No export on mobile.** Per the Mobile reform v2 (2026-05-27), export is 100% desktop. `ExportButton` returns `null` when `useIsMobile()` is `true`.

The button must live inside `DashboardHeader.rightSlot` — `DashboardHeader` is the only component that consumes the right-slot pattern, and it is desktop-only.

---

## Backend RPCs needed (owned by `worker_supabase`)

| RPC | Used by | Purpose |
|---|---|---|
| `get_production_well_full_history(p_empresa text)` | `/well-by-well` (4 company sheets) | Full history at well level, stake-weighted, for one company |
| `get_production_brazil_well_full_history()` | `/well-by-well` (Brasil sheet) | Same but Brazil-wide, no stake math |
| `get_anp_cdp_diaria_export_count(p_nivel text, p_filtros jsonb)` | `/anp-cdp-diaria` size estimator | Returns count for the chosen nível + filters |
| `get_anp_prices_export_counts(p_filtros jsonb)` | `/anp-prices` size estimator | Returns counts for Producer + Distribution + Retail sources |
| `get_imports_exports_raw_imports(p_filtros jsonb)` | `/imports-exports` Imports sheet | Raw rows for export (1 row per ano/mes/pais/importador/cnpj/ncm) |
| `get_imports_exports_raw_exports(p_filtros jsonb)` | `/imports-exports` Exports sheet | Raw rows for export (1 row per ano/mes/pais/ncm) |
| `get_imports_exports_export_count(p_filtros jsonb)` | `/imports-exports` size estimator | Returns Imports + Exports counts |

All new RPCs: `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp`, granted to `anon, authenticated` (Pegadinha #18).

The existing `/anp-cdp` export RPCs (`get_anp_cdp_raw_export`, `get_anp_cdp_aggregated_export`, possibly a count) — `worker_supabase` validates they exist and creates a count helper if missing.

---

## Deprecation of the old library

`src/lib/exportExcel.ts`, `src/lib/exportCsv.ts`, `src/lib/exportSizeHeuristics.ts`, `src/components/dashboard/ExportPanel.tsx`, `src/components/dashboard/ExportModal.tsx` remain in place until ALL dashboards are migrated. Once every dashboard imports from `src/lib/export/`, these files can be deleted in a single cleanup commit.

During the migration wave, **dash workers do NOT delete the old functions**. They simply stop calling them from their dashboard's View. The cleanup is a separate task scheduled after all dashboards land.

---

## Decision table — per-dashboard recap

| Dashboard | Tier | Sheets / Files | `filterSource` | Charts | CSV mode |
|---|---|---|---|---|---|
| `/well-by-well` | 2 | 5 sheets (Brasil + 4 empresas) | `none` (always full history) | None | `single-with-discriminator` (view col) |
| `/anp-cdp` | 2 | 1 sheet (Raw OR Aggregated by chosen groupBy) | `modal-editable` | None | `single` |
| `/anp-cdp-diaria` | 2 | 1 sheet (chosen nível) | `modal-editable` | None | `single` |
| `/navios-diesel` | 1 | 1 sheet "Vessels" | `wysiwyg` | None | `single` |
| `/diesel-gasoline-margins` | 1 | 2 sheets (Diesel B + Gasoline C) | `none` | None | `single-with-discriminator` (fuel_type) |
| `/price-bands` | 1 | 2 sheets (Diesel + Gasoline) | `none` | None | `single-with-discriminator` (product) |
| `/subsidy-tracker` | 1 | 2 sheets (Importador + Produtor) | `none` | None | `single-with-discriminator` (tipo_agente) |
| `/market-share` | 2 | 4 sheets × 3-4 segment blocks, **with line charts** | `wysiwyg` | **YES (OOXML line per block)** | `single` (cols: product/segment/player/date/value) |
| `/anp-prices` | 2 | 3 sheets (Producer/Distribution/Retail) | `modal-editable` | None | `zip` (heterogeneous schemas) |
| `/anp-glp` | 1 | 1 sheet "LPG Sales" | `none` | None | `single` |
| `/imports-exports` | 2 | 2 sheets (Imports + Exports) | `modal-editable` | None | `zip` (heterogeneous: Exports has no importador) |

**Excluded (no export):** `/anp-cdp-bsw`, `/anp-cdp-depletion`, `/stocks`, `/news-hunter`, `/alerts`.

---

## Worker dispatch — file ownership matrix

| Path | Owner |
|---|---|
| `src/lib/export/index.ts` | `worker_subgerente-app` |
| `src/lib/export/types.ts` | `worker_subgerente-app` |
| `src/lib/export/core/*` | `worker_subgerente-app` |
| `src/lib/export/modal/*` | `worker_subgerente-app` |
| `src/lib/export/ui/icons.tsx` | `worker_designer` |
| `src/lib/export/ui/ExportButton.tsx` | `worker_designer` |
| `src/lib/export/dashboards/anpPrices.ts` | `worker_subgerente-app` (no dedicated dash worker yet) |
| `src/lib/export/dashboards/<other>.ts` | `worker_dash-<slug>` |
| `src/app/(dashboard)/<slug>/desktop/View.tsx` | `worker_dash-<slug>` (plug ExportButton, remove legacy ExportPanel) |
| `src/app/(dashboard)/anp-prices/desktop/View.tsx` | `worker_subgerente-app` |
| `supabase/migrations/<timestamp>_export_rpcs.sql` | `worker_supabase` |

If you are a dash worker and you find yourself wanting to edit a file outside your column: **stop, leave a note in your worktree commit message, and the CTO will route it to the right owner**.
