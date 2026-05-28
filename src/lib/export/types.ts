// Public types for the unified export library.
//
// Binding contract: docs/app/export-library-contract.md.
// Owners: worker_subgerente-app (this file).
//
// Every dashboard declares its export shape as `const <slug>Export: ExportSpec`
// inside src/lib/export/dashboards/<slug>.ts. The shape drives the modal UI,
// the Excel/CSV builders and the filename, so a typo in a key cascades into
// runtime undefined columns. Keep the spec source of truth here.

export type ExportSpec = {
  /** Base filename WITHOUT extension or date — e.g. "BrazilProductionSummary". */
  filename: string;
  /** 1 = direct download (2 buttons, no modal); 2 = modal w/ size estimator + format toggle. */
  tier: 1 | 2;
  excel: ExcelSpec;
  csv: CsvSpec;
  /** Required when tier === 2. */
  modal?: ModalSpec;
  /**
   * Filter sourcing strategy for the export modal body.
   *   • wysiwyg         — read-only snapshot of the dashboard's current filters
   *   • modal-editable  — render `modal.filters` controls; user edits them in-modal
   *   • none            — no filter section
   */
  filterSource: "wysiwyg" | "modal-editable" | "none";
};

export type ExcelSpec = {
  /** 1+ sheets. Each becomes a tab in the workbook. */
  sheets: SheetSpec[];
};

export type SheetSpec = {
  /** Tab label — max 31 chars per Excel's limit. */
  name: string;
  /** Optional brand-orange title in row 1. */
  title?: string;
  /** Ordered columns; drives header row + cell formatting. */
  columns: ColumnDef[];
  /**
   * Returns the rows to render in this sheet, given the current filter snapshot.
   * Called once at download time, NOT during modal preview (the count RPC is
   * separate). Must resolve to a plain array of row objects keyed by `ColumnDef.key`.
   */
  rowsAsync: (filters: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  /** Optional OOXML chart embed (rare — only /market-share uses today). */
  chart?: ChartSpec;
};

export type ColumnDef = {
  /** Row lookup key — `row[key]`. */
  key: string;
  /** English header label. */
  header: string;
  /** Excel column width in chars. Default = max(header.length + 2, 12). */
  width?: number;
  /** ExcelJS numFmt string (e.g. "0.00", "#,##0", "yyyy-mm-dd"). */
  format?: string;
  /** Cell alignment. Default: center for numeric (when `format` is set), left otherwise. */
  align?: "left" | "center" | "right";
};

export type CsvSpec =
  | {
      mode: "single";
      columns: ColumnDef[];
      rowsAsync: (f: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
    }
  | {
      /**
       * Single CSV file but rows come from N source sheets, each tagged with
       * the sheet name in a discriminator column (e.g. `view`, `fuel_type`).
       */
      mode: "single-with-discriminator";
      discriminatorColumn: string;
      sheets: SheetSpec[];
    }
  | {
      /** N CSV files zipped — used when sheet schemas are heterogeneous. */
      mode: "zip";
      files: {
        name: string;
        columns: ColumnDef[];
        rowsAsync: (f: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
      }[];
    };

export type ModalSpec = {
  /** Empty/omitted when filterSource !== "modal-editable". */
  filters?: FilterControl[];
  /**
   * Row-count RPC for the size estimator. Debounced 300ms in the modal.
   * Receives the current filter snapshot; returns an integer row count.
   */
  countRpc?: (filters: Record<string, unknown>) => Promise<number>;
};

export type FilterControl =
  | {
      type: "date-range";
      key: string;
      label: string;
      default?: [string, string];
      min?: string;
      max?: string;
    }
  | {
      type: "multi-select";
      key: string;
      label: string;
      optionsAsync: () => Promise<{ value: string; label: string }[]>;
      default?: string[];
    }
  | {
      type: "single-select";
      key: string;
      label: string;
      optionsAsync: () => Promise<{ value: string; label: string }[]>;
      default?: string;
    }
  | {
      type: "search";
      key: string;
      label: string;
      placeholder?: string;
    }
  | {
      type: "segmented";
      key: string;
      label: string;
      options: { value: string; label: string }[];
      default?: string;
    };

export type ChartSpec = {
  /** Future: bar, area. Only "line" supported today (/market-share). */
  type: "line";
  /** X-axis source column key. */
  catColumn: string;
  /** Y-axis series source column keys. */
  seriesColumns: string[];
  /** Optional fixed colours per series (hex without leading #). */
  seriesColors?: Record<string, string>;
  /** Y-axis format string, e.g. '0"%"' or '0.0'. */
  yAxisFormat?: string;
  /** When charts are grouped by category (e.g. one chart per segment). */
  titleColumn?: string;
};

/** Fired by the ExportButton/Modal on a successful download. */
export type ExportCompleteInfo = {
  format: "excel" | "csv";
  rows?: number;
  bytes?: number;
};
