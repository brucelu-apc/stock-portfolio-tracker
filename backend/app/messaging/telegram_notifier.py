"""
Telegram Notifier — Push notifications via Telegram Bot API.
=============================================================

Sends price alerts and advisory summaries via Telegram Bot.

Key advantages over LINE:
  - UNLIMITED free messages (no 500/month quota)
  - Native Markdown/HTML formatting
  - Inline keyboard buttons
  - No signature verification complexity
  - Photo/document sending capabilities

Message modes:
  1. send_text()         — Simple text message
  2. send_alert()        — Formatted price alert with inline keyboard
  3. send_parse_result() — Parsed advisory stocks summary
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

TG_API_BASE = "https://api.telegram.org"


# ─── Low-level API ───────────────────────────────────────────

def _get_bot_url(method: str) -> str:
    """Build Telegram Bot API URL."""
    settings = get_settings()
    return f"{TG_API_BASE}/bot{settings.TELEGRAM_BOT_TOKEN}/{method}"


async def _send_message(
    chat_id: int | str,
    text: str,
    parse_mode: str = "HTML",
    reply_markup: Optional[dict] = None,
) -> bool:
    """
    Send a message to a Telegram chat.

    Args:
        chat_id: Telegram chat ID (user, group, or channel)
        text: Message text (supports HTML formatting)
        parse_mode: "HTML" or "MarkdownV2"
        reply_markup: Optional inline keyboard

    Returns:
        True if successful
    """
    settings = get_settings()
    if not settings.TELEGRAM_BOT_TOKEN:
        logger.warning("TELEGRAM_BOT_TOKEN not set — skipping send")
        return False

    payload: dict = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                _get_bot_url("sendMessage"),
                json=payload,
                timeout=10.0,
            )
            data = resp.json()
            if data.get("ok"):
                logger.info(f"Telegram message sent to {chat_id}")
                return True
            else:
                logger.error(f"Telegram send failed: {data.get('description', 'unknown')}")
                return False
    except Exception as e:
        logger.error(f"Telegram send error: {e}")
        return False


# ─── High-level Message Builders ─────────────────────────────

async def send_text(chat_id: int | str, text: str) -> bool:
    """Send a plain text message (no formatting)."""
    return await _send_message(chat_id, text, parse_mode="")


async def send_html(chat_id: int | str, html: str) -> bool:
    """Send an HTML-formatted message."""
    return await _send_message(chat_id, html, parse_mode="HTML")


# ─── Alert Messages ──────────────────────────────────────────

ALERT_EMOJI = {
    "defense_breach": "🔴",
    "min_target_reached": "🟢",
    "reasonable_target_reached": "🟡",
    "tp_triggered": "🔵",
    "sl_triggered": "🔴",
}

ALERT_LABEL = {
    "defense_breach": "跌破防守價",
    "min_target_reached": "達最小目標",
    "reasonable_target_reached": "達合理目標",
    "tp_triggered": "停利觸發",
    "sl_triggered": "停損觸發",
}


async def send_alert(
    chat_id: int | str,
    ticker: str,
    alert_type: str,
    trigger_price: float,
    current_price: float,
    dashboard_url: str = "",
    strategy_notes: str = "",
) -> bool:
    """
    Send a formatted price alert to Telegram.

    Format:
      🔴 跌破防守價
      ━━━━━━━━━━━━━
      📊 億光(2393)
      現價：52.30 元
      防守價：53.00 元
      📝 策略說明...
      ⏰ 14:32 TST
      [查看 Dashboard]
    """
    from datetime import datetime
    from zoneinfo import ZoneInfo

    emoji = ALERT_EMOJI.get(alert_type, "⚠️")
    label = ALERT_LABEL.get(alert_type, "價格警示")
    now_tst = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%H:%M")

    trigger_labels = {
        "defense_breach": "防守價",
        "min_target_reached": "最小目標",
        "reasonable_target_reached": "合理目標",
        "tp_triggered": "停利價",
        "sl_triggered": "停損價",
    }
    trigger_label = trigger_labels.get(alert_type, "觸發價")

    lines = [
        f"{emoji} <b>{label}</b>",
        f"━━━━━━━━━━━━━",
        f"📊 <b>{ticker}</b>",
        f"現價：<b>{current_price:.2f}</b> 元",
        f"{trigger_label}：<b>{trigger_price:.2f}</b> 元",
    ]

    if strategy_notes:
        lines.append(f"📝 {strategy_notes}")

    lines.append(f"⏰ {now_tst} TST")
    html = "\n".join(lines)

    # Inline keyboard with dashboard link
    reply_markup = None
    if dashboard_url:
        reply_markup = {
            "inline_keyboard": [[
                {"text": "📊 查看 Dashboard", "url": dashboard_url}
            ]]
        }

    return await _send_message(chat_id, html, parse_mode="HTML", reply_markup=reply_markup)


# ─── Parse Result Messages ───────────────────────────────────

async def send_parse_result(
    chat_id: int | str,
    stocks: list[dict],
    dates: list[str],
) -> bool:
    """
    Send parsed advisory stock results to Telegram.

    Format:
      📊 解析完成 — 5 檔股票
      📅 2026/02/05 ~ 2026/02/10

      1. 億光(2393)
         🛡 防守價：53 元
         📈 最小漲幅：68~77 元

      2. 矽統(2363)
         📈 最小漲幅：88~105 元
    """
    if not stocks:
        return await send_html(chat_id, "未解析到任何股票資訊。")

    date_range = " ~ ".join(dates) if dates else "今日"
    lines = [
        f"📊 <b>解析完成 — {len(stocks)} 檔股票</b>",
        f"📅 {date_range}",
        "",
    ]

    for i, stock in enumerate(stocks[:20], 1):  # Telegram message limit ~4096 chars
        ticker = stock.get("ticker", "")
        name = stock.get("name", "")
        defense = stock.get("defense_price")
        min_low = stock.get("min_target_low")
        min_high = stock.get("min_target_high")
        reas_low = stock.get("reasonable_target_low")
        reas_high = stock.get("reasonable_target_high")
        entry = stock.get("entry_price")

        lines.append(f"<b>{i}. {name}({ticker})</b>")

        if defense:
            lines.append(f"   🛡 防守價：{defense} 元")
        if min_low and min_high:
            lines.append(f"   📈 最小漲幅：{min_low}~{min_high} 元")
        if reas_low and reas_high:
            lines.append(f"   🎯 合理漲幅：{reas_low}~{reas_high} 元")
        if entry:
            lines.append(f"   💰 買進：≤{entry} 元")

        # Strategy notes (解析結果說明)
        notes = stock.get("strategy_notes", "")
        if notes:
            lines.append(f"   📝 {notes}")
        lines.append("")

    return await send_html(chat_id, "\n".join(lines))


# ─── Forward Messages ────────────────────────────────────────

async def send_forward_message(
    chat_id: int | str,
    stocks: list[dict],
    sender_name: str = "Stock Tracker",
) -> bool:
    """
    Forward selected stock info to a Telegram contact or group.

    This is the "stock forwarding" feature — users select stocks
    from parsed advisory notifications and forward them to friends.
    """
    if not stocks:
        return False

    lines = [
        f"📨 <b>轉發自 {sender_name}</b>",
        f"📋 {len(stocks)} 檔股票",
        "━━━━━━━━━━━━━",
        "",
    ]

    for stock in stocks[:15]:
        ticker = stock.get("ticker", "")
        name = stock.get("name", "")
        defense = stock.get("defense_price")
        min_low = stock.get("min_target_low")
        min_high = stock.get("min_target_high")

        line = f"• <b>{name}({ticker})</b>"
        parts = []
        if defense:
            parts.append(f"防守價{defense}")
        if min_low and min_high:
            parts.append(f"最小漲幅{min_low}~{min_high}")
        reas_low = stock.get("reasonable_target_low")
        reas_high = stock.get("reasonable_target_high")
        if reas_low and reas_high:
            parts.append(f"合理漲幅{reas_low}~{reas_high}")
        entry = stock.get("entry_price")
        if entry:
            parts.append(f"買進≤{entry}")
        if parts:
            line += f"  {' | '.join(parts)}"
        lines.append(line)

        # Strategy notes
        notes = stock.get("strategy_notes", "")
        if notes:
            lines.append(f"  📝 {notes}")

    return await send_html(chat_id, "\n".join(lines))


# ─── Bot Info ────────────────────────────────────────────────

async def get_bot_info() -> Optional[dict]:
    """Get bot information (username, name, etc.)."""
    settings = get_settings()
    if not settings.TELEGRAM_BOT_TOKEN:
        return None

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                _get_bot_url("getMe"),
                timeout=10.0,
            )
            data = resp.json()
            if data.get("ok"):
                return data.get("result")
    except Exception as e:
        logger.error(f"Telegram getMe error: {e}")

    return None
