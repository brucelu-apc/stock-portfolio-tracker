"""
Taiwan Stock Real-time Fetcher via twstock.
============================================

Fetches real-time prices from TWSE during market hours (09:00-13:30 TST).

Rate limiting strategy:
  - TWSE limits ~3 requests per 5 seconds
  - We batch 5 tickers per request using twstock.realtime.get()
  - For 30+ tickers: split into groups of 5, with 2s delay between groups
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

TST = ZoneInfo("Asia/Taipei")

# Market hours (Taiwan Standard Time)
MARKET_OPEN_HOUR = 9
MARKET_OPEN_MIN = 0
MARKET_CLOSE_HOUR = 13
MARKET_CLOSE_MIN = 30


def is_market_open() -> bool:
    """Check if Taiwan stock market is currently open."""
    now = datetime.now(TST)
    # Weekdays only (Mon=0, Fri=4)
    if now.weekday() > 4:
        return False
    market_open = now.replace(hour=MARKET_OPEN_HOUR, minute=MARKET_OPEN_MIN, second=0)
    market_close = now.replace(hour=MARKET_CLOSE_HOUR, minute=MARKET_CLOSE_MIN, second=0)
    return market_open <= now <= market_close


async def fetch_realtime_prices(tickers: list[str]) -> dict[str, dict]:
    """
    Fetch real-time prices for Taiwan stocks via twstock.

    Args:
        tickers: List of Taiwan stock tickers (e.g., ['2393', '2454'])

    Returns:
        dict mapping ticker to price data:
        {
            '2393': {
                'current_price': 55.3,
                'day_open': 54.8,
                'day_high': 55.5,
                'day_low': 54.5,
                'volume': 12345678,
                'timestamp': datetime(...)
            }
        }
    """
    try:
        import twstock
    except ImportError:
        logger.error("twstock not installed. Run: pip install twstock")
        return {}

    results: dict[str, dict] = {}
    batch_size = 5
    delay_between_batches = 2.0  # seconds

    for i in range(0, len(tickers), batch_size):
        batch = tickers[i:i + batch_size]
        logger.info(f"Fetching batch {i // batch_size + 1}: {batch}")

        for ticker in batch:
            try:
                stock = twstock.realtime.get(ticker)
                if stock and stock.get('success'):
                    info = stock.get('realtime', {})
                    misc = stock.get('info', {})

                    # Parse latest trade price
                    latest_price = _parse_float(info.get('latest_trade_price'))
                    if latest_price is None:
                        # Try best_bid/ask midpoint
                        bid = _parse_float(info.get('best_bid_price', ['0'])[0] if isinstance(info.get('best_bid_price'), list) else '0')
                        ask = _parse_float(info.get('best_ask_price', ['0'])[0] if isinstance(info.get('best_ask_price'), list) else '0')
                        if bid and ask:
                            latest_price = (bid + ask) / 2

                    if latest_price and latest_price > 0:
                        results[ticker] = {
                            'current_price': latest_price,
                            'day_open': _parse_float(info.get('open')),
                            'day_high': _parse_float(info.get('high')),
                            'day_low': _parse_float(info.get('low')),
                            'volume': _parse_int(info.get('accumulate_trade_volume')),
                            'timestamp': datetime.now(TST),
                        }
                    else:
                        logger.warning(f"No valid price for {ticker}")
                else:
                    logger.warning(f"twstock request failed for {ticker}: {stock}")
            except Exception as e:
                logger.error(f"Error fetching {ticker}: {e}")

        # Rate limit delay between batches
        if i + batch_size < len(tickers):
            await asyncio.sleep(delay_between_batches)

    logger.info(f"Fetched {len(results)}/{len(tickers)} real-time prices")
    return results


def _parse_float(val) -> Optional[float]:
    """Safely parse a value to float."""
    if val is None:
        return None
    try:
        result = float(str(val).replace(',', ''))
        if result <= 0:
            return None
        return result
    except (ValueError, TypeError):
        return None


def _parse_int(val) -> Optional[int]:
    """Safely parse a value to int."""
    if val is None:
        return None
    try:
        return int(str(val).replace(',', ''))
    except (ValueError, TypeError):
        return None
