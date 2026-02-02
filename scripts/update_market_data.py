import os
import requests
import yfinance as yf
from supabase import create_client, Client
from datetime import datetime
import math

def is_valid_number(n):
    try:
        num = float(n)
        return not (math.isnan(num) or math.isinf(num))
    except (TypeError, ValueError):
        return False

def update_market_data():
    # 1. Setup Supabase Client
    url = os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Error: Missing Supabase credentials.")
        import sys
        sys.exit(1)

    supabase: Client = create_client(url, key)

    # 2. Update Exchange Rate (USDTWD)
    print("Fetching exchange rate...")
    try:
        twd_fx = yf.Ticker("TWD=X")
        fx_data = twd_fx.history(period="1d")
        if not fx_data.empty:
            current_fx = fx_data['Close'].iloc[-1]
            prev_fx = fx_data['Open'].iloc[-1]
            
            if is_valid_number(current_fx):
                supabase.table("market_data").upsert({
                    "ticker": "USDTWD",
                    "region": "FX",
                    "current_price": current_fx,
                    "prev_close": prev_fx if is_valid_number(prev_fx) else current_fx,
                    "updated_at": datetime.now().isoformat(),
                    "sector": "Forex"
                }).execute()
                print(f"Updated USDTWD: {current_fx}")
    except Exception as e:
        print(f"Failed to update exchange rate: {e}")

    # 3. Get all active tickers
    response = supabase.table("portfolio_holdings").select("ticker, region").execute()
    holdings = response.data
    
    if not holdings:
        print("No active holdings.")
    else:
        ticker_map = { (f"{h['ticker']}.TW" if h['region'] == 'TPE' else h['ticker']): h['ticker'] for h in holdings }

        # 4. Batch fetch prices
        print(f"Updating {len(ticker_map)} tickers...")
        if ticker_map:
            tickers_list = list(ticker_map.keys())
            data = yf.download(tickers_list, period="1d", group_by='ticker', progress=False)

            market_data_res = supabase.table("market_data").select("ticker, sector").execute()
            existing_sectors = {item['ticker']: item['sector'] for item in market_data_res.data}

            for yf_code, original_ticker in ticker_map.items():
                try:
                    ticker_data = data[yf_code] if len(ticker_map) > 1 else data
                    if not ticker_data.empty:
                        close_price = ticker_data['Close'].iloc[-1]
                        open_price = ticker_data['Open'].iloc[-1]

                        if not is_valid_number(close_price):
                            print(f"Skipping {original_ticker}: Invalid price data (NaN)")
                            continue

                        sector = existing_sectors.get(original_ticker, "Unknown")
                        if sector == "Unknown":
                            sector = yf.Ticker(yf_code).info.get('sector', "Unknown")

                        supabase.table("market_data").upsert({
                            "ticker": original_ticker,
                            "region": "US" if "." not in yf_code else "TPE",
                            "current_price": close_price,
                            "prev_close": open_price if is_valid_number(open_price) else close_price,
                            "sector": sector,
                            "updated_at": datetime.now().isoformat()
                        }).execute()
                        print(f"Updated {original_ticker}: {close_price}")
                except Exception as e:
                    print(f"Error updating {original_ticker}: {e}")

    # 5. Alerts Logic (Same as before but with valid number checks)
    print("Checking alerts...")
    all_holdings = supabase.table("portfolio_holdings").select("*").execute()
    alerts = []
    for h in all_holdings.data:
        ticker = h['ticker']
        market_res = supabase.table("market_data").select("current_price").eq("ticker", ticker).execute()
        if market_res.data:
            price = float(market_res.data[0]['current_price'])
            cost = float(h['cost_price'])
            hwm = float(h['high_watermark_price'] or cost)
            
            if price > hwm:
                supabase.table("portfolio_holdings").update({"high_watermark_price": price}).eq("id", h['id']).execute()
                hwm = price

            if cost * 0.98 <= price <= cost * 1.02:
                alerts.append({"ticker": ticker, "price": price, "sl_price": cost})

    if alerts:
        send_alerts_to_openclaw(alerts)

def send_alerts_to_openclaw(alerts):
    url = os.environ.get("OPENCLAW_GATEWAY_URL")
    token = os.environ.get("OPENCLAW_GATEWAY_TOKEN")
    target = os.environ.get("NOTIFICATION_TARGET_ID")
    if not (url and token and target): return
    
    endpoint = f"{url.rstrip('/')}/api/v1/message"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    for a in alerts:
        msg = f"⚠️ 【停損預警】\n代碼：{a['ticker']}\n現價：${a['price']:.2f}\n停損價：${a['sl_price']:.2f}\n狀態：股價已進入停損價 +/-2% 警戒區！🍡"
        requests.post(endpoint, json={"action": "send", "channel": "line", "target": target, "message": msg}, headers=headers)

if __name__ == "__main__":
    update_market_data()
