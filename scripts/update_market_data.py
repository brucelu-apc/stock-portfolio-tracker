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

    # 5. Update High Watermarks & Check for Alerts
    print("Updating high watermarks and checking for alerts...")
    # Get all holdings with auto strategy and their owners
    # We need user profiles to know where to send alerts (if email/ID mapping is available)
    auto_holdings = supabase.table("portfolio_holdings") \
        .select("id, user_id, ticker, cost_price, buy_fee, strategy_mode, high_watermark_price, manual_tp, manual_sl") \
        .eq("strategy_mode", "auto").execute()

    alerts = []

    for holding in auto_holdings.data:
        ticker = holding['ticker']
        # Get latest price from market_data table
        market_res = supabase.table("market_data").select("current_price").eq("ticker", ticker).execute()
        
        if market_res.data:
            current_price = float(market_res.data[0]['current_price'])
            old_hwm = float(holding['high_watermark_price'] or 0)
            avg_cost = float(holding['cost_price'])
            
            # Update High Watermark
            if current_price > old_hwm:
                supabase.table("portfolio_holdings").update({
                    "high_watermark_price": current_price
                }).eq("id", holding['id']).execute()
                old_hwm = current_price # Use new HWM for alert check
                print(f"New High Watermark for {ticker}: {current_price}")

            # Alert Logic: MAX(Cost*1.1, HWM*0.9)
            tp_threshold = max(avg_cost * 1.1, old_hwm * 0.9)
            sl_threshold = avg_cost # Breakeven protection
            
            if current_price >= tp_threshold:
                alerts.append({
                    "user_id": holding['user_id'],
                    "ticker": ticker,
                    "price": current_price,
                    "threshold": tp_threshold,
                    "type": "TAKE_PROFIT"
                })
            elif current_price <= sl_threshold:
                alerts.append({
                    "user_id": holding['user_id'],
                    "ticker": ticker,
                    "price": current_price,
                    "threshold": sl_threshold,
                    "type": "STOP_LOSS"
                })

    # 6. Send Alerts to OpenClaw
    if alerts:
        send_alerts_to_openclaw(alerts)

def send_alerts_to_openclaw(alerts):
    # Get Gateway credentials from environment (passed by GitHub Actions)
    gateway_url = os.environ.get("OPENCLAW_GATEWAY_URL")
    gateway_token = os.environ.get("OPENCLAW_GATEWAY_TOKEN")
    target_user = os.environ.get("NOTIFICATION_TARGET_ID") # e.g. Line User ID

    if not gateway_url or not gateway_token or not target_user:
        print("Warning: Missing OpenClaw notification settings.")
        return

    for a in alerts:
        msg = f"🔔 【投資預警】\n代碼：{a['ticker']}\n現價：${a['price']}\n觸發：{'移動停利' if a['type'] == 'TAKE_PROFIT' else '停損保護'}\n門檻：${a['threshold']}\n建議：請考慮操作！🍡"
        
        try:
            # Call OpenClaw Gateway to send message via LINE/Discord
            payload = {
                "action": "send",
                "channel": "line",
                "target": target_user,
                "message": msg
            }
            headers = {"Authorization": f"Bearer {gateway_token}"}
            # Path: /api/v1/message (assuming standard OpenClaw API)
            response = requests.post(f"{gateway_url}/api/v1/message", json=payload, headers=headers)
            if response.status_code == 200:
                print(f"Alert sent for {a['ticker']}")
            else:
                print(f"Failed to send alert: {response.text}")
        except Exception as e:
            print(f"Error calling OpenClaw: {e}")

if __name__ == "__main__":
    update_market_data()
