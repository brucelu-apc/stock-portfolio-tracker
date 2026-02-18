"""
Market Data Backup Update — GitHub Actions fallback script.
============================================================

This script runs as a BACKUP when Railway APScheduler is unavailable.
Primary updates are handled by Railway backend (twstock + yfinance).

Key fixes vs. original:
  1. Uses period="5d" instead of "1d" to always get data even on weekends/holidays
  2. Writes BOTH current_price AND close_price (was missing close_price)
  3. Better error handling for Taiwan stock ticker resolution
"""
import os
import math
import sys
import requests
import yfinance as yf
from supabase import create_client, Client
from datetime import datetime


def is_valid_number(n):
    """Check if a value is a valid, finite number."""
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
        sys.exit(1)

    supabase: Client = create_client(url, key)

    # 2. Update Exchange Rate (USDTWD)
    print("Fetching exchange rate (USDTWD)...")
    try:
        twd_fx = yf.Ticker("TWD=X")
        fx_data = twd_fx.history(period="5d")
        if not fx_data.empty:
            current_fx = fx_data['Close'].iloc[-1]
            prev_fx = fx_data['Open'].iloc[-1]

            if is_valid_number(current_fx):
                supabase.table("market_data").upsert({
                    "ticker": "USDTWD",
                    "region": "FX",
                    "current_price": float(current_fx),
                    "close_price": float(current_fx),
                    "realtime_price": None,
                    "prev_close": float(prev_fx) if is_valid_number(prev_fx) else float(current_fx),
                    "updated_at": datetime.now().isoformat(),
                    "sector": "Forex",
                    "update_source": "yfinance-gh",
                }).execute()
                print(f"Updated USDTWD: {current_fx}")
            else:
                print("USDTWD price is NaN. Skipping update.")
    except Exception as e:
        print(f"Failed to update exchange rate: {e}")

    # 3. Get all active tickers from portfolio_holdings
    response = supabase.table("portfolio_holdings").select("ticker, region").execute()
    holdings = response.data

    # Also get advisory price_targets tickers
    try:
        advisory_res = supabase.table("price_targets").select("ticker").execute()
        advisory_tickers = {row['ticker'] for row in advisory_res.data} if advisory_res.data else set()
    except Exception:
        advisory_tickers = set()

    if not holdings and not advisory_tickers:
        print("No active holdings or advisory tickers.")
        return

    # Build ticker map: yf_ticker -> (original_ticker, region)
    ticker_map = {}
    seen = set()
    for h in (holdings or []):
        ticker = h['ticker']
        if ticker in seen:
            continue
        seen.add(ticker)
        if h['region'] == 'TPE':
            ticker_map[f"{ticker}.TW"] = (ticker, 'TPE')
        else:
            ticker_map[ticker] = (ticker, 'US')

    # Add advisory tickers (assume TPE if not already known)
    for at in advisory_tickers:
        if at not in seen:
            seen.add(at)
            ticker_map[f"{at}.TW"] = (at, 'TPE')

    if not ticker_map:
        print("No tickers to update.")
        return

    # 4. Batch fetch prices using period="5d" for reliability
    print(f"Updating {len(ticker_map)} tickers (period='5d')...")

    tickers_list = list(ticker_map.keys())
    tw_variants = [t.replace(".TW", ".TWO") for t in tickers_list if t.endswith(".TW")]
    all_query_tickers = list(set(tickers_list + tw_variants))

    try:
        data = yf.download(
            all_query_tickers,
            period="5d",
            group_by='ticker',
            progress=False
        )
    except Exception as e:
        print(f"yfinance download failed: {e}")
        return

    # Get existing sectors from DB
    market_data_res = supabase.table("market_data").select("ticker, sector").execute()
    existing_sectors = {item['ticker']: item.get('sector', 'Unknown') for item in market_data_res.data}

    multi_ticker = len(all_query_tickers) > 1
    updated_count = 0
    failed_count = 0

    for query_ticker, (original_ticker, region) in ticker_map.items():
        try:
            ticker_data = data[query_ticker] if multi_ticker else data

            # .TW → .TWO fallback for Taiwan stocks
            if query_ticker.endswith(".TW"):
                is_empty = (ticker_data is None or ticker_data.empty)
                has_nan = False
                if not is_empty:
                    try:
                        has_nan = math.isnan(ticker_data['Close'].iloc[-1])
                    except (IndexError, KeyError):
                        is_empty = True

                if is_empty or has_nan:
                    alt_ticker = query_ticker.replace(".TW", ".TWO")
                    print(f"Primary {query_ticker} failed, trying {alt_ticker}...")
                    try:
                        alt_data = data[alt_ticker] if multi_ticker else data
                        if alt_data is not None and not alt_data.empty:
                            test_val = alt_data['Close'].iloc[-1]
                            if is_valid_number(test_val):
                                ticker_data = alt_data
                                query_ticker = alt_ticker
                    except (KeyError, IndexError):
                        pass

            if ticker_data is None or ticker_data.empty:
                print(f"No data for {original_ticker}. Skipping.")
                failed_count += 1
                continue

            close_price = ticker_data['Close'].iloc[-1]
            if not is_valid_number(close_price):
                print(f"Warning: {original_ticker} price is NaN. Skipping (not clearing).")
                failed_count += 1
                continue

            close_price = float(close_price)

            # Get prev_close from 5d data (second-to-last trading day)
            prev_close = close_price
            if len(ticker_data) >= 2:
                pc_from_data = ticker_data['Close'].iloc[-2]
                if is_valid_number(pc_from_data):
                    prev_close = float(pc_from_data)

            sector = existing_sectors.get(original_ticker, "Unknown")

            # Try ticker.info for prev_close and sector (may fail for some TW stocks)
            try:
                ticker_obj = yf.Ticker(query_ticker)
                info = ticker_obj.info
                pc = info.get('previousClose')
                if is_valid_number(pc):
                    prev_close = float(pc)
                if sector == "Unknown":
                    sector = info.get('sector', 'Unknown')
            except Exception:
                pass

            detected_region = "TPE" if (".TW" in query_ticker or ".TWO" in query_ticker) else "US"

            # CRITICAL: Write BOTH current_price AND close_price
            supabase.table("market_data").upsert({
                "ticker": original_ticker,
                "region": detected_region,
                "current_price": close_price,
                "close_price": close_price,         # <-- Was missing before!
                "realtime_price": None,              # Clear realtime (backup update)
                "prev_close": prev_close,
                "sector": sector,
                "update_source": "yfinance-gh",      # Tag as GitHub Actions source
                "updated_at": datetime.now().isoformat(),
            }).execute()
            print(f"Updated {original_ticker}: {close_price}")
            updated_count += 1

        except Exception as e:
            print(f"Error updating {original_ticker}: {e}")
            failed_count += 1

    print(f"\nSummary: {updated_count} updated, {failed_count} failed out of {len(ticker_map)}")

    # 5. Alerts Logic
    print("Checking alerts...")
    all_holdings = supabase.table("portfolio_holdings").select("*").execute()
    alerts = []
    for h in all_holdings.data:
        ticker = h['ticker']
        market_res = supabase.table("market_data").select("current_price").eq("ticker", ticker).execute()
        if market_res.data and market_res.data[0]['current_price'] is not None:
            price = float(market_res.data[0]['current_price'])
            cost = float(h['cost_price'])
            hwm = float(h['high_watermark_price'] or cost)

            if price > hwm:
                supabase.table("portfolio_holdings").update(
                    {"high_watermark_price": price}
                ).eq("id", h['id']).execute()
                hwm = price

            if cost * 0.98 <= price <= cost * 1.02:
                alerts.append({"ticker": ticker, "price": price, "sl_price": cost})

    if alerts:
        send_alerts_to_line(alerts)


