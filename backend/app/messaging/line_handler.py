"""
LINE Webhook Handler — Receives and processes LINE Bot messages.
================================================================

Endpoint: POST /webhook/line

Flow:
  1. Verify signature (HMAC-SHA256 with Channel Secret)
  2. Parse webhook events (MessageEvent, FollowEvent, etc.)
  3. Handle text messages:
     a. Advisory notification text → Parse → Reply with Flex Message
     b. Commands (/help, /status, /quota) → Reply with info
  4. Handle follow event → Register LINE user ID → Welcome message

Security:
  - ALL requests must pass signature verification
  - Channel Secret is used to compute HMAC-SHA256 of raw body
  - Invalid signatures are rejected with 403

User Binding:
  - When a user sends any message, we look up or create their
    user_messaging record to store line_user_id for future pushes
  - This allows the monitoring system to send push notifications
    to the correct LINE user
"""
from __future__ import annotations

import hashlib
import hmac
import base64
import json
import logging
from typing import Optional

from fastapi import APIRouter, Request, HTTPException

from app.config import get_settings
from app.parser.notification_parser import parse_notification
from app.messaging.line_notifier import send_parse_result_reply, send_text_reply

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── Signature Verification ──────────────────────────────────

def verify_signature(body: bytes, signature: str) -> bool:
    """
    Verify LINE webhook signature using Channel Secret.

    LINE signs the raw request body with HMAC-SHA256 using the Channel Secret.
    We recompute and compare (timing-safe) to ensure the request is authentic.
    """
    settings = get_settings()
    secret = settings.LINE_CHANNEL_SECRET
    if not secret:
        logger.error("LINE_CHANNEL_SECRET not set — cannot verify signature")
        return False

    hash_value = hmac.new(
        secret.encode("utf-8"),
        body,
        hashlib.sha256,
    ).digest()

    computed_signature = base64.b64encode(hash_value).decode("utf-8")
    return hmac.compare_digest(signature, computed_signature)


# ─── Webhook Endpoint ────────────────────────────────────────

@router.post("/webhook/line")
async def line_webhook(request: Request):
    """
    LINE Messaging API webhook endpoint.

    Receives events from LINE platform:
    - message: User sent a text message
    - follow: User added the bot as friend
    - unfollow: User blocked/removed the bot
    """
    body = await request.body()
    signature = request.headers.get("X-Line-Signature", "")

    # Verify signature
    if not verify_signature(body, signature):
        raise HTTPException(status_code=403, detail="Invalid signature")

    # Parse event payload
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    events = payload.get("events", [])

    for event in events:
        event_type = event.get("type")

        if event_type == "message":
            await _handle_message_event(event)
        elif event_type == "follow":
            await _handle_follow_event(event)
        elif event_type == "unfollow":
            await _handle_unfollow_event(event)

    return {"status": "ok"}


# ─── Event Handlers ──────────────────────────────────────────

async def _handle_message_event(event: dict):
    """
    Handle incoming text messages.

    Decision tree:
    1. If text starts with "/" → command handler
    2. If text contains date patterns or stock mentions → parse as advisory
    3. Otherwise → help message
    """
    message = event.get("message", {})
    message_type = message.get("type")
    reply_token = event.get("replyToken", "")
    line_user_id = event.get("source", {}).get("userId", "")

    if message_type != "text":
        # Non-text messages (images, stickers, etc.)
        await send_text_reply(reply_token, "目前僅支援文字訊息。請貼上投顧通知文字或輸入 /help 查看指令。")
        return

    text = message.get("text", "").strip()

    if not text:
        return

    # Auto-register LINE user ID (non-blocking)
    await _auto_register_line_user(line_user_id)

    # ── Command handling ──
    if text.startswith("/"):
        await _handle_command(text, reply_token, line_user_id)
        return

    # ── Advisory notification parsing ──
    # Try to parse as advisory notification
    try:
        result = parse_notification(text).model_dump()

        if result["total_stocks"] > 0:
            # Successfully parsed — collect all stocks
            all_stocks = []
            for msg in result["messages"]:
                for stock in msg["stocks"]:
                    # Avoid duplicates
                    if not any(s["ticker"] == stock["ticker"] for s in all_stocks):
                        all_stocks.append(stock)

            await send_parse_result_reply(
                reply_token=reply_token,
                stocks=all_stocks,
                dates=result.get("dates_found", []),
                total_messages=result["total_messages"],
            )

            # Also import to DB if user is bound
            await _auto_import_notification(
                line_user_id=line_user_id,
                raw_text=text,
                parsed_stocks=all_stocks,
            )
        else:
            # No stocks found — show help
            await send_text_reply(
                reply_token,
                "📝 未偵測到股票資訊。\n\n"
                "請直接貼上投顧 LINE 群組的完整通知文字，"
                "系統會自動解析防守價和目標價。\n\n"
                "輸入 /help 查看更多指令。"
            )

    except Exception as e:
        logger.error(f"Parse error in LINE handler: {e}", exc_info=True)
        await send_text_reply(reply_token, f"解析發生錯誤：{str(e)[:100]}")


async def _handle_follow_event(event: dict):
    """Handle new friend addition — send welcome message."""
    reply_token = event.get("replyToken", "")
    line_user_id = event.get("source", {}).get("userId", "")

    # Register user
    await _auto_register_line_user(line_user_id)

    welcome = (
        "👋 歡迎使用 Stock Advisory Tracker！\n\n"
        "📊 功能說明：\n"
        "• 直接貼上投顧通知 → 自動解析股票\n"
        "• 系統自動監控防守價/目標價\n"
        "• 觸發條件時即時推送警示\n\n"
        "📝 使用方式：\n"
        "直接貼上投顧群組的通知文字即可！\n\n"
        "⌨️ 指令列表：\n"
        "/help — 使用說明\n"
        "/status — 監控狀態\n"
        "/quota — LINE 訊息額度"
    )

    await send_text_reply(reply_token, welcome)


