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
  // RETIRED (2026-06-05): the `d_g_margins` table is now computed automatically
  // (weekly composition from ANP · CEPEA/ESALQ · CONFAZ). The dashboard is
  // read-only and no longer accepts manual Data Input. Do not re-add an
  // EditableTableConfig entry for it.
];
