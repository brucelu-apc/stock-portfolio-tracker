# Tasks: Stock Portfolio Tracker MVP

## Phase 1: Infrastructure & Database
- [ ] **Setup Supabase Project**
    - [ ] Create new project on Supabase.
    - [ ] Execute SQL scripts from `plan.md` to create tables (`market_data`, `portfolio_holdings`, `historical_holdings`).
    - [ ] Enable RLS and setup policies.
- [ ] **Project Scaffold**
    - [ ] Initialize Vite + React project (TypeScript).
    - [ ] Install Chakra UI and dependencies.
    - [ ] Configure Supabase Client (`src/services/supabase.ts`).

## Phase 2: Frontend - Core Features
- [ ] **Authentication**
    - [ ] Create Login/Signup page.
    - [ ] Implement ProtectedRoute logic.
- [ ] **Portfolio Management**
    - [ ] Create `AddHoldingModal` with validation logic (Region/Ticker).
    - [ ] Implement `usePortfolio` hook for CRUD operations.
    - [ ] Implement "Add" logic: Check for existing ticker, update `is_multiple` flag.
- [ ] **Holdings View**
    - [ ] Build `HoldingsTable` layout.
    - [ ] Build `HoldingRow` with expand/collapse functionality.
    - [ ] Implement aggregation logic (Weighted Avg Cost, Total Shares).
    - [ ] Add "Edit" (Rebalance) and "Delete" (Archive) logic.

## Phase 3: Advanced Logic (TP/SL)
- [ ] **Strategy Component**
    - [ ] Build `StrategyToggle` UI (Manual/Auto switch).
    - [ ] Implement "Auto" calculation logic: `MAX(Cost*1.1, HighWatermark*0.9)`.
    - [ ] Implement "Manual" input fields.
- [ ] **Visuals**
    - [ ] Apply TW Stock colors (Red/Green) to P&L columns.

## Phase 4: Automation & Deployment
- [ ] **Python Script**
    - [ ] Write `scripts/update_market_data.py` using `yfinance`.
    - [ ] Implement High Watermark update logic in Python.
- [ ] **CI/CD**
    - [ ] Configure `.github/workflows/market-update.yml`.
    - [ ] Configure Vercel deployment for frontend.
