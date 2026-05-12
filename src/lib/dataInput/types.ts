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

export interface EditableTableConfig {
  slug: string;
  label: string;
  tableName: string;
  conflictColumns: string[];
  columns: ColumnConfig[];
  defaultSort?: SortConfig;
  partitionBy?: PartitionConfig;
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
}

export interface SaveResult {
  inserted: number;
  updated: number;
  deleted: number;
  error?: string;
}
