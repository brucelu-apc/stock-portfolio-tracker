-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Market Data Table (Stores Prices & Exchange Rates)
CREATE TABLE public.market_data (
    ticker TEXT PRIMARY KEY, -- e.g., 'AAPL', '2330.TW', 'USDTWD'
    region TEXT NOT NULL CHECK (region IN ('TPE', 'US', 'FX')),
    current_price NUMERIC,
    prev_close NUMERIC,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for market_data (Public read is fine, but write needs restriction)
ALTER TABLE public.market_data ENABLE ROW LEVEL SECURITY;
-- Allow everyone to read market data
CREATE POLICY "Enable read access for all users" ON public.market_data FOR SELECT USING (true);
-- Only service_role can update (for GitHub Actions)
CREATE POLICY "Enable write access for service_role only" ON public.market_data FOR ALL USING (auth.role() = 'service_role');


-- 2. Portfolio Holdings Table (Active Positions)
CREATE TABLE public.portfolio_holdings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    ticker TEXT NOT NULL,
    region TEXT NOT NULL,
    name TEXT,
    shares NUMERIC NOT NULL,
    cost_price NUMERIC NOT NULL, -- Average cost
    buy_date DATE NOT NULL,
    is_multiple BOOLEAN DEFAULT FALSE,
    
    -- Strategy Columns
    strategy_mode TEXT DEFAULT 'auto' CHECK (strategy_mode IN ('manual', 'auto')),
    manual_tp NUMERIC,
    manual_sl NUMERIC,
    high_watermark_price NUMERIC,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.portfolio_holdings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see/edit their own data
CREATE POLICY "Users can CRUD their own holdings" 
ON public.portfolio_holdings 
FOR ALL 
USING (auth.uid() = user_id);


-- 3. Historical Holdings Table (Archived)
CREATE TABLE public.historical_holdings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id),
    ticker TEXT,
    shares NUMERIC,
    cost_price NUMERIC,
    sell_price NUMERIC,
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    archive_reason TEXT -- 'sold', 'adjusted'
);

-- Enable RLS
ALTER TABLE public.historical_holdings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see/edit their own history
CREATE POLICY "Users can CRUD their own history" 
ON public.historical_holdings 
FOR ALL 
USING (auth.uid() = user_id);
