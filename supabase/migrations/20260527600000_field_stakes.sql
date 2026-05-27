-- Table: per-field × per-company working-interest (stake percentage)
-- Manually curated by Admin via /admin-panel "Field Stakes" section.
-- Read by future /production dashboard to compute company-attributable production.

CREATE TABLE public.field_stakes (
  campo        text NOT NULL,
  empresa      text NOT NULL,
  stake_pct    numeric(6,3) NOT NULL CHECK (stake_pct > 0 AND stake_pct <= 100),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES auth.users(id),
  PRIMARY KEY (campo, empresa)
);

ALTER TABLE public.field_stakes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "field_stakes_read_all"
  ON public.field_stakes FOR SELECT TO anon, authenticated USING (true);

-- No INSERT/UPDATE/DELETE policies → all writes go through SECURITY DEFINER RPCs below.

CREATE INDEX field_stakes_campo_idx   ON public.field_stakes (campo);
CREATE INDEX field_stakes_empresa_idx ON public.field_stakes (empresa);

------------------------------------------------------------
-- RPC 1: overview of all campos (with-stakes + without-stakes from mv_anp_cdp_pocos)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_field_stakes_overview()
  RETURNS TABLE (
    campo                 text,
    n_empresas            int,
    soma_pct              numeric,
    is_complete           boolean,
    has_data_in_producao  boolean,
    last_updated          timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH all_campos AS (
      SELECT DISTINCT campo FROM mv_anp_cdp_pocos WHERE campo IS NOT NULL
      UNION
      SELECT DISTINCT campo FROM field_stakes
    ),
    stakes_agg AS (
      SELECT campo,
             COUNT(*)::int     AS n_empresas,
             SUM(stake_pct)    AS soma_pct,
             MAX(updated_at)   AS last_updated
        FROM field_stakes
       GROUP BY campo
    )
    SELECT
      ac.campo,
      COALESCE(sa.n_empresas, 0)::int                   AS n_empresas,
      COALESCE(sa.soma_pct, 0)                          AS soma_pct,
      COALESCE(sa.soma_pct = 100, false)                AS is_complete,
      EXISTS (SELECT 1 FROM mv_anp_cdp_pocos m WHERE m.campo = ac.campo) AS has_data_in_producao,
      sa.last_updated
    FROM all_campos ac
    LEFT JOIN stakes_agg sa USING (campo)
    ORDER BY ac.campo;
  $$;

------------------------------------------------------------
-- RPC 2: list stakes for one campo (editor consumes this)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_field_stakes(p_campo text)
  RETURNS TABLE (empresa text, stake_pct numeric, updated_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT empresa, stake_pct, updated_at
      FROM field_stakes
     WHERE campo = p_campo
     ORDER BY stake_pct DESC, empresa;
  $$;

------------------------------------------------------------
-- RPC 3: atomic upsert of ALL stakes for one campo (replace-all in 1 tx,
--        validates SUM(stake_pct) = 100 before commit)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_field_stakes(
  p_campo  text,
  p_stakes jsonb  -- [{"empresa":"Petrobras","stake_pct":88.99}, ...]
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_sum numeric;
    v_uid uuid := auth.uid();
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF p_campo IS NULL OR length(trim(p_campo)) = 0 THEN
      RAISE EXCEPTION 'campo_required' USING ERRCODE = '22023';
    END IF;

    SELECT SUM((s->>'stake_pct')::numeric)
      INTO v_sum
      FROM jsonb_array_elements(p_stakes) s;

    IF v_sum IS NULL OR v_sum <> 100 THEN
      RAISE EXCEPTION 'sum_must_equal_100: got %', COALESCE(v_sum, 0)
        USING ERRCODE = '23514';
    END IF;

    DELETE FROM field_stakes WHERE campo = p_campo;

    INSERT INTO field_stakes (campo, empresa, stake_pct, updated_by)
    SELECT p_campo,
           trim(s->>'empresa'),
           (s->>'stake_pct')::numeric,
           v_uid
      FROM jsonb_array_elements(p_stakes) s
     WHERE trim(s->>'empresa') <> '';
  END;
  $$;

------------------------------------------------------------
-- RPC 4: delete all stakes for one campo (admin only)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_field_stakes(p_campo text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    DELETE FROM field_stakes WHERE campo = p_campo;
  END;
  $$;

------------------------------------------------------------
-- RPC 5: list distinct empresas already registered (autocomplete)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_field_stakes_empresas()
  RETURNS TABLE (empresa text, n_campos int)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT empresa, COUNT(DISTINCT campo)::int AS n_campos
      FROM field_stakes
     GROUP BY empresa
     ORDER BY 2 DESC, 1;
  $$;

------------------------------------------------------------
-- Grants
------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_field_stakes_overview()       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_field_stakes(text)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_field_stakes_empresas()       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_field_stakes(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_field_stakes(text)   TO authenticated;
