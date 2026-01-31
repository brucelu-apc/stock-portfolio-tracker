import os
import yfinance as yf
from supabase import create_client, Client
from datetime import datetime

def update_market_data():
    # 1. Setup Supabase Client
    url = os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") # Use service role key for write access
    if not url or not key:
        print("Error: Missing Supabase credentials in environment.")
        return

    supabase: Client = create_client(url, key)

    # 2. Update Exchange Rate (USDTWD)
    print("Fetching exchange rate...")
    twd_fx = yf.Ticker("TWD=X")
    fx_data = twd_fx.history(period="1d")
    if not fx_data.empty:
        current_fx = fx_data['Close'].iloc[-1]
        prev_fx = fx_data['Open'].iloc[-1]
        
        supabase.table("market_data").upsert({
            "ticker": "USDTWD",
            "region": "FX",
            "current_price": current_fx,
            "prev_close": prev_fx,
            "updated_at": datetime.now().isoformat()
        }).execute()
        print(f"Updated USDTWD: {current_fx}")

    # 3. Get all active tickers from holdings
    print("Fetching active tickers...")
    response = supabase.table("portfolio_holdings").select("ticker, region").execute()
    holdings = response.data
    
    if not holdings:
        print("No active holdings found.")
        return

    # Create a unique list of tickers formatted for yfinance
    ticker_map = {}
    for h in holdings:
        ticker = h['ticker']
        # yfinance format for TW is 2330.TW
        yf_ticker = ticker if h['region'] == 'US' else f"{ticker}.TW"
        ticker_map[yf_ticker] = ticker

    # 4. Batch fetch stock prices
    print(f"Updating prices for {len(ticker_map)} tickers...")
    if ticker_map:
        tickers_str = " ".join(ticker_map.keys())
        data = yf.download(tickers_str, period="1d", group_by='ticker', progress=False)

        for yf_code, original_ticker in ticker_map.items():
            try:
                # Handle single ticker vs multiple tickers return format
                ticker_data = data[yf_code] if len(ticker_map) > 1 else data
                
                if not ticker_data.empty:
                    current_price = ticker_data['Close'].iloc[-1]
                    prev_close = ticker_data['Open'].iloc[-1] # Simple approximation

                    supabase.table("market_data").upsert({
                        "ticker": original_ticker,
                        "region": "US" if "." not in yf_code else "TPE",
                        "current_price": current_price,
                        "prev_close": prev_close,
                        "updated_at": datetime.now().isoformat()
                    }).execute()
                    print(f"Updated {original_ticker}: {current_price}")
            except Exception as e:
                print(f"Failed to update {original_ticker}: {e}")

    # 5. Update High Watermarks for Trailing Stop
    print("Updating high watermarks...")
    # Get all holdings with auto strategy
    auto_holdings = supabase.table("portfolio_holdings") \
        .select("id, ticker, high_watermark_price") \
        .eq("strategy_mode", "auto").execute()

    for holding in auto_holdings.data:
        ticker = holding['ticker']
        # Get latest price from market_data table
        market_res = supabase.table("market_data").select("current_price").eq("ticker", ticker).execute()
        
        if market_res.data:
            current_price = float(market_res.data[0]['current_price'])
            old_hwm = float(holding['high_watermark_price'] or 0)
            
            if current_price > old_hwm:
                supabase.table("portfolio_holdings").update({
                    "high_watermark_price": current_price
                }).eq("id", holding['id']).execute()
                print(f"New High Watermark for {ticker}: {current_price}")

if __name__ == "__main__":
    update_market_data()
