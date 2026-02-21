-- ============================================================
-- Migration 004: Add stock_name to price_targets
-- ============================================================
-- Stores the parsed stock name alongside the ticker code,
-- so the frontend can display "億光(2393)" instead of just "2393".
-- ============================================================

ALTER TABLE public.price_targets
    ADD COLUMN IF NOT EXISTS stock_name TEXT;

COMMENT ON COLUMN public.price_targets.stock_name IS
    'Human-readable stock name parsed from advisory notification, e.g. 億光';
