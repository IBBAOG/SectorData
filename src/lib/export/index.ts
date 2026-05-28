// Public barrel for the unified export library.
//
// Binding contract: docs/app/export-library-contract.md.
//
// Every dashboard imports `ExportButton` (owned by worker_designer, lives in
// src/lib/export/ui/ExportButton.tsx — created in a parallel worktree) plus
// the dashboard's own spec (owned by the dash worker, lives in
// src/lib/export/dashboards/<slug>.ts).
//
// Re-exports from this file are the ONLY entry-points any dashboard should
// touch — `downloadExcel` / `downloadCsv` / `ExportModal` are not meant to be
// imported directly (they're called by `ExportButton`).

// Public types
export type {
  ExportSpec,
  ExcelSpec,
  SheetSpec,
  ColumnDef,
  CsvSpec,
  ModalSpec,
  FilterControl,
  ChartSpec,
  ExportCompleteInfo,
} from "./types";

// Core builders (exposed for advanced/edge-case callers; ExportButton is the
// normal path).
export { downloadExcel } from "./core/ExcelBuilder";
export { downloadCsv } from "./core/CsvBuilder";

// Modal (exposed so a host can mount it without ExportButton if needed).
export { default as ExportModal } from "./modal/ExportModal";
export { default as FormatToggle } from "./modal/FormatToggle";
export { default as SizeEstimator } from "./modal/SizeEstimator";
export { default as FilterEditor } from "./modal/FilterEditor";

// NOTE: ExportButton + icons live in src/lib/export/ui/ and are owned by
// worker_designer. Once they land, this barrel will also `export { ExportButton }`
// plus the icon set. Until then, callers depending on the contract import
// directly from "@/lib/export/ui/ExportButton".
