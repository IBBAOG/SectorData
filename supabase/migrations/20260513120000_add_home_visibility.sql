-- Reform: Admin curates which cards appear on the Home gallery.
-- Adds is_visible_on_home (default true, backward-compat).
-- Updates get_module_visibility() to expose the new column.
-- Adds set_module_home_visibility() admin-only RPC.

ALTER TABLE module_visibility
  ADD COLUMN IF NOT EXISTS is_visible_on_home BOOLEAN NOT NULL DEFAULT true;

DROP FUNCTION IF EXISTS get_module_visibility();

CREATE OR REPLACE FUNCTION get_module_visibility()
RETURNS TABLE (module_slug TEXT, is_visible_for_clients BOOLEAN, is_visible_on_home BOOLEAN)
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT module_slug, is_visible_for_clients, is_visible_on_home
  FROM module_visibility
$$;

GRANT EXECUTE ON FUNCTION get_module_visibility() TO authenticated;

CREATE OR REPLACE FUNCTION set_module_home_visibility(p_slug TEXT, p_is_visible BOOLEAN)
RETURNS module_visibility
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_role TEXT;
  v_row module_visibility;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = (select auth.uid());
  IF v_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO module_visibility (module_slug, is_visible_on_home)
  VALUES (p_slug, p_is_visible)
  ON CONFLICT (module_slug)
  DO UPDATE SET is_visible_on_home = EXCLUDED.is_visible_on_home
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION set_module_home_visibility(TEXT, BOOLEAN) TO authenticated;
