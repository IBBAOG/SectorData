// Shared types for export UI components (ExportPanel + ExportModal).
//
// Both components emit an `onExportComplete` callback with the same shape;
// previously each declared its own copy of the type. Centralizing here keeps
// the contract single-sourced so future fields (e.g. a `dataset` discriminator)
// land in one place.

export type ExportFormat = "excel" | "csv";

export interface ExportCompleteInfo {
  format: ExportFormat;
  rows?: number;
  bytes?: number;
}
