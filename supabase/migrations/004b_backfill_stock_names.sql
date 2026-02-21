-- ============================================================
-- Migration 004b: Backfill stock_name in price_targets
-- ============================================================
-- For existing price_targets records where stock_name is NULL,
-- attempt to fill from portfolio_holdings.name.
-- This is a one-time backfill; future imports will set stock_name directly.
-- ============================================================

UPDATE public.price_targets pt
SET stock_name = ph.name
FROM public.portfolio_holdings ph
WHERE pt.ticker = ph.ticker
  AND pt.user_id = ph.user_id
  AND pt.stock_name IS NULL
  AND ph.name IS NOT NULL
  AND ph.name != '';
