"""
Finnhub WebSocket Client — Real-time US stock quotes.
=====================================================

Uses the raw ``websocket-client`` library to connect to Finnhub's
streaming endpoint at ``wss://ws.finnhub.io``.

Features
--------
* Subscribe / unsubscribe by sending JSON messages
* Auto-reconnect with exponential backoff
* Writes price updates to Supabase ``market_data`` (region='US')
* Thread-safe bridge to asyncio for DB writes
* **Market-hours aware**: only writes ``realtime_price`` during regular
  US trading hours (09:30–16:00 ET, weekdays).  Outside those hours
  trade messages are silently ignored so the dashboard correctly shows
  "休市" (market closed).

Message format from Finnhub
---------------------------
{
    "type": "trade",
    "data": [
        {"s": "AAPL", "p": 178.45, "v": 100, "t": 1700000000000, "c": ["1"]}
    ]
}
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from datetime import datetime
from typing import Callable, Optional, Set
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)
ET = ZoneInfo("America/New_York")
TST = ZoneInfo("Asia/Taipei")


def _is_us_market_open() -> bool:
    """
    Return True if US regular trading session is active.

    Regular hours: Mon–Fri 09:30–16:00 Eastern Time.
    Does NOT account for US holidays — for a hobby project this is fine;
    the worst case is writing ``realtime_price`` on a holiday which the
    ``daily_us_close`` job will overwrite anyway.
    """
    now_et = datetime.now(ET)
    if now_et.weekday() >= 5:          # Saturday=5, Sunday=6
        return False
    t = now_et.time()
    # 09:30 <= now < 16:00
    from datetime import time as dt_time
    return dt_time(9, 30) <= t < dt_time(16, 0)

WS_URL = "wss://ws.finnhub.io"
RECONNECT_BASE_DELAY = 1.0
RECONNECT_MAX_DELAY = 60.0


class FinnhubWSClient:
    """Manages a Finnhub WebSocket connection for US stock real-time trades."""

    def __init__(
        self,
        api_key: str,
        supabase_client,
        loop: Optional[asyncio.AbstractEventLoop] = None,
        on_price_update: Optional[Callable] = None,
    ):
        self._api_key = api_key
        self._supabase = supabase_client
        self._loop = loop or asyncio.get_event_loop()
        self._on_price_update = on_price_update

        self._ws = None
        self._ws_thread: Optional[threading.Thread] = None
        self._connected = False
        self._should_run = False
        self._subscribed: Set[str] = set()

        # Reconnect
        self._reconnect_delay = RECONNECT_BASE_DELAY

        # Stats
        self._last_message_at: Optional[datetime] = None
        self._message_count = 0

    # ── Public API ──────────────────────────────────────────────

    def connect(self) -> None:
        """Open the WebSocket connection in a background thread."""
        if self._connected:
            return
        self._should_run = True
        self._start_ws_thread()

    def disconnect(self) -> None:
        """Gracefully close the connection."""
        self._should_run = False
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                pass
        self._connected = False
        self._subscribed.clear()
        logger.info("Finnhub WS disconnected")

    def subscribe(self, tickers: list[str]) -> None:
        """Subscribe to real-time trades for the given US tickers."""
        for ticker in tickers:
            if ticker not in self._subscribed:
                self._subscribed.add(ticker)
                if self._ws and self._connected:
                    self._send_subscribe(ticker)

    def unsubscribe(self, tickers: list[str]) -> None:
        """Unsubscribe from the given tickers."""
        for ticker in tickers:
            if ticker in self._subscribed:
                self._subscribed.discard(ticker)
                if self._ws and self._connected:
                    self._send_unsubscribe(ticker)

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def subscribed_tickers(self) -> Set[str]:
        return set(self._subscribed)

    def health(self) -> dict:
        return {
            "source": "finnhub_ws",
            "connected": self._connected,
            "subscribed_count": len(self._subscribed),
            "last_message_at": (
                self._last_message_at.isoformat() if self._last_message_at else None
            ),
            "total_messages": self._message_count,
        }

    # ── Internal: WebSocket thread ──────────────────────────────

    def _start_ws_thread(self) -> None:
        """Start the websocket-client in a daemon thread."""
        try:
            import websocket
        except ImportError:
            logger.error(
                "websocket-client not installed. "
                "Run: pip install websocket-client"
            )
            return

        url = f"{WS_URL}?token={self._api_key}"

        self._ws = websocket.WebSocketApp(
            url,
            on_open=self._on_open,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
        )

        self._ws_thread = threading.Thread(
            target=self._ws.run_forever,
            kwargs={"ping_interval": 30, "ping_timeout": 10},
            daemon=True,
        )
        self._ws_thread.start()

    def _on_open(self, ws) -> None:
        """Called when WebSocket connection is established."""
        self._connected = True
        self._reconnect_delay = RECONNECT_BASE_DELAY
        logger.info("Finnhub WS connected")

        # Re-subscribe all queued tickers
        for ticker in list(self._subscribed):
            self._send_subscribe(ticker)

    def _on_message(self, ws, raw_message: str) -> None:
        """Handle incoming trade messages.

        IMPORTANT: Only writes ``realtime_price`` during US regular
        trading hours (09:30–16:00 ET, weekdays).  Outside those hours
        the message is silently dropped so ``realtime_price`` stays
        ``None`` (set by ``daily_us_close``) and the frontend correctly
        shows "休市".
        """
        self._last_message_at = datetime.now(TST)
        self._message_count += 1

        try:
            msg = json.loads(raw_message)
            msg_type = msg.get("type", "")

            if msg_type == "ping":
                return

            if msg_type != "trade":
                return

            # ── Market hours gate ──
            if not _is_us_market_open():
                # Log once every 500 messages to avoid spam
                if self._message_count % 500 == 1:
                    logger.debug(
                        "Finnhub WS: ignoring trade (US market closed), "
                        "total ignored msgs since connect: %d",
                        self._message_count,
                    )
                return

            trades = msg.get("data", [])
            if not trades:
                return

            # Aggregate: keep the latest price per symbol
            latest: dict[str, dict] = {}
            for trade in trades:
                symbol = trade.get("s", "")
                price = trade.get("p")
                volume = trade.get("v", 0)
                if symbol and price and float(price) > 0:
                    latest[symbol] = {
                        "price": float(price),
                        "volume": int(volume),
                        "timestamp": trade.get("t"),
                    }

            # Write each symbol to Supabase
            for symbol, data in latest.items():
                upsert = {
                    "ticker": symbol,
                    "region": "US",
                    "current_price": data["price"],
                    "realtime_price": data["price"],
                    "update_source": "finnhub_ws",
                    "updated_at": datetime.now(TST).isoformat(),
                }
                asyncio.run_coroutine_threadsafe(
                    self._upsert(upsert), self._loop
                )

                if self._on_price_update:
                    asyncio.run_coroutine_threadsafe(
                        self._safe_callback(symbol, data["price"]),
                        self._loop,
                    )

        except Exception as e:
            logger.error(f"Finnhub message error: {e}", exc_info=True)

    def _on_error(self, ws, error) -> None:
        error_str = str(error)
        logger.error(f"Finnhub WS error: {error_str}")
        # 429 Too Many Requests — back off much longer to avoid rate-limit storm
        if "429" in error_str or "API limit reached" in error_str:
            self._reconnect_delay = max(self._reconnect_delay, 120.0)
            logger.warning(
                "Finnhub rate limited (429) — backoff set to %.0fs",
                self._reconnect_delay,
            )

    def _on_close(self, ws, close_status_code, close_msg) -> None:
        self._connected = False
        logger.warning(
            f"Finnhub WS closed: code={close_status_code} msg={close_msg}"
        )
        if self._should_run:
            self._schedule_reconnect()

    # ── Helpers ─────────────────────────────────────────────────

    def _send_subscribe(self, ticker: str) -> None:
        try:
            self._ws.send(json.dumps({
                "type": "subscribe",
                "symbol": ticker,
            }))
            logger.debug(f"Finnhub subscribed: {ticker}")
        except Exception as e:
            logger.error(f"Finnhub subscribe send error [{ticker}]: {e}")

    def _send_unsubscribe(self, ticker: str) -> None:
        try:
            self._ws.send(json.dumps({
                "type": "unsubscribe",
                "symbol": ticker,
            }))
            logger.debug(f"Finnhub unsubscribed: {ticker}")
        except Exception as e:
            logger.error(f"Finnhub unsubscribe send error [{ticker}]: {e}")

    async def _upsert(self, data: dict) -> None:
        try:
            self._supabase.table("market_data").upsert(
                data, on_conflict='ticker'
            ).execute()
        except Exception as e:
            logger.error(f"Finnhub→Supabase upsert error [{data.get('ticker')}]: {e}")

    async def _safe_callback(self, symbol: str, price: float) -> None:
        try:
            result = self._on_price_update(symbol, price)
            if asyncio.iscoroutine(result):
                await result
        except Exception as e:
            logger.error(f"Finnhub on_price_update callback error: {e}")

    def _schedule_reconnect(self) -> None:
        delay = self._reconnect_delay
        logger.info(f"Finnhub WS reconnecting in {delay:.1f}s …")
        timer = threading.Timer(delay, self._do_reconnect)
        timer.daemon = True
        timer.start()
        self._reconnect_delay = min(self._reconnect_delay * 2, RECONNECT_MAX_DELAY)

    def _do_reconnect(self) -> None:
        if not self._should_run:
            return
        logger.info("Finnhub WS attempting reconnect …")
        self._start_ws_thread()
