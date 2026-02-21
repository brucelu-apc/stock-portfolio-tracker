"""
Polygon.io REST Fallback — US stock price backup.
==================================================

When Finnhub WebSocket is disconnected for more than
``ACTIVATION_THRESHOLD`` seconds, this module activates and polls
Polygon's REST API every ``POLL_INTERVAL`` seconds until Finnhub
recovers.

Polygon.io was rebranded to Massive.com in October 2025, but the
``api.polygon.io`` domain still works.

API endpoint
------------
GET https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers
    ?tickers=AAPL,MSFT&apiKey=...

Each ticker returns:
  ticker.lastTrade.p  (last trade price)
  ticker.prevDay.c    (previous close)
  ticker.day.o / h / l / c / v  (today's OHLCV)
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)
TST = ZoneInfo("Asia/Taipei")

BASE_URL = "https://api.polygon.io"
SNAPSHOT_URL = f"{BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers"

# Activate when Finnhub is down for this many seconds
ACTIVATION_THRESHOLD = 120  # 2 minutes
POLL_INTERVAL = 60           # seconds between polls


class PolygonFallback:
    """Polls Polygon REST when Finnhub WS is unavailable."""

    def __init__(
        self,
        api_key: str,
        supabase_client,
        finnhub_client,  # FinnhubWSClient — we check .is_connected
    ):
        self._api_key = api_key
        self._supabase = supabase_client
        self._finnhub = finnhub_client
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._active = False  # True when actively polling

        # Stats
        self._last_poll_at: Optional[datetime] = None
        self._poll_count = 0

    async def start(self, tickers: list[str]) -> None:
        """Start the fallback watcher loop."""
        self._running = True
        self._tickers = set(tickers)
        self._task = asyncio.create_task(self._watch_loop())
        logger.info("Polygon fallback watcher started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Polygon fallback stopped")

    def update_tickers(self, tickers: list[str]) -> None:
        """Update the set of US tickers to poll."""
        self._tickers = set(tickers)

    def health(self) -> dict:
        return {
            "source": "polygon_fallback",
            "active": self._active,
            "last_poll_at": (
                self._last_poll_at.isoformat() if self._last_poll_at else None
            ),
            "total_polls": self._poll_count,
        }

    # ── Internal ────────────────────────────────────────────────

    async def _watch_loop(self) -> None:
        """
        Main loop: check if Finnhub is connected.
        If disconnected for > threshold, start polling.
        """
        disconnected_since: Optional[datetime] = None

        while self._running:
            try:
                if self._finnhub.is_connected:
                    # Finnhub is fine — reset
                    if self._active:
                        logger.info("Finnhub recovered — Polygon fallback deactivated")
                        self._active = False
                    disconnected_since = None
                else:
                    # Finnhub is down
                    now = datetime.now(TST)
                    if disconnected_since is None:
                        disconnected_since = now

                    elapsed = (now - disconnected_since).total_seconds()
                    if elapsed >= ACTIVATION_THRESHOLD and not self._active:
                        logger.warning(
                            f"Finnhub down for {elapsed:.0f}s — "
                            f"activating Polygon fallback"
                        )
                        self._active = True

                    if self._active and self._tickers:
                        await self._poll_prices()

                await asyncio.sleep(POLL_INTERVAL)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Polygon fallback loop error: {e}", exc_info=True)
                await asyncio.sleep(POLL_INTERVAL)

    async def _poll_prices(self) -> None:
        """Fetch snapshot for all tracked US tickers from Polygon."""
        tickers_str = ",".join(sorted(self._tickers))
        url = SNAPSHOT_URL
        params = {
            "tickers": tickers_str,
            "apiKey": self._api_key,
        }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()

            tickers_data = data.get("tickers", [])
            now_iso = datetime.now(TST).isoformat()

            for item in tickers_data:
                ticker = item.get("ticker", "")
                last_trade = item.get("lastTrade", {})
                price = last_trade.get("p")
                if not ticker or not price or float(price) <= 0:
                    continue

                prev_day = item.get("prevDay", {})
                day = item.get("day", {})

                upsert = {
                    "ticker": ticker,
                    "region": "US",
                    "current_price": float(price),
                    "realtime_price": float(price),
                    "prev_close": float(prev_day.get("c", 0)) or None,
                    "day_open": float(day.get("o", 0)) or None,
                    "day_high": float(day.get("h", 0)) or None,
                    "day_low": float(day.get("l", 0)) or None,
                    "volume": int(day.get("v", 0)) or None,
                    "update_source": "polygon_rest",
                    "updated_at": now_iso,
                }
                try:
                    self._supabase.table("market_data").upsert(upsert).execute()
                except Exception as e:
                    logger.error(f"Polygon→Supabase upsert [{ticker}]: {e}")

            self._last_poll_at = datetime.now(TST)
            self._poll_count += 1
            logger.info(f"Polygon polled {len(tickers_data)} US tickers")

        except httpx.HTTPStatusError as e:
            logger.error(f"Polygon API HTTP error: {e.response.status_code}")
        except Exception as e:
            logger.error(f"Polygon poll error: {e}", exc_info=True)
