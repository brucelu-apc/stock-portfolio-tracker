import os
import requests
import yfinance as yf
from supabase import create_client, Client
from datetime import datetime
import math
import time

def is_valid_number(n):
    try:
        num = float(n)
        return not (math.isnan(num) or math.isinf(num))
    except (TypeError, ValueError):
        return False

def get_latest_price_from_df(df):
    """Extract the latest non-NaN price and its corresponding open/prev_close from a yfinance history dataframe."""
    if df is None or df.empty:
        return None, None
    
    # Remove rows where Close is NaN
    valid_rows = df.dropna(subset=['Close'])
    if valid_rows.empty:
        return None, None
    
    latest_row = valid_rows.iloc[-1]
    close_price = latest_row['Close']
    
    # For previous close, we ideally want the row before the latest one if it exists
    if len(valid_rows) > 1:
        prev_close = valid_rows.iloc[-2]['Close']
    else:
        # Fallback to Open of the same day if only one row exists
        prev_close = latest_row['Open']
        
    return close_price, prev_close

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
    print("Fetching exchange rate (USDTWD)...")
    try:
        twd_fx = yf.Ticker("TWD=X")
        # Use period="5d" to ensure we get data even on weekends/holidays
        fx_data = twd_fx.history(period="5d")
        current_fx, prev_fx = get_latest_price_from_df(fx_data)
        
        if is_valid_number(current_fx):
            supabase.table("market_data").upsert({
                "ticker": "USDTWD",
                "region": "FX",
                "current_price": current_fx,
                "prev_close": prev_fx if is_valid_number(prev_fx) else current_fx,
                "updated_at": datetime.now().isoformat(),
                "sector": "Forex"
            }).execute()
            print(f"Updated USDTWD: {current_fx} (Prev: {prev_fx})")
        else:
            print("Failed to get valid exchange rate data.")
    except Exception as e:
        print(f"Failed to update exchange rate: {e}")

    # 3. Get all active tickers
    response = supabase.table("portfolio_holdings").select("ticker, region").execute()
    holdings = response.data
    
    if not holdings:
        print("No active holdings.")
    else:
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
            # For Taiwan stocks, add .TWO variant
            tw_variants = [t.replace(".TW", ".TWO") for t in tickers_list if t.endswith(".TW")]
            all_query_tickers = list(set(tickers_list + tw_variants))
            
            # Use period="5d" for batch download as well to be more resilient
            data = yf.download(all_query_tickers, period="5d", group_by='ticker', progress=False)

            market_data_res = supabase.table("market_data").select("ticker, sector").execute()
            existing_sectors = {item['ticker']: item['sector'] for item in market_data_res.data}

            for query_ticker, original_ticker in ticker_map.items():
                try:
                    ticker_data = data[query_ticker] if len(all_query_tickers) > 1 else data
                    
                    # If NaN or empty, try alternative suffix (.TWO) for Taiwan stocks
                    if (ticker_data is None or ticker_data.empty or math.isnan(ticker_data['Close'].dropna().iloc[-1] if not ticker_data['Close'].dropna().empty else float('nan'))) and query_ticker.endswith(".TW"):
                        alt_ticker = query_ticker.replace(".TW", ".TWO")
                        print(f"Primary ticker {query_ticker} failed or empty, trying {alt_ticker}...")
                        ticker_data = data[alt_ticker] if len(all_query_tickers) > 1 else data
                        # If successful, use this ticker for info/sector fetch
                        if not ticker_data['Close'].dropna().empty:
                            query_ticker = alt_ticker

                    close_price, prev_close = get_latest_price_from_df(ticker_data)

                    if is_valid_number(close_price):
                        # Fetch Ticker object for sector if missing
                        sector = existing_sectors.get(original_ticker, "Unknown")
                        if sector == "Unknown":
                            try:
                                sector = yf.Ticker(query_ticker).info.get('sector', "Unknown")
                            except:
                                sector = "Unknown"

                        # If we still don't have a good prev_close from history, try Ticker.info
                        if not is_valid_number(prev_close):
                            try:
                                info = yf.Ticker(query_ticker).info
                                prev_close = info.get('previousClose', close_price)
                            except:
                                prev_close = close_price

                        supabase.table("market_data").upsert({
                            "ticker": original_ticker,
                            "region": "US" if "." not in query_ticker else "TPE",
                            "current_price": close_price,
                            "prev_close": prev_close if is_valid_number(prev_close) else close_price,
                            "sector": sector,
                            "updated_at": datetime.now().isoformat()
                        }).execute()
                        print(f"Updated {original_ticker}: {close_price} (Prev: {prev_close}, Sector: {sector})")
                    else:
                        print(f"Skipping {original_ticker}: Could not find valid price data in last 5 days.")
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
