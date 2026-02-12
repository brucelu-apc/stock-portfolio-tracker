"""
Telegram Webhook Handler — Receives and processes Telegram Bot messages.
========================================================================

Endpoint: POST /webhook/telegram

Flow:
  1. Verify secret token (X-Telegram-Bot-Api-Secret-Token header)
  2. Parse Telegram Update object
  3. Handle message types:
     a. /start → Welcome message
     b. /help → Command list
     c. /status → Monitor status
     d. /link <email> → Link Telegram to Supabase account
     e. Plain text → Parse as advisory notification
  4. Handle callback queries (inline keyboard button clicks)

Security:
  - Telegram sends X-Telegram-Bot-Api-Secret-Token header
  - We verify it matches our TELEGRAM_BOT_TOKEN hash
  - Alternatively, use a secret path segment

User Binding:
  - /link command binds telegram_chat_id to Supabase user
  - Enables push notifications from the monitoring system
"""
from __future__ import annotations

import hashlib
import logging
from typing import Optional

from fastapi import APIRouter, Request, HTTPException

from app.config import get_settings
from app.parser.notification_parser import parse_notification
from app.messaging.telegram_notifier import (
    send_html,
    send_text,
    send_parse_result,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── Webhook Endpoint ────────────────────────────────────────

@router.post("/webhook/telegram")
async def telegram_webhook(request: Request):
    """
    Telegram Bot API webhook endpoint.

    Receives Update objects from Telegram:
    - message: User sent a message
    - callback_query: User clicked inline keyboard button
    """
    settings = get_settings()

    # Verify secret token (optional but recommended)
    secret_header = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    expected_secret = hashlib.sha256(
        settings.TELEGRAM_BOT_TOKEN.encode()
    ).hexdigest()[:32] if settings.TELEGRAM_BOT_TOKEN else ""

    if expected_secret and secret_header and secret_header != expected_secret:
        raise HTTPException(status_code=403, detail="Invalid secret token")

    try:
        update = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    # Handle message
    if "message" in update:
        await _handle_message(update["message"])

    # Handle callback query (inline keyboard clicks)
    elif "callback_query" in update:
        await _handle_callback_query(update["callback_query"])

    return {"ok": True}


# ─── Message Handler ─────────────────────────────────────────

async def _handle_message(message: dict):
    """Handle incoming Telegram messages."""
    chat_id = message.get("chat", {}).get("id")
    text = message.get("text", "").strip()
    from_user = message.get("from", {})

    if not chat_id or not text:
        return

    # Auto-register Telegram user
    await _auto_register_telegram_user(
        chat_id=chat_id,
        username=from_user.get("username", ""),
        first_name=from_user.get("first_name", ""),
    )

    # ── Command handling ──
    if text.startswith("/"):
        await _handle_command(text, chat_id, from_user)
        return

    # ── Advisory notification parsing ──
    try:
        result = parse_notification(text).model_dump()

        if result["total_stocks"] > 0:
            all_stocks = []
            for msg in result["messages"]:
                for stock in msg["stocks"]:
                    if not any(s["ticker"] == stock["ticker"] for s in all_stocks):
                        all_stocks.append(stock)

            await send_parse_result(
                chat_id=chat_id,
                stocks=all_stocks,
                dates=result.get("dates_found", []),
            )

            # Auto-import if user is bound
            await _auto_import_notification(
                chat_id=chat_id,
                raw_text=text,
                parsed_stocks=all_stocks,
            )
        else:
            await send_html(
                chat_id,
                "📝 未偵測到股票資訊。\n\n"
                "請直接貼上投顧 LINE 群組的完整通知文字，"
                "系統會自動解析防守價和目標價。\n\n"
                "輸入 /help 查看更多指令。",
            )

    except Exception as e:
        logger.error(f"Parse error in Telegram handler: {e}", exc_info=True)
        await send_text(chat_id, f"解析發生錯誤：{str(e)[:100]}")


# ─── Command Handler ─────────────────────────────────────────

async def _handle_command(text: str, chat_id: int, from_user: dict):
    """Handle slash commands from Telegram users."""
    parts = text.split(maxsplit=1)
    command = parts[0].lower().split("@")[0]  # Remove @BotName suffix
    args = parts[1] if len(parts) > 1 else ""

    if command == "/start":
        welcome = (
            "👋 <b>歡迎使用 Stock Advisory Tracker！</b>\n\n"
            "📊 <b>功能說明：</b>\n"
            "• 直接貼上投顧通知 → 自動解析股票\n"
            "• 系統自動監控防守價/目標價\n"
            "• 觸發條件時即時推送警示\n"
            "• 無訊息數量限制！\n\n"
            "📝 <b>使用方式：</b>\n"
            "直接貼上投顧群組的通知文字即可！\n\n"
            "⌨️ <b>指令列表：</b>\n"
            "/help — 使用說明\n"
            "/status — 監控狀態\n"
            "/link &lt;email&gt; — 綁定帳號\n"
            "/dashboard — Dashboard 連結"
        )
        await send_html(chat_id, welcome)

    elif command == "/help":
        help_text = (
            "📖 <b>Stock Advisory Tracker 指令</b>\n\n"
            "📊 <b>通知解析：</b>\n"
            "直接貼上投顧群組通知 → 自動解析\n\n"
            "⌨️ <b>指令：</b>\n"
            "/start — 歡迎訊息\n"
            "/help — 顯示此說明\n"
            "/status — 查看監控狀態\n"
            "/link &lt;email&gt; — 綁定 Dashboard 帳號\n"
            "/dashboard — Dashboard 連結\n\n"
            "💡 Telegram 無訊息數量限制，所有警示都會即時推送！"
        )
        await send_html(chat_id, help_text)

    elif command == "/status":
        from app.monitor.stock_monitor import get_monitor_status
        status = get_monitor_status()

        if status.get("running"):
            market = "🟢 開盤中" if status.get("market_open") else "🔴 休市"
            jobs = status.get("jobs", [])
            jobs_text = "\n".join(
                f"  • {j['name']}"
                for j in jobs
            )
            msg = f"📡 <b>監控狀態：運行中</b>\n{market}\n\n排程工作：\n{jobs_text}"
        else:
            msg = "⚠️ 監控系統未啟動"

        await send_html(chat_id, msg)

    elif command == "/link":
        if not args:
            await send_html(
                chat_id,
                "請提供您的 Dashboard 帳號 Email：\n"
                "<code>/link your@email.com</code>",
            )
            return

        email = args.strip()
        success = await _link_telegram_account(chat_id, email)
        if success:
            await send_html(
                chat_id,
                f"✅ <b>帳號綁定成功！</b>\n\n"
                f"Email：{email}\n"
                f"Telegram ID：{chat_id}\n\n"
                f"現在開始，價格警示將推送到此聊天。",
            )
        else:
            await send_html(
                chat_id,
                f"❌ 綁定失敗：找不到使用 {email} 的帳號。\n"
                f"請先在 Dashboard 註冊後再嘗試綁定。",
            )

    elif command == "/dashboard":
        settings = get_settings()
        url = settings.FRONTEND_URL
        if "localhost" in url:
            url = "https://stock-portfolio-tracker-tawny.vercel.app"
        await send_html(
            chat_id,
            f"📊 <b>Dashboard 連結：</b>\n{url}",
        )

    else:
        await send_text(chat_id, f"未知指令：{command}\n輸入 /help 查看可用指令。")


# ─── Callback Query Handler ──────────────────────────────────

async def _handle_callback_query(query: dict):
    """Handle inline keyboard button clicks."""
    callback_id = query.get("id")
    data = query.get("data", "")
    chat_id = query.get("message", {}).get("chat", {}).get("id")

    settings = get_settings()
    if not settings.TELEGRAM_BOT_TOKEN:
        return

    # Answer the callback to remove loading indicator
    try:
        async with __import__("httpx").AsyncClient() as client:
            await client.post(
                f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/answerCallbackQuery",
                json={"callback_query_id": callback_id},
                timeout=5.0,
            )
    except Exception:
        pass

    # Handle callback data
    if data.startswith("track_"):
        ticker = data.replace("track_", "")
        if chat_id:
            await send_text(chat_id, f"已開始追蹤 {ticker}")


# ─── Account Linking ─────────────────────────────────────────

async def _link_telegram_account(chat_id: int, email: str) -> bool:
    """
    Link a Telegram chat ID to a Supabase user account via email.

    Flow:
    1. Look up user by email in auth.users (via service role)
    2. Upsert telegram_chat_id in user_messaging table
    """
    try:
        from supabase import create_client

        settings = get_settings()
        if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
            return False

        supabase = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,
        )

        # Look up user by email
        users_res = supabase.auth.admin.list_users()
        target_user = None
        for user in users_res:
            if hasattr(user, 'email') and user.email == email:
                target_user = user
                break

        if not target_user:
            return False

        user_id = str(target_user.id)

        # Upsert user_messaging with telegram_chat_id
        supabase.table("user_messaging").upsert(
            {
                "user_id": user_id,
                "telegram_chat_id": chat_id,
            },
            on_conflict="user_id",
        ).execute()

        logger.info(f"Telegram linked: chat_id={chat_id} → user={user_id[:8]}...")
        return True

    except Exception as e:
        logger.error(f"Telegram link error: {e}")
        return False


