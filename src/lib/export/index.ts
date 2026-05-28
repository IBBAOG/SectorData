// ─────────────────────────────────────────────────────────────────────────────
// src/lib/export/index.ts — Public barrel for the unified export library.
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
