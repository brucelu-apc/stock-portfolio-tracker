"""
Dynamic Subscription Manager
=============================

Periodically scans Supabase for all tickers that need monitoring
(from ``portfolio_holdings`` + ``price_targets``) and reconciles
the set of subscribed symbols with the live WebSocket clients.

When a user adds a new holding the ticker will be picked up within
``SCAN_INTERVAL`` seconds — no restart required.

Usage
-----
``QuoteManager`` owns a single ``DynamicSubscription`` instance and
calls ``start()`` / ``stop()`` alongside the WS clients.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Callable, Optional, Set

logger = logging.getLogger(__name__)

# How often to re-scan the DB for active tickers (seconds)
SCAN_INTERVAL = 300  # 5 minutes


class DynamicSubscription:
    """
    Watches Supabase for the set of tickers that need real-time quotes
    and calls back whenever the set changes.
    """

    def __init__(
        self,
        supabase_client,
        on_subscribe: Callable[[list[str]], None],
        on_unsubscribe: Callable[[list[str]], None],
        scan_interval: int = SCAN_INTERVAL,
    ):
        self._supabase = supabase_client
        self._on_subscribe = on_subscribe
        self._on_unsubscribe = on_unsubscribe
        self._scan_interval = scan_interval

        self._current_tw: Set[str] = set()
        self._current_us: Set[str] = set()
        self._task: Optional[asyncio.Task] = None
        self._running = False

    # ── Public API ──────────────────────────────────────────────

    async def start(self) -> None:
        """Begin periodic scanning."""
        self._running = True
        # Do one immediate scan so the first subscribe happens right away
        await self._scan()
        # Then schedule periodic scans
        self._task = asyncio.create_task(self._scan_loop())
        logger.info(f"DynamicSubscription started (interval={self._scan_interval}s)")

    async def stop(self) -> None:
        """Stop the scan loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("DynamicSubscription stopped")

    def get_tw_tickers(self) -> Set[str]:
        """Return the current set of Taiwan tickers being tracked."""
        return set(self._current_tw)

    def get_us_tickers(self) -> Set[str]:
        """Return the current set of US tickers being tracked."""
        return set(self._current_us)

    # ── Internal ────────────────────────────────────────────────

    async def _scan_loop(self) -> None:
        """Run _scan() every ``_scan_interval`` seconds."""
        while self._running:
            try:
                await asyncio.sleep(self._scan_interval)
                if self._running:
                    await self._scan()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"DynamicSubscription scan error: {e}", exc_info=True)

    async def _scan(self) -> None:
        """
        Query Supabase for all tracked tickers and reconcile
        with the currently subscribed set.
        """
        tw_tickers: Set[str] = set()
        us_tickers: Set[str] = set()

        # ── From portfolio_holdings ──
        try:
            res = self._supabase.table("portfolio_holdings") \
                .select("ticker, region").execute()
            for row in res.data:
                ticker = row.get("ticker", "")
                region = row.get("region", "TPE")
                if not ticker:
                    continue
                if region == "TPE":
                    tw_tickers.add(ticker)
                elif region == "US":
                    us_tickers.add(ticker)
        except Exception as e:
            logger.error(f"Failed to scan portfolio_holdings: {e}")

        # ── From price_targets (advisory, always TPE) ──
        try:
            res = self._supabase.table("price_targets") \
                .select("ticker") \
                .eq("is_latest", True) \
                .execute()
            for row in res.data:
                ticker = row.get("ticker", "")
                if ticker:
                    tw_tickers.add(ticker)
        except Exception as e:
            logger.error(f"Failed to scan price_targets: {e}")

        # ── Reconcile Taiwan tickers ──
        new_tw = tw_tickers - self._current_tw
        removed_tw = self._current_tw - tw_tickers

        if new_tw:
            logger.info(f"New TW tickers to subscribe: {new_tw}")
            try:
                self._on_subscribe(list(new_tw))
            except Exception as e:
                logger.error(f"TW subscribe callback error: {e}")

        if removed_tw:
            logger.info(f"TW tickers to unsubscribe: {removed_tw}")
            try:
                self._on_unsubscribe(list(removed_tw))
            except Exception as e:
                logger.error(f"TW unsubscribe callback error: {e}")

        self._current_tw = tw_tickers

        # ── Store US tickers (Phase 2 will use these) ──
        # For now just track the set; QuoteManager will read it
        # when Finnhub/Polygon clients are added.
        if us_tickers != self._current_us:
            added_us = us_tickers - self._current_us
            removed_us = self._current_us - us_tickers
            if added_us:
                logger.info(f"New US tickers detected: {added_us}")
            if removed_us:
                logger.info(f"US tickers removed: {removed_us}")
            self._current_us = us_tickers

        logger.debug(
            f"DynamicSubscription scan: "
            f"TW={len(self._current_tw)}, US={len(self._current_us)}"
        )
