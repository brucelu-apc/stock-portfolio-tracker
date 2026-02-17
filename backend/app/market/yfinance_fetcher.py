"""
yfinance Fetcher — Ported from scripts/update_market_data.py
=============================================================

Handles:
  - Taiwan stock close prices (.TW / .TWO fallback)
  - US stock close prices
  - USDTWD exchange rate
  - High watermark updates
  - Sector info caching

NOTE: Uses a custom requests.Session with browser-like User-Agent
to avoid Yahoo Finance blocking cloud server IPs (Railway, Heroku, AWS).
"""
from __future__ import annotations

import asyncio
import logging
import math
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

TST = ZoneInfo("Asia/Taipei")

# Delay between individual ticker fetches (seconds) to avoid rate-limiting
FETCH_DELAY = 1.0

# Browser-like User-Agent to avoid Yahoo Finance IP blocking
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


def _create_yf_session():
    """
    Create a requests.Session with browser-like headers.

    Yahoo Finance blocks requests from cloud server IPs when they use
    the default python-requests User-Agent. By setting a browser-like
    User-Agent, the requests appear to come from a normal browser.
    """
    import requests
    session = requests.Session()
    session.headers.update({
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
    })
    return session


def is_valid_number(n) -> bool:
    """Check if a value is a valid, finite number."""
    try:
        num = float(n)
        return not (math.isnan(num) or math.isinf(num))
    except (TypeError, ValueError):
        return False


def _fetch_single_ticker_history(query_ticker: str, session=None):
    """
    Fetch 5d history for a single ticker using yf.Ticker().history().

    Uses a custom session with browser headers to bypass Yahoo Finance
    cloud IP blocking.

    Returns a DataFrame or None.
    """
    import yfinance as yf

    try:
        ticker_obj = yf.Ticker(query_ticker, session=session)
        hist = ticker_obj.history(period="5d")
        if hist is not None and not hist.empty:
            return hist
    except Exception as e:
        logger.warning(f"yfinance fetch failed for {query_ticker}: {e}")

    return None


