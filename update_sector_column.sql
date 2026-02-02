-- Add sector column to market_data table
ALTER TABLE public.market_data 
ADD COLUMN IF NOT EXISTS sector TEXT DEFAULT 'Unknown';

-- Add sector column to portfolio_holdings for local override or cache
ALTER TABLE public.portfolio_holdings 
ADD COLUMN IF NOT EXISTS sector TEXT DEFAULT 'Unknown';
