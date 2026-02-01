-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. User Profiles (Metadata & Roles)
CREATE TABLE public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'enabled', 'rejected', 'disabled')),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Enable RLS for user_profiles
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" 
ON public.user_profiles FOR SELECT 
USING (auth.uid() = id);

-- This policy needs careful execution: 
-- Initially, we need to manually set the first admin
CREATE POLICY "Admins have full access to profiles" 
ON public.user_profiles FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles 
    WHERE id = auth.uid() AND role = 'admin'
  )
);


-- 2. Market Data Table (Stores Prices & Exchange Rates)
CREATE TABLE public.market_data (
    ticker TEXT PRIMARY KEY, 
    region TEXT NOT NULL CHECK (region IN ('TPE', 'US', 'FX')),
    current_price NUMERIC,
    prev_close NUMERIC,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.market_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read access for all users" ON public.market_data FOR SELECT USING (true);
CREATE POLICY "Enable write access for service_role only" ON public.market_data FOR ALL USING (auth.role() = 'service_role');


-- 3. Portfolio Holdings Table (Active Positions)
CREATE TABLE public.portfolio_holdings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    ticker TEXT NOT NULL,
    region TEXT NOT NULL,
    name TEXT,
    shares NUMERIC NOT NULL,
    cost_price NUMERIC NOT NULL,
    buy_date DATE NOT NULL,
    is_multiple BOOLEAN DEFAULT FALSE,
    strategy_mode TEXT DEFAULT 'auto' CHECK (strategy_mode IN ('manual', 'auto')),
    manual_tp NUMERIC,
    manual_sl NUMERIC,
    high_watermark_price NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.portfolio_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD their own holdings" 
ON public.portfolio_holdings 
FOR ALL 
USING (auth.uid() = user_id);


-- 4. Historical Holdings Table (Archived)
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

ALTER TABLE public.historical_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD their own history" 
ON public.historical_holdings 
FOR ALL 
USING (auth.uid() = user_id);
