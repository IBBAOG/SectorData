-- Add groups JSONB column for sub-portfolios
ALTER TABLE stock_portfolios ADD COLUMN IF NOT EXISTS groups jsonb NOT NULL DEFAULT '[]';

-- Migrate existing tickers into a default "General" group
UPDATE stock_portfolios
SET groups = jsonb_build_array(
  jsonb_build_object('name', 'General', 'tickers', tickers)
)
WHERE groups = '[]'::jsonb
  AND array_length(tickers, 1) > 0;
