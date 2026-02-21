"""
Fugle WebSocket Client — Real-time Taiwan stock quotes.
========================================================

Wraps the `fugle-marketdata` Python SDK to provide:
  - Persistent WebSocket connection during market hours
  - Auto-reconnect with exponential backoff (1 s → 60 s)
  - Subscribe / unsubscribe individual tickers on the fly
  - Writes every price update into Supabase `market_data`

Lifecycle
---------
QuoteManager calls ``connect()`` at market open and ``disconnect()``
at market close.  Between those two calls the connection stays alive;
any network blip triggers automatic reconnection.

Thread model
------------
``fugle-marketdata`` runs its own WebSocket event-loop thread.
We marshal data back to the main asyncio loop via
``asyncio.run_coroutine_threadsafe`` so Supabase writes are non-blocking.
"""
from __future__ import annotations

import asyncio
import logging
import time
import threading
from datetime import datetime
from typing import Callable, Optional, Set
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)
TST = ZoneInfo("Asia/Taipei")

# ── Constants ───────────────────────────────────────────────────
DEFAULT_CHANNEL = "trades"
RECONNECT_BASE_DELAY = 1.0        # seconds
RECONNECT_MAX_DELAY = 60.0        # seconds


class FugleWSClient:
    """Manages a single Fugle WebSocket connection for Taiwan stocks."""

    def __init__(
        self,
        api_key: str,
        supabase_client,
        loop: Optional[asyncio.AbstractEventLoop] = None,
        on_price_update: Optional[Callable] = None,
        reconnect_max_delay: float = RECONNECT_MAX_DELAY,
    ):
        self._api_key = api_key
        self._supabase = supabase_client
        self._loop = loop or asyncio.get_event_loop()
        self._on_price_update = on_price_update  # optional external callback

        # Connection state
        self._client = None          # fugle_marketdata.WebSocketClient
        self._stock = None           # client.stock sub-client
        self._connected = False
        self._should_run = False     # True between connect() / disconnect()
        self._subscribed: Set[str] = set()

        # Reconnect
        self._reconnect_delay = RECONNECT_BASE_DELAY
        self._reconnect_max = reconnect_max_delay
        self._reconnect_timer: Optional[threading.Timer] = None

        # Stats
        self._last_message_at: Optional[datetime] = None
        self._message_count = 0

    # ── Public API ──────────────────────────────────────────────

    def connect(self) -> None:
        """
        Open the WebSocket connection.

        Safe to call multiple times — silently returns if already connected.
        """
        if self._connected:
            logger.debug("Fugle WS already connected")
            return

        self._should_run = True
        self._init_client()

    def disconnect(self) -> None:
        """Gracefully tear down the connection."""
        self._should_run = False
        self._cancel_reconnect()

        if self._stock:
            try:
                self._stock.disconnect()
            except Exception as e:
                logger.warning(f"Fugle WS disconnect error: {e}")

        self._connected = False
        self._subscribed.clear()
        logger.info("Fugle WS disconnected")

    def subscribe(self, tickers: list[str]) -> None:
        """Subscribe to real-time trades for the given tickers."""
        if not self._stock or not self._connected:
            # Queue for when we reconnect
            self._subscribed.update(tickers)
            return

        for ticker in tickers:
            if ticker not in self._subscribed:
                try:
                    self._stock.subscribe({
                        "channel": DEFAULT_CHANNEL,
                        "symbol": ticker,
                    })
                    self._subscribed.add(ticker)
                    logger.debug(f"Fugle WS subscribed: {ticker}")
                except Exception as e:
                    logger.error(f"Fugle WS subscribe error [{ticker}]: {e}")

    def unsubscribe(self, tickers: list[str]) -> None:
        """Unsubscribe from the given tickers."""
        if not self._stock or not self._connected:
            self._subscribed -= set(tickers)
            return

        for ticker in tickers:
            if ticker in self._subscribed:
                try:
                    self._stock.unsubscribe({
                        "channel": DEFAULT_CHANNEL,
                        "symbol": ticker,
                    })
                    self._subscribed.discard(ticker)
                    logger.debug(f"Fugle WS unsubscribed: {ticker}")
                except Exception as e:
                    logger.error(f"Fugle WS unsubscribe error [{ticker}]: {e}")

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def subscribed_tickers(self) -> Set[str]:
        return set(self._subscribed)

    def health(self) -> dict:
        """Return health-check info for the /api/monitor/status endpoint."""
        return {
            "source": "fugle_ws",
            "connected": self._connected,
            "subscribed_count": len(self._subscribed),
            "last_message_at": (
                self._last_message_at.isoformat() if self._last_message_at else None
            ),
            "total_messages": self._message_count,
        }

    # ── Internal: SDK initialisation ────────────────────────────

    def _init_client(self) -> None:
        """Create the Fugle WebSocketClient and wire up event handlers."""
        try:
            from fugle_marketdata import WebSocketClient
        except ImportError:
            logger.error(
                "fugle-marketdata not installed. "
                "Run: pip install fugle-marketdata"
            )
            return

        self._client = WebSocketClient(api_key=self._api_key)
        self._stock = self._client.stock

        # ── Event handlers ──
        @self._stock.on("connect")
        def _on_connect():
            self._connected = True
            self._reconnect_delay = RECONNECT_BASE_DELAY  # reset backoff
            logger.info("Fugle WS connected")

            # Re-subscribe tickers that were queued / existed before reconnect
            pending = list(self._subscribed)
            self._subscribed.clear()
            if pending:
                self.subscribe(pending)

        @self._stock.on("message")
        def _on_message(message: dict):
            self._last_message_at = datetime.now(TST)
            self._message_count += 1
            self._handle_message(message)

        @self._stock.on("disconnect")
        def _on_disconnect(code, reason):
            self._connected = False
            logger.warning(f"Fugle WS disconnected: code={code} reason={reason}")
            if self._should_run:
                self._schedule_reconnect()

        @self._stock.on("error")
        def _on_error(error):
            logger.error(f"Fugle WS error: {error}")

        # Start connection (runs on SDK's internal thread)
        try:
            self._stock.connect()
        except Exception as e:
            logger.error(f"Fugle WS connect failed: {e}")
            if self._should_run:
                self._schedule_reconnect()

    # ── Internal: message processing ────────────────────────────

    def _handle_message(self, message: dict) -> None:
        """
        Process a Fugle trades message and write to Supabase.

        Message shape (trades channel):
        {
            "event": "data",
            "channel": "trades",
            "symbol": "2330",
            "data": {
                "trade": {
                    "price": 590.0,
                    "size": 1000,
                    "time": 1700000000000,
                    ...
                },
                ...
            }
        }
        """
        try:
            event = message.get("event")
            if event != "data":
                return  # heartbeat, subscribed confirmation, etc.

            symbol = message.get("symbol", "")
            data = message.get("data", {})

            # Extract price from the trades payload
            trade = data.get("trade", data)
            price = trade.get("price")
            if price is None or float(price) <= 0:
                return

            price = float(price)
            volume = trade.get("size") or trade.get("volume")

            upsert = {
                "ticker": symbol,
                "region": "TPE",
                "current_price": price,
                "realtime_price": price,
                "update_source": "fugle_ws",
                "updated_at": datetime.now(TST).isoformat(),
            }
            if volume is not None:
                upsert["volume"] = int(volume)

            # Additional OHLC fields if present
            for key, col in [("open", "day_open"), ("high", "day_high"), ("low", "day_low")]:
                val = data.get(key) or trade.get(key)
                if val is not None:
                    upsert[col] = float(val)

            # Write to Supabase (from SDK thread → asyncio loop)
            asyncio.run_coroutine_threadsafe(
                self._upsert_market_data(upsert), self._loop
            )

            # Fire external callback if registered
            if self._on_price_update:
                asyncio.run_coroutine_threadsafe(
                    self._safe_callback(symbol, price), self._loop
                )

        except Exception as e:
            logger.error(f"Fugle message handling error: {e}", exc_info=True)

    async def _upsert_market_data(self, data: dict) -> None:
        """Async wrapper for Supabase upsert."""
        try:
            self._supabase.table("market_data").upsert(data).execute()
        except Exception as e:
            logger.error(f"Fugle→Supabase upsert error [{data.get('ticker')}]: {e}")

    async def _safe_callback(self, symbol: str, price: float) -> None:
        """Safely invoke the external on_price_update callback."""
        try:
            result = self._on_price_update(symbol, price)
            if asyncio.iscoroutine(result):
                await result
        except Exception as e:
            logger.error(f"on_price_update callback error: {e}")

    # ── Internal: reconnection ──────────────────────────────────

    def _schedule_reconnect(self) -> None:
        """Schedule a reconnect with exponential backoff."""
        self._cancel_reconnect()
        delay = self._reconnect_delay
        logger.info(f"Fugle WS reconnecting in {delay:.1f}s …")

        self._reconnect_timer = threading.Timer(delay, self._do_reconnect)
        self._reconnect_timer.daemon = True
        self._reconnect_timer.start()

        # Increase backoff for next attempt
        self._reconnect_delay = min(
            self._reconnect_delay * 2, self._reconnect_max
        )

    def _do_reconnect(self) -> None:
        """Actual reconnect attempt (runs on Timer thread)."""
        if not self._should_run:
            return
        logger.info("Fugle WS attempting reconnect …")
        self._init_client()

    def _cancel_reconnect(self) -> None:
        """Cancel any pending reconnect timer."""
        if self._reconnect_timer:
            self._reconnect_timer.cancel()
            self._reconnect_timer = None
