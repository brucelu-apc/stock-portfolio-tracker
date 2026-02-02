import os
import requests
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
    else:
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

            # Get current market_data to check for missing sectors
            market_data_res = supabase.table("market_data").select("ticker, sector").execute()
            existing_sectors = {item['ticker']: item['sector'] for item in market_data_res.data}

            for yf_code, original_ticker in ticker_map.items():
                try:
                    # Handle single ticker vs multiple tickers return format
                    ticker_data = data[yf_code] if len(ticker_map) > 1 else data
                    
                    if not ticker_data.empty:
                        current_price = ticker_data['Close'].iloc[-1]
                        prev_close = ticker_data['Open'].iloc[-1]

                        # Fetch sector if missing or Unknown
                        sector = existing_sectors.get(original_ticker, "Unknown")
                        if sector == "Unknown":
                            print(f"Fetching sector for {original_ticker}...")
                            info = yf.Ticker(yf_code).info
                            sector = info.get('sector', "Unknown")
                            print(f"Sector for {original_ticker}: {sector}")

                        supabase.table("market_data").upsert({
                            "ticker": original_ticker,
                            "region": "US" if "." not in yf_code else "TPE",
                            "current_price": current_price,
                            "prev_close": prev_close,
                            "sector": sector,
                            "updated_at": datetime.now().isoformat()
                        }).execute()
                        print(f"Updated {original_ticker}: {current_price} ({sector})")
                except Exception as e:
                    print(f"Failed to update {original_ticker}: {e}")

    # 5. Update High Watermarks & Check for Alerts (SL within +/- 2%)
    print("Checking for Stop Loss alerts...")
    all_holdings = supabase.table("portfolio_holdings") \
        .select("id, user_id, ticker, cost_price, high_watermark_price") \
        .execute()

    alerts = []

    for holding in all_holdings.data:
        ticker = holding['ticker']
        # Get latest price from market_data table
        market_res = supabase.table("market_data").select("current_price").eq("ticker", ticker).execute()
        
        if market_res.data:
            current_price = float(market_res.data[0]['current_price'])
            avg_cost = float(holding['cost_price'])
            old_hwm = float(holding['high_watermark_price'] or avg_cost)
            
            # Update High Watermark (for UI/Analysis, still useful)
            if current_price > old_hwm:
                supabase.table("portfolio_holdings").update({
                    "high_watermark_price": current_price
                }).eq("id", holding['id']).execute()
                print(f"New High Watermark for {ticker}: {current_price}")

            # NEW Stop Loss Alert Logic: within +/- 2% of cost price
            # Range: [Cost * 0.98, Cost * 1.02]
            lower_bound = avg_cost * 0.98
            upper_bound = avg_cost * 1.02
            
            if lower_bound <= current_price <= upper_bound:
                alerts.append({
                    "user_id": holding['user_id'],
                    "ticker": ticker,
                    "price": current_price,
                    "sl_price": avg_cost,
                    "type": "STOP_LOSS_WARNING"
                })

    # 6. Send Alerts via OpenClaw Gateway
    if alerts:
        send_alerts_to_openclaw(alerts)

    print("Market data update and alert check completed.")

def send_alerts_to_openclaw(alerts):
    """Send stock alerts via OpenClaw Gateway API"""
    gateway_url = os.environ.get("OPENCLAW_GATEWAY_URL")
    gateway_token = os.environ.get("OPENCLAW_GATEWAY_TOKEN")
    target_user = os.environ.get("NOTIFICATION_TARGET_ID")

    if not gateway_url or not gateway_token or not target_user:
        print("Warning: Missing OpenClaw notification settings (URL, Token, or Target ID).")
        return

    # Clean URL (ensure no trailing slash for endpoint construction)
    base_url = gateway_url.rstrip("/")
    endpoint = f"{base_url}/api/v1/message"
    headers = {
        "Authorization": f"Bearer {gateway_token}",
        "Content-Type": "application/json"
    }

    for a in alerts:
        msg = f"⚠️ 【停損預警】\n代碼：{a['ticker']}\n現價：${a['price']:.2f}\n停損價：${a['sl_price']:.2f}\n狀態：股價已進入停損價 +/-2% 警戒區！🍡"
        
        payload = {
            "action": "send",
            "channel": "line",
            "target": target_user,
            "message": msg
        }
        
        try:
            response = requests.post(endpoint, json=payload, headers=headers)
            if response.status_code == 200:
                print(f"Alert sent for {a['ticker']}")
            else:
                print(f"Failed to send alert for {a['ticker']}: {response.text}")
        except Exception as e:
            print(f"Error calling OpenClaw Gateway: {e}")

if __name__ == "__main__":
    update_market_data()
