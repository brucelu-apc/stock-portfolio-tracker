"""
Stock Advisory Tracker — FastAPI Backend
=========================================
Handles:
  - Advisory notification parsing (POST /api/parse)
  - Real-time stock price monitoring (APScheduler)
  - LINE / Telegram webhooks (Phase 3-4)
  - Stock info forwarding (Phase 4)
  - Monthly report generation (Phase 5)
  - Registration email notifications (Phase 6)
"""
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client

from app.config import get_settings
from app.parser.notification_parser import router as parser_router
from app.messaging.line_handler import router as line_router
from app.messaging.telegram_handler import router as telegram_router
from app.messaging.stock_forwarder import router as forward_router
from app.routers.registrations import router as registrations_router
from app.monitor.stock_monitor import (
    init_monitor,
    shutdown_monitor,
    get_monitor_status,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Reduce APScheduler noise — only show warnings (suppress per-job SUCCESS logs)
logging.getLogger("apscheduler.executors.default").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle hook."""
    settings = get_settings()
    logger.info(f"🚀 Backend starting — frontend at {settings.FRONTEND_URL}")

    # Initialize Supabase client
    if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY:
        supabase = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,
        )
        logger.info("Supabase client initialized")

        # Start stock monitor with APScheduler
        try:
            await init_monitor(supabase)
            logger.info("Stock monitor started")
        except Exception as e:
            logger.error(f"Failed to start monitor: {e}")
    else:
        logger.warning("Supabase credentials not set — monitor disabled")

    # Log SMTP config status
    if settings.SMTP_USER and settings.SMTP_PASS:
        logger.info(f"SMTP configured: {settings.SMTP_HOST}:{settings.SMTP_PORT}")
    else:
        logger.warning("SMTP not configured — registration emails disabled")

    yield

    # Shutdown
    await shutdown_monitor()
    logger.info("👋 Backend shutting down")


app = FastAPI(
    title="Stock Advisory Tracker API",
    version="0.5.0",
    description="投顧通知解析 + 即時股價監控 + LINE/Telegram 整合 + 推送通知 + 轉發功能 + 註冊通知",
    lifespan=lifespan,
)

# --- CORS ---
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "https://stock-portfolio-tracker-tawny.vercel.app",  # production
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Routers ---
app.include_router(parser_router, prefix="/api", tags=["Parser"])
app.include_router(line_router, tags=["LINE Bot"])
app.include_router(telegram_router, tags=["Telegram Bot"])
app.include_router(forward_router, tags=["Forward"])
app.include_router(registrations_router, prefix="/api", tags=["Registrations"])


# --- Monitor endpoints ---

@app.get("/api/monitor/status", tags=["Monitor"])
async def monitor_status():
    """Get the current status of the stock price monitor."""
    return get_monitor_status()


@app.post("/api/prices/refresh", tags=["Monitor"])
async def manual_price_refresh():
    """Manually trigger a real-time price refresh (twstock) for TW stocks."""
    from app.monitor.stock_monitor import realtime_tw_monitor
    try:
        await realtime_tw_monitor()
        return {"success": True, "message": "Realtime price refresh triggered"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/api/prices/close-refresh", tags=["Monitor"])
async def manual_close_refresh(region: str = "all"):
    """
    Manually trigger yfinance close price update with diagnostic info.

    - region=all  → Refresh both TW and US close prices + FX
    - region=tw   → Refresh TW close prices only
    - region=us   → Refresh US close prices + FX only
    """
    from app.monitor.stock_monitor import _get_tracked_tickers, _update_single_market_data, _supabase
    from app.market.yfinance_fetcher import fetch_close_prices, fetch_exchange_rate
    results = {}

    try:
        if region in ("all", "tw"):
            tickers = await _get_tracked_tickers(region='TPE')
            results["tw_tickers_found"] = len(tickers)
            results["tw_tickers"] = tickers[:10]  # Show first 10

            if tickers:
                ticker_dicts = [{'ticker': t, 'region': 'TPE'} for t in tickers]
                prices = await fetch_close_prices(ticker_dicts, _supabase)
                results["tw_prices_fetched"] = len(prices)

                # Show sample data for debugging
                sample = {}
                for ticker, data in list(prices.items())[:5]:
                    sample[ticker] = {
                        "close": data.get('current_price'),
                        "prev_close": data.get('prev_close'),
                    }
                results["tw_sample"] = sample

                for ticker, data in prices.items():
                    await _update_single_market_data(ticker, data, source='yfinance')

                results["tw"] = "OK"
            else:
                results["tw"] = "NO_TICKERS"

        if region in ("all", "us"):
            # FX
            fx = await fetch_exchange_rate()
            results["fx"] = "OK" if fx else "FAILED"

            us_tickers = await _get_tracked_tickers(region='US')
            results["us_tickers_found"] = len(us_tickers)

            if us_tickers:
                ticker_dicts = [{'ticker': t, 'region': 'US'} for t in us_tickers]
                prices = await fetch_close_prices(ticker_dicts, _supabase)
                results["us_prices_fetched"] = len(prices)

                for ticker, data in prices.items():
                    await _update_single_market_data(ticker, data, source='yfinance')

                results["us"] = "OK"
            else:
                results["us"] = "NO_TICKERS"

        return {"success": True, "message": "Close price refresh completed", "results": results}
    except Exception as e:
        logger.error(f"Close refresh error: {e}", exc_info=True)
        return {"success": False, "error": str(e), "results": results}


@app.post("/api/report/generate", tags=["Report"])
async def generate_report(send: bool = False, user_id: Optional[str] = None):
    """
    Generate monthly investment report.

    - send=False (default): Preview only — returns report data + formatted messages
      Requires user_id query param to scope the preview to a specific user.
    - send=True: Generate AND send each user their own report via LINE + Telegram
    """
    from app.report.monthly_report import generate_report_preview, generate_and_send_report
    from supabase import create_client
    settings = get_settings()
    sb = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)

    if send:
        await generate_and_send_report(sb)
        return {"success": True, "message": "Monthly report sent to all users"}

    if not user_id:
        return {"success": False, "error": "user_id is required for preview"}

    preview = await generate_report_preview(sb, user_id=user_id)
    if preview:
        return {"success": True, **preview}
    return {"success": False, "error": "Failed to collect report data"}


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "stock-advisory-tracker", "version": "0.5.0"}
