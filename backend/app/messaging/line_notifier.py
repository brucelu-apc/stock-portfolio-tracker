"""
LINE Notifier — Push notifications via LINE Messaging API.
============================================================

Replaces OpenClaw for sending price alerts and advisory summaries.

Three message modes:
  1. send_text_push()       — Simple text message (e.g., status updates)
  2. send_alert_push()      — Rich Flex Message for price alerts
  3. send_parse_result()    — Flex Message carousel for parsed advisory stocks

LINE quota management:
  - Free tier = 500 push messages/month
  - Reply messages are FREE (use reply_token whenever possible)
  - The 60-min dedup cooldown in price_checker.py helps conserve quota
  - Notification preferences in user_messaging table control per-user routing

Flex Message Structure:
  Container → Bubble → Header + Body + Footer
  Bubble:
    Header: Alert type badge + ticker
    Body: Price details, trigger info
    Footer: Action buttons (View in Dashboard)
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

LINE_API_BASE = "https://api.line.me/v2/bot"


# ─── Low-level API ───────────────────────────────────────────

def _get_headers() -> dict:
    """Build authorization headers for LINE Messaging API."""
    settings = get_settings()
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.LINE_CHANNEL_ACCESS_TOKEN}",
    }


async def _push_message(to: str, messages: list[dict]) -> bool:
    """
    Send a push message to a LINE user.

    Args:
        to: LINE user ID (obtained from webhook or user_messaging table)
        messages: List of LINE message objects (max 5 per push)

    Returns:
        True if successful, False otherwise
    """
    settings = get_settings()
    if not settings.LINE_CHANNEL_ACCESS_TOKEN:
        logger.warning("LINE_CHANNEL_ACCESS_TOKEN not set — skipping push")
        return False

    payload = {"to": to, "messages": messages[:5]}  # LINE max 5 messages per push

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{LINE_API_BASE}/message/push",
                json=payload,
                headers=_get_headers(),
                timeout=10.0,
            )
            if resp.status_code == 200:
                logger.info(f"LINE push sent to {to[:8]}...")
                return True
            else:
                logger.error(f"LINE push failed: {resp.status_code} {resp.text}")
                return False
    except Exception as e:
        logger.error(f"LINE push error: {e}")
        return False


async def _reply_message(reply_token: str, messages: list[dict]) -> bool:
    """
    Send a reply message (free, no quota cost).
    Must be called within 1 minute of receiving the webhook event.

    Args:
        reply_token: Token from webhook event
        messages: List of LINE message objects (max 5)
    """
    settings = get_settings()
    if not settings.LINE_CHANNEL_ACCESS_TOKEN:
        return False

    payload = {"replyToken": reply_token, "messages": messages[:5]}

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{LINE_API_BASE}/message/reply",
                json=payload,
                headers=_get_headers(),
                timeout=10.0,
            )
            if resp.status_code == 200:
                return True
            else:
                logger.error(f"LINE reply failed: {resp.status_code} {resp.text}")
                return False
    except Exception as e:
        logger.error(f"LINE reply error: {e}")
        return False


# ─── High-level Message Builders ─────────────────────────────

async def send_text_push(line_user_id: str, text: str) -> bool:
    """Send a simple text push message."""
    return await _push_message(line_user_id, [{"type": "text", "text": text}])


async def send_text_reply(reply_token: str, text: str) -> bool:
    """Send a simple text reply message (free)."""
    return await _reply_message(reply_token, [{"type": "text", "text": text}])


# ─── Alert Flex Message ──────────────────────────────────────

ALERT_STYLES = {
    "defense_breach": {
        "emoji": "🔴",
        "label": "跌破防守價",
        "header_bg": "#FF4444",
        "header_text": "#FFFFFF",
    },
    "min_target_reached": {
        "emoji": "🟢",
        "label": "達最小目標",
        "header_bg": "#00C851",
        "header_text": "#FFFFFF",
    },
    "reasonable_target_reached": {
        "emoji": "🟡",
        "label": "達合理目標",
        "header_bg": "#FFB300",
        "header_text": "#000000",
    },
    "tp_triggered": {
        "emoji": "🔵",
        "label": "停利觸發",
        "header_bg": "#2196F3",
        "header_text": "#FFFFFF",
    },
    "sl_triggered": {
        "emoji": "🔴",
        "label": "停損觸發",
        "header_bg": "#FF1744",
        "header_text": "#FFFFFF",
    },
}


def _build_alert_flex(
    ticker: str,
    alert_type: str,
    trigger_price: float,
    current_price: float,
    dashboard_url: str = "",
) -> dict:
    """
    Build a Flex Message bubble for a price alert.

    Layout:
      ┌─────────────────────────┐
      │ 🔴 跌破防守價            │ ← Header (colored)
      ├─────────────────────────┤
      │ 億光 (2393)             │ ← Body
      │ 現價：52.30 元           │
      │ 防守價：53.00 元         │
      │ 觸發時間：14:32          │
      ├─────────────────────────┤
      │ [查看 Dashboard]         │ ← Footer (optional)
      └─────────────────────────┘
    """
    style = ALERT_STYLES.get(alert_type, ALERT_STYLES["defense_breach"])
    from datetime import datetime
    from zoneinfo import ZoneInfo

    now_tst = datetime.now(ZoneInfo("Asia/Taipei"))
    time_str = now_tst.strftime("%H:%M")

    # Determine trigger label
    trigger_labels = {
        "defense_breach": "防守價",
        "min_target_reached": "最小目標",
        "reasonable_target_reached": "合理目標",
        "tp_triggered": "停利價",
        "sl_triggered": "停損價",
    }
    trigger_label = trigger_labels.get(alert_type, "觸發價")

    bubble = {
        "type": "bubble",
        "size": "kilo",
        "header": {
            "type": "box",
            "layout": "horizontal",
            "contents": [
                {
                    "type": "text",
                    "text": f"{style['emoji']} {style['label']}",
                    "weight": "bold",
                    "size": "md",
                    "color": style["header_text"],
                },
            ],
            "backgroundColor": style["header_bg"],
            "paddingAll": "12px",
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "text",
                    "text": ticker,
                    "weight": "bold",
                    "size": "xl",
                    "margin": "md",
                },
                {
                    "type": "separator",
                    "margin": "lg",
                },
                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "lg",
                    "spacing": "sm",
                    "contents": [
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": "現價",
                                    "size": "sm",
                                    "color": "#666666",
                                    "flex": 0,
                                },
                                {
                                    "type": "text",
                                    "text": f"{current_price:.2f} 元",
                                    "size": "sm",
                                    "color": "#333333",
                                    "weight": "bold",
                                    "align": "end",
                                },
                            ],
                        },
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": trigger_label,
                                    "size": "sm",
                                    "color": "#666666",
                                    "flex": 0,
                                },
                                {
                                    "type": "text",
                                    "text": f"{trigger_price:.2f} 元",
                                    "size": "sm",
                                    "color": style["header_bg"],
                                    "weight": "bold",
                                    "align": "end",
                                },
                            ],
                        },
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": "觸發時間",
                                    "size": "sm",
                                    "color": "#666666",
                                    "flex": 0,
                                },
                                {
                                    "type": "text",
                                    "text": time_str,
                                    "size": "sm",
                                    "color": "#999999",
                                    "align": "end",
                                },
                            ],
                        },
                    ],
                },
            ],
            "paddingAll": "16px",
        },
    }

    # Add dashboard link as footer if URL is provided
    if dashboard_url:
        bubble["footer"] = {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "button",
                    "style": "link",
                    "height": "sm",
                    "action": {
                        "type": "uri",
                        "label": "查看 Dashboard",
                        "uri": dashboard_url,
                    },
                },
            ],
            "paddingAll": "8px",
        }

    return bubble


async def send_alert_push(
    line_user_id: str,
    ticker: str,
    alert_type: str,
    trigger_price: float,
    current_price: float,
    dashboard_url: str = "",
) -> bool:
    """
    Send a rich Flex Message alert to a LINE user.

    Args:
        line_user_id: LINE user ID
        ticker: Stock ticker (e.g., "2393")
        alert_type: One of: defense_breach, min_target_reached, etc.
        trigger_price: The threshold price that was breached
        current_price: Current market price
        dashboard_url: Optional link to dashboard

    Returns:
        True if sent successfully
    """
    bubble = _build_alert_flex(ticker, alert_type, trigger_price, current_price, dashboard_url)

    flex_message = {
        "type": "flex",
        "altText": f"{ALERT_STYLES.get(alert_type, {}).get('label', '價格警示')}：{ticker}",
        "contents": bubble,
    }

    return await _push_message(line_user_id, [flex_message])


# ─── Parse Result Flex Message ───────────────────────────────

def _build_parse_result_flex(stocks: list[dict], dates: list[str]) -> dict:
    """
    Build a Flex Message carousel showing parsed advisory stocks.

    Each bubble shows one stock with its defense/target prices.
    Max 12 bubbles per carousel (LINE limit).
    """
    bubbles = []
    date_range = " ~ ".join(dates) if dates else "今日"

    for stock in stocks[:12]:  # LINE carousel max 12 bubbles
        ticker = stock.get("ticker", "")
        name = stock.get("name", "")
        defense = stock.get("defense_price")
        min_low = stock.get("min_target_low")
        min_high = stock.get("min_target_high")
        reas_low = stock.get("reasonable_target_low")
        reas_high = stock.get("reasonable_target_high")
        entry = stock.get("entry_price")

        # Build body content rows
        body_contents = [
            {
                "type": "text",
                "text": f"{name}({ticker})",
                "weight": "bold",
                "size": "lg",
            },
        ]

        if defense:
            body_contents.append({
                "type": "text",
                "text": f"🛡 防守價：{defense} 元",
                "size": "sm",
                "color": "#FF4444",
                "margin": "md",
            })

        if min_low and min_high:
            body_contents.append({
                "type": "text",
                "text": f"📈 最小漲幅：{min_low}~{min_high} 元",
                "size": "sm",
                "color": "#00C851",
                "margin": "sm",
            })

        if reas_low and reas_high:
            body_contents.append({
                "type": "text",
                "text": f"🎯 合理漲幅：{reas_low}~{reas_high} 元",
                "size": "sm",
                "color": "#FFB300",
                "margin": "sm",
            })

        if entry:
            body_contents.append({
                "type": "text",
                "text": f"💰 建議買進：≤{entry} 元",
                "size": "sm",
                "color": "#2196F3",
                "margin": "sm",
            })

        strategy = stock.get("strategy_notes", "")
        if strategy and strategy != "法人鎖碼股":
            body_contents.append({
                "type": "text",
                "text": strategy[:50],
                "size": "xs",
                "color": "#999999",
                "margin": "md",
                "wrap": True,
            })

        bubble = {
            "type": "bubble",
            "size": "kilo",
            "body": {
                "type": "box",
                "layout": "vertical",
                "contents": body_contents,
                "paddingAll": "14px",
            },
        }

        bubbles.append(bubble)

    # Wrap in carousel
    carousel = {
        "type": "carousel",
        "contents": bubbles,
    }

    return carousel


async def send_parse_result_push(
    line_user_id: str,
    stocks: list[dict],
    dates: list[str],
) -> bool:
    """Push a carousel of parsed stocks to a LINE user."""
    if not stocks:
        return await send_text_push(line_user_id, "未解析到任何股票資訊。")

    carousel = _build_parse_result_flex(stocks, dates)

    flex_message = {
        "type": "flex",
        "altText": f"📊 解析完成 — {len(stocks)} 檔股票",
        "contents": carousel,
    }

    return await _push_message(line_user_id, [flex_message])


async def send_parse_result_reply(
    reply_token: str,
    stocks: list[dict],
    dates: list[str],
    total_messages: int = 0,
) -> bool:
    """Reply with parsed stock results (free, uses reply token)."""
    if not stocks:
        return await send_text_reply(reply_token, "未解析到股票資訊，請確認輸入格式正確。")

    # Build header summary text
    date_range = " ~ ".join(dates) if dates else "今日"
    summary = f"📊 解析完成\n📅 {date_range}\n📋 共 {len(stocks)} 檔股票"

    carousel = _build_parse_result_flex(stocks, dates)

    messages = [
        {"type": "text", "text": summary},
        {
            "type": "flex",
            "altText": f"解析結果 — {len(stocks)} 檔股票",
            "contents": carousel,
        },
    ]

    return await _reply_message(reply_token, messages)


# ─── Quota Check ─────────────────────────────────────────────

async def get_message_quota() -> Optional[dict]:
    """
    Check remaining LINE push message quota.
    Useful for deciding whether to send via LINE or Telegram.

    Returns:
        dict with 'totalUsage' and 'type' or None on error
    """
    settings = get_settings()
    if not settings.LINE_CHANNEL_ACCESS_TOKEN:
        return None

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{LINE_API_BASE}/message/quota/consumption",
                headers=_get_headers(),
                timeout=10.0,
            )
            if resp.status_code == 200:
                return resp.json()
    except Exception as e:
        logger.error(f"LINE quota check error: {e}")

    return None


# ─── Forward Messages ────────────────────────────────────────

async def send_forward_push(
    to: str,
    stocks: list[dict],
    sender_name: str = "Stock Tracker",
) -> bool:
    """
    Forward selected stock info to a LINE user or group.

    Uses a compact text format instead of Flex Message to save quota
    and ensure readability in groups.

    Args:
        to: LINE user ID or group ID
        stocks: List of stock dicts with ticker, name, defense_price, etc.
        sender_name: Display name of the sender

    Returns:
        True if sent successfully
    """
    if not stocks:
        return False

    lines = [
        f"📨 轉發自 {sender_name}",
        f"📋 {len(stocks)} 檔股票",
        "━━━━━━━━━━━━━",
        "",
    ]

    for stock in stocks[:15]:  # Keep within LINE message length
        ticker = stock.get("ticker", "")
        name = stock.get("name", "")
        defense = stock.get("defense_price")
        min_low = stock.get("min_target_low")
        min_high = stock.get("min_target_high")

        line = f"• {name}({ticker})"
        parts = []
        if defense:
            parts.append(f"防守{defense}")
        if min_low and min_high:
            parts.append(f"目標{min_low}~{min_high}")
        if parts:
            line += f"  {' | '.join(parts)}"
        lines.append(line)

    text = "\n".join(lines)
    return await _push_message(to, [{"type": "text", "text": text}])