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

    Uses period="5d" to ensure data is available even on weekends/holidays.
    prev_close is derived ONLY from the 5d historical data (not ticker.info)
    to ensure consistency between close_price and prev_close.

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

    if data is None or data.empty:
        logger.warning("yfinance returned empty DataFrame")
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

            # Drop rows where Close is NaN to get only valid trading days
            valid_data = ticker_data.dropna(subset=['Close'])
            if valid_data.empty:
                logger.warning(f"{original_ticker}: all Close values are NaN")
                continue

            close_price = float(valid_data['Close'].iloc[-1])
            if not is_valid_number(close_price):
                logger.warning(f"{original_ticker} close is NaN")
                continue

            # prev_close: ONLY from 5d historical data (not ticker.info)
            # This ensures consistency with close_price from the same data source.
            prev_close = close_price
            if len(valid_data) >= 2:
                pc_from_data = valid_data['Close'].iloc[-2]
                if is_valid_number(pc_from_data):
                    prev_close = float(pc_from_data)

            sector = existing_sectors.get(original_ticker, "Unknown")

            # Use ticker.info ONLY for sector (not for prev_close)
            if sector == "Unknown":
                try:
                    ticker_obj = yf.Ticker(query_ticker)
                    info = ticker_obj.info
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

            logger.info(
                f"  {original_ticker}: close={close_price}, "
                f"prev_close={prev_close}, "
                f"data_rows={len(valid_data)}"
            )

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
