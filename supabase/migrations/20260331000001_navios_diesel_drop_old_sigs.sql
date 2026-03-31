-- Drop old function signatures that accept timestamptz
-- (CREATE OR REPLACE não remove overloads antigos com tipos diferentes)
DROP FUNCTION IF EXISTS public.get_nd_navios(timestamptz);
DROP FUNCTION IF EXISTS public.get_nd_resumo_portos(timestamptz);
