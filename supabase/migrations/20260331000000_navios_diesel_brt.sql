-- ============================================================================
-- Navios Diesel — retornar timestamps em BRT (America/Sao_Paulo)
-- Os dados continuam armazenados em UTC; as funções convertem na saída.
-- ============================================================================

-- ── RPC 1: Latest collection timestamp (BRT) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_nd_ultima_coleta()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT json_build_object(
    'ultima_coleta',
    to_char(MAX(collected_at) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS')
  )
  FROM public.navios_diesel;
$$;

-- ── RPC 2: All distinct collection timestamps (BRT) ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_nd_coletas_distintas()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(json_agg(ts ORDER BY ts DESC), '[]'::json)
  FROM (
    SELECT DISTINCT
      to_char(collected_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS ts
    FROM public.navios_diesel
  ) sub;
$$;

-- ── RPC 3: Vessel rows — aceita timestamp BRT como texto ─────────────────────
-- O parâmetro chega como string BRT ("YYYY-MM-DDTHH:MM:SS"), é convertido
-- para timestamptz (UTC) antes de comparar com collected_at.
CREATE OR REPLACE FUNCTION public.get_nd_navios(p_collected_at text)
RETURNS SETOF public.navios_diesel LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.navios_diesel
  WHERE collected_at = (p_collected_at::timestamp AT TIME ZONE 'America/Sao_Paulo')
  ORDER BY porto, status, navio;
$$;

-- ── RPC 4: Per-port aggregation — aceita timestamp BRT como texto ─────────────
CREATE OR REPLACE FUNCTION public.get_nd_resumo_portos(p_collected_at text)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(json_agg(row_to_json(sub)), '[]'::json)
  FROM (
    SELECT
      porto,
      COUNT(*)::int                              AS total_navios,
      COALESCE(SUM(quantidade), 0)               AS total_quantidade,
      COALESCE(SUM(quantidade_convertida), 0)    AS total_convertida
    FROM public.navios_diesel
    WHERE collected_at = (p_collected_at::timestamp AT TIME ZONE 'America/Sao_Paulo')
    GROUP BY porto
    ORDER BY total_navios DESC
  ) sub;
$$;
