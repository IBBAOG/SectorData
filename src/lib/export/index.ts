// ─────────────────────────────────────────────────────────────────────────────
// src/lib/export/index.ts — Public barrel for the unified export library.
//
// Binding contract: docs/app/export-library-contract.md.
//
// This file is co-owned by `worker_subgerente-app` (types + core + modal
// re-exports) and `worker_designer` (icons + ExportButton re-exports). Each
// owner appends to the file rather than rewriting it; the orquestrador merges
// the two streams of additions.
//
// Public surface intentionally tiny: dashboards should import only
// `ExportButton` (and optionally the canonical icons for ad-hoc surfaces).
// They never reach into `./core`, `./modal`, or `./types` directly.
// ─────────────────────────────────────────────────────────────────────────────

// ── Owned by worker_designer ────────────────────────────────────────────────
export { ExportButton } from "./ui/ExportButton";
export { ExcelIcon, CsvIcon, DownloadIcon } from "./ui/icons";

// ── Owned by worker_subgerente-app ──────────────────────────────────────────
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
