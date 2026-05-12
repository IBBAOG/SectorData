// Pure validation functions for Data Input cells and rows.
// No side effects — safe to call in render.

import type { ColumnConfig } from "./types";

/**
 * Validate a single cell value against its column config.
 * Returns an error message string, or null if valid.
 */
export function validateCell(value: unknown, col: ColumnConfig): string | null {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "");

  // Required check
  if (col.required && isEmpty) {
    return `${col.label} is required.`;
  }

  // If empty and not required, no further checks needed
  if (isEmpty) return null;

  const strVal = String(value).trim();

  switch (col.type) {
    case "date": {
      // Expect YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(strVal)) {
        return "Date must be in YYYY-MM-DD format.";
      }
      break;
    }

    case "number": {
      const num = Number(value);
      if (isNaN(num)) {
        return `${col.label} must be a number.`;
      }
      if (col.min !== undefined && num < col.min) {
        return `${col.label} must be at least ${col.min}.`;
      }
      if (col.max !== undefined && num > col.max) {
        return `${col.label} must be at most ${col.max}.`;
      }
      break;
    }

    case "select": {
      if (col.options && !col.options.includes(strVal)) {
        return `${col.label} must be one of: ${col.options.join(", ")}.`;
      }
      break;
    }

    case "text": {
      if (col.pattern) {
        const re = new RegExp(col.pattern);
        if (!re.test(strVal)) {
          return col.patternError ?? `${col.label} format is invalid.`;
        }
      }
      break;
    }
  }

  return null;
}

/**
 * Validate all columns in a single row.
 * Returns a Map of columnKey → error message (only for columns with errors).
 */
export function validateRow(
  row: Record<string, unknown>,
  columns: ColumnConfig[]
): Map<string, string> {
  const errors = new Map<string, string>();
  for (const col of columns) {
    const err = validateCell(row[col.key], col);
    if (err) errors.set(col.key, err);
  }
  return errors;
}

/**
 * Validate all rows.
 * Returns a Map of rowId → Map<columnKey, errorMessage>.
 * Only rows with at least one error are present in the outer map.
 */
export function validateAll(
  rows: { id: number; data: Record<string, unknown> }[],
  columns: ColumnConfig[]
): Map<number, Map<string, string>> {
  const result = new Map<number, Map<string, string>>();
  for (const { id, data } of rows) {
    const rowErrors = validateRow(data, columns);
    if (rowErrors.size > 0) {
      result.set(id, rowErrors);
    }
  }
  return result;
}
