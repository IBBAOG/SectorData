-- ============================================================================
-- RPC: list of vessels in the current line-up snapshot that still have no
-- IMO/MMSI resolved — used by the dashboard AIS layer to show the user which
-- vessels are pending resolution.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_nd_unresolved(p_collected_at timestamptz)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(json_agg(navio ORDER BY navio), '[]'::json)
  FROM (
    SELECT DISTINCT navio
    FROM public.navios_diesel
    WHERE collected_at = p_collected_at
      AND status NOT IN ('Despachado', 'ERRO_COLETA')
      AND imo IS NULL
      AND mmsi IS NULL
  ) x;
$$;
