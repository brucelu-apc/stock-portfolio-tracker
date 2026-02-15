"""
Stock Monitor — APScheduler-based orchestrator.
=================================================

Manages three scheduled tasks:
  1. realtime_tw_monitor:  Every 30s during TW market hours (twstock)
  2. daily_tw_close:       14:05 TST (yfinance Taiwan close)
  3. daily_us_close:       05:30 TST (yfinance US close + FX)

Each cycle:
  1. Fetch prices (twstock or yfinance)
  2. Update market_data in Supabase
  3. Check advisory alerts (defense/target)
  4. Check portfolio alerts (TP/SL)
  5. Record triggered alerts in price_alerts
  6. Push notifications (Phase 3-4: LINE/Telegram)
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.config import get_settings
from app.market.twstock_fetcher import fetch_realtime_prices, is_market_open
from app.market.yfinance_fetcher import fetch_close_prices, fetch_exchange_rate
from app.monitor.price_checker import (
    check_advisory_alerts,
    check_portfolio_alerts,
    deduplicate_alerts,
    AlertEvent,
)

logger = logging.getLogger(__name__)
TST = ZoneInfo("Asia/Taipei")

# Global scheduler instance
scheduler: Optional[AsyncIOScheduler] = None

# Supabase client reference (set during init)
_supabase = None


async def init_monitor(supabase_client):
    """Initialize the stock monitor with scheduler and Supabase client."""
    global scheduler, _supabase
    _supabase = supabase_client
    settings = get_settings()

    scheduler = AsyncIOScheduler(timezone=TST)

    # ── Job 1: Real-time Taiwan stock monitoring ──
    interval_seconds = settings.MONITOR_INTERVAL_SECONDS
    scheduler.add_job(
        realtime_tw_monitor,
        IntervalTrigger(seconds=interval_seconds, timezone=TST),
        id='realtime_tw_monitor',
        name='Taiwan Real-time Monitor',
        replace_existing=True,
        max_instances=1,
    )

    # ── Job 2: Taiwan market close update ──
    scheduler.add_job(
        daily_tw_close,
        CronTrigger(hour=14, minute=5, timezone=TST),
        id='daily_tw_close',
        name='Daily TW Close Update',
        replace_existing=True,
    )

    # ── Job 3: US market close + FX update ──
    scheduler.add_job(
        daily_us_close,
        CronTrigger(hour=5, minute=30, timezone=TST),
        id='daily_us_close',
        name='Daily US Close + FX Update',
        replace_existing=True,
    )

    # ── Job 4: Monthly report (1st of each month, 14:30 TST) ──
    scheduler.add_job(
        monthly_report_job,
        CronTrigger(day=1, hour=14, minute=30, timezone=TST),
        id='monthly_report',
        name='Monthly Investment Report',
        replace_existing=True,
    )

    scheduler.start()
    logger.info(f"Stock monitor started (interval={interval_seconds}s)")


async def shutdown_monitor():
    """Gracefully shutdown the scheduler."""
    global scheduler
    if scheduler:
        scheduler.shutdown(wait=False)
        logger.info("Stock monitor stopped")


# ─── Scheduled Jobs ───────────────────────────────────────────

async def realtime_tw_monitor():
    """
    Every 30 seconds during market hours:
    Fetch Taiwan stock real-time prices, update DB, check alerts.
    """
    if not is_market_open():
        return  # Skip outside market hours

    try:
        # 1. Get all tracked Taiwan tickers
        tracked_tickers = await _get_tracked_tickers(region='TPE')
        if not tracked_tickers:
            return

        # 2. Fetch real-time prices
        prices = await fetch_realtime_prices(tracked_tickers)
        if not prices:
            return

        # 3. Update market_data in Supabase
        await _update_market_data_batch(prices, source='twstock')

        # 4. Build current_prices dict
        current_prices = {t: p['current_price'] for t, p in prices.items()}

        # 5. Check and process alerts
        await _process_alerts(current_prices)

        logger.info(f"TW realtime: {len(prices)} tickers updated")

    except Exception as e:
        logger.error(f"Realtime monitor error: {e}", exc_info=True)


async def daily_tw_close():
    """After Taiwan market close: fetch accurate closing prices."""
    try:
        tickers = await _get_tracked_tickers(region='TPE')
        if not tickers:
            return

        ticker_dicts = [{'ticker': t, 'region': 'TPE'} for t in tickers]
        prices = await fetch_close_prices(ticker_dicts, _supabase)

        for ticker, data in prices.items():
            await _update_single_market_data(ticker, data, source='yfinance')

        logger.info(f"TW close update: {len(prices)} tickers")
    except Exception as e:
        logger.error(f"TW close update error: {e}", exc_info=True)


async def daily_us_close():
    """After US market close: fetch US prices + USDTWD exchange rate."""
    try:
        # Update exchange rate
        fx = await fetch_exchange_rate()
        if fx:
            _supabase.table("market_data").upsert({
                "ticker": "USDTWD",
                "region": "FX",
                "current_price": fx['current_price'],
                "close_price": fx['current_price'],
                "realtime_price": None,
                "prev_close": fx['prev_close'],
                "sector": "Forex",
                "update_source": "yfinance",
                "updated_at": datetime.now(TST).isoformat(),
            }).execute()
            logger.info(f"USDTWD updated: {fx['current_price']}")

        # Update US stock prices
        us_tickers = await _get_tracked_tickers(region='US')
        if us_tickers:
            ticker_dicts = [{'ticker': t, 'region': 'US'} for t in us_tickers]
            prices = await fetch_close_prices(ticker_dicts, _supabase)
            for ticker, data in prices.items():
                await _update_single_market_data(ticker, data, source='yfinance')

            # Update high watermarks
            await _update_high_watermarks(prices)
            logger.info(f"US close update: {len(prices)} tickers")

    except Exception as e:
        logger.error(f"US close update error: {e}", exc_info=True)


async def monthly_report_job():
    """
    Monthly report generation (1st of each month at 14:30 TST).
    Collects portfolio + advisory data, sends rich messages to all users.
    """
    try:
        from app.report.monthly_report import generate_and_send_report
        await generate_and_send_report(_supabase)
    except Exception as e:
        logger.error(f"Monthly report error: {e}", exc_info=True)


# ─── Helper Functions ─────────────────────────────────────────

async def _get_tracked_tickers(region: Optional[str] = None) -> list[str]:
    """Get all tickers that need monitoring (from holdings + advisory targets)."""
    tickers: set[str] = set()

    try:
        # From portfolio holdings
        query = _supabase.table("portfolio_holdings").select("ticker, region")
        if region:
            query = query.eq("region", region)
        res = query.execute()
        for h in res.data:
            tickers.add(h['ticker'])
    except Exception as e:
        logger.error(f"Failed to fetch holdings tickers: {e}")

    try:
        # From advisory price targets (latest only)
        res = _supabase.table("price_targets").select("ticker").eq("is_latest", True).execute()
        for pt in res.data:
            ticker = pt['ticker']
            # Advisory stocks are always TPE
            if region is None or region == 'TPE':
                tickers.add(ticker)
    except Exception as e:
        logger.error(f"Failed to fetch advisory tickers: {e}")

    return list(tickers)


async def _update_market_data_batch(
    prices: dict[str, dict],
    source: str = 'twstock'
):
    """Batch upsert price data into market_data table."""
    for ticker, data in prices.items():
        try:
            upsert_data = {
                "ticker": ticker,
                "region": "TPE",
                "current_price": data['current_price'],
                "realtime_price": data['current_price'],  # twstock = realtime
                "update_source": source,
                "updated_at": datetime.now(TST).isoformat(),
            }
            # Include OHLCV if available
            if data.get('day_open'):
                upsert_data["day_open"] = data['day_open']
            if data.get('day_high'):
                upsert_data["day_high"] = data['day_high']
            if data.get('day_low'):
                upsert_data["day_low"] = data['day_low']
            if data.get('volume'):
                upsert_data["volume"] = data['volume']

            _supabase.table("market_data").upsert(upsert_data).execute()
        except Exception as e:
            logger.error(f"Failed to update market_data for {ticker}: {e}")


async def _update_single_market_data(
    ticker: str,
    data: dict,
    source: str = 'yfinance'
):
    """Update a single ticker in market_data (yfinance close prices)."""
    try:
        upsert_data = {
            "ticker": ticker,
            "region": data.get('region', 'TPE'),
            "current_price": data['current_price'],
            "close_price": data['current_price'],  # yfinance = official close
            "realtime_price": None,                 # Clear realtime (market closed)
            "prev_close": data.get('prev_close'),
            "sector": data.get('sector', 'Unknown'),
            "update_source": source,
            "updated_at": datetime.now(TST).isoformat(),
        }
        _supabase.table("market_data").upsert(upsert_data).execute()
    except Exception as e:
        logger.error(f"Failed to update {ticker}: {e}")


async def _update_high_watermarks(prices: dict[str, dict]):
    """Update high_watermark_price if current > previous."""
    try:
        holdings = _supabase.table("portfolio_holdings").select("id, ticker, high_watermark_price, cost_price").execute()
        for h in holdings.data:
            ticker = h['ticker']
            if ticker not in prices:
                continue
            current = prices[ticker]['current_price']
            hwm = float(h.get('high_watermark_price') or h.get('cost_price', 0))
            if current > hwm:
                _supabase.table("portfolio_holdings").update(
                    {"high_watermark_price": current}
                ).eq("id", h['id']).execute()
    except Exception as e:
        logger.error(f"High watermark update error: {e}")


async def _process_alerts(current_prices: dict[str, float]):
    """Check both advisory and portfolio alerts, record and (future) push."""

    # ── Advisory alerts ──
    try:
        res = _supabase.table("price_targets").select("*").eq("is_latest", True).execute()
        advisory_alerts = check_advisory_alerts(current_prices, res.data)
    except Exception as e:
        logger.error(f"Advisory alert check error: {e}")
        advisory_alerts = []

    # ── Portfolio alerts ──
    try:
        res = _supabase.table("portfolio_holdings").select("*").execute()
        portfolio_alerts = check_portfolio_alerts(current_prices, res.data)
    except Exception as e:
        logger.error(f"Portfolio alert check error: {e}")
        portfolio_alerts = []

    all_alerts = advisory_alerts + portfolio_alerts

    if not all_alerts:
        return

    # ── Deduplicate against recent alerts ──
    try:
        recent = _supabase.table("price_alerts").select("user_id, ticker, alert_type, triggered_at").order("triggered_at", desc=True).limit(200).execute()
        all_alerts = deduplicate_alerts(all_alerts, recent.data, cooldown_minutes=60)
    except Exception as e:
        logger.error(f"Alert dedup error: {e}")

    if not all_alerts:
        return

    # ── Record alerts + push notifications ──
    for alert in all_alerts:
        notified_via: list[str] = []

        # Push to LINE (Phase 3)
        try:
            line_sent = await _push_alert_to_line(alert)
            if line_sent:
                notified_via.append("line")
        except Exception as e:
            logger.error(f"LINE push error for {alert.ticker}: {e}")

        # Push to Telegram (Phase 4)
        try:
            tg_sent = await _push_alert_to_telegram(alert)
            if tg_sent:
                notified_via.append("telegram")
        except Exception as e:
            logger.error(f"Telegram push error for {alert.ticker}: {e}")

        # Record alert in DB
        try:
            _supabase.table("price_alerts").insert({
                "user_id": alert.user_id,
                "ticker": alert.ticker,
                "alert_type": alert.alert_type,
                "trigger_price": alert.trigger_price,
                "current_price": alert.current_price,
                "notified_via": notified_via,
            }).execute()
            logger.info(f"Alert: {alert.details} [via: {notified_via}]")
        except Exception as e:
            logger.error(f"Failed to record alert: {e}")

    logger.info(f"Processed {len(all_alerts)} alerts")


# ─── API Helpers ──────────────────────────────────────────────

async def _push_alert_to_line(alert: AlertEvent) -> bool:
    """
    Push a price alert to the user's LINE account.

    Checks:
    1. User has a line_user_id in user_messaging
    2. User's notification_prefs enable this alert type
    3. LINE Channel Access Token is configured

    Returns True if the alert was sent successfully.
    """
    from app.messaging.line_notifier import send_alert_push

    try:
        # Look up user's LINE user ID and notification prefs
        user_msg = (
            _supabase.table("user_messaging")
            .select("line_user_id, notification_prefs")
            .eq("user_id", alert.user_id)
            .execute()
        )

        if not user_msg.data:
            return False

        record = user_msg.data[0]
        line_user_id = record.get("line_user_id")
        if not line_user_id:
            return False

        # Check notification preferences
        prefs = record.get("notification_prefs") or {}
        if not prefs.get("line_enabled", True):
            return False

        # Map alert_type to preference key
        pref_map = {
            "defense_breach": "defense_alert",
            "min_target_reached": "min_target_alert",
            "reasonable_target_reached": "reasonable_target_alert",
            "tp_triggered": "tp_sl_alert",
            "sl_triggered": "tp_sl_alert",
        }
        pref_key = pref_map.get(alert.alert_type, "defense_alert")
        if not prefs.get(pref_key, True):
            return False

        # Build dashboard URL
        settings = get_settings()
        dashboard_url = settings.FRONTEND_URL
        if "localhost" in dashboard_url:
            dashboard_url = "https://stock-portfolio-tracker-tawny.vercel.app"

        # Send the alert via LINE
        return await send_alert_push(
            line_user_id=line_user_id,
            ticker=alert.ticker,
            alert_type=alert.alert_type,
            trigger_price=alert.trigger_price,
            current_price=alert.current_price,
            dashboard_url=f"{dashboard_url}?page=advisory",
        )

    except Exception as e:
        logger.error(f"LINE alert push error: {e}")
        return False


async def _push_alert_to_telegram(alert: AlertEvent) -> bool:
    """
    Push a price alert to the user's Telegram chat.

    Checks:
    1. User has a telegram_chat_id in user_messaging
    2. User's notification_prefs enable this alert type for Telegram
    3. TELEGRAM_BOT_TOKEN is configured

    Returns True if the alert was sent successfully.
    """
    from app.messaging.telegram_notifier import send_alert

    try:
        # Look up user's Telegram chat ID and notification prefs
        user_msg = (
            _supabase.table("user_messaging")
            .select("telegram_chat_id, notification_prefs")
            .eq("user_id", alert.user_id)
            .execute()
        )

        if not user_msg.data:
            return False

        record = user_msg.data[0]
        telegram_chat_id = record.get("telegram_chat_id")
        if not telegram_chat_id:
            return False

        # Check notification preferences
        prefs = record.get("notification_prefs") or {}
        if not prefs.get("telegram_enabled", True):
            return False

        # Map alert_type to preference key (same mapping as LINE)
        pref_map = {
            "defense_breach": "defense_alert",
            "min_target_reached": "min_target_alert",
            "reasonable_target_reached": "reasonable_target_alert",
            "tp_triggered": "tp_sl_alert",
            "sl_triggered": "tp_sl_alert",
        }
        pref_key = pref_map.get(alert.alert_type, "defense_alert")
        if not prefs.get(pref_key, True):
            return False

        # Build dashboard URL
        settings = get_settings()
        dashboard_url = settings.FRONTEND_URL
        if "localhost" in dashboard_url:
            dashboard_url = "https://stock-portfolio-tracker-tawny.vercel.app"

        # Send the alert via Telegram
        return await send_alert(
            chat_id=telegram_chat_id,
            ticker=alert.ticker,
            alert_type=alert.alert_type,
            trigger_price=alert.trigger_price,
            current_price=alert.current_price,
            dashboard_url=f"{dashboard_url}?page=advisory",
        )

    except Exception as e:
        logger.error(f"Telegram alert push error: {e}")
        return False


def get_monitor_status() -> dict:
    """Return current monitor status for /api/monitor/status endpoint."""
    if scheduler is None:
        return {"running": False, "message": "Monitor not initialized"}

    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run": str(job.next_run_time) if job.next_run_time else None,
        })

    return {
        "running": scheduler.running,
        "market_open": is_market_open(),
        "jobs": jobs,
    }
