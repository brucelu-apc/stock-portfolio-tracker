-- 1. 為目前的持股表補上「買入手續費」欄位
ALTER TABLE public.portfolio_holdings 
ADD COLUMN IF NOT EXISTS buy_fee NUMERIC DEFAULT 0;

-- 2. 為歷史紀錄表補上「總手續費」與「交易稅」欄位
ALTER TABLE public.historical_holdings 
ADD COLUMN IF NOT EXISTS fee NUMERIC DEFAULT 0;

ALTER TABLE public.historical_holdings 
ADD COLUMN IF NOT EXISTS tax NUMERIC DEFAULT 0;