async def _handle_unfollow_event(event: dict):
    """Handle bot removal — log for analytics."""
    line_user_id = event.get("source", {}).get("userId", "")
    logger.info(f"User unfollowed: {line_user_id[:8]}...")


# ─── Command Handler ─────────────────────────────────────────

async def _handle_command(text: str, reply_token: str, line_user_id: str):
    """Handle slash commands from LINE users."""
    command = text.lower().split()[0]

    if command == "/help":
        help_text = (
            "📖 Stock Advisory Tracker 指令\n\n"
            "📊 通知解析：\n"
            "直接貼上投顧群組通知 → 自動解析\n\n"
            "⌨️ 指令：\n"
            "/help — 顯示此說明\n"
            "/status — 查看監控狀態\n"
            "/quota — 查看 LINE 訊息額度\n"
            "/dashboard — Dashboard 連結\n\n"
            "💡 小提示：系統會自動追蹤防守價和目標價，"
            "觸發時會即時通知你！"
        )
        await send_text_reply(reply_token, help_text)

    elif command == "/status":
        from app.monitor.stock_monitor import get_monitor_status
        status = get_monitor_status()

        if status.get("running"):
            market = "🟢 開盤中" if status.get("market_open") else "🔴 休市"
            jobs = status.get("jobs", [])
            jobs_text = "\n".join(
                f"  • {j['name']}: {j.get('next_run', '—')}"
                for j in jobs
            )
            text = f"📡 監控狀態：運行中\n{market}\n\n排程工作：\n{jobs_text}"
        else:
            text = "⚠️ 監控系統未啟動"

        await send_text_reply(reply_token, text)

    elif command == "/quota":
        from app.messaging.line_notifier import get_message_quota
        quota = await get_message_quota()

        if quota:
            used = quota.get("totalUsage", 0)
            text = f"📨 LINE 訊息額度\n\n已使用：{used} / 500 則\n剩餘：{500 - used} 則"
        else:
            text = "無法取得額度資訊"

        await send_text_reply(reply_token, text)

    elif command == "/dashboard":
        settings = get_settings()
        url = settings.FRONTEND_URL.replace("localhost:5173", "stock-portfolio-tracker-tawny.vercel.app")
        await send_text_reply(reply_token, f"📊 Dashboard 連結：\n{url}")

    else:
        await send_text_reply(reply_token, f"未知指令：{command}\n輸入 /help 查看可用指令。")


# ─── Auto-registration & Import ──────────────────────────────

async def _auto_register_line_user(line_user_id: str):
    """
    Auto-register or update LINE user ID in user_messaging table.

    This creates the binding between LINE user → Supabase user,
    enabling push notifications from the monitoring system.

    Note: Without a prior Supabase auth session, we can only store
    the LINE user ID. The user needs to link their account in the
    Dashboard settings to complete the binding.
    """
    if not line_user_id:
        return

    try:
        from app.config import get_settings
        from supabase import create_client

        settings = get_settings()
        if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
            return

        supabase = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,
        )

        # Check if this LINE user is already registered
        existing = (
            supabase.table("user_messaging")
            .select("id, line_user_id")
            .eq("line_user_id", line_user_id)
            .execute()
        )

        if existing.data:
            logger.debug(f"LINE user already registered: {line_user_id[:8]}...")
            return

        # Store as unbound record (user_id will be linked from Dashboard)
        # For now, log it — full binding happens in Settings page
        logger.info(f"New LINE user: {line_user_id[:8]}... (awaiting account link)")

    except Exception as e:
        logger.error(f"Auto-register error: {e}")


async def _auto_import_notification(
    line_user_id: str,
    raw_text: str,
    parsed_stocks: list[dict],
):
    """
    Auto-import parsed notification to DB if user is bound.

    Looks up the Supabase user_id from line_user_id in user_messaging,
    then inserts advisory_notifications + price_targets records.
    """
    if not line_user_id or not parsed_stocks:
        return

    try:
        from app.config import get_settings
        from supabase import create_client
        from datetime import date

        settings = get_settings()
        if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
            return

        supabase = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,
        )

        # Find the Supabase user_id for this LINE user
        user_res = (
            supabase.table("user_messaging")
            .select("user_id")
            .eq("line_user_id", line_user_id)
            .execute()
        )

        if not user_res.data:
            logger.info(f"LINE user {line_user_id[:8]}... not bound — skip auto-import")
            return

        user_id = user_res.data[0]["user_id"]

        # Import each stock as a price_target
        for stock in parsed_stocks:
            ticker = stock.get("ticker")
            if not ticker:
                continue

            # Mark previous targets as non-latest
            supabase.table("price_targets").update(
                {"is_latest": False}
            ).eq("ticker", ticker).eq("user_id", user_id).eq("is_latest", True).execute()

            # Insert new target
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

            # Upsert advisory_tracking (set to 'watching' if new)
            supabase.table("advisory_tracking").upsert(
                {"user_id": user_id, "ticker": ticker, "tracking_status": "watching"},
                on_conflict="user_id,ticker",
            ).execute()

        logger.info(f"Auto-imported {len(parsed_stocks)} stocks for user {user_id[:8]}...")

    except Exception as e:
        logger.error(f"Auto-import error: {e}")
