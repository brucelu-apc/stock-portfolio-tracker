# Implementation Plan: Stock Portfolio Tracker

## 1. Database Schema (Supabase)

We will use Supabase (PostgreSQL) as our backend.

### Tables

#### `user_profiles` (NEW: User Roles & Status)
*Stores metadata about users for management.*
```sql
CREATE TABLE user_profiles (
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

-- RLS: Users can read their own profile, Admins can read/write all
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON user_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admins have full access to profiles" ON user_profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);
```

#### `market_data` (Shared Price Info & Exchange Rates)
*Stores real-time price data and USD/TWD exchange rate.*
*Special Ticker: `USDTWD` will store the exchange rate.*
```sql
CREATE TABLE market_data (
    ticker TEXT PRIMARY KEY, -- e.g., 'AAPL', '2330.TW', 'USDTWD'
    region TEXT NOT NULL CHECK (region IN ('TPE', 'US', 'FX')),
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
    buy_date DATE NOT NULL,
    is_multiple BOOLEAN DEFAULT FALSE,
    strategy_mode TEXT DEFAULT 'auto' CHECK (strategy_mode IN ('manual', 'auto')),
    manual_tp NUMERIC,
    manual_sl NUMERIC,
    high_watermark_price NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS Policy: Users can only see their own holdings
ALTER TABLE portfolio_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can only access their own holdings" 
ON portfolio_holdings FOR ALL USING (auth.uid() = user_id);
```

## 2. Frontend Architecture (React + Chakra UI)

### Project Structure
```
src/
  components/
    auth/           # Login, Signup forms (Add Google Login)
    admin/          # NEW: UserManagement table
    settings/       # NEW: Profile view, Change Password
    dashboard/      # Summary cards, Exchange rate
    holdings/       # HoldingsTable, AddHoldingModal, HoldingRow
    common/         # Layout, Navbar (Add Admin link)
  hooks/
    usePortfolio.ts 
    useAdmin.ts     # NEW: For fetching/managing user list
  services/
    supabase.ts     
  utils/
    calculations.ts 
```

### Key Components
1.  **`AuthPage`**: Added "Continue with Google" button.
2.  **`AdminDashboard`**: Table view of `user_profiles` with status dropdowns.
3.  **`SettingsPage`**: Displays account status and "Update Password" form.

## 3. Backend & Scheduling (GitHub Actions + Python)

### Script: `scripts/update_market_data.py`
- Fetches `TWD=X` and stock prices.
- Updates high watermarks for trailing stops.

## 4. Implementation Steps

1.  **Setup Supabase**: Run NEW SQL scripts for `user_profiles` and triggers.
2.  **Auth Enhancement**: Implement Google Login and Profile creation.
3.  **Admin Feature**: Build User Management dashboard.
4.  **Security Update**: Apply RLS policies for `user_profiles`.
5.  **User Settings**: Implement Change Password and Status display.
