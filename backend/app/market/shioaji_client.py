"""
Shioaji Client — Broker-grade Taiwan stock quotes (Phase 3).
=============================================================

Integrates with Sinopac's Shioaji SDK (永豐金 API) for the most
accurate real-time Taiwan stock quotes.  Requires a Sinopac
securities account.

This module is **optional** — set ``SHIOAJI_ENABLED=true`` plus
``SHIOAJI_API_KEY`` and ``SHIOAJI_SECRET_KEY`` to activate.

When active, Shioaji takes priority over Fugle for Taiwan stocks
because broker-grade data is more accurate and has lower latency.

Data flow
---------
Shioaji tick → ``_on_tick()`` → upsert ``market_data`` (Supabase)
                               → ``on_price_update()`` callback

Note on Shioaji login
---------------------
``shioaji.Shioaji().login()`` is a *synchronous* blocking call that
can take several seconds.  We run it in a thread to avoid blocking
the asyncio event loop.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from datetime import datetime
from typing import Callable, Optional, Set
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)
TST = ZoneInfo("Asia/Taipei")


class ShioajiClient:
    """
    Manages a Shioaji connection for broker-grade Taiwan stock quotes.

    This is a Phase 3 optional component.  If the Shioaji SDK is not
    installed or credentials are missing, it silently no-ops.
    """

    def __init__(
        self,
        api_key: str,
        secret_key: str,
        supabase_client,
        loop: Optional[asyncio.AbstractEventLoop] = None,
        on_price_update: Optional[Callable] = None,
    ):
        self._api_key = api_key
        self._secret_key = secret_key
        self._supabase = supabase_client
        self._loop = loop or asyncio.get_event_loop()
        self._on_price_update = on_price_update

        self._api = None  # shioaji.Shioaji instance
        self._connected = False
        self._should_run = False
        self._subscribed: Set[str] = set()

        # Stats
        self._last_tick_at: Optional[datetime] = None
        self._tick_count = 0

    # ── Public API ──────────────────────────────────────────────

    def connect(self) -> None:
        """
        Login to Shioaji in a background thread.

        The login process is blocking and can take a few seconds, so we
        offload it to avoid stalling the asyncio loop.
        """
        if self._connected:
            return
        self._should_run = True

        thread = threading.Thread(target=self._do_login, daemon=True)
        thread.start()

    def disconnect(self) -> None:
        """Logout and clean up."""
        self._should_run = False
        if self._api:
            try:
                self._api.logout()
            except Exception as e:
                logger.warning(f"Shioaji logout error: {e}")
        self._connected = False
        self._subscribed.clear()
        logger.info("Shioaji disconnected")

    def subscribe(self, tickers: list[str]) -> None:
        """Subscribe to real-time ticks for the given Taiwan tickers."""
        if not self._api or not self._connected:
            self._subscribed.update(tickers)
            return

        for ticker in tickers:
            if ticker not in self._subscribed:
                try:
                    contract = self._api.Contracts.Stocks[ticker]
                    if contract:
                        self._api.quote.subscribe(
                            contract,
                            quote_type="tick",
                            version="v1",
                        )
                        self._subscribed.add(ticker)
                        logger.debug(f"Shioaji subscribed: {ticker}")
                    else:
                        logger.warning(f"Shioaji: contract not found for {ticker}")
                except Exception as e:
                    logger.error(f"Shioaji subscribe error [{ticker}]: {e}")

    def unsubscribe(self, tickers: list[str]) -> None:
        """Unsubscribe from the given tickers."""
        if not self._api or not self._connected:
            self._subscribed -= set(tickers)
            return

        for ticker in tickers:
            if ticker in self._subscribed:
                try:
                    contract = self._api.Contracts.Stocks[ticker]
                    if contract:
                        self._api.quote.unsubscribe(
                            contract,
                            quote_type="tick",
                            version="v1",
                        )
                    self._subscribed.discard(ticker)
                    logger.debug(f"Shioaji unsubscribed: {ticker}")
                except Exception as e:
                    logger.error(f"Shioaji unsubscribe error [{ticker}]: {e}")

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def subscribed_tickers(self) -> Set[str]:
        return set(self._subscribed)

    def health(self) -> dict:
        return {
            "source": "shioaji",
            "connected": self._connected,
            "subscribed_count": len(self._subscribed),
            "last_tick_at": (
                self._last_tick_at.isoformat() if self._last_tick_at else None
            ),
            "total_ticks": self._tick_count,
        }

    # ── Internal: login ─────────────────────────────────────────

    def _do_login(self) -> None:
        """Blocking login (runs on a background thread)."""
        try:
            import shioaji as sj
        except ImportError:
            logger.error(
                "shioaji not installed. Run: pip install shioaji"
            )
            return

        try:
            self._api = sj.Shioaji()
            self._api.login(
                api_key=self._api_key,
                secret_key=self._secret_key,
            )
            self._connected = True
            logger.info("Shioaji logged in successfully")

            # Register tick callback
            self._api.quote.set_on_tick_stk_v1_callback(self._on_tick)

            # Subscribe any tickers that were queued before login
            pending = list(self._subscribed)
            self._subscribed.clear()
            if pending:
                self.subscribe(pending)

        except Exception as e:
            logger.error(f"Shioaji login failed: {e}", exc_info=True)
            self._connected = False

    # ── Internal: tick handler ──────────────────────────────────

    def _on_tick(self, exchange, tick) -> None:
        """
        Callback from Shioaji on every stock tick.

        ``tick`` attributes:
          - code:      e.g. "2330"
          - close:     last trade price
          - volume:    tick volume
          - total_volume: accumulated volume
          - bid_price / ask_price
        """
        try:
            ticker = str(tick.code)
            price = float(tick.close)
            if price <= 0:
                return

            self._last_tick_at = datetime.now(TST)
            self._tick_count += 1

            upsert = {
                "ticker": ticker,
                "region": "TPE",
                "current_price": price,
                "realtime_price": price,
                "update_source": "shioaji",
                "updated_at": datetime.now(TST).isoformat(),
            }

            # Add volume if available
            total_vol = getattr(tick, "total_volume", None)
            if total_vol:
                upsert["volume"] = int(total_vol)

            asyncio.run_coroutine_threadsafe(
                self._upsert(upsert), self._loop
            )

            if self._on_price_update:
                asyncio.run_coroutine_threadsafe(
                    self._safe_callback(ticker, price), self._loop
                )

        except Exception as e:
            logger.error(f"Shioaji tick handler error: {e}", exc_info=True)

    async def _upsert(self, data: dict) -> None:
        try:
            self._supabase.table("market_data").upsert(data).execute()
        except Exception as e:
            logger.error(f"Shioaji→Supabase upsert [{data.get('ticker')}]: {e}")

    async def _safe_callback(self, symbol: str, price: float) -> None:
        try:
            result = self._on_price_update(symbol, price)
            if asyncio.iscoroutine(result):
                await result
        except Exception as e:
            logger.error(f"Shioaji callback error: {e}")
