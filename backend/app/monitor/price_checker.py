"""
Price Checker — Compares current prices against thresholds.
============================================================

Two comparison systems running simultaneously:

1. Advisory System (new):
   - defense_breach:           current_price <= defense_price
   - min_target_reached:       min_target_low <= current_price <= min_target_high
   - reasonable_target_reached: reasonable_target_low <= current_price <= reasonable_target_high

2. Portfolio System (existing, ported from calculations.ts):
   - tp_triggered:  current_price >= TP price
   - sl_triggered:  current_price <= SL price (cost-based)
   - Also: ±2% cost zone alert (from update_market_data.py)
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class AlertEvent:
    """Represents a triggered price alert."""
    user_id: str
    ticker: str
    stock_name: str  # 股票名稱 e.g. "億光"
    alert_type: str  # defense_breach | min_target_reached | reasonable_target_reached | tp_triggered | sl_triggered
    trigger_price: float  # The threshold that was breached
    current_price: float
    strategy_notes: str = ""  # 解析結果說明
    details: str = ""


# ─── Advisory Price Checks ────────────────────────────────────

def check_advisory_alerts(
    current_prices: dict[str, float],
    price_targets: list[dict],
    name_map: dict[str, str] | None = None,
) -> list[AlertEvent]:
    """
    Compare current prices against advisory defense/target prices.

    Args:
        current_prices: {ticker: current_price}
        price_targets: List of price_targets rows from Supabase
            Each has: user_id, ticker, defense_price, min_target_low/high,
                      reasonable_target_low/high, is_latest
        name_map: Optional {ticker: stock_name} lookup

    Returns:
        List of AlertEvent for each triggered condition
    """
    alerts: list[AlertEvent] = []
    _names = name_map or {}

    for target in price_targets:
        if not target.get('is_latest'):
            continue

        ticker = target['ticker']
        current = current_prices.get(ticker)
        if current is None:
            continue

        user_id = target['user_id']
        name = _names.get(ticker, "")
        notes = target.get('strategy_notes', "") or ""

        # ── Defense price breach ──
        defense = target.get('defense_price')
        if defense is not None and current <= defense:
            alerts.append(AlertEvent(
                user_id=user_id,
                ticker=ticker,
                stock_name=name,
                alert_type='defense_breach',
                trigger_price=defense,
                current_price=current,
                strategy_notes=notes,
                details=f"⚠️ {ticker} 跌破防守價 {defense} 元！目前 {current:.2f} 元",
            ))

        # ── Min target reached ──
        min_low = target.get('min_target_low')
        min_high = target.get('min_target_high')
        if min_low is not None and min_high is not None:
            if min_low <= current <= min_high:
                alerts.append(AlertEvent(
                    user_id=user_id,
                    ticker=ticker,
                    stock_name=name,
                    alert_type='min_target_reached',
                    trigger_price=min_low,
                    current_price=current,
                    strategy_notes=notes,
                    details=f"✅ {ticker} 達到最小漲幅 {min_low}~{min_high} 元！目前 {current:.2f} 元",
                ))

        # ── Reasonable target reached ──
        reas_low = target.get('reasonable_target_low')
        reas_high = target.get('reasonable_target_high')
        if reas_low is not None and reas_high is not None:
            if reas_low <= current <= reas_high:
                alerts.append(AlertEvent(
                    user_id=user_id,
                    ticker=ticker,
                    stock_name=name,
                    alert_type='reasonable_target_reached',
                    trigger_price=reas_low,
                    current_price=current,
                    strategy_notes=notes,
                    details=f"🎯 {ticker} 達到合理漲幅 {reas_low}~{reas_high} 元！目前 {current:.2f} 元",
                ))

    return alerts


# ─── Portfolio TP/SL Checks ───────────────────────────────────

def calculate_tp_sl(holding: dict) -> tuple[float, float]:
    """
    Calculate TP/SL prices for a holding.
    Ported from calculations.ts calculateTPSL().

    Manual mode: user-set TP/SL
    Auto mode: TP = MAX(cost*1.1, highWatermark*0.9), SL = cost (breakeven)
    """
    avg_cost = float(holding.get('cost_price', 0))
    strategy = holding.get('strategy_mode', 'auto')

    if strategy == 'manual':
        tp = float(holding.get('manual_tp') or avg_cost * 1.1)
        sl = float(holding.get('manual_sl') or avg_cost)
        return tp, sl

    # Auto trailing logic
    hwm = float(holding.get('high_watermark_price') or avg_cost)
    base_tp = avg_cost * 1.1
    trailing_tp = hwm * 0.9
    tp = max(base_tp, trailing_tp)
    sl = avg_cost  # Breakeven

    return tp, sl


def check_portfolio_alerts(
    current_prices: dict[str, float],
    holdings: list[dict],
) -> list[AlertEvent]:
    """
    Compare current prices against portfolio TP/SL thresholds.

    Args:
        current_prices: {ticker: current_price}
        holdings: List of portfolio_holdings rows from Supabase

    Returns:
        List of AlertEvent for triggered TP/SL conditions
    """
    alerts: list[AlertEvent] = []

    # Group holdings by (user_id, ticker) and aggregate
    aggregated: dict[tuple, dict] = {}
    for h in holdings:
        key = (h['user_id'], h['ticker'])
        if key not in aggregated:
            aggregated[key] = {
                'user_id': h['user_id'],
                'ticker': h['ticker'],
                'name': h.get('name', ''),
                'total_shares': 0,
                'total_cost': 0,
                'strategy_mode': h.get('strategy_mode', 'auto'),
                'manual_tp': h.get('manual_tp'),
                'manual_sl': h.get('manual_sl'),
                'high_watermark_price': h.get('high_watermark_price'),
            }
        agg = aggregated[key]
        shares = float(h.get('shares', 0))
        cost = float(h.get('cost_price', 0))
        agg['total_shares'] += shares
        agg['total_cost'] += shares * cost
        # Keep highest watermark
        hwm = h.get('high_watermark_price')
        if hwm is not None:
            existing = agg.get('high_watermark_price') or 0
            agg['high_watermark_price'] = max(float(hwm), float(existing))

    for key, agg in aggregated.items():
        ticker = agg['ticker']
        current = current_prices.get(ticker)
        if current is None or agg['total_shares'] <= 0:
            continue

        avg_cost = agg['total_cost'] / agg['total_shares']
        agg['cost_price'] = avg_cost

        tp, sl = calculate_tp_sl(agg)

        name = agg.get('name', '')

        # ── TP triggered ──
        if current >= tp:
            alerts.append(AlertEvent(
                user_id=agg['user_id'],
                ticker=ticker,
                stock_name=name,
                alert_type='tp_triggered',
                trigger_price=tp,
                current_price=current,
                details=f"🎯 停利觸發：{ticker} 達 TP {tp:.2f} 元，目前 {current:.2f} 元",
            ))

        # ── SL triggered ──
        if current <= sl and sl > 0:
            alerts.append(AlertEvent(
                user_id=agg['user_id'],
                ticker=ticker,
                stock_name=name,
                alert_type='sl_triggered',
                trigger_price=sl,
                current_price=current,
                details=f"⚠️ 停損觸發：{ticker} 跌破 SL {sl:.2f} 元，目前 {current:.2f} 元",
            ))

    return alerts


# ─── Deduplication ────────────────────────────────────────────

def deduplicate_alerts(
    new_alerts: list[AlertEvent],
    recent_alerts: list[dict],
    cooldown_minutes: int = 60,
) -> list[AlertEvent]:
    """
    Filter out alerts that were already sent recently.

    Args:
        new_alerts: Newly triggered alerts
        recent_alerts: Recent alert records from price_alerts table
        cooldown_minutes: Minimum minutes between duplicate alerts

    Returns:
        Filtered list of alerts to actually send
    """
    from datetime import datetime, timedelta, timezone

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=cooldown_minutes)

    # Build a set of (user_id, ticker, alert_type) from recent alerts
    recent_set: set[tuple] = set()
    for ra in recent_alerts:
        triggered_at = ra.get('triggered_at', '')
        # Parse ISO timestamp
        try:
            if isinstance(triggered_at, str):
                ts = datetime.fromisoformat(triggered_at.replace('Z', '+00:00'))
            else:
                ts = triggered_at
            if ts > cutoff:
                recent_set.add((ra['user_id'], ra['ticker'], ra['alert_type']))
        except (ValueError, TypeError):
            pass

    filtered = []
    for alert in new_alerts:
        key = (alert.user_id, alert.ticker, alert.alert_type)
        if key not in recent_set:
            filtered.append(alert)
        else:
            logger.debug(f"Suppressed duplicate alert: {alert.ticker} {alert.alert_type}")

    return filtered
