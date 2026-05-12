/**
 * Registry of tables editable via /admin-panel → Data Input.
 * To add a new table:
 *   1. Append an EditableTableConfig entry here.
 *   2. Add an RLS policy in a new migration:
 *      CREATE POLICY "<table>_admin_write" ON public.<table>
 *        AS PERMISSIVE FOR ALL TO authenticated
 *        USING (public.is_admin()) WITH CHECK (public.is_admin());
 *   3. That's it — the UI picks it up automatically.
 */

import type { EditableTableConfig } from "./types";

export const EDITABLE_TABLES: EditableTableConfig[] = [
  // ── Price Bands ────────────────────────────────────────────────────────────
  {
    slug: "price-bands",
    label: "Price Bands",
    tableName: "price_bands",
    conflictColumns: ["product", "date"],
    defaultSort: { key: "id", dir: "desc" },
    partitionBy: {
      column: "product",
      values: [
        { value: "Diesel", label: "Diesel" },
        { value: "Gasoline", label: "Gasoline" },
      ],
    },
    columns: [
      {
        key: "date",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        key: "bba_import_parity",
        label: "BBA Import Parity",
        type: "number",
        step: 0.0001,
        required: true,
        max: 999999.9999,
      },
      {
        key: "bba_import_parity_w_subsidy",
        label: "BBA Import Parity w/ Subsidy",
        type: "number",
        step: 0.0001,
        required: false,
        max: 999999.9999,
        visibleWhen: (row) => row["product"] === "Diesel",
        helpText: "Diesel only",
      },
      {
        key: "bba_export_parity",
        label: "BBA Export Parity",
        type: "number",
        step: 0.0001,
        required: true,
        max: 999999.9999,
      },
      {
        key: "petrobras_price",
        label: "Petrobras Price",
        type: "number",
        step: 0.0001,
        required: false,
        max: 999999.9999,
      },
      {
        key: "petrobras_price_w_subsidy",
        label: "Petrobras Price w/ Subsidy",
        type: "number",
        step: 0.0001,
        required: false,
        max: 999999.9999,
        visibleWhen: (row) => row["product"] === "Diesel",
        helpText: "Diesel only",
      },
    ],
  },

  // ── D&G Margins ────────────────────────────────────────────────────────────
  {
    slug: "d-g-margins",
    label: "D&G Margins",
    tableName: "d_g_margins",
    conflictColumns: ["fuel_type", "week"],
    defaultSort: { key: "id", dir: "desc" },
    partitionBy: {
      column: "fuel_type",
      values: [
        { value: "Diesel B", label: "Diesel" },
        { value: "Gasoline C", label: "Gasoline" },
      ],
    },
    columns: [
      {
        key: "week",
        label: "Week",
        type: "text",
        required: true,
        pattern: "^([1-9]|[1-4][0-9]|5[0-3])/\\d{4}$",
        patternError: "Format: W/YYYY or WW/YYYY (week 1–53), e.g. 13/2026",
      },
      {
        key: "distribution_and_resale_margin",
        label: "Distribution & Resale Margin",
        type: "number",
        step: "any",
        required: false,
      },
      {
        key: "state_tax",
        label: "State Tax",
        type: "number",
        step: "any",
        required: false,
      },
      {
        key: "federal_tax",
        label: "Federal Tax",
        type: "number",
        step: "any",
        required: false,
      },
      {
        key: "biofuel_component",
        label: "Biofuel Component",
        type: "number",
        step: "any",
        required: false,
      },
      {
        key: "base_fuel",
        label: "Base Fuel",
        type: "number",
        step: "any",
        required: false,
      },
      {
        key: "total",
        label: "Total",
        type: "number",
        step: "any",
        required: false,
      },
    ],
  },
];
