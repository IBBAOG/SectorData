-- Replace any prior system-owned public stocks portfolios with a snapshot
-- of ibbaogproject@gmail.com's portfolios. Re-run-safe.
--
-- Context: the Market Watch (/stocks) module is anon-accessible. The hook
-- src/hooks/useStockPortfolios.ts reads every row WHERE is_public = TRUE
-- for anonymous visitors. Previously seeded data lived in
-- supabase/migrations/20260522000001_anonymous_access.sql (single hardcoded
-- portfolio "Brazilian Oil & Gas (default)"). This migration replaces that
-- seed with a live snapshot of ibbaogproject@gmail.com's own portfolios,
-- cloned as system-owned rows (user_id IS NULL, is_public = TRUE).
--
-- Idempotent: each run clears prior system-owned public rows and re-clones
-- from the current state of ibbaogproject.

DELETE FROM public.stock_portfolios
WHERE user_id IS NULL AND is_public = TRUE;

INSERT INTO public.stock_portfolios (id, user_id, name, tickers, groups, is_public, is_active)
SELECT gen_random_uuid(), NULL, sp.name, sp.tickers, sp.groups, TRUE, sp.is_active
FROM public.stock_portfolios sp
JOIN auth.users u ON u.id = sp.user_id
WHERE u.email = 'ibbaogproject@gmail.com';

-- Belt and suspenders: ensure the module stays open to anon.
UPDATE public.module_visibility
   SET is_visible_for_public = TRUE
 WHERE module_slug = 'stocks';
