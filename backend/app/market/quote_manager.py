"""
Quote Manager — Unified real-time quote orchestrator.
=====================================================

Central hub that owns and coordinates all data-source clients:

  Phase 1:  Fugle WebSocket   (Taiwan stocks, 09:00-13:30 TST)
  Phase 2:  Finnhub WS        (US stocks, 09:30-16:00 ET)  ← future
            Polygon REST       (US fallback)                 ← future
  Phase 3:  Shioaji            (Taiwan, broker-grade)        ← future

Responsibilities
----------------
* Start / stop data sources according to market hours
* Own the DynamicSubscription scanner
* Provide a unified health-check dict for ``/api/monitor/status``
* Forward price updates so alert-checking can run

Integration
-----------
``stock_monitor.init_monitor()`` creates one ``QuoteManager`` and calls
``start()`` / ``stop()`` as part of the FastAPI lifespan.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time as dt_time
from typing import Optional
from zoneinfo import ZoneInfo

from app.config import get_settings
from app.market.dynamic_subscription import DynamicSubscription

logger = logging.getLogger(__name__)
TST = ZoneInfo("Asia/Taipei")
ET = ZoneInfo("America/New_York")

# Taiwan market hours
TW_OPEN = dt_time(9, 0)
TW_CLOSE = dt_time(13, 30)

# US market hours (Eastern)
US_OPEN = dt_time(9, 30)
US_CLOSE = dt_time(16, 0)


class QuoteManager:
    """Unified orchestrator for all real-time quote sources."""

    def __init__(self, supabase_client, loop: Optional[asyncio.AbstractEventLoop] = None):
        self._supabase = supabase_client
        self._loop = loop or asyncio.get_event_loop()
        self._settings = get_settings()
        self._running = False

        # ── Phase 1: Fugle ──
        self._fugle_client = None  # FugleWSClient
        self._fugle_enabled = getattr(self._settings, "FUGLE_ENABLED", False)

        # ── Phase 2: Finnhub + Polygon ──
        self._finnhub_client = None
        self._finnhub_enabled = getattr(self._settings, "FINNHUB_ENABLED", False)
        self._polygon_fallback = None
        self._polygon_enabled = getattr(self._settings, "POLYGON_ENABLED", False)

        # ── Phase 3: Shioaji ──
        self._shioaji_client = None
        self._shioaji_enabled = getattr(self._settings, "SHIOAJI_ENABLED", False)

        # ── Dynamic subscription ──
        self._subscription: Optional[DynamicSubscription] = None

        # ── Callbacks ──
        self._on_price_update = None  # set by stock_monitor

    # ── Public API ──────────────────────────────────────────────

    async def start(self, on_price_update=None) -> None:
        """
        Start all enabled data sources and the dynamic subscription scanner.

        Args:
            on_price_update: async callback(ticker, price) called on every
                             new price — used by stock_monitor for alert checking.
        """
        self._running = True
        self._on_price_update = on_price_update

        # ── Phase 1: Fugle WS ──
        if self._fugle_enabled:
            await self._start_fugle()
        else:
            logger.info("Fugle WS disabled (FUGLE_ENABLED=false or no API key)")

        # ── Phase 2: Finnhub WS ──
        if self._finnhub_enabled:
            await self._start_finnhub()
        else:
            logger.info("Finnhub WS disabled (FINNHUB_ENABLED=false or no API key)")

        # ── Phase 3: Shioaji ──
        if self._shioaji_enabled:
            await self._start_shioaji()
        else:
            logger.info("Shioaji disabled (SHIOAJI_ENABLED=false or no API key)")

        # ── Dynamic Subscription ──
        self._subscription = DynamicSubscription(
            supabase_client=self._supabase,
            on_subscribe=self._handle_subscribe,
            on_unsubscribe=self._handle_unsubscribe,
        )
        await self._subscription.start()

        logger.info("QuoteManager started")

    async def stop(self) -> None:
        """Gracefully shut down all data sources."""
        self._running = False

        if self._subscription:
            await self._subscription.stop()

        if self._fugle_client:
            self._fugle_client.disconnect()

        if self._finnhub_client:
            self._finnhub_client.disconnect()

        if self._polygon_fallback:
            await self._polygon_fallback.stop()

        if self._shioaji_client:
            self._shioaji_client.disconnect()

        logger.info("QuoteManager stopped")

    def health(self) -> dict:
        """Aggregate health info from all active sources."""
        sources = []

        if self._fugle_client:
            sources.append(self._fugle_client.health())

        if self._finnhub_client:
            sources.append(self._finnhub_client.health())

        if self._polygon_fallback:
            sources.append(self._polygon_fallback.health())

        if self._shioaji_client:
            sources.append(self._shioaji_client.health())

        tw_tickers = (
            self._subscription.get_tw_tickers() if self._subscription else set()
        )
        us_tickers = (
            self._subscription.get_us_tickers() if self._subscription else set()
        )

        return {
            "running": self._running,
            "sources": sources,
            "tracked_tw": len(tw_tickers),
            "tracked_us": len(us_tickers),
        }

    @property
    def is_tw_market_open(self) -> bool:
        """Check if Taiwan market is currently open."""
        now = datetime.now(TST)
        if now.weekday() > 4:  # Sat / Sun
            return False
        return TW_OPEN <= now.time() <= TW_CLOSE

    @property
    def is_us_market_open(self) -> bool:
        """Check if US market is currently open."""
        now = datetime.now(ET)
        if now.weekday() > 4:
            return False
        return US_OPEN <= now.time() <= US_CLOSE

    # ── Phase 1: Fugle ──────────────────────────────────────────

    async def _start_fugle(self) -> None:
        """Initialise and connect the Fugle WebSocket client."""
        api_key = getattr(self._settings, "FUGLE_API_KEY", "")
        if not api_key:
            logger.warning("FUGLE_API_KEY not set — Fugle WS skipped")
            return

        from app.market.fugle_ws_client import FugleWSClient

        reconnect_max = getattr(
            self._settings, "FUGLE_RECONNECT_MAX_DELAY", 60
        )
        self._fugle_client = FugleWSClient(
            api_key=api_key,
            supabase_client=self._supabase,
            loop=self._loop,
            on_price_update=self._on_price_update,
            reconnect_max_delay=float(reconnect_max),
        )
        self._fugle_client.connect()
        logger.info("Fugle WS client initialised")

    # ── Phase 2: Finnhub ────────────────────────────────────────

    async def _start_finnhub(self) -> None:
        """Initialise and connect the Finnhub WebSocket client."""
        api_key = getattr(self._settings, "FINNHUB_API_KEY", "")
        if not api_key:
            logger.warning("FINNHUB_API_KEY not set — Finnhub WS skipped")
            return

        from app.market.finnhub_ws_client import FinnhubWSClient

        self._finnhub_client = FinnhubWSClient(
            api_key=api_key,
            supabase_client=self._supabase,
            loop=self._loop,
            on_price_update=self._on_price_update,
        )
        self._finnhub_client.connect()
        logger.info("Finnhub WS client initialised")

        # Start Polygon fallback if enabled
        if self._polygon_enabled:
            polygon_key = getattr(self._settings, "POLYGON_API_KEY", "")
            if polygon_key:
                from app.market.polygon_fallback import PolygonFallback

                self._polygon_fallback = PolygonFallback(
                    api_key=polygon_key,
                    supabase_client=self._supabase,
                    finnhub_client=self._finnhub_client,
                )

    # ── Phase 3: Shioaji ────────────────────────────────────────

    async def _start_shioaji(self) -> None:
        """Initialise and connect the Shioaji client."""
        api_key = getattr(self._settings, "SHIOAJI_API_KEY", "")
        secret = getattr(self._settings, "SHIOAJI_SECRET_KEY", "")
        if not api_key or not secret:
            logger.warning("Shioaji credentials not set — skipped")
            return

        from app.market.shioaji_client import ShioajiClient

        self._shioaji_client = ShioajiClient(
            api_key=api_key,
            secret_key=secret,
            supabase_client=self._supabase,
            loop=self._loop,
            on_price_update=self._on_price_update,
        )
        self._shioaji_client.connect()
        logger.info("Shioaji client initialised")

    # ── Subscription callbacks ──────────────────────────────────

    def _handle_subscribe(self, tickers: list[str]) -> None:
        """Called by DynamicSubscription when new tickers appear."""
        # Phase 3 takes priority for TW tickers if available
        if self._shioaji_client and self._shioaji_client.is_connected:
            self._shioaji_client.subscribe(tickers)
        elif self._fugle_client:
            self._fugle_client.subscribe(tickers)

    def _handle_unsubscribe(self, tickers: list[str]) -> None:
        """Called by DynamicSubscription when tickers are removed."""
        if self._shioaji_client:
            self._shioaji_client.unsubscribe(tickers)
        if self._fugle_client:
            self._fugle_client.unsubscribe(tickers)
