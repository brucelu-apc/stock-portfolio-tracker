# Stock Portfolio Tracker Database Schema

## Tables

### 1. `portfolio_holdings` (Active Holdings)
- `ticker` (TEXT): Stock symbol (e.g., 2330, AAPL)
- `region` (TEXT): 'TPE' or 'US'
- `name` (TEXT): Stock name
- `shares` (NUMERIC): Quantity held
- `cost_price` (NUMERIC): Average cost per share
- `strategy_mode` (TEXT): 'auto' or 'manual'
- `high_watermark_price` (NUMERIC): Highest price recorded for trailing stop
- `user_id` (UUID): Owner of the record

### 2. `market_data` (Global Price Cache)
- `ticker` (TEXT): Symbol
- `current_price` (NUMERIC): Latest price
- `prev_close` (NUMERIC): Previous close price
- `updated_at` (TIMESTAMP): Last sync time
- Special Ticker: `USDTWD` (region='FX') stores the exchange rate.

### 3. `historical_holdings` (Sold/Archived)
- `ticker` (TEXT): Symbol
- `shares` (NUMERIC): Quantity sold
- `cost_price` (NUMERIC): Buy cost
- `sell_price` (NUMERIC): Realized price
- `fee` (NUMERIC): Total fees
- `tax` (NUMERIC): Total tax
- `archived_at` (TIMESTAMP): Settlement date
