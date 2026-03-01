"""
Monthly Report Generator — Migrated from GitHub Actions to Railway.
====================================================================

Previous pipeline (GitHub Actions):
  generate_report_html.py → report.html → render_poster.py (Playwright)
  → monthly_report.png → OpenClaw → LINE

New pipeline (Railway APScheduler):
  Supabase data → structured dict → LINE Flex Message + Telegram HTML
  No Playwright dependency needed!

Advantages:
  - No browser/Playwright dependency on Railway
  - Rich native messages (Flex for LINE, HTML for Telegram)
  - Better mobile rendering than screenshot images
  - Runs as a cron job inside the existing scheduler

Schedule:
  Every 1st of the month at 14:30 TST (after TW market close update)
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from app.config import get_settings

logger = logging.getLogger(__name__)
TST = ZoneInfo("Asia/Taipei")


# ─── Data Collection ────────────────────────────────────────

async def collect_report_data(supabase, user_id: str) -> Optional[dict]:
    """
    Collect all data needed for the monthly report from Supabase,
    scoped to a specific user's holdings.

    Returns a structured dict with:
      - month_label: "February 2026"
      - total_value, total_cost, pnl, roi
      - top_holdings: top 5 by market value
      - fx_rate: current USDTWD
      - advisory_summary: advisory stocks tracked this month
      - alert_summary: alerts triggered this month
    """
    try:
        now = datetime.now(TST)
        month_label = now.strftime("%B %Y")

        # 1. Portfolio holdings + market data — filtered to this user only
        holdings_res = (
            supabase.table("portfolio_holdings")
            .select("*")
            .eq("user_id", user_id)
            .execute()
        )
        market_res = supabase.table("market_data").select("*").execute()

        price_map = {
            item["ticker"]: float(item["current_price"])
            for item in market_res.data
            if item.get("current_price") is not None
        }
        fx_rate = price_map.get("USDTWD", 32.5)

        total_cost = 0.0
        total_value = 0.0
        holdings_detail = []

        for h in holdings_res.data:
            ticker = h["ticker"]
            shares = float(h["shares"])
            cost_price = float(h["cost_price"])
            curr_price = price_map.get(ticker, cost_price)

            val = curr_price * shares
            cost = cost_price * shares

            if h.get("region") == "US":
                val *= fx_rate
                cost *= fx_rate

            total_value += val
            total_cost += cost

            pnl_pct = ((curr_price - cost_price) / cost_price * 100) if cost_price > 0 else 0

            holdings_detail.append({
                "ticker": ticker,
                "name": h.get("name", ticker),
                "shares": shares,
                "cost_price": cost_price,
                "current_price": curr_price,
                "value_twd": val,
                "pnl_pct": pnl_pct,
                "region": h.get("region", "TPE"),
            })

        # Sort by value descending
        holdings_detail.sort(key=lambda x: x["value_twd"], reverse=True)
        top_holdings = holdings_detail[:5]

        total_pnl = total_value - total_cost
        total_roi = (total_pnl / total_cost * 100) if total_cost > 0 else 0

        # 2. Advisory summary — stocks tracked this month
        advisory_count = 0
        try:
            # Count unique tickers in price_targets that are still active (is_latest=true)
            advisory_res = (
                supabase.table("price_targets")
                .select("ticker", count="exact")
                .eq("is_latest", True)
                .execute()
            )
            advisory_count = advisory_res.count or len(advisory_res.data)
        except Exception:
            pass

        # 3. Alert summary — alerts triggered this month
        alert_count = 0
        alert_breakdown = {}
        try:
            first_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            alerts_res = (
                supabase.table("price_alerts")
                .select("alert_type")
                .gte("triggered_at", first_of_month.isoformat())
                .execute()
            )
            alert_count = len(alerts_res.data)
            for a in alerts_res.data:
                atype = a.get("alert_type", "unknown")
                alert_breakdown[atype] = alert_breakdown.get(atype, 0) + 1
        except Exception:
            pass

        return {
            "month_label": month_label,
            "generated_at": now.isoformat(),
            "total_value": total_value,
            "total_cost": total_cost,
            "pnl": total_pnl,
            "roi": total_roi,
            "fx_rate": fx_rate,
            "holdings_count": len(holdings_res.data),
            "top_holdings": top_holdings,
            "advisory_count": advisory_count,
            "alert_count": alert_count,
            "alert_breakdown": alert_breakdown,
            "is_profit": total_pnl >= 0,
        }

    except Exception as e:
        logger.error(f"Monthly report data collection error: {e}")
        return None


# ─── LINE Flex Message Builder ──────────────────────────────

def build_report_flex(data: dict) -> dict:
    """
    Build a LINE Flex Message bubble for the monthly investment report.

    Layout:
      ┌─────────────────────────────┐
      │ 📊 Investment Report        │ ← Header (gold)
      │ February 2026               │
      ├─────────────────────────────┤
      │ Portfolio Value              │ ← Body
      │ $2,328,320                   │
      │ PnL: +401,040  ROI: +20.81% │
      │ ─────────────                │
      │ Top Holdings:                │
      │ • 2330.TW  $2,130,000       │
      │ • AAPL     $150,000         │
      │ ─────────────                │
      │ 投顧追蹤: 15 檔              │
      │ 本月警示: 8 次               │
      ├─────────────────────────────┤
      │ [查看 Dashboard]             │
      └─────────────────────────────┘
    """
    pnl_color = "#00C851" if data["is_profit"] else "#FF4444"

    # Format numbers
    def fmt_money(n):
        return f"${n:,.0f}"

    # Top holdings rows
    holdings_rows = []
    for h in data["top_holdings"]:
        pnl_sign = "+" if h["pnl_pct"] >= 0 else ""
        holdings_rows.append({
            "type": "box",
            "layout": "horizontal",
            "contents": [
                {
                    "type": "text",
                    "text": f"{h['name']}",
                    "size": "sm",
                    "color": "#333333",
                    "flex": 3,
                },
                {
                    "type": "text",
                    "text": fmt_money(h["value_twd"]),
                    "size": "sm",
                    "color": "#333333",
                    "align": "end",
                    "flex": 3,
                },
                {
                    "type": "text",
                    "text": f"{pnl_sign}{h['pnl_pct']:.1f}%",
                    "size": "sm",
                    "color": "#00C851" if h["pnl_pct"] >= 0 else "#FF4444",
                    "align": "end",
                    "flex": 2,
                },
            ],
            "margin": "sm",
        })

    # Build the bubble
    bubble = {
        "type": "bubble",
        "size": "mega",
        "header": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "text",
                    "text": "📊 Investment Report",
                    "weight": "bold",
                    "size": "lg",
                    "color": "#FFFFFF",
                },
                {
                    "type": "text",
                    "text": data["month_label"],
                    "size": "sm",
                    "color": "#D4AF37",
                    "margin": "sm",
                },
            ],
            "backgroundColor": "#064E3B",
            "paddingAll": "16px",
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                # Total value
                {
                    "type": "text",
                    "text": "Portfolio Value (TWD)",
                    "size": "xs",
                    "color": "#999999",
                },
                {
                    "type": "text",
                    "text": fmt_money(data["total_value"]),
                    "weight": "bold",
                    "size": "xxl",
                    "color": "#064E3B",
                    "margin": "sm",
                },
                # PnL / ROI row
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {
                            "type": "text",
                            "text": f"損益 {fmt_money(data['pnl'])}",
                            "size": "sm",
                            "color": pnl_color,
                            "weight": "bold",
                        },
                        {
                            "type": "text",
                            "text": f"ROI {data['roi']:+.2f}%",
                            "size": "sm",
                            "color": pnl_color,
                            "weight": "bold",
                            "align": "end",
                        },
                    ],
                    "margin": "lg",
                },
                {"type": "separator", "margin": "xl"},
                # Top holdings title
                {
                    "type": "text",
                    "text": "Top Holdings",
                    "size": "sm",
                    "color": "#D4AF37",
                    "weight": "bold",
                    "margin": "xl",
                },
                *holdings_rows,
                {"type": "separator", "margin": "xl"},
                # Advisory & Alert summary
                {
                    "type": "box",
                    "layout": "horizontal",
                    "margin": "xl",
                    "contents": [
                        {
                            "type": "text",
                            "text": f"📋 投顧追蹤 {data['advisory_count']} 檔",
                            "size": "sm",
                            "color": "#666666",
                        },
                        {
                            "type": "text",
                            "text": f"🔔 本月警示 {data['alert_count']} 次",
                            "size": "sm",
                            "color": "#666666",
                            "align": "end",
                        },
                    ],
                },
            ],
            "paddingAll": "16px",
        },
    }

    # Add dashboard link footer
    settings = get_settings()
    dashboard_url = settings.FRONTEND_URL
    if "localhost" in dashboard_url:
        dashboard_url = "https://stock-portfolio-tracker-tawny.vercel.app"

    bubble["footer"] = {
        "type": "box",
        "layout": "vertical",
        "contents": [
            {
                "type": "button",
                "style": "primary",
                "height": "sm",
                "action": {
                    "type": "uri",
                    "label": "查看 Dashboard",
                    "uri": dashboard_url,
                },
                "color": "#064E3B",
            },
        ],
        "paddingAll": "12px",
    }

    return bubble


# ─── Telegram HTML Builder ──────────────────────────────────

def build_report_telegram_html(data: dict) -> str:
    """Build Telegram HTML report message."""
    pnl_sign = "+" if data["is_profit"] else ""
    pnl_emoji = "📈" if data["is_profit"] else "📉"

    lines = [
        f"<b>📊 Investment Report — {data['month_label']}</b>",
        "",
        f"💰 <b>Portfolio Value</b>",
        f"<code>${data['total_value']:,.0f} TWD</code>",
        "",
        f"{pnl_emoji} 損益: <b>{pnl_sign}${data['pnl']:,.0f}</b>",
        f"📊 ROI: <b>{data['roi']:+.2f}%</b>",
        f"💱 USDTWD: {data['fx_rate']:.2f}",
        "",
        "━━━━━━━━━━━━━━━",
        "<b>Top Holdings</b>",
        "",
    ]

    for i, h in enumerate(data["top_holdings"], 1):
        pnl_s = "+" if h["pnl_pct"] >= 0 else ""
        emoji = "🥇" if i == 1 else "🥈" if i == 2 else "🥉" if i == 3 else "  "
        lines.append(
            f"{emoji} {h['name']} — <code>${h['value_twd']:,.0f}</code> ({pnl_s}{h['pnl_pct']:.1f}%)"
        )

    lines.extend([
        "",
        "━━━━━━━━━━━━━━━",
        f"📋 投顧追蹤: {data['advisory_count']} 檔",
        f"🔔 本月警示: {data['alert_count']} 次",
    ])

    # Alert breakdown
    if data["alert_breakdown"]:
        breakdown_parts = []
        label_map = {
            "defense_breach": "防守跌破",
            "min_target_reached": "最小目標",
            "reasonable_target_reached": "合理目標",
            "tp_triggered": "停利",
            "sl_triggered": "停損",
        }
        for atype, count in data["alert_breakdown"].items():
            label = label_map.get(atype, atype)
            breakdown_parts.append(f"{label}×{count}")
        lines.append(f"   ({' | '.join(breakdown_parts)})")

    lines.extend([
        "",
        f"<i>Generated {data['generated_at'][:16]}</i>",
    ])

    return "\n".join(lines)


# ─── Report Sender ──────────────────────────────────────────

async def generate_and_send_report(supabase):
    """
    Main entry point: for each user, collect THEIR OWN data → send via LINE + Telegram.

    Called by APScheduler on the 1st of each month.
    Each user receives a report based solely on their own portfolio holdings.
    """
    logger.info("🚀 Generating monthly reports...")

    # Get all users with messaging configured
    try:
        users_res = (
            supabase.table("user_messaging")
            .select("user_id, line_user_id, telegram_chat_id, notification_prefs")
            .execute()
        )
    except Exception as e:
        logger.error(f"Failed to fetch user messaging data: {e}")
        return

    sent_line = 0
    sent_tg = 0

    for user in users_res.data:
        user_id = user.get("user_id")
        if not user_id:
            logger.warning("Skipping user with missing user_id")
            continue

        # Collect report data scoped to this specific user's holdings
        data = await collect_report_data(supabase, user_id=user_id)
        if not data:
            logger.error(f"Failed to collect report data for user {user_id} — skipping")
            continue

        logger.info(
            f"User {user_id}: value={data['total_value']:,.0f}, "
            f"pnl={data['pnl']:+,.0f}, roi={data['roi']:+.2f}%"
        )

        prefs = user.get("notification_prefs") or {}

        # Send via Telegram (preferred — unlimited)
        tg_chat_id = user.get("telegram_chat_id")
        if tg_chat_id and prefs.get("telegram_enabled", True):
            try:
                from app.messaging.telegram_notifier import send_html
                html = build_report_telegram_html(data)
                ok = await send_html(tg_chat_id, html)
                if ok:
                    sent_tg += 1
            except Exception as e:
                logger.error(f"Report Telegram send error for user {user_id}: {e}")

        # Send via LINE (only if enabled and quota allows)
        line_user_id = user.get("line_user_id")
        if line_user_id and prefs.get("line_enabled", True):
            try:
                from app.messaging.line_notifier import _push_message
                bubble = build_report_flex(data)
                flex_msg = {
                    "type": "flex",
                    "altText": f"📊 {data['month_label']} Investment Report",
                    "contents": bubble,
                }
                ok = await _push_message(line_user_id, [flex_msg])
                if ok:
                    sent_line += 1
            except Exception as e:
                logger.error(f"Report LINE send error for user {user_id}: {e}")

    logger.info(
        f"Monthly report sent — LINE: {sent_line}, Telegram: {sent_tg}"
    )


# ─── API Endpoint ───────────────────────────────────────────

async def generate_report_preview(supabase, user_id: str) -> Optional[dict]:
    """
    Generate report data for API preview (no sending).
    Used by POST /api/report/generate endpoint.
    Report is scoped to the specified user's own holdings.
    """
    data = await collect_report_data(supabase, user_id=user_id)
    if not data:
        return None

    return {
        "data": data,
        "line_flex": build_report_flex(data),
        "telegram_html": build_report_telegram_html(data),
    }