def send_alerts_to_line(alerts):
    """
    Send price alerts via LINE Messaging API.
    Falls back to OpenClaw if LINE credentials are not set.
    """
    line_token = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN")
    line_target = os.environ.get("LINE_ALERT_TARGET_ID")

    if line_token and line_target:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {line_token}",
        }
        for a in alerts:
            msg = (
                f"⚠️ 【停損預警】\n"
                f"代碼：{a['ticker']}\n"
                f"現價：${a['price']:.2f}\n"
                f"停損價：${a['sl_price']:.2f}\n"
                f"狀態：股價已進入停損價 ±2% 警戒區！"
            )
            payload = {
                "to": line_target,
                "messages": [{"type": "text", "text": msg}],
            }
            try:
                resp = requests.post(
                    "https://api.line.me/v2/bot/message/push",
                    json=payload, headers=headers, timeout=10,
                )
                if resp.status_code == 200:
                    print(f"LINE alert sent for {a['ticker']}")
                else:
                    print(f"LINE push failed: {resp.status_code} {resp.text}")
            except Exception as e:
                print(f"LINE push error: {e}")
        return

    # Fallback: OpenClaw (legacy)
    oc_url = os.environ.get("OPENCLAW_GATEWAY_URL")
    oc_token = os.environ.get("OPENCLAW_GATEWAY_TOKEN")
    oc_target = os.environ.get("NOTIFICATION_TARGET_ID")
    if oc_url and oc_token and oc_target:
        endpoint = f"{oc_url.rstrip('/')}/api/v1/message"
        oc_headers = {"Authorization": f"Bearer {oc_token}", "Content-Type": "application/json"}
        for a in alerts:
            msg = (
                f"⚠️ 【停損預警】\n"
                f"代碼：{a['ticker']}\n"
                f"現價：${a['price']:.2f}\n"
                f"停損價：${a['sl_price']:.2f}\n"
                f"狀態：股價已進入停損價 ±2% 警戒區！🍡"
            )
            requests.post(endpoint, json={
                "action": "send", "channel": "line",
                "target": oc_target, "message": msg,
            }, headers=oc_headers)
        print("Alerts sent via OpenClaw (fallback)")
    else:
        print("No notification channel configured (LINE or OpenClaw)")


if __name__ == "__main__":
    update_market_data()
