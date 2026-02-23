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
import json
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
MAX_CONN_BACKOFF = 120.0          # longer backoff for "max connections" errors


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

        # Reconnect — use a lock to prevent parallel reconnect storms
        self._reconnect_delay = RECONNECT_BASE_DELAY
        self._reconnect_max = reconnect_max_delay
        self._reconnect_timer: Optional[threading.Timer] = None
        self._reconnect_lock = threading.Lock()
        self._reconnecting = False   # True while a reconnect is in progress

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

        # ── Event handlers (SDK uses .on(event, listener), NOT decorators) ──
        def _on_connect():
            self._connected = True
            # NOTE: Do NOT reset backoff here — only reset after first
            # successful message, to avoid infinite 1s reconnect loops
            # when Fugle rejects us for "Maximum connections reached".
            logger.info("Fugle WS connected")

            # Re-subscribe tickers that were queued / existed before reconnect
            pending = list(self._subscribed)
            self._subscribed.clear()
            if pending:
                self.subscribe(pending)

        def _on_message(message):
            # Fugle SDK may deliver raw JSON strings OR parsed dicts
            if isinstance(message, str):
                try:
                    message = json.loads(message)
                except (json.JSONDecodeError, ValueError):
                    logger.debug(f"Fugle WS non-JSON message: {message[:120]}")
                    return
            if not isinstance(message, dict):
                logger.debug(f"Fugle WS unexpected message type: {type(message)}")
                return

            self._last_message_at = datetime.now(TST)
            self._message_count += 1
            # Reset backoff only after receiving real data (stable connection)
            if self._reconnect_delay > RECONNECT_BASE_DELAY:
                logger.info("Fugle WS connection stable — backoff reset")
                self._reconnect_delay = RECONNECT_BASE_DELAY
            self._handle_message(message)

        def _on_disconnect(code, reason):
            self._connected = False
            logger.warning(f"Fugle WS disconnected: code={code} reason={reason}")
            if self._should_run and not self._reconnecting:
                self._schedule_reconnect()

        def _on_error(error):
            error_str = str(error)
            logger.error(f"Fugle WS error: {error_str}")
            # If max connections reached, use much longer backoff
            if "Maximum number of connections" in error_str:
                self._reconnect_delay = max(
                    self._reconnect_delay, MAX_CONN_BACKOFF
                )
                logger.warning(
                    f"Fugle max connections hit — backoff set to "
                    f"{self._reconnect_delay:.0f}s"
                )

        self._stock.on("connect", _on_connect)
        self._stock.on("message", _on_message)
        self._stock.on("disconnect", _on_disconnect)
        self._stock.on("error", _on_error)

        # Start connection (runs on SDK's internal thread)
        try:
            self._stock.connect()
        except Exception as e:
            logger.error(f"Fugle WS connect failed: {e}")
            # Detect max-connections to use longer backoff
            if "Maximum number of connections" in str(e):
                self._reconnect_delay = max(
                    self._reconnect_delay, MAX_CONN_BACKOFF
                )
            if self._should_run and not self._reconnecting:
                self._schedule_reconnect()

    # ── Internal: message processing ────────────────────────────

    def _handle_message(self, message) -> None:
        """
        Process a Fugle trades message and write to Supabase.

        Fugle SDK v1.x message shape (trades channel):
        {
            "event": "data",
            "data": {
                "symbol": "2330",
                "type": "EQUITY",
                "exchange": "TWSE",
                "market": "TSE",
                "bid": 567,
                "ask": 568,
                "price": 568,
                "size": 4778,
                "volume": 54538,
                "isClose": true,
                "time": 1685338200000000,
                "serial": 6652422
            },
            "id": "<CHANNEL_ID>",
            "channel": "trades"
        }

        NOTE: In the current SDK, ``symbol`` and ``price`` are inside
        ``data`` directly — there is no ``trade`` sub-object.
        For backward compatibility we also check the old location.
        """
        try:
            # Defensive: parse string messages
            if isinstance(message, str):
                try:
                    message = json.loads(message)
                except (json.JSONDecodeError, ValueError):
                    return
            if not isinstance(message, dict):
                return

            event = message.get("event")
            if event != "data":
                return  # heartbeat, subscribed confirmation, etc.

            data = message.get("data", {})

            # ── Symbol: current SDK puts it inside ``data``,
            #    older versions had it at the top level. ──
            symbol = data.get("symbol") or message.get("symbol", "")
            if not symbol:
                logger.debug("Fugle WS: no symbol in message, skipping")
                return

            # ── Price: current SDK has ``price`` directly in ``data``;
            #    older versions nested it under ``data.trade.price``. ──
            trade = data.get("trade", data)  # backward-compat fallback
            price = trade.get("price")
            if price is None or float(price) <= 0:
                return

            price = float(price)
            volume = (
                trade.get("size")
                or trade.get("volume")
                or data.get("size")
                or data.get("volume")
            )

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

            # Additional OHLC fields if present (from candles channel or trade extras)
            for key, col in [("open", "day_open"), ("high", "day_high"), ("low", "day_low")]:
                val = data.get(key) or trade.get(key)
                if val is not None:
                    upsert[col] = float(val)

            # Log first message per symbol for debugging
            if self._message_count <= len(self._subscribed):
                logger.info(
                    "Fugle WS price: %s = %.2f (vol=%s, src=%s)",
                    symbol, price, volume,
                    "data" if "price" in data else "data.trade",
                )

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
        """Schedule a reconnect with exponential backoff (thread-safe)."""
        with self._reconnect_lock:
            if self._reconnecting:
                logger.debug("Fugle WS reconnect already scheduled — skipping")
                return
            self._reconnecting = True
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
        try:
            if not self._should_run:
                return
            logger.info("Fugle WS attempting reconnect …")

            # Clean up old SDK client to avoid stale connection leaks
            if self._stock:
                try:
                    self._stock.disconnect()
                except Exception:
                    pass
            self._client = None
            self._stock = None
            self._connected = False

            self._init_client()
        finally:
            with self._reconnect_lock:
                self._reconnecting = False

    def _cancel_reconnect(self) -> None:
        """Cancel any pending reconnect timer."""
        if self._reconnect_timer:
            self._reconnect_timer.cancel()
            self._reconnect_timer = None
