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
        # Ensure max delay is at least MAX_CONN_BACKOFF so "max connections"
        # errors don't get their backoff capped too low
        self._reconnect_max = max(reconnect_max_delay, MAX_CONN_BACKOFF)
        self._reconnect_timer: Optional[threading.Timer] = None
        self._reconnect_lock = threading.Lock()
        self._reconnecting = False   # True while a reconnect is in progress

        # Stats
        self._last_message_at: Optional[datetime] = None
        self._message_count = 0
        self._seen_symbols: set[str] = set()  # Track which symbols actually receive data

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
            "symbols_covered": len(self._seen_symbols),
            "symbols_subscribed": len(self._subscribed),
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

            # Periodic coverage summary (every 300 messages ≈ every few minutes)
            if self._message_count % 300 == 0:
                missing = self._subscribed - self._seen_symbols
                logger.info(
                    "Fugle WS coverage: %d/%d symbols active, %d msgs total%s",
                    len(self._seen_symbols), len(self._subscribed),
                    self._message_count,
                    f" | NOT covered: {missing}" if missing else "",
                )

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
            logger.info("Fugle WS connecting to server …")
            self._stock.connect()
        except Exception as e:
            logger.error(f"Fugle WS connect failed: {e}", exc_info=True)
            # Detect max-connections to use longer backoff
            if "Maximum number of connections" in str(e):
                self._reconnect_delay = max(
                    self._reconnect_delay, MAX_CONN_BACKOFF
                )
            # ALWAYS schedule reconnect on failure (if we should still run)
            if self._should_run and not self._reconnecting:
                self._schedule_reconnect()

    # ── Internal: message processing ────────────────────────────

    def _handle_message(self, message) -> None:
        """
        Process a Fugle trades message and write to Supabase.

        The Fugle SDK may deliver messages in several formats depending on
        the SDK version, channel, and subscription type.  We try multiple
        extraction strategies to be resilient to format changes.

        Known formats:
          - SDK v1.x trades: ``{"event":"data","data":{"symbol":"2330","price":568,...}}``
          - SDK v2.x / snapshot: top-level ``{"symbol":"2330","price":568,...}``
          - Heartbeat / ack:    ``{"event":"heartbeat",...}`` or ``{"event":"subscribed",...}``
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

            # ── Diagnostic: log first 5 messages' structure so we can
            #    debug format mismatches in Railway logs ──
            if self._message_count <= 5:
                # Truncate to avoid huge log lines; keep keys + first-level values
                sample = {k: (v if not isinstance(v, dict) else f"<dict keys={list(v.keys())}>")
                          for k, v in list(message.items())[:10]}
                logger.info(
                    "Fugle WS msg #%d structure: %s",
                    self._message_count, sample,
                )

            event = message.get("event", "")

            # ── Skip non-data events ──
            # Accept "data" and also empty-event messages (some SDK versions
            # deliver trade data without an "event" wrapper).
            if event and event != "data":
                # Log unexpected event types (but not heartbeats, which are normal)
                if event not in ("heartbeat", "subscribed", "unsubscribed", "pong"):
                    if self._message_count <= 20:
                        logger.debug("Fugle WS: skipping event=%s", event)
                return

            # ── Extract the data payload ──
            # Strategy 1: nested under "data" key (SDK v1.x standard)
            data = message.get("data", {})
            if isinstance(data, str):
                # Some SDK versions deliver data as a JSON string
                try:
                    data = json.loads(data)
                except (json.JSONDecodeError, ValueError):
                    data = {}

            # ── Symbol extraction: try multiple locations ──
            symbol = (
                data.get("symbol")           # SDK v1.x: inside data
                or message.get("symbol")     # SDK v2.x: top-level
                or data.get("code")          # alternative key
                or message.get("code")       # alternative key
                or ""
            )
            if not symbol:
                # Log first few failures for debugging
                if self._message_count <= 20 and (event == "data" or not event):
                    logger.warning(
                        "Fugle WS: no symbol found in msg #%d (event=%s, "
                        "data_keys=%s, msg_keys=%s)",
                        self._message_count, event,
                        list(data.keys())[:8] if isinstance(data, dict) else "N/A",
                        list(message.keys())[:8],
                    )
                return

            # ── Price extraction: try multiple locations and keys ──
            price = None

            # Try 1: data.price (SDK v1.x)
            if isinstance(data, dict):
                price = data.get("price")

            # Try 2: data.trade.price (older SDK)
            if price is None and isinstance(data, dict):
                trade_obj = data.get("trade")
                if isinstance(trade_obj, dict):
                    price = trade_obj.get("price")

            # Try 3: top-level price (SDK v2.x / snapshot)
            if price is None:
                price = message.get("price")

            # Try 4: closePrice or lastPrice (alternative names)
            if price is None and isinstance(data, dict):
                price = data.get("closePrice") or data.get("lastPrice") or data.get("close")

            # NOTE: Do NOT fallback to bid/ask midpoint!
            # The "trades" channel should provide actual trade prices.
            # Midpoint of bid/ask always differs by half a tick
            # (±0.025 / ±0.25 / ±2.5), causing price drift on the dashboard.
            # If no trade price is available, skip this message entirely.

            if price is None or float(price) <= 0:
                if self._message_count <= 20 and symbol:
                    logger.warning(
                        "Fugle WS: no valid price for %s in msg #%d "
                        "(data_keys=%s)",
                        symbol, self._message_count,
                        list(data.keys())[:10] if isinstance(data, dict) else "N/A",
                    )
                return

            price = float(price)

            # ── Volume ──
            trade_obj = data.get("trade", data) if isinstance(data, dict) else {}
            volume = (
                trade_obj.get("size")
                or trade_obj.get("volume")
                or data.get("size") if isinstance(data, dict) else None
                or data.get("volume") if isinstance(data, dict) else None
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

            # Additional OHLC fields if present
            if isinstance(data, dict):
                for key, col in [("open", "day_open"), ("high", "day_high"), ("low", "day_low")]:
                    val = data.get(key) or (trade_obj.get(key) if isinstance(trade_obj, dict) else None)
                    if val is not None:
                        upsert[col] = float(val)

            # Log first message per symbol for debugging (track coverage)
            if symbol not in self._seen_symbols:
                self._seen_symbols.add(symbol)
                logger.info(
                    "Fugle WS first price: %s = %.2f (vol=%s) "
                    "[%d/%d symbols covered]",
                    symbol, price, volume,
                    len(self._seen_symbols), len(self._subscribed),
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
            self._supabase.table("market_data").upsert(
                data, on_conflict='ticker'
            ).execute()
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
                logger.info("Fugle WS reconnect cancelled (_should_run=False)")
                return
            logger.info(
                "Fugle WS attempting reconnect (delay was %.0fs, next=%.0fs) …",
                self._reconnect_delay / 2,  # approximate: was halved after schedule
                self._reconnect_delay,
            )

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
        except Exception as e:
            logger.error(f"Fugle WS reconnect failed unexpectedly: {e}", exc_info=True)
            # Schedule another attempt if we should still run
            if self._should_run:
                self._schedule_reconnect()
        finally:
            with self._reconnect_lock:
                self._reconnecting = False

    def _cancel_reconnect(self) -> None:
        """Cancel any pending reconnect timer."""
        if self._reconnect_timer:
            self._reconnect_timer.cancel()
            self._reconnect_timer = None
