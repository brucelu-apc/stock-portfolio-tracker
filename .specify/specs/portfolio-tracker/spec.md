# Specification: Stock Portfolio Tracker (MVP)

## User Stories
- As a user, I want to manage my TW and US stock holdings in a consolidated view.
- As a user, I want to see my aggregated portfolio value in TWD.
- As a user, I want to easily add new holdings and have the system handle multiple entries of the same stock.
- As a user, I want to "Sell All" or "Adjust Position" (Edit) for a stock, and have the system auto-archive historical data.
- As a user, I want stock prices and exchange rates to auto-update daily.
- As a user, I want advanced Take Profit (TP) and Stop Loss (SL) strategies, including manual override and trailing stop.
- As a user, I want to sign up using either my email or my Google account.
- As an administrator, I want to review and manage user applications and roles.

## Functional Requirements

### 1. Authentication & Authorization
- **Providers**: 
    - Supabase Auth (Email/Password).
    - Google OAuth (Social Login).
- **Default Admin**: `sys@stockadmin.tw` (Initial password: `Admin`).
- **Roles**:
    - `Admin`: Can view and manage all users.
    - `User`: Standard access.
- **Account Status**:
    - `Pending`: Default status after signup. User can login but might have restricted access until approved.
    - `Enabled`: Full access.
    - `Rejected`: Access denied.
    - `Disabled`: Account locked by admin.
- **User Actions**:
    - Change password (applicable for Email/Password users only).

### 2. Administrator Management Panel
- **User Management Table**:
    - View list of all registered users.
    - Fields: Email, Role, Status, Signup Date.
    - **Actions (Admin only)**: 
        - Toggle Role between `User` and `Admin`.
        - Change Status (`Pending`, `Enabled`, `Rejected`, `Disabled`).
- **User View**:
    - Users can view their current status in their profile/settings page.

### 3. Portfolio Management (Core Logic)

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

### 4. Data & Scheduling
- **Source**: **yfinance** (Python) via GitHub Actions (Daily Cron).
- **Tasks**:
    1. Fetch latest stock prices & exchange rates.
    2. Update `market_data` table.
    3. **System Logic**: For every holding in 'Auto' mode:
        - Check if `Current Price > high_watermark_price`.
        - If yes, update `high_watermark_price`.
        - (This automatically lifts the TP price in the UI).

### 5. Database Schema (Draft)
- **user_profiles**: (Links to `auth.users`)
    - `id` (references auth.users), `email`, `role`, `status`, `updated_at`.
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
