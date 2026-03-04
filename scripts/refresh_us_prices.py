"""
Refresh US Stock Prices — Manual trigger script.
=================================================

Fetches the latest prices for all US holdings via Finnhub REST API
(Yahoo Finance blocks Railway/cloud IPs, so Finnhub is the reliable choice)
and upserts them into the Supabase ``market_data`` table.

Usage (run on Railway or locally with .env populated):
    python scripts/refresh_us_prices.py

    # Update a specific ticker only:
    python scripts/refresh_us_prices.py --tickers NVDA AAPL MSFT

Environment variables required (same as backend .env):
    SUPABASE_URL or VITE_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
    FINNHUB_API_KEY
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

TST = ZoneInfo("Asia/Taipei")

# ── Finnhub REST endpoint ────────────────────────────────────────
FINNHUB_QUOTE_URL = "https://finnhub.io/api/v1/quote"


def is_valid(n) -> bool:
    try:
        v = float(n)
        return not (math.isnan(v) or math.isinf(v)) and v > 0
    except (TypeError, ValueError):
        return False


def fetch_finnhub_quote(ticker: str, api_key: str) -> dict | None:
    """Call Finnhub /quote and return price dict or None."""
    try:
        resp = requests.get(
            FINNHUB_QUOTE_URL,
            params={"symbol": ticker, "token": api_key},
            timeout=10,
        )
        if resp.status_code == 429:
            print(f"  ⚠️  Rate limited (429) — waiting 60s before retrying {ticker}")
            time.sleep(60)
            resp = requests.get(
                FINNHUB_QUOTE_URL,
                params={"symbol": ticker, "token": api_key},
                timeout=10,
            )
        resp.raise_for_status()
        data = resp.json()

        price = data.get("c")      # current / close price
        prev  = data.get("pc")     # previous close
        high  = data.get("h")      # day high
        low   = data.get("l")      # day low
        open_ = data.get("o")      # day open

        if not is_valid(price):
            print(f"  ⚠️  {ticker}: Finnhub returned no valid price (c={price})")
            return None

        return {
            "price":      float(price),
            "prev_close": float(prev)  if is_valid(prev)  else float(price),
            "day_high":   float(high)  if is_valid(high)  else None,
            "day_low":    float(low)   if is_valid(low)   else None,
            "day_open":   float(open_) if is_valid(open_) else None,
        }
    except Exception as e:
        print(f"  ❌  {ticker}: Finnhub fetch error — {e}")
        return None


def main(target_tickers: list[str] | None = None) -> None:
    # ── Credentials ─────────────────────────────────────────────
    supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    finnhub_key  = os.environ.get("FINNHUB_API_KEY")

    if not supabase_url or not supabase_key:
        print("❌  Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)
    if not finnhub_key:
        print("❌  Missing FINNHUB_API_KEY")
        sys.exit(1)

    # ── Supabase REST helper (no SDK dependency) ─────────────────
    headers = {
        "apikey":        supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type":  "application/json",
        "Prefer":        "resolution=merge-duplicates",
    }
    rest_base = f"{supabase_url.rstrip('/')}/rest/v1"

    def sb_get(table: str, params: dict) -> list:
        r = requests.get(f"{rest_base}/{table}", headers=headers, params=params, timeout=15)
        r.raise_for_status()
        return r.json()

    def sb_upsert(table: str, payload: dict | list) -> None:
        data = payload if isinstance(payload, list) else [payload]
        r = requests.post(f"{rest_base}/{table}", headers=headers, json=data, timeout=15)
        r.raise_for_status()

    # ── Determine tickers to refresh ────────────────────────────
    if target_tickers:
        tickers = [t.upper() for t in target_tickers]
        print(f"Refreshing specified tickers: {tickers}")
    else:
        rows = sb_get("portfolio_holdings", {"select": "ticker,region", "region": "eq.US"})
        tickers = sorted({r["ticker"] for r in rows if r.get("region") == "US"})
        if not tickers:
            print("No US tickers found in portfolio_holdings.")
            return
        print(f"Found {len(tickers)} US tickers in portfolio: {tickers}")

    # ── Fetch current sectors (to preserve them) ────────────────
    sector_map: dict[str, str] = {}
    try:
        mrows = sb_get("market_data", {"select": "ticker,sector", "region": "eq.US"})
        sector_map = {r["ticker"]: r.get("sector") or "Unknown" for r in mrows}
    except Exception:
        pass

    # ── Fetch + upsert prices ────────────────────────────────────
    now_iso = datetime.now(TST).isoformat()
    updated, failed = 0, 0

    for i, ticker in enumerate(tickers):
        if i > 0:
            time.sleep(1.1)   # Finnhub free tier: 60 req/min

        print(f"  Fetching {ticker} …", end=" ")
        quote = fetch_finnhub_quote(ticker, finnhub_key)
        if not quote:
            failed += 1
            continue

        upsert_row = {
            "ticker":         ticker,
            "region":         "US",
            "current_price":  quote["price"],
            "prev_close":     quote["prev_close"],
            "day_high":       quote["day_high"],
            "day_low":        quote["day_low"],
            "day_open":       quote["day_open"],
            "sector":         sector_map.get(ticker, "Unknown"),
            "update_source":  "finnhub_rest_manual",
            "updated_at":     now_iso,
        }

        try:
            sb_upsert("market_data", upsert_row)
            print(f"✅  ${quote['price']:.2f}  (prev_close: ${quote['prev_close']:.2f})")
            updated += 1
        except Exception as e:
            print(f"❌  DB upsert failed — {e}")
            failed += 1

    print(f"\n{'─'*50}")
    print(f"Done: {updated} updated, {failed} failed / {len(tickers)} total")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Refresh US stock prices via Finnhub REST")
    parser.add_argument(
        "--tickers", nargs="*",
        help="Specific tickers to refresh (e.g. NVDA AAPL). "
             "Defaults to all US holdings in the portfolio."
    )
    args = parser.parse_args()
    main(target_tickers=args.tickers)
