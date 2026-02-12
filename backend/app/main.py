"""
Stock Advisory Tracker — FastAPI Backend
=========================================
Handles:
  - Advisory notification parsing (POST /api/parse)
  - Real-time stock price monitoring (APScheduler)
  - LINE / Telegram webhooks (Phase 3-4)
  - Stock info forwarding (Phase 4)
  - Monthly report generation (Phase 5)
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client

from app.config import get_settings
from app.parser.notification_parser import router as parser_router
from app.messaging.line_handler import router as line_router
from app.messaging.telegram_handler import router as telegram_router
from app.messaging.stock_forwarder import router as forward_router
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

    yield

    # Shutdown
    await shutdown_monitor()
    logger.info("👋 Backend shutting down")


app = FastAPI(
    title="Stock Advisory Tracker API",
    version="0.4.0",
    description="投顧通知解析 + 即時股價監控 + LINE/Telegram 整合 + 推送通知 + 轉發功能",
    lifespan=lifespan,
)

# --- CORS ---
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "https://stock-portfolio-tracker.vercel.app",  # production
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


# --- Monitor endpoints ---

@app.get("/api/monitor/status", tags=["Monitor"])
async def monitor_status():
    """Get the current status of the stock price monitor."""
    return get_monitor_status()


@app.post("/api/prices/refresh", tags=["Monitor"])
async def manual_price_refresh():
    """Manually trigger a price refresh for all tracked stocks."""
    from app.monitor.stock_monitor import realtime_tw_monitor, daily_us_close
    try:
        await realtime_tw_monitor()
        return {"success": True, "message": "Price refresh triggered"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/api/report/generate", tags=["Report"])
async def generate_report(send: bool = False):
    """
    Generate monthly investment report.

    - send=False (default): Preview only — returns report data + formatted messages
    - send=True: Generate AND send to all users via LINE + Telegram
    """
    from app.report.monthly_report import generate_report_preview, generate_and_send_report
    from supabase import create_client
    settings = get_settings()
    sb = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)

    if send:
        await generate_and_send_report(sb)
        return {"success": True, "message": "Monthly report sent to all users"}

    preview = await generate_report_preview(sb)
    if preview:
        return {"success": True, **preview}
    return {"success": False, "error": "Failed to collect report data"}


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "stock-advisory-tracker", "version": "0.4.0"}
