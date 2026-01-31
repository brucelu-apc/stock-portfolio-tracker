# Specification: Stock Portfolio Tracker (MVP)

## User Stories
- As a user, I want to manage my TW and US stock holdings in a consolidated view.
- As a user, I want to see my aggregated portfolio value in TWD.
- As a user, I want to easily add new holdings and have the system handle multiple entries of the same stock.
- As a user, I want to "Sell All" or "Adjust Position" (Edit) for a stock, and have the system auto-archive historical data.
- As a user, I want stock prices and exchange rates to auto-update daily.
- As a user, I want advanced Take Profit (TP) and Stop Loss (SL) strategies, including manual override and trailing stop.

## Functional Requirements

### 1. Authentication
- **Provider**: Supabase Auth (Email/Password).
- **Security**: Row Level Security (RLS) ensures users only access their own data.

### 2. Portfolio Management (Core Logic)

#### A. Add Holding (UI)
- **Fields**: Region (TPE/US), Ticker, Name, Price, Shares, Date.
- **Logic**: 
    - Auto-aggregate multiple entries (is_multiple = true).
    - Initialize `strategy_mode = 'Auto'`.
    - Initialize `high_watermark_price = Cost Price`.

#### B. Holdings List (Display & Aggregation)
- **View**: Aggregated row per Ticker. Click to expand history.
- **Columns**: Region, Ticker, Name, Avg Price, Total Shares, Date (Latest), Current Price, Change %, Market Value, P&L, ROI %.
- **Advanced TP/SL Column**:
    - **Toggle**: Manual / Auto.
    - **Display**: Shows current TP and SL prices.
    - **Edit Mode (Manual)**: User can input specific prices.
    - **View Mode (Auto)**: Read-only, calculated by system.
    
#### C. TP/SL Strategy Logic
- **Manual Mode**: User sets static TP and SL prices.
- **Auto Mode (Smart Trailing)**:
    - **SL (Stop Loss)**: Fixed at `Avg Cost` (Breakeven protection).
    - **TP (Trailing Take Profit)**:
        - Logic: `MAX(Avg Cost * 1.1, High Watermark * 0.9)`.
        - **Initial**: Target 10% profit.
        - **Trailing**: If price rises, TP follows (10% retracement from peak), ensuring profit isn't given back.
    - **High Watermark**: Updated daily by system if `Current Price > High Watermark`.

#### D. Operations
- **Delete**: Sell All -> Archive all entries to history.
- **Edit**: Adjust Position -> Archive old, create new consolidated entry (maintaining Weighted Avg Cost).

### 3. Data & Scheduling
- **Source**: **yfinance** (Python) via GitHub Actions (Daily Cron).
- **Tasks**:
    1. Fetch latest stock prices & exchange rates.
    2. Update `market_data` table.
    3. **System Logic**: For every holding in 'Auto' mode:
        - Check if `Current Price > high_watermark_price`.
        - If yes, update `high_watermark_price`.
        - (This automatically lifts the TP price in the UI).

### 4. Database Schema (Draft)
- **portfolio_holdings**: 
    - `id`, `user_id`, `ticker`, `region`, `shares`, `cost_price`, `buy_date`
    - `is_multiple` (bool)
    - `strategy_mode` (enum: 'manual', 'auto')
    - `manual_tp`, `manual_sl` (numeric, nullable)
    - `high_watermark_price` (numeric, default=cost)
- **historical_holdings**: Same + `archived_at`, `archive_reason`.
- **market_data**: `ticker`, `current_price`, `prev_close`, `updated_at`.

## UI/UX Requirements
- **Framework**: React + Chakra UI.
- **Visuals**: 
    - TW Colors (Red=Up, Green=Down).
    - TP/SL visual indicators (e.g., progress bar relative to current price).
