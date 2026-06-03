// Types for the Data Input admin feature.
// All tables editable via /admin-panel → Data Input share these shapes.

export type ColumnType = "text" | "number" | "date" | "select";

export interface ColumnConfig {
  key: string;
  label: string;
  type: ColumnType;
  required?: boolean;
  options?: string[];
  step?: number | "any";
  min?: number;
  max?: number;
  pattern?: string;
  patternError?: string;
  /** Hide this column unless the predicate is true for the current row. */
  visibleWhen?: (row: Record<string, unknown>) => boolean;
  helpText?: string;
  /** Suggested width (px) for the table column. */
  width?: number;
}

export interface PartitionConfig {
  column: string;
  values: { value: string; label: string }[];
}

export interface SortConfig {
  key: string;
  dir: "asc" | "desc";
}

/**
 * Maps one Excel worksheet to a partition value + its header→column mapping.
 * Sheet-specific because the same logical column can have different Excel
 * headers per sheet (e.g. "BBA - Import Parity" on Diesel vs
 * "IBBA - Import Parity" on Gasoline).
 */
export interface BulkSheetMap {
  /** Excel worksheet name (must match exactly). */
  sheetName: string;
  /** Value stamped on the partitionBy column for every row of this sheet. */
  partitionValue: string;
  /** Excel header text → registry column key. Sheet-specific. */
  headerMap: Record<string, string>;
}

/**
 * Declarative bulk-upload spec for a table. When present on an
 * `EditableTableConfig`, the Data Input editor exposes a "Bulk upload (.xlsx)"
 * affordance that parses the admin's multi-sheet workbook and upserts it.
 */
export interface BulkUploadConfig {
  /** The conflict/partition column each sheet stamps (e.g. "product", "fuel_type"). */
  partitionColumn: string;
  sheets: BulkSheetMap[];
}

export interface EditableTableConfig {
  slug: string;
  label: string;
  tableName: string;
  conflictColumns: string[];
  columns: ColumnConfig[];
  defaultSort?: SortConfig;
  /**
   * Optional client-side sort applied AFTER fetching, for tables whose
   * natural order can't be expressed as a single SQL column (e.g. a "WW/YYYY"
   * text week that must sort chronologically, not lexically).
   * When present, this overrides defaultSort for display ordering.
   */
  clientSort?: (a: Row, b: Row) => number;
  partitionBy?: PartitionConfig;
  /**
   * Optional informational banner rendered above the editor for this table.
   * Use for caveats like "this column is computed automatically".
   */
  infoNote?: string;
  /**
   * Optional bulk .xlsx upload spec. When present, the editor shows a
   * "Bulk upload (.xlsx)" button that parses a multi-sheet workbook (one sheet
   * per partition value) and upserts it. Mirrors the legacy
   * `scripts/manual/*_upload.py` Excel → DB mapping.
   */
  bulkUpload?: BulkUploadConfig;
}

/** One parse/validation problem flagged during bulk upload. */
export interface BulkRowError {
  /** Excel worksheet the problem came from. */
  sheet: string;
  /** 1-based Excel row number (header is row 1). */
  rowNumber: number;
  message: string;
}

/** Result of parsing an uploaded workbook against a table config. */
export interface BulkParseResult {
  /** Successfully parsed + coerced rows, ready for diff/upsert. */
  rows: Row[];
  /** Hard errors — block the upload until the file is fixed. */
  errors: BulkRowError[];
  /** Non-blocking warnings (e.g. an expected sheet was missing). */
  warnings: string[];
  /** Worksheet names actually present in the workbook. */
  sheetsFound: string[];
}

/** A draft (unsaved insert) uses a negative id to distinguish it from DB rows. */
export interface DraftRow extends Record<string, unknown> {
  id: number; // always < 0
}

export type Row = Record<string, unknown> & { id: number };

export interface EditState {
  editedRows: Map<number, Partial<Row>>;
  drafts: DraftRow[];
  deletedIds: Set<number>;
  /** Snapshot of the loaded rows, needed to build full upsert payloads for edits. */
  rows: Row[];
}

export interface SaveResult {
  inserted: number;
  updated: number;
  deleted: number;
  error?: string;
}
