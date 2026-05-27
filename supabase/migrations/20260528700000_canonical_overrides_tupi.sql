-- Manual canonical override for PDF Well-by-Well's Tupi aggregation.
-- The PDF (page 3 + 4) explicitly notes: "Tupi data contains 'Sul de Tupi' field".
-- Same operator (Petrobras), adjacent reservoir, single play in IR reports.
-- The regex in canonical_field_name() doesn't catch "SUL DE TUPI" -> "TUPI",
-- so we add a manual override row in field_canonical_names.

INSERT INTO public.field_canonical_names (variant, canonical, source)
VALUES ('SUL DE TUPI', 'TUPI', 'manual')
ON CONFLICT (variant) DO UPDATE
   SET canonical = EXCLUDED.canonical,
       source = EXCLUDED.source;

-- Refresh the 2 MVs that materialize canonical names.
-- Without this, the override only takes effect on NEW data; existing MV rows
-- still have the old canonical until next ETL-triggered refresh.
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_production_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_brazil_canonical_monthly;
