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
        # Ticker map stores both possible suffixes for Taiwan stocks
        ticker_map = {}
        for h in holdings:
            ticker = h['ticker']
            if h['region'] == 'TPE':
                ticker_map[f"{ticker}.TW"] = ticker
            else:
                ticker_map[ticker] = ticker

        # 4. Batch fetch prices
        print(f"Updating {len(ticker_map)} tickers...")
        if ticker_map:
            tickers_list = list(ticker_map.keys())
            # For Taiwan stocks, add .TWO variant just in case
            tw_variants = [t.replace(".TW", ".TWO") for t in tickers_list if t.endswith(".TW")]
            all_query_tickers = list(set(tickers_list + tw_variants))
            
            # Use yf.download(..., interval="1m") to get the most recent price if needed, 
            # but usually period="1d" is fine. The key is how yfinance handles the "Open" vs "Prev Close".
            data = yf.download(all_query_tickers, period="1d", group_by='ticker', progress=False)

            market_data_res = supabase.table("market_data").select("ticker, sector").execute()
            existing_sectors = {item['ticker']: item['sector'] for item in market_data_res.data}

            for query_ticker, original_ticker in ticker_map.items():
                try:
                    # Try primary suffix (.TW)
                    ticker_data = data[query_ticker] if len(all_query_tickers) > 1 else data
                    
                    # If NaN or empty, try alternative suffix (.TWO) for Taiwan stocks
                    if (ticker_data is None or ticker_data.empty or math.isnan(ticker_data['Close'].iloc[-1])) and query_ticker.endswith(".TW"):
                        alt_ticker = query_ticker.replace(".TW", ".TWO")
                        print(f"Primary ticker {query_ticker} failed, trying {alt_ticker}...")
                        ticker_data = data[alt_ticker] if len(all_query_tickers) > 1 else data
                        query_ticker = alt_ticker # Use the successful ticker for info fetch

                    if ticker_data is not None and not ticker_data.empty:
                        # yfinance's 'Close' for current day is the live price
                        # 'Open' is today's open. To get "漲跌幅", we actually need the PREVIOUS CLOSE.
                        # yfinance download period="1d" often doesn't give previous close easily.
                        # Let's try to get full info from Ticker object for critical fields.
                        
                        close_price = ticker_data['Close'].iloc[-1]
                        
                        # Fetch Ticker object for more detailed info (like previousClose)
                        ticker_obj = yf.Ticker(query_ticker)
                        info = ticker_obj.info
                        prev_close = info.get('previousClose')
                        
                        if not is_valid_number(prev_close):
                            # Fallback to Open if previousClose is missing
                            prev_close = ticker_data['Open'].iloc[-1]

                        if not is_valid_number(close_price):
                            print(f"Skipping {original_ticker}: Invalid price data (NaN)")
                            continue

                        sector = existing_sectors.get(original_ticker, "Unknown")
                        if sector == "Unknown":
                            sector = info.get('sector', "Unknown")

                        supabase.table("market_data").upsert({
                            "ticker": original_ticker,
                            "region": "US" if "." not in query_ticker else "TPE",
                            "current_price": close_price,
                            "prev_close": prev_close if is_valid_number(prev_close) else close_price,
                            "sector": sector,
                            "updated_at": datetime.now().isoformat()
                        }).execute()
                        print(f"Updated {original_ticker}: {close_price} (Prev: {prev_close}, Sector: {sector})")
                except Exception as e:
                    print(f"Error updating {original_ticker}: {e}")

    # 5. Alerts Logic
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
