"""
yfinance Fetcher — Multi-source price fetcher
=============================================================

Handles:
  - Taiwan stock close prices via TWSE/TPEX API (primary)
  - Taiwan stock close prices via yfinance (fallback)
  - US stock close prices via yfinance
  - USDTWD exchange rate via yfinance
  - Sector info caching

NOTE: Yahoo Finance blocks cloud server IPs (Railway, Heroku, AWS).
For Taiwan stocks, we use the official TWSE/TPEX API (mis.twse.com.tw)
which is the same API that twstock uses — proven to work on Railway.
yfinance is only used as fallback for TW and primary for US stocks.
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

# Delay between API calls (seconds)
FETCH_DELAY = 0.5

# Browser-like User-Agent
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

# ─── TWSE/TPEX API (Taiwan stocks) ──────────────────────────────

TWSE_API_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"


async def fetch_tw_close_prices_twse(tickers: list[str]) -> dict[str, dict]:
    """
    Fetch Taiwan stock close prices from TWSE/TPEX official API.

    This is the same API that twstock uses for real-time data.
    After market close, the 'z' field contains the close price
    and 'y' field contains yesterday's close (prev_close).

    For each ticker, we try both tse_ (TWSE 上市) and otc_ (TPEX 上櫃)
    to handle both exchange types.

    Args:
        tickers: List of ticker strings (e.g., ['2330', '2363', '5289'])

    Returns:
        dict mapping ticker to price data
    """
    import requests

    results: dict[str, dict] = {}

    if not tickers:
        return results

    # Build query string: try both tse_ and otc_ for each ticker
    # TWSE API accepts pipe-separated list
    query_parts = []
    for t in tickers:
        query_parts.append(f"tse_{t}.tw")
        query_parts.append(f"otc_{t}.tw")

    # Split into batches of 20 to avoid too-long URLs
    batch_size = 20
    all_stock_data = []

    for i in range(0, len(query_parts), batch_size):
        batch = query_parts[i:i + batch_size]
        query_str = "|".join(batch)

        try:
            if i > 0:
                await asyncio.sleep(FETCH_DELAY)

            resp = requests.get(
                TWSE_API_URL,
                params={"ex_ch": query_str},
                headers={"User-Agent": USER_AGENT},
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()

            if data.get("msgArray"):
                all_stock_data.extend(data["msgArray"])

        except Exception as e:
            logger.error(f"TWSE API batch request failed: {e}")

    # Process results
    seen_tickers = set()
    for item in all_stock_data:
        ticker = item.get("c", "")  # ticker code
        if not ticker or ticker in seen_tickers:
            continue

        z = item.get("z", "-")  # latest trade price (close after market)
        y = item.get("y", "-")  # yesterday's close
        n = item.get("n", "")   # stock name

        # 'z' can be '-' if no trade today
        if z == "-" or not z:
            logger.warning(f"TWSE: {ticker} ({n}) has no trade price (z='-')")
            continue

        try:
            close_price = float(z)
            prev_close = float(y) if y and y != "-" else close_price

            if not is_valid_number(close_price):
                continue

            results[ticker] = {
                'current_price': close_price,
                'prev_close': prev_close,
                'sector': 'Unknown',
                'region': 'TPE',
            }
            seen_tickers.add(ticker)

            logger.info(
                f"  TWSE: {ticker} ({n}): close={close_price}, "
                f"prev_close={prev_close}"
            )

        except (ValueError, TypeError) as e:
            logger.warning(f"TWSE: {ticker} parse error: {e}")

    logger.info(f"TWSE API: fetched {len(results)}/{len(tickers)} prices")
    return results


# ─── Utility ─────────────────────────────────────────────────────

def is_valid_number(n) -> bool:
    """Check if a value is a valid, finite number."""
    try:
        num = float(n)
        return not (math.isnan(num) or math.isinf(num))
    except (TypeError, ValueError):
        return False


def _create_yf_session():
    """Create a requests.Session with browser-like headers."""
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


# ─── Main fetch function ─────────────────────────────────────────

async def fetch_close_prices(
    tickers: list[dict],
    supabase_client
) -> dict[str, dict]:
    """
    Fetch close prices for a batch of stocks.

    Strategy:
      - Taiwan stocks (TPE): Use TWSE/TPEX API (primary), yfinance (fallback)
      - US stocks: Use yfinance with browser session

    Args:
        tickers: List of dicts with 'ticker' and 'region' keys
        supabase_client: Supabase client for DB updates

    Returns:
        dict mapping original ticker to price data
    """
    results: dict[str, dict] = {}

    # Separate TW and US tickers
    tw_tickers = [item['ticker'] for item in tickers if item.get('region') == 'TPE']
    us_tickers = [item for item in tickers if item.get('region') not in ('TPE', 'FX')]

    # Get existing sectors
    existing_sectors: dict[str, str] = {}
    try:
        res = supabase_client.table("market_data").select("ticker, sector").execute()
        existing_sectors = {item['ticker']: item.get('sector', 'Unknown') for item in res.data}
    except Exception:
        pass

    # ── Taiwan stocks: TWSE API ──
    if tw_tickers:
        logger.info(f"Fetching {len(tw_tickers)} TW tickers via TWSE API...")

        tw_results = await fetch_tw_close_prices_twse(tw_tickers)

        # Restore existing sectors
        for ticker, data in tw_results.items():
            if ticker in existing_sectors:
                data['sector'] = existing_sectors[ticker]

        results.update(tw_results)

        # Check for missing tickers — try yfinance as fallback
        missing_tw = [t for t in tw_tickers if t not in results]
        if missing_tw:
            logger.info(f"TWSE missed {len(missing_tw)} tickers, trying yfinance fallback...")
            yf_results = await _fetch_via_yfinance(
                missing_tw, region='TPE', existing_sectors=existing_sectors
            )
            results.update(yf_results)

    # ── US stocks: yfinance → Finnhub REST fallback ──
    if us_tickers:
        us_ticker_codes = [item['ticker'] for item in us_tickers]
        logger.info(f"Fetching {len(us_ticker_codes)} US tickers via yfinance...")
        yf_results = await _fetch_via_yfinance(
            us_ticker_codes, region='US', existing_sectors=existing_sectors
        )
        results.update(yf_results)

        # Fallback: any US tickers yfinance missed → try Finnhub REST API
        missing_us = [t for t in us_ticker_codes if t not in results]
        if missing_us:
            logger.info(
                "yfinance missed %d US tickers, trying Finnhub REST: %s",
                len(missing_us), missing_us,
            )
            finnhub_results = await _fetch_via_finnhub_rest(
                missing_us, existing_sectors=existing_sectors
            )
            results.update(finnhub_results)

    return results


async def _fetch_via_yfinance(
    ticker_codes: list[str],
    region: str,
    existing_sectors: dict[str, str]
) -> dict[str, dict]:
    """
    Fallback: fetch close prices via yfinance with browser session.

    Used for:
      - US stocks (primary)
      - Taiwan stocks that TWSE API missed (fallback)

    Strategy (two-tier):
      Tier 1: ticker.info['regularMarketPrice'] — most up-to-date price
              (after market close, this IS the latest close price)
      Tier 2: ticker.history(period="5d") — fallback if .info fails
              (may return stale data if called too soon after close)
    """
    try:
        import yfinance as yf
    except ImportError:
        logger.error("yfinance not installed")
        return {}

    try:
        yf.set_tz_cache_location("/tmp/yfinance_tz_cache")
    except Exception:
        pass

    results: dict[str, dict] = {}
    session = _create_yf_session()

    for idx, ticker in enumerate(ticker_codes):
        try:
            if idx > 0:
                await asyncio.sleep(FETCH_DELAY)

            # Build yfinance ticker symbol
            if region == 'TPE':
                query_ticker = f"{ticker}.TW"
            else:
                query_ticker = ticker

            ticker_obj = yf.Ticker(query_ticker, session=session)

            # ── Tier 1: Try ticker.info for the most accurate price ──
            close_price = None
            prev_close = None
            sector = existing_sectors.get(ticker, "Unknown")
            used_info = False

            try:
                info = ticker_obj.info
                if info:
                    # regularMarketPrice = latest trade price
                    # After market close, this equals the closing price
                    rmp = info.get('regularMarketPrice')
                    if rmp and is_valid_number(rmp):
                        close_price = float(rmp)
                        used_info = True

                    # regularMarketPreviousClose or previousClose
                    pc = info.get('regularMarketPreviousClose') or info.get('previousClose')
                    if pc and is_valid_number(pc):
                        prev_close = float(pc)

                    # Sector info (bonus)
                    if sector == "Unknown":
                        sector = info.get('sector', 'Unknown')
            except Exception as e:
                logger.debug(f"yfinance info failed for {ticker}: {e}")

            # ── Tier 2: Fall back to history() if info didn't work ──
            if close_price is None:
                hist = ticker_obj.history(period="5d")

                # .TW → .TWO fallback
                if (hist is None or hist.empty) and region == 'TPE':
                    alt_ticker = f"{ticker}.TWO"
                    logger.info(f"yfinance fallback: {query_ticker} → {alt_ticker}")
                    await asyncio.sleep(FETCH_DELAY)
                    ticker_obj = yf.Ticker(alt_ticker, session=session)
                    hist = ticker_obj.history(period="5d")
                    if hist is not None and not hist.empty:
                        query_ticker = alt_ticker

                if hist is None or hist.empty:
                    logger.warning(f"yfinance: no data for {ticker}")
                    continue

                valid_data = hist.dropna(subset=['Close'])
                if valid_data.empty:
                    continue

                close_price = float(valid_data['Close'].iloc[-1])

                if prev_close is None and len(valid_data) >= 2:
                    pc = valid_data['Close'].iloc[-2]
                    if is_valid_number(pc):
                        prev_close = float(pc)

            if not close_price or not is_valid_number(close_price):
                logger.warning(f"yfinance: no valid price for {ticker}")
                continue

            if prev_close is None:
                prev_close = close_price

            results[ticker] = {
                'current_price': close_price,
                'prev_close': prev_close,
                'sector': sector,
                'region': region,
            }

            source_tag = "info" if used_info else "history"
            logger.info(f"  yfinance({source_tag}): {ticker}: close={close_price}, prev_close={prev_close}")

        except Exception as e:
            logger.error(f"yfinance error for {ticker}: {e}")

    return results


# ─── Exchange Rate ───────────────────────────────────────────────

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


# ─── Finnhub REST API Fallback (US stocks) ────────────────────

FINNHUB_QUOTE_URL = "https://finnhub.io/api/v1/quote"


async def _fetch_via_finnhub_rest(
    ticker_codes: list[str],
    existing_sectors: dict[str, str] | None = None,
) -> dict[str, dict]:
    """
    Fetch US stock close prices via Finnhub REST API ``/quote`` endpoint.

    This is a **fallback** for when yfinance fails (common on cloud servers
    like Railway because Yahoo Finance blocks their IPs).

    Finnhub free-tier quota: 60 API calls / minute.

    Response format::

        {"c": 134.99, "d": -1.01, "dp": -0.7426,
         "h": 137.98, "l": 134.43, "o": 136.06,
         "pc": 136.0, "t": 1700000000}

        c  = current price (= close when market is closed)
        pc = previous close
    """
    import requests

    existing_sectors = existing_sectors or {}

    try:
        from app.config import get_settings
        api_key = get_settings().FINNHUB_API_KEY
    except Exception:
        api_key = ""

    if not api_key:
        logger.warning("Finnhub REST fallback skipped: no FINNHUB_API_KEY")
        return {}

    results: dict[str, dict] = {}

    for idx, ticker in enumerate(ticker_codes):
        try:
            if idx > 0:
                await asyncio.sleep(1.1)  # Stay within 60 req/min

            resp = requests.get(
                FINNHUB_QUOTE_URL,
                params={"symbol": ticker, "token": api_key},
                timeout=10,
            )

            if resp.status_code == 429:
                logger.warning("Finnhub REST rate limited (429) — stopping")
                break

            resp.raise_for_status()
            data = resp.json()

            price = data.get("c")  # current / close price
            prev_close = data.get("pc")  # previous close

            if not price or not is_valid_number(price) or float(price) <= 0:
                logger.warning(f"Finnhub REST: no valid price for {ticker}")
                continue

            results[ticker] = {
                "current_price": float(price),
                "prev_close": float(prev_close) if prev_close and is_valid_number(prev_close) else float(price),
                "sector": existing_sectors.get(ticker, "Unknown"),
                "region": "US",
            }
            logger.info(
                "  Finnhub REST: %s → close=%.2f, prev_close=%.2f",
                ticker, float(price),
                float(prev_close) if prev_close else 0,
            )

        except Exception as e:
            logger.error(f"Finnhub REST error for {ticker}: {e}")

    if results:
        logger.info(f"Finnhub REST fallback: {len(results)}/{len(ticker_codes)} tickers")

    return results
