"""
Taiwan Stock Real-time Fetcher via twstock + TWSE API fallback.
================================================================

Fetches real-time prices from TWSE during market hours (09:00-13:30 TST).

Two-tier strategy:
  Tier 1: twstock.realtime.get() — fast, works for most tickers in its codes DB
  Tier 2: Direct TWSE API — fallback for tickers NOT in twstock.codes
          (newer ETFs, letter-suffix codes like 00991A, recently listed stocks)

Rate limiting strategy:
  - TWSE limits ~3 requests per 5 seconds
  - We batch 5 tickers per request using twstock.realtime.get()
  - For direct API: batch up to 20 tickers per request (| separated)
  - 2s delay between batches
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)

TST = ZoneInfo("Asia/Taipei")

# Market hours (Taiwan Standard Time)
MARKET_OPEN_HOUR = 9
MARKET_OPEN_MIN = 0
MARKET_CLOSE_HOUR = 13
MARKET_CLOSE_MIN = 30

# TWSE direct API
TWSE_SESSION_URL = "https://mis.twse.com.tw/stock/index.jsp"
TWSE_API_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"

# Known market mapping: ticker → 'tse' or 'otc'
# This supplements twstock.codes for tickers not in its database.
# Updated manually when new stocks/ETFs are added to the portfolio.
MARKET_OVERRIDE: dict[str, str] = {
    # --- ETFs with letter suffix ---
    "00991A": "tse",    # 主動復華未來50
    "00991B": "tse",
    # --- Newer ETFs ---
    "00965":  "tse",    # 元大航太防衛科技
    "00961":  "tse",    # 元大全球AI
    "00960":  "tse",    # 元大台灣碳權
    "00958B": "tse",
    "00957B": "tse",
    # --- Newer stocks ---
    "2646":   "tse",    # 星宇航空
    "6957":   "tse",    # 聯域光電
}


def is_market_open() -> bool:
    """Check if Taiwan stock market is currently open."""
    now = datetime.now(TST)
    # Weekdays only (Mon=0, Fri=4)
    if now.weekday() > 4:
        return False
    market_open = now.replace(hour=MARKET_OPEN_HOUR, minute=MARKET_OPEN_MIN, second=0)
    market_close = now.replace(hour=MARKET_CLOSE_HOUR, minute=MARKET_CLOSE_MIN, second=0)
    return market_open <= now <= market_close


def _get_market_type(ticker: str) -> str:
    """
    Determine if a ticker is listed on TSE (上市) or OTC (上櫃).

    Priority:
      1. MARKET_OVERRIDE dict (manually maintained for new tickers)
      2. twstock.codes / twstock.twse (built-in database)
      3. Heuristic: 4-digit codes starting with 0-3 → tse, 4-8 → otc
         ETF codes (00xxx) → tse (most ETFs are TSE-listed)
    """
    # 1. Manual override
    if ticker in MARKET_OVERRIDE:
        return MARKET_OVERRIDE[ticker]

    # 2. twstock database
    try:
        import twstock
        if ticker in twstock.twse:
            return "tse"
        code = twstock.codes.get(ticker)
        if code:
            return "tse" if code.market == "上市" else "otc"
    except ImportError:
        pass

    # 3. Heuristic
    numeric_part = re.sub(r"[A-Za-z]", "", ticker)
    if ticker.startswith("00"):
        return "tse"  # ETFs are predominantly TSE-listed
    if len(numeric_part) == 4:
        first_digit = int(numeric_part[0])
        if first_digit <= 3:
            return "tse"
    return "tse"  # Default to tse, fallback will try otc


async def fetch_realtime_prices(tickers: list[str]) -> dict[str, dict]:
    """
    Fetch real-time prices for Taiwan stocks.

    Uses twstock for known tickers, falls back to direct TWSE API
    for tickers not in twstock's codes database.

    Args:
        tickers: List of Taiwan stock tickers (e.g., ['2393', '2454', '00991A'])

    Returns:
        dict mapping ticker to price data
    """
    # Separate tickers into twstock-known vs unknown
    twstock_tickers: list[str] = []
    fallback_tickers: list[str] = []

    try:
        import twstock
        for t in tickers:
            if t in twstock.codes:
                twstock_tickers.append(t)
            else:
                fallback_tickers.append(t)
    except ImportError:
        logger.warning("twstock not installed — using direct API for all tickers")
        fallback_tickers = list(tickers)

    results: dict[str, dict] = {}

    # ── Tier 1: twstock for known tickers ──
    if twstock_tickers:
        tier1 = await _fetch_via_twstock(twstock_tickers)
        results.update(tier1)

    # ── Tier 2: Direct TWSE API for unknown tickers ──
    if fallback_tickers:
        logger.info(f"Fallback TWSE API for {len(fallback_tickers)} tickers: {fallback_tickers}")
        tier2 = await _fetch_via_twse_api(fallback_tickers)
        results.update(tier2)

    logger.info(f"Fetched {len(results)}/{len(tickers)} real-time prices "
                f"(twstock={len(twstock_tickers)}, api={len(fallback_tickers)})")
    return results


async def _fetch_via_twstock(tickers: list[str]) -> dict[str, dict]:
    """Tier 1: Fetch via twstock library (existing logic)."""
    import twstock

    results: dict[str, dict] = {}
    batch_size = 5
    delay = 2.0

    for i in range(0, len(tickers), batch_size):
        batch = tickers[i:i + batch_size]
        logger.debug(f"twstock batch {i // batch_size + 1}: {batch}")

        for ticker in batch:
            try:
                stock = twstock.realtime.get(ticker)
                if stock and stock.get('success'):
                    info = stock.get('realtime', {})

                    latest_price = _parse_float(info.get('latest_trade_price'))
                    # NOTE: Do NOT fallback to bid/ask midpoint!
                    # Midpoint always differs from real price by half a tick
                    # (e.g. ±0.025 / ±0.25 / ±2.5 depending on price range).
                    # If no trade price is available, skip this ticker — the DB
                    # retains the last valid price from Fugle WS or a prior poll.
                    if latest_price is None:
                        logger.debug(
                            "twstock %s: latest_trade_price='-', skipping "
                            "(no bid/ask midpoint to avoid half-tick drift)",
                            ticker,
                        )

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
                    logger.warning(f"twstock failed for {ticker}")
            except Exception as e:
                logger.error(f"twstock error for {ticker}: {e}")

        if i + batch_size < len(tickers):
            await asyncio.sleep(delay)

    return results


async def _fetch_via_twse_api(tickers: list[str]) -> dict[str, dict]:
    """
    Tier 2: Fetch directly from TWSE API for tickers not in twstock.codes.

    Uses httpx to:
      1. Start a session (GET index.jsp for cookies)
      2. Query getStockInfo.jsp with ex_ch=tse_XXXX.tw|otc_YYYY.tw|...

    For tickers where tse/otc is uncertain, tries tse first.
    If result is empty for a ticker, retries with otc.
    """
    results: dict[str, dict] = {}

    if not tickers:
        return results

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            # Step 1: Establish session (get JSESSIONID cookie)
            await client.get(TWSE_SESSION_URL)
            await asyncio.sleep(0.5)

            # Step 2: Build query string — batch up to 20 tickers
            batch_size = 20
            for i in range(0, len(tickers), batch_size):
                batch = tickers[i:i + batch_size]

                # Build ex_ch parameter
                ex_ch_parts = []
                for t in batch:
                    market = _get_market_type(t)
                    ex_ch_parts.append(f"{market}_{t}.tw")
                ex_ch = "|".join(ex_ch_parts)

                url = f"{TWSE_API_URL}?ex_ch={ex_ch}&json=1&delay=0&_={int(time.time() * 1000)}"
                resp = await client.get(url)

                if resp.status_code != 200:
                    logger.error(f"TWSE API HTTP {resp.status_code}")
                    continue

                data = resp.json()
                msg_array = data.get("msgArray", [])

                if not msg_array:
                    logger.warning(f"TWSE API empty msgArray for batch: {batch}")
                    continue

                # Parse results
                fetched_codes = set()
                for item in msg_array:
                    ticker_code = item.get("c", "")  # stock code
                    name = item.get("n", "")          # stock name
                    z = item.get("z", "-")            # latest trade price
                    o = item.get("o", "-")            # open
                    h = item.get("h", "-")            # high
                    l = item.get("l", "-")            # low
                    y = item.get("y", "-")            # prev close
                    v = item.get("v", "-")            # accumulated volume

                    latest_price = _parse_float(z)
                    # NOTE: Do NOT fallback to bid/ask midpoint — same
                    # half-tick drift issue as in twstock Tier 1.
                    if latest_price is None:
                        logger.debug(
                            "TWSE API %s: z='%s', skipping (no midpoint)",
                            ticker_code, z,
                        )

                    if latest_price and latest_price > 0:
                        results[ticker_code] = {
                            'current_price': latest_price,
                            'day_open': _parse_float(o),
                            'day_high': _parse_float(h),
                            'day_low': _parse_float(l),
                            'prev_close': _parse_float(y),
                            'volume': _parse_int(v),
                            'name': name,
                            'timestamp': datetime.now(TST),
                        }
                        fetched_codes.add(ticker_code)
                        logger.info(f"TWSE API: {ticker_code} ({name}) = {latest_price}")
                    else:
                        logger.warning(f"TWSE API: no valid price for {ticker_code} (z={z})")

                # Step 3: Retry failed tickers with opposite market type
                missed = [t for t in batch if t not in fetched_codes]
                if missed:
                    await asyncio.sleep(1.0)
                    retry_parts = []
                    for t in missed:
                        orig = _get_market_type(t)
                        alt = "otc" if orig == "tse" else "tse"
                        retry_parts.append(f"{alt}_{t}.tw")
                    retry_ex_ch = "|".join(retry_parts)
                    retry_url = f"{TWSE_API_URL}?ex_ch={retry_ex_ch}&json=1&delay=0&_={int(time.time() * 1000)}"

                    retry_resp = await client.get(retry_url)
                    if retry_resp.status_code == 200:
                        retry_data = retry_resp.json()
                        for item in retry_data.get("msgArray", []):
                            ticker_code = item.get("c", "")
                            z = item.get("z", "-")
                            latest_price = _parse_float(z)
                            if latest_price and latest_price > 0:
                                results[ticker_code] = {
                                    'current_price': latest_price,
                                    'day_open': _parse_float(item.get("o")),
                                    'day_high': _parse_float(item.get("h")),
                                    'day_low': _parse_float(item.get("l")),
                                    'prev_close': _parse_float(item.get("y")),
                                    'volume': _parse_int(item.get("v")),
                                    'name': item.get("n", ""),
                                    'timestamp': datetime.now(TST),
                                }
                                logger.info(
                                    f"TWSE API (retry): {ticker_code} = {latest_price}"
                                )

                # Rate limit between batches
                if i + batch_size < len(tickers):
                    await asyncio.sleep(2.0)

    except Exception as e:
        logger.error(f"TWSE API fallback error: {e}", exc_info=True)

    return results


def _parse_float(val) -> Optional[float]:
    """Safely parse a value to float."""
    if val is None or val == "-" or val == "":
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
    if val is None or val == "-" or val == "":
        return None
    try:
        return int(str(val).replace(',', ''))
    except (ValueError, TypeError):
        return None
