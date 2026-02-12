-- ============================================================
-- Migration 002: Advisory Notification Tracking Tables
-- ============================================================
-- Adds 7 new tables + extends market_data for advisory features.
-- Run this in Supabase SQL Editor after backing up existing data.
-- ============================================================

-- Enable UUID extension (safe to call if already exists)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- STEP 1: Extend existing market_data table
-- ============================================================
ALTER TABLE public.market_data
    ADD COLUMN IF NOT EXISTS day_high NUMERIC,
    ADD COLUMN IF NOT EXISTS day_low NUMERIC,
    ADD COLUMN IF NOT EXISTS day_open NUMERIC,
    ADD COLUMN IF NOT EXISTS volume BIGINT,
    ADD COLUMN IF NOT EXISTS sector TEXT,
    ADD COLUMN IF NOT EXISTS update_source TEXT DEFAULT 'yfinance'
        CHECK (update_source IN ('yfinance', 'twstock', 'manual'));

COMMENT ON TABLE public.market_data IS
    '統一股價快取表：同時服務投組損益計算和投顧防守價監控';
COMMENT ON COLUMN public.market_data.update_source IS
    'yfinance = 收盤價更新, twstock = 盤中即時更新, manual = 手動';

-- ============================================================
-- STEP 2: Advisory Notifications (raw notification records)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.advisory_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    notification_date DATE NOT NULL,
    message_type TEXT NOT NULL
        CHECK (message_type IN (
            'greeting', 'market_analysis', 'recommendation',
            'institutional', 'buy_signal', 'hold', 'sell_signal'
        )),
    raw_text TEXT NOT NULL,
    source TEXT DEFAULT 'dashboard'
        CHECK (source IN ('dashboard', 'line_bot')),
    parsed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_advisory_notif_user_date
    ON public.advisory_notifications (user_id, notification_date DESC);

ALTER TABLE public.advisory_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own advisory notifications"
    ON public.advisory_notifications FOR ALL
    USING (auth.uid() = user_id);

-- ============================================================
-- STEP 3: Price Targets (defense / min / reasonable targets)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.price_targets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    notification_id UUID REFERENCES public.advisory_notifications(id) ON DELETE SET NULL,
    defense_price NUMERIC(10,2),
    min_target_low NUMERIC(10,2),
    min_target_high NUMERIC(10,2),
    reasonable_target_low NUMERIC(10,2),
    reasonable_target_high NUMERIC(10,2),
    entry_price NUMERIC(10,2),
    strategy_notes TEXT,
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    is_latest BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one "latest" target per ticker per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_latest_price_target
    ON public.price_targets (ticker, user_id)
    WHERE is_latest = TRUE;

CREATE INDEX IF NOT EXISTS idx_price_targets_ticker
    ON public.price_targets (ticker);

ALTER TABLE public.price_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own price targets"
    ON public.price_targets FOR ALL
    USING (auth.uid() = user_id);

-- ============================================================
-- STEP 4: Price Alerts (triggered alert records)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.price_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    alert_type TEXT NOT NULL
        CHECK (alert_type IN (
            'defense_breach',
            'min_target_reached',
            'reasonable_target_reached',
            'tp_triggered',
            'sl_triggered'
        )),
    trigger_price NUMERIC(10,2),
    current_price NUMERIC(10,2),
    notified_via TEXT[] DEFAULT '{}',
    triggered_at TIMESTAMPTZ DEFAULT NOW(),
    acknowledged BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user_ticker
    ON public.price_alerts (user_id, ticker, triggered_at DESC);

ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own price alerts"
    ON public.price_alerts FOR ALL
    USING (auth.uid() = user_id);

-- ============================================================
-- STEP 5: User Messaging Settings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_messaging (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    line_user_id TEXT,
    telegram_chat_id BIGINT,
    notification_prefs JSONB DEFAULT '{
        "line_enabled": true,
        "telegram_enabled": true,
        "browser_enabled": true,
        "defense_alert": true,
        "min_target_alert": true,
        "reasonable_target_alert": true,
        "tp_sl_alert": true
    }'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_messaging ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own messaging settings"
    ON public.user_messaging FOR ALL
    USING (auth.uid() = user_id);

-- ============================================================
-- STEP 6: Forward Targets (LINE/Telegram contacts & groups)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.forward_targets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL
        CHECK (platform IN ('line', 'telegram')),
    target_id TEXT NOT NULL,
    target_name TEXT NOT NULL,
    target_type TEXT NOT NULL
        CHECK (target_type IN ('user', 'group')),
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, platform, target_id)
);

ALTER TABLE public.forward_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own forward targets"
    ON public.forward_targets FOR ALL
    USING (auth.uid() = user_id);

-- ============================================================
-- STEP 7: Forward Logs (history of forwarded messages)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.forward_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    forward_target_id UUID REFERENCES public.forward_targets(id) ON DELETE SET NULL,
    tickers TEXT[] NOT NULL,
    message_content JSONB,
    forwarded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forward_logs_user
    ON public.forward_logs (user_id, forwarded_at DESC);

ALTER TABLE public.forward_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own forward logs"
    ON public.forward_logs FOR SELECT
    USING (auth.uid() = user_id);

-- ============================================================
-- STEP 8: Advisory Tracking Status
-- ============================================================
CREATE TABLE IF NOT EXISTS public.advisory_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    tracking_status TEXT DEFAULT 'watching'
        CHECK (tracking_status IN ('watching', 'entered', 'exited', 'ignored')),
    notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, ticker)
);

ALTER TABLE public.advisory_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own advisory tracking"
    ON public.advisory_tracking FOR ALL
    USING (auth.uid() = user_id);

-- ============================================================
-- STEP 9: Enable Supabase Realtime for key tables
-- ============================================================
-- Run these in Supabase Dashboard > Database > Replication:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.market_data;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.price_alerts;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.price_targets;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.advisory_tracking;

-- ============================================================
-- STEP 10: Helper function for updated_at timestamp
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_messaging_updated_at
    BEFORE UPDATE ON public.user_messaging
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_advisory_tracking_updated_at
    BEFORE UPDATE ON public.advisory_tracking
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