# ─── Auto-registration ───────────────────────────────────────

async def _auto_register_telegram_user(
    chat_id: int,
    username: str = "",
    first_name: str = "",
):
    """Log new Telegram users for analytics."""
    logger.debug(
        f"Telegram user: chat_id={chat_id}, "
        f"username=@{username}, name={first_name}"
    )


async def _auto_import_notification(
    chat_id: int,
    raw_text: str,
    parsed_stocks: list[dict],
):
    """Auto-import parsed notification if user is bound to a Supabase account."""
    if not parsed_stocks:
        return

    try:
        from supabase import create_client
        from datetime import date

        settings = get_settings()
        if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
            return

        supabase = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,
        )

        # Find user by telegram_chat_id
        user_res = (
            supabase.table("user_messaging")
            .select("user_id")
            .eq("telegram_chat_id", chat_id)
            .execute()
        )

        if not user_res.data:
            return

        user_id = user_res.data[0]["user_id"]

        for stock in parsed_stocks:
            ticker = stock.get("ticker")
            if not ticker:
                continue

            supabase.table("price_targets").update(
                {"is_latest": False}
            ).eq("ticker", ticker).eq("user_id", user_id).eq("is_latest", True).execute()

            supabase.table("price_targets").insert({
                "user_id": user_id,
                "ticker": ticker,
                "defense_price": stock.get("defense_price"),
                "min_target_low": stock.get("min_target_low"),
                "min_target_high": stock.get("min_target_high"),
                "reasonable_target_low": stock.get("reasonable_target_low"),
                "reasonable_target_high": stock.get("reasonable_target_high"),
                "entry_price": stock.get("entry_price"),
                "strategy_notes": stock.get("strategy_notes"),
                "effective_date": date.today().isoformat(),
                "is_latest": True,
            }).execute()

            supabase.table("advisory_tracking").upsert(
                {"user_id": user_id, "ticker": ticker, "tracking_status": "watching"},
                on_conflict="user_id,ticker",
            ).execute()

        logger.info(f"TG auto-imported {len(parsed_stocks)} stocks for chat_id={chat_id}")

    except Exception as e:
        logger.error(f"TG auto-import error: {e}")
