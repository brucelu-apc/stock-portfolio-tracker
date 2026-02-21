-- ================================================================
-- Migration 005: Fix update_source CHECK constraint
-- ================================================================
-- PROBLEM: The check constraint on market_data.update_source
-- does not include 'yfinance-gh' (used by GitHub Actions backup),
-- causing ALL updates from GA to fail with:
--   "new row violates check constraint market_data_update_source_check"
--
-- This migration:
--   1. Drops the old constraint (if it exists)
--   2. Recreates it with 'yfinance-gh' included
-- ================================================================

-- Drop existing constraint
ALTER TABLE market_data
  DROP CONSTRAINT IF EXISTS market_data_update_source_check;

-- Recreate with all valid sources (including yfinance-gh for GitHub Actions)
ALTER TABLE market_data
  ADD CONSTRAINT market_data_update_source_check
  CHECK (update_source IN (
    'yfinance',        -- Railway APScheduler (primary)
    'yfinance-gh',     -- GitHub Actions (backup)
    'twstock',         -- twstock realtime (legacy)
    'fugle_ws',        -- Fugle WebSocket
    'finnhub_ws',      -- Finnhub WebSocket (US)
    'polygon_rest',    -- Polygon REST fallback (US)
    'shioaji'          -- Shioaji broker feed
  ));

-- Done: After running this, re-trigger the GitHub Actions workflow.
