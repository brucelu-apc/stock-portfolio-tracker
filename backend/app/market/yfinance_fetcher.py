"""
yfinance Fetcher — Ported from scripts/update_market_data.py
=============================================================

Handles:
  - Taiwan stock close prices (.TW / .TWO fallback)
  - US stock close prices
  - USDTWD exchange rate
  - High watermark updates
  - Sector info caching
"""
from __future__ import annotations

import logging
import math
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

TST = ZoneInfo("Asia/Taipei")


def is_valid_number(n) -> bool:
    """Check if a value is a valid, finite number."""
    try:
        num = float(n)
        return not (math.isnan(num) or math.isinf(num))
    except (TypeError, ValueError):
        return False


async def fetch_close_prices(
    tickers: list[dict],
    supabase_client
) -> dict[str, dict]:
    """
    Fetch close prices for a batch of stocks via yfinance.

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

    results: dict[str, dict] = {}

    # Build ticker map: yf_ticker -> original_ticker
    ticker_map: dict[str, str] = {}
    for item in tickers:
        ticker = item['ticker']
        region = item.get('region', 'TPE')
        if region == 'TPE':
            ticker_map[f"{ticker}.TW"] = ticker
        elif region == 'FX':
            continue  # Handled separately
        else:
            ticker_map[ticker] = ticker

    if not ticker_map:
        return results

    # Add .TWO variants for fallback
    tw_variants = [t.replace(".TW", ".TWO") for t in ticker_map if t.endswith(".TW")]
    all_query_tickers = list(set(list(ticker_map.keys()) + tw_variants))

    logger.info(f"yfinance: downloading {len(all_query_tickers)} tickers...")

    try:
        # Use period="5d" to always get the last trading day's close,
        # even on weekends/holidays when "1d" would return empty.
        data = yf.download(
            all_query_tickers,
            period="5d",
            group_by='ticker',
            progress=False
        )
    except Exception as e:
        logger.error(f"yfinance download failed: {e}")
        return results

    # Get existing sectors
    existing_sectors: dict[str, str] = {}
    try:
        res = supabase_client.table("market_data").select("ticker, sector").execute()
        existing_sectors = {item['ticker']: item.get('sector', 'Unknown') for item in res.data}
    except Exception:
        pass

    multi_ticker = len(all_query_tickers) > 1

    for query_ticker, original_ticker in ticker_map.items():
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
                    logger.info(f"Fallback: {query_ticker} → {alt_ticker}")
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
                logger.warning(f"No data for {original_ticker}")
                continue

            close_price = ticker_data['Close'].iloc[-1]
            if not is_valid_number(close_price):
                logger.warning(f"{original_ticker} close is NaN")
                continue

            close_price = float(close_price)

            # Try to get prev_close from 5d data (second-to-last trading day)
            prev_close = close_price
            if len(ticker_data) >= 2:
                pc_from_data = ticker_data['Close'].iloc[-2]
                if is_valid_number(pc_from_data):
                    prev_close = float(pc_from_data)

            sector = existing_sectors.get(original_ticker, "Unknown")

            # Fallback: try ticker.info for prev_close and sector
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

            region = "TPE" if ".TW" in query_ticker or ".TWO" in query_ticker else "US"

            results[original_ticker] = {
                'current_price': close_price,
                'prev_close': prev_close,
                'sector': sector,
                'region': region,
            }

        except Exception as e:
            logger.error(f"Error processing {original_ticker}: {e}")

    logger.info(f"yfinance: fetched {len(results)}/{len(ticker_map)} prices")
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

    try:
        twd_fx = yf.Ticker("TWD=X")
        fx_data = twd_fx.history(period="5d")
        if not fx_data.empty:
            current_fx = fx_data['Close'].iloc[-1]
            prev_fx = fx_data['Open'].iloc[-1]

            if is_valid_number(current_fx):
                return {
                    'current_price': float(current_fx),
                    'prev_close': float(prev_fx) if is_valid_number(prev_fx) else float(current_fx),
                }
    except Exception as e:
        logger.error(f"Failed to fetch USDTWD: {e}")

    return None