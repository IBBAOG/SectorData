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
  // Subsidy-adjusted columns (`bba_import_parity_w_subsidy`,
  // `petrobras_price_w_subsidy`) are NOT exposed in the form: they are
  // computed automatically by SQL triggers from ANP reference and
  // commercialization data. See `supabase/migrations/20260527200000_subsidy_reform.sql`.
  {
    slug: "price-bands",
    label: "Price Bands",
    tableName: "price_bands",
    conflictColumns: ["product", "date"],
    defaultSort: { key: "date", dir: "desc" },
    partitionBy: {
      column: "product",
      values: [
        { value: "Diesel", label: "Diesel" },
        { value: "Gasoline", label: "Gasoline" },
      ],
    },
    infoNote:
      "Subsidy-adjusted values (Import Parity w/ Subsidy, Petrobras Price w/ Subsidy) are computed automatically from ANP data — no manual input needed.",
    // Bulk .xlsx upload — mirrors scripts/manual/price_bands_upload.py.
    // Per-sheet header maps because Diesel uses "BBA -" and Gasoline "IBBA -".
    // Obsolete "… w/ subsidy" columns are silently ignored (not mapped); the
    // upsert allowlist further guarantees the `_w_subsidy` columns never ship.
    bulkUpload: {
      partitionColumn: "product",
      sheets: [
        {
          sheetName: "Diesel",
          partitionValue: "Diesel",
          headerMap: {
            Date: "date",
            "BBA - Import Parity": "bba_import_parity",
            "BBA - Export Parity": "bba_export_parity",
            "Petrobras Price": "petrobras_price",
          },
        },
        {
          sheetName: "Gasoline",
          partitionValue: "Gasoline",
          headerMap: {
            Date: "date",
            "IBBA - Import Parity": "bba_import_parity",
            "IBBA - Export Parity": "bba_export_parity",
            "Petrobras Price": "petrobras_price",
          },
        },
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
    ],
  },

  // ── D&G Margins ────────────────────────────────────────────────────────────
  {
    slug: "d-g-margins",
    label: "D&G Margins",
    tableName: "d_g_margins",
    conflictColumns: ["fuel_type", "week"],
    defaultSort: { key: "id", dir: "desc" },
    // `week` is text in "WW/YYYY" format, so a SQL .order() sorts lexically
    // (wrong: "9/2026" > "19/2026", and the year is at the end). Parse into a
    // comparable (year, week) number and sort descending (newest first).
    // Malformed/missing values parse to -1 and sort last.
    clientSort: (a, b) => {
      const parse = (w: unknown): number => {
        if (typeof w !== "string") return -1;
        const [wk, yr] = w.split("/").map((s) => parseInt(s, 10));
        if (!Number.isFinite(wk) || !Number.isFinite(yr)) return -1;
        return yr * 100 + wk;
      };
      return parse(b.week) - parse(a.week); // newest first
    },
    partitionBy: {
      column: "fuel_type",
      values: [
        { value: "Diesel B", label: "Diesel" },
        { value: "Gasoline C", label: "Gasoline" },
      ],
    },
    // Bulk .xlsx upload — mirrors scripts/manual/dg_margins_upload.py.
    // Per-sheet header maps because the biofuel/base-fuel columns differ
    // (Biodiesel/Diesel A on Diesel B; Anhydrous Ethanol/Gasoline A on
    // Gasoline C). Note the Excel header is "Distribution and Resale Margin"
    // ("and") while the registry label is "Distribution & Resale Margin" —
    // the header map bridges this.
    bulkUpload: {
      partitionColumn: "fuel_type",
      sheets: [
        {
          sheetName: "Diesel B",
          partitionValue: "Diesel B",
          headerMap: {
            Week: "week",
            "Distribution and Resale Margin": "distribution_and_resale_margin",
            "State Tax": "state_tax",
            "Federal Tax": "federal_tax",
            Total: "total",
            Biodiesel: "biofuel_component",
            "Diesel A": "base_fuel",
          },
        },
        {
          sheetName: "Gasoline C",
          partitionValue: "Gasoline C",
          headerMap: {
            Week: "week",
            "Distribution and Resale Margin": "distribution_and_resale_margin",
            "State Tax": "state_tax",
            "Federal Tax": "federal_tax",
            Total: "total",
            "Anhydrous Ethanol": "biofuel_component",
            "Gasoline A": "base_fuel",
          },
        },
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
