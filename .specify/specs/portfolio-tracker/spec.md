# Specification: Stock Portfolio Tracker (MVP)

## User Stories
- As a user, I want to sign up and log in securely to protect my financial data.
- As a user, I want to add and manage my holdings for both Taiwan (TW) and US stocks.
- As a user, I want to see my portfolio value in TWD, regardless of the original currency.
- As a user, I want to see real-time or near-real-time gains/losses and ROI.
- As a user, I want to manually override or auto-fetch the USD/TWD exchange rate.

## Functional Requirements

### 1. Authentication
- User signup/login via Email/Password (Supabase Auth).
- Persistent sessions.

### 2. Portfolio Management
- Add holding: Ticker (e.g., 2330.TW, AAPL), Quantity, Average Cost.
- Currency handling: Automatically identify currency based on ticker suffix (.TW = TWD, else USD).
- Transaction history (Optional for MVP, but recommended).

### 3. Dashboard (RWD)
- **Exchange Rate Section**: Show USD/TWD rate. Buttons to edit or "Fetch Latest".
- **Summary Cards**:
    - Total Cost (TWD)
    - Total Market Value (TWD)
    - Total P&L (TWD)
    - Total ROI (%)
- **Holdings Table**: List of stocks with Ticker, Name, Shares, Avg Cost, Current Price, Market Value, P&L, P&L %.

### 4. Data Sync (Scheduled Task)
- GitHub Action runs periodically to:
    - Fetch latest prices for all active tickers in the DB.
    - Fetch latest USD/TWD exchange rate.
    - Update `last_price` and `exchange_rate` fields in Supabase.

### 5. Settings & Profile
- Basic profile management.
- Setting preference for "Red is Up" (TW style) or "Green is Up" (US style).

## Non-Functional Requirements
- **Responsive**: Works on desktop, tablet, and mobile.
- **Performance**: Dashboard should load fast using cached prices from the DB.
- **Cost**: Stay within the free tiers of Vercel and Supabase.