async def fetch_close_prices(
    tickers: list[dict],
    supabase_client
) -> dict[str, dict]:
    """
    Fetch close prices for a batch of stocks via yfinance.

    Uses individual Ticker.history() calls with a custom browser-like
    session to avoid Yahoo Finance blocking cloud server IPs.
    Falls back from .TW to .TWO for Taiwan OTC stocks.

    Args:
        tickers: List of dicts with 'ticker' and 'region' keys
        supabase_client: Supabase client for DB updates

    Returns:
        dict mapping original ticker to price data
    """
    try:
        import yfinance as yf
    except ImportError:
        logger.error("yfinance not installed. Run: pip install yfinance")
        return {}

    # Set TZ cache to /tmp to avoid permission errors on Railway
    try:
        yf.set_tz_cache_location("/tmp/yfinance_tz_cache")
    except Exception:
        pass

    results: dict[str, dict] = {}

    # Build ticker list: (yf_ticker, original_ticker, region)
    ticker_list: list[tuple[str, str, str]] = []
    for item in tickers:
        ticker = item['ticker']
        region = item.get('region', 'TPE')
        if region == 'TPE':
            ticker_list.append((f"{ticker}.TW", ticker, 'TPE'))
        elif region == 'FX':
            continue  # Handled separately
        else:
            ticker_list.append((ticker, ticker, 'US'))

    if not ticker_list:
        return results

    logger.info(f"yfinance: fetching {len(ticker_list)} tickers with browser session...")

    # Create browser-like session
    session = _create_yf_session()

    # Get existing sectors
    existing_sectors: dict[str, str] = {}
    try:
        res = supabase_client.table("market_data").select("ticker, sector").execute()
        existing_sectors = {item['ticker']: item.get('sector', 'Unknown') for item in res.data}
    except Exception:
        pass

    success_count = 0
    fail_count = 0

    for idx, (query_ticker, original_ticker, region) in enumerate(ticker_list):
        try:
            # Add delay between requests (skip first)
            if idx > 0:
                await asyncio.sleep(FETCH_DELAY)

            # Fetch history with browser session
            ticker_data = _fetch_single_ticker_history(query_ticker, session=session)

            # .TW → .TWO fallback for Taiwan stocks
            if ticker_data is None and query_ticker.endswith(".TW"):
                alt_ticker = query_ticker.replace(".TW", ".TWO")
                logger.info(f"Fallback: {query_ticker} → {alt_ticker}")
                await asyncio.sleep(FETCH_DELAY)
                ticker_data = _fetch_single_ticker_history(alt_ticker, session=session)
                if ticker_data is not None:
                    query_ticker = alt_ticker

            if ticker_data is None:
                logger.warning(f"No data for {original_ticker} ({query_ticker})")
                fail_count += 1
                continue

            # Drop rows where Close is NaN to get only valid trading days
            valid_data = ticker_data.dropna(subset=['Close'])
            if valid_data.empty:
                logger.warning(f"{original_ticker}: all Close values are NaN")
                fail_count += 1
                continue

            close_price = float(valid_data['Close'].iloc[-1])
            if not is_valid_number(close_price):
                logger.warning(f"{original_ticker} close is NaN")
                fail_count += 1
                continue

            # prev_close: ONLY from 5d historical data (not ticker.info)
            prev_close = close_price
            if len(valid_data) >= 2:
                pc_from_data = valid_data['Close'].iloc[-2]
                if is_valid_number(pc_from_data):
                    prev_close = float(pc_from_data)

            sector = existing_sectors.get(original_ticker, "Unknown")

            # Use ticker.info ONLY for sector (not for prev_close)
            if sector == "Unknown":
                try:
                    ticker_obj = yf.Ticker(query_ticker, session=session)
                    info = ticker_obj.info
                    sector = info.get('sector', 'Unknown')
                except Exception:
                    pass

            results[original_ticker] = {
                'current_price': close_price,
                'prev_close': prev_close,
                'sector': sector,
                'region': region,
            }

            success_count += 1
            logger.info(
                f"  [{success_count}/{len(ticker_list)}] {original_ticker}: "
                f"close={close_price}, prev_close={prev_close}"
            )

        except Exception as e:
            logger.error(f"Error processing {original_ticker}: {e}")
            fail_count += 1

    logger.info(
        f"yfinance: completed {success_count} OK, {fail_count} failed "
        f"out of {len(ticker_list)} tickers"
    )
    return results


async def fetch_exchange_rate() -> Optional[dict]:
    """
    Fetch USDTWD exchange rate via yfinance.

    Returns:
        dict with 'current_price' and 'prev_close', or None
    """
    try:
        import yfinance as yf
    except ImportError:
        return None

    # Set TZ cache to /tmp
    try:
        yf.set_tz_cache_location("/tmp/yfinance_tz_cache")
    except Exception:
        pass

    try:
        session = _create_yf_session()
        twd_fx = yf.Ticker("TWD=X", session=session)
        fx_data = twd_fx.history(period="5d")
        if not fx_data.empty:
            valid_data = fx_data.dropna(subset=['Close'])
            if valid_data.empty:
                return None

            current_fx = valid_data['Close'].iloc[-1]

            # Get prev_close from 5d data
            prev_fx = current_fx
            if len(valid_data) >= 2:
                pf = valid_data['Close'].iloc[-2]
                if is_valid_number(pf):
                    prev_fx = float(pf)

            if is_valid_number(current_fx):
                return {
                    'current_price': float(current_fx),
                    'prev_close': float(prev_fx) if is_valid_number(prev_fx) else float(current_fx),
                }
    except Exception as e:
        logger.error(f"Failed to fetch USDTWD: {e}")

    return None
