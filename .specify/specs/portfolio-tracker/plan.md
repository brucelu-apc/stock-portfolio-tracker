# Implementation Plan: Stock Portfolio Tracker

## 1. Database Schema (Supabase)

We will use Supabase (PostgreSQL) as our backend.

### Tables

#### `market_data` (Shared Price Info & Exchange Rates)
*Stores real-time price data and USD/TWD exchange rate.*
*Special Ticker: `USDTWD` will store the exchange rate.*
```sql
CREATE TABLE market_data (
    ticker TEXT PRIMARY KEY, -- e.g., 'AAPL', '2330.TW', 'USDTWD'
    region TEXT NOT NULL CHECK (region IN ('TPE', 'US', 'FX')), -- Added 'FX' for Forex
    current_price NUMERIC,
    prev_close NUMERIC,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### `portfolio_holdings` (Active Holdings)
*Stores current user positions.*
```sql
CREATE TABLE portfolio_holdings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    ticker TEXT NOT NULL,
    region TEXT NOT NULL,
    name TEXT,
    shares NUMERIC NOT NULL,
    cost_price NUMERIC NOT NULL, -- Average cost
    buy_date DATE NOT NULL,      -- Date of latest entry
    is_multiple BOOLEAN DEFAULT FALSE,
    
    -- TP/SL Strategy
    strategy_mode TEXT DEFAULT 'auto' CHECK (strategy_mode IN ('manual', 'auto')),
    manual_tp NUMERIC,
    manual_sl NUMERIC,
    high_watermark_price NUMERIC, -- For Trailing Stop logic
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS Policy: Users can only see their own holdings
ALTER TABLE portfolio_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can only access their own holdings" 
ON portfolio_holdings FOR ALL USING (auth.uid() = user_id);
```

#### `historical_holdings` (Archived)
*Stores sold or adjusted positions.*
```sql
CREATE TABLE historical_holdings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id),
    ticker TEXT,
    shares NUMERIC,
    cost_price NUMERIC,
    sell_price NUMERIC, -- Estimated based on current market price at archive time
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    archive_reason TEXT -- 'sold', 'adjusted'
);
```

## 2. Frontend Architecture (React + Chakra UI)

### Project Structure
```
src/
  components/
    auth/           # Login, Signup forms
    dashboard/      # Summary cards, Exchange rate
    holdings/       # HoldingsTable, AddHoldingModal, HoldingRow
    common/         # Layout, Navbar, ProtectedRoute
  hooks/
    usePortfolio.ts # CRUD for holdings
    useMarketData.ts# Fetch prices (including USDTWD)
  services/
    supabase.ts     # Supabase client client
  utils/
    calculations.ts # Logic for TP/SL, P&L, Weighted Avg
```

### Key Components
1.  **`HoldingsTable`**: The main view. Renders `HoldingRow` components.
2.  **`ExchangeRateWidget`**: Fetches `USDTWD` from `market_data` table.
3.  **`HoldingRow`**: Handles the logic for displaying aggregated data vs expanded history.
4.  **`StrategyToggle`**: A small component inside the row to switch between Auto/Manual.

## 3. Backend & Scheduling (GitHub Actions + Python)

### Script: `scripts/update_market_data.py`
- **Dependencies**: `yfinance`, `supabase`
- **Logic**:
    1. **Exchange Rate**: Always fetch `TWD=X` (Yahoo Finance Symbol) and upsert as `USDTWD` with region `FX`.
    2. **Stock Prices**: Query distinct tickers from `portfolio_holdings`.
    3. Batch fetch stock prices using `yfinance`.
    4. Upsert data into `market_data` table.
    5. **High Watermark Logic**: Fetch all 'auto' strategy holdings, compare `current_price` vs `high_watermark_price`. If current > high, update high watermark in DB.

### Workflow: `.github/workflows/market-update.yml`
- **Schedule**:
    - Daily at 21:30 UTC (After US close / Before TW open).
    - Daily at 06:00 UTC (After TW close).
- **Secrets**: `SUPABASE_URL`, `SUPABASE_KEY`.

## 4. Implementation Steps

1.  **Setup Supabase**: Run SQL scripts to create tables and RLS policies.
2.  **Frontend Scaffold**: Setup Vite + Chakra UI + Supabase Auth.
3.  **Core Feature**: Implement "Add Holding" and "List Holdings".
4.  **Exchange Rate**: Implement display and manual override.
5.  **Advanced Logic**: Implement Client-side TP/SL calculation display.
6.  **Automation**: Write Python script and configure GitHub Action.
