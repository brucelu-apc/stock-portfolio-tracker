-- ================================================================
-- Migration v2: Realtime Price / Close Price Separation
-- ================================================================
-- Adds two new columns to market_data:
--   realtime_price  — intraday price from twstock (盤中即時價)
--   close_price     — official closing price from yfinance (收盤價)
--
-- The existing current_price column is KEPT as "best available price"
-- and continues to drive alerts, market value calculations, etc.
-- ================================================================
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ================================================================

-- ─── Add new columns ──────────────────────────────────────────

ALTER TABLE market_data
  ADD COLUMN IF NOT EXISTS realtime_price NUMERIC DEFAULT NULL;

ALTER TABLE market_data
  ADD COLUMN IF NOT EXISTS close_price NUMERIC DEFAULT NULL;

-- ─── Ensure UNIQUE constraint on ticker ─────────────────────
-- This is CRITICAL for Supabase upsert with on_conflict='ticker'.
-- Without it, upsert inserts duplicate rows instead of updating.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'market_data_ticker_unique'
  ) THEN
    ALTER TABLE market_data
      ADD CONSTRAINT market_data_ticker_unique UNIQUE (ticker);
  END IF;
END $$;

-- ─── Backfill: set close_price = current_price for existing rows ──
-- This ensures existing data shows proper close prices immediately.
UPDATE market_data
  SET close_price = current_price
  WHERE close_price IS NULL AND current_price IS NOT NULL;

-- ─── Done ─────────────────────────────────────────────────────
-- After running this migration:
-- 1. Deploy updated stock_monitor.py (writes realtime_price + close_price)
-- 2. Deploy updated frontend (shows separated columns)
-- 3. twstock will populate realtime_price during market hours
-- 4. yfinance will populate close_price after market close
