"""
Notification Parser — Regex-based engine for 楊少凱贏家 advisory messages.
==========================================================================

Parses 7 message types:
  1. greeting      — 問候語 (ignore)
  2. market_analysis — 大盤解析 + 法人鎖碼股
  3. recommendation — 個股推薦 with target prices
  4. institutional  — 法人鎖碼股 (only defense prices)
  5. buy_signal    — 買進建立
  6. hold          — 續抱 / 防守價不跌破
  7. sell_signal   — 賣出 / 離場

Usage:
    from app.parser.notification_parser import parse_notification
    result = parse_notification("楊少凱贏家1 ...")
"""
from __future__ import annotations

import re
from typing import Optional
from fastapi import APIRouter

from app.models.schemas import (
    MessageType,
    ParsedStock,
    ParsedMessage,
    ParseRequest,
    ParseResponse,
    ImportRequest,
    ImportResponse,
)

router = APIRouter()

# ─── Regex patterns ──────────────────────────────────────────

# Date header: "2026/02/10 -----..."
RE_DATE_HEADER = re.compile(
    r"(\d{4}/\d{2}/\d{2})\s*-{3,}"
)

# Message block header: "楊少凱贏家N" or "楊少凱股全"
RE_MSG_HEADER = re.compile(
    r"(?:(?:\d{2}:\d{2})?)\s*楊少凱(?:贏家|股全)\s*(\d*)"
)

# Stock ticker with name: "億光（2393）" or "2393億光" or "2455全新（防守價150元）"
RE_STOCK_WITH_NAME = re.compile(
    r"([^\d\s（(]{1,6})[（(](\d{4,6})[）)]"   # 名稱（代號）
    r"|(\d{4,6})([^\d\s）)]{1,6})"              # 代號名稱
)

# Defense price: "防守價53元" or "防守53" or "防守價設53元" or "可以53元為防守價"
RE_DEFENSE_PRICE = re.compile(
    r"防守(?:價)?(?:設|可[以])?[為是]?\s*(\d+(?:\.\d+)?)\s*元?"
    r"|(?:可[以])\s*(\d+(?:\.\d+)?)\s*元?為防守價"
)

# Min target range: "最小漲幅68~69.5元" or "最小漲幅為88~92元"
RE_MIN_TARGET = re.compile(
    r"最小漲幅[為是]?\s*(\d+(?:\.\d+)?)\s*[~～至到]\s*(\d+(?:\.\d+)?)\s*元?"
)

# Reasonable target range: "合理漲幅75~77元"
RE_REASONABLE_TARGET = re.compile(
    r"合理漲幅[為是]?\s*(\d+(?:\.\d+)?)\s*[~～至到]\s*(\d+(?:\.\d+)?)\s*元?"
)

# Entry price: "58.8以下可直接買進" or "159以下可先買進"
RE_ENTRY_PRICE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(?:元)?以下可(?:直接|先)?買進"
)

# Buy signal: "買進建立"
RE_BUY_SIGNAL = re.compile(r"買進建立")

# Sell signal: "賣出" or "離場"
RE_SELL_SIGNAL = re.compile(r"(?:現在)?賣出|離場")

# Hold signal: "續抱" or "防守價不跌破"
RE_HOLD_SIGNAL = re.compile(r"續抱|防守價不跌破")

# Market support/resistance: "支撑31900附近" or "短支撐32335~32405"
RE_MARKET_SUPPORT = re.compile(
    r"(?:短)?支撐?\s*(\d{4,6})(?:\s*[~～]\s*(\d{4,6}))?\s*附近?"
)
RE_MARKET_RESISTANCE = re.compile(
    r"(?:短)?壓[力]?\s*(\d{4,6})(?:\s*[~～]\s*(\d{4,6}))?\s*附近?"
)

# Institutional stocks: "法人鎖碼股" section
RE_INSTITUTIONAL_HEADER = re.compile(r"法人鎖碼股")

# Individual institutional stock: "2455全新（防守價150元）"
RE_INSTITUTIONAL_STOCK = re.compile(
    r"(\d{4,6})([^\d\s（(]{1,10})[（(]防守價(\d+(?:\.\d+)?)元[）)]"
)

# Date with time: "09:14楊少凱股全"
RE_TIME_PREFIX = re.compile(r"^(\d{2}:\d{2})")


# ─── Classification logic ────────────────────────────────────

def classify_message(text: str) -> MessageType:
    """Determine the type of a single message block."""
    # Check for greeting (short, motivational, no stock data)
    if len(text) < 200 and not re.search(r"\d{4}", text[20:] if len(text) > 20 else text):
        if any(kw in text for kw in ["早安", "快樂", "美好", "希望", "太陽", "大門"]):
            return MessageType.GREETING

    # Check for sell signal (note: "資金轉買" is a buy indicator, not sell)
    if RE_SELL_SIGNAL.search(text) and ("走勢不如預期" in text or "資金轉買" in text):
        return MessageType.SELL_SIGNAL

    # Check for market analysis (大盤解析)
    if "大盤解析" in text:
        return MessageType.MARKET_ANALYSIS

    # Check for buy signal
    if RE_BUY_SIGNAL.search(text) and ("新朋友" in text or "空手" in text):
        return MessageType.BUY_SIGNAL

    # Check for recommendation with targets
    if RE_MIN_TARGET.search(text) or RE_REASONABLE_TARGET.search(text):
        return MessageType.RECOMMENDATION

    # Check for hold signal
    if RE_HOLD_SIGNAL.search(text):
        return MessageType.HOLD

    # Check for institutional stocks only
    if RE_INSTITUTIONAL_HEADER.search(text) and not "大盤解析" in text:
        return MessageType.INSTITUTIONAL

    # Supplementary analysis or commentary
    if "補充" in text and "持股" in text:
        return MessageType.HOLD

    # Default to greeting if nothing else matches
    return MessageType.GREETING


# ─── Helper functions ─────────────────────────────────────────

def _extract_defense_price(text: str) -> Optional[float]:
    """Extract defense price from text, handling multiple regex patterns."""
    match = RE_DEFENSE_PRICE.search(text)
    if match:
        # Group 1: standard "防守價53元" format
        # Group 2: reverse "可以53元為防守價" format
        val = match.group(1) or match.group(2)
        if val:
            return float(val)
    return None


# ─── Stock extraction ─────────────────────────────────────────

def extract_institutional_stocks(text: str) -> list[ParsedStock]:
    """Extract stocks from 法人鎖碼股 section."""
    stocks: list[ParsedStock] = []
    seen_tickers: set[str] = set()

    for match in RE_INSTITUTIONAL_STOCK.finditer(text):
        ticker = match.group(1)
        name = match.group(2).strip()
        defense = float(match.group(3))

        if ticker not in seen_tickers:
            seen_tickers.add(ticker)
            stocks.append(ParsedStock(
                ticker=ticker,
                name=name,
                defense_price=defense,
                strategy_notes="法人鎖碼股",
            ))

    return stocks


def extract_recommendation_stocks(text: str) -> list[ParsedStock]:
    """Extract stocks from recommendation messages with target prices."""
    stocks: list[ParsedStock] = []

    # Find stock references
    stock_refs: list[tuple[str, str]] = []

    # Pattern: 名稱（代號）
    for m in re.finditer(r"([^\d\s,，。（(）)\n]{1,6})[（(](\d{4,6})[）)]", text):
        name = m.group(1).strip()
        ticker = m.group(2)
        # Filter out "防守價" pattern
        if "防守" not in name:
            stock_refs.append((ticker, name))

    if not stock_refs:
        return stocks

    # For each found stock, extract associated prices from the full text
    # (for single-stock messages, prices apply to that stock)
    for ticker, name in stock_refs:
        stock = ParsedStock(ticker=ticker, name=name)

        # Defense price
        stock.defense_price = _extract_defense_price(text)

        # Min target
        min_match = RE_MIN_TARGET.search(text)
        if min_match:
            stock.min_target_low = float(min_match.group(1))
            stock.min_target_high = float(min_match.group(2))

        # Reasonable target
        reas_match = RE_REASONABLE_TARGET.search(text)
        if reas_match:
            stock.reasonable_target_low = float(reas_match.group(1))
            stock.reasonable_target_high = float(reas_match.group(2))

        # Entry price
        entry_match = RE_ENTRY_PRICE.search(text)
        if entry_match:
            stock.entry_price = float(entry_match.group(1))

        # Strategy notes — extract the "操作策略：" section
        strategy_match = re.search(r"操作策略[：:]\s*(.+?)(?:\n\n|\Z)", text, re.DOTALL)
        if strategy_match:
            stock.strategy_notes = strategy_match.group(1).strip()[:500]

        stocks.append(stock)

    return stocks


def extract_buy_signal_stocks(text: str) -> list[ParsedStock]:
    """Extract stocks from buy signal messages."""
    stocks: list[ParsedStock] = []

    # Find stock references
    for m in re.finditer(r"([^\d\s,，。（(）)\n]{1,6})[（(](\d{4,6})[）)]", text):
        name = m.group(1).strip()
        ticker = m.group(2)
        if "防守" not in name:
            stock = ParsedStock(ticker=ticker, name=name)
            stock.action_type = "buy"

            # Defense price
            defense_match = RE_DEFENSE_PRICE.search(text)
            if defense_match:
                stock.defense_price = float(defense_match.group(1))

            # Entry price
            entry_match = RE_ENTRY_PRICE.search(text)
            if entry_match:
                stock.entry_price = float(entry_match.group(1))

            # Min / reasonable targets
            min_m = RE_MIN_TARGET.search(text)
            if min_m:
                stock.min_target_low = float(min_m.group(1))
                stock.min_target_high = float(min_m.group(2))
            reas_m = RE_REASONABLE_TARGET.search(text)
            if reas_m:
                stock.reasonable_target_low = float(reas_m.group(1))
                stock.reasonable_target_high = float(reas_m.group(2))

            # Try to extract actual 操作策略 content; fallback to "買進建立"
            strategy_match = re.search(r"操作策略[：:]\s*(.+?)(?:\n\n|\Z)", text, re.DOTALL)
            if strategy_match:
                stock.strategy_notes = strategy_match.group(1).strip()[:500]
            else:
                stock.strategy_notes = "買進建立"
            stocks.append(stock)

    return stocks


def extract_sell_signal_stocks(text: str) -> list[ParsedStock]:
    """
    Extract stocks from sell signal messages.

    Handles compound messages like:
      "中鋼（2002）走勢不如預期…賣出，資金轉買億光（2393）…防守價53元…"
    → 中鋼 = SELL, 億光 = BUY (with defense/entry prices)
    """
    stocks: list[ParsedStock] = []

    # Detect compound sell + buy message: "資金轉買" splits the message
    buy_split_pos = text.find("資金轉買")
    if buy_split_pos >= 0:
        sell_part = text[:buy_split_pos]
        buy_part = text[buy_split_pos:]
    else:
        sell_part = text
        buy_part = ""

    # --- Extract SELL stocks (from text before 資金轉買, or entire text) ---
    for m in re.finditer(r"([^\d\s,，。（(）)\n]{1,6})[（(](\d{4,6})[）)]", sell_part):
        name = m.group(1).strip()
        ticker = m.group(2)
        if "防守" not in name:
            stock = ParsedStock(ticker=ticker, name=name)
            stock.action_type = "sell"
            sell_reason = re.search(r"(走勢不如預期|獲利了結|目標價到|離場)", sell_part)
            stock.strategy_notes = f"賣出 — {sell_reason.group(1)}" if sell_reason else "賣出"
            stocks.append(stock)

    # --- Extract BUY stocks (from text after 資金轉買) ---
    if buy_part:
        for m in re.finditer(r"([^\d\s,，。（(）)\n]{1,6})[（(](\d{4,6})[）)]", buy_part):
            raw_name = m.group(1).strip()
            ticker = m.group(2)

            # Clean name: strip "資金轉買" prefix
            name = re.sub(r"^(?:資金轉買|轉買)", "", raw_name).strip()
            if not name:
                name = raw_name

            if "防守" not in name:
                stock = ParsedStock(ticker=ticker, name=name)
                stock.action_type = "buy"

                # Extract defense price from buy_part
                stock.defense_price = _extract_defense_price(buy_part)

                # Extract entry price
                entry_match = RE_ENTRY_PRICE.search(buy_part)
                if entry_match:
                    stock.entry_price = float(entry_match.group(1))

                # Extract targets if present
                min_match = RE_MIN_TARGET.search(buy_part)
                if min_match:
                    stock.min_target_low = float(min_match.group(1))
                    stock.min_target_high = float(min_match.group(2))
                reas_match = RE_REASONABLE_TARGET.search(buy_part)
                if reas_match:
                    stock.reasonable_target_low = float(reas_match.group(1))
                    stock.reasonable_target_high = float(reas_match.group(2))

                # Strategy notes from buy context
                strategy_match = re.search(r"操作策略[：:]\s*(.+?)(?:\n\n|\Z)", buy_part, re.DOTALL)
                if strategy_match:
                    stock.strategy_notes = strategy_match.group(1).strip()[:500]
                else:
                    # Try to capture parenthetical reason: （低檔有主力進場的跡象）
                    # Skip pure numbers like （2393） by requiring at least one CJK char
                    reason_match = re.search(r"[（(]([^）)\d]{2}[^）)]{2,48})[）)]", buy_part)
                    if reason_match:
                        stock.strategy_notes = f"資金轉買 — {reason_match.group(1)}"
                    else:
                        stock.strategy_notes = "資金轉買"
                stocks.append(stock)

    return stocks


# ─── Market analysis extraction ───────────────────────────────

def extract_market_data(text: str) -> tuple[Optional[float], Optional[float]]:
    """Extract market support/resistance from 大盤解析 section."""
    support = None
    resistance = None

    sup_match = RE_MARKET_SUPPORT.search(text)
    if sup_match:
        support = float(sup_match.group(1))

    res_match = RE_MARKET_RESISTANCE.search(text)
    if res_match:
        resistance = float(res_match.group(1))

    return support, resistance


# ─── Main parse function ─────────────────────────────────────

def parse_notification(text: str) -> ParseResponse:
    """
    Parse a full notification text (potentially multi-day) into
    structured messages and stock data.
    """
    messages: list[ParsedMessage] = []
    dates_found: list[str] = []
    all_tickers: set[str] = set()

    # Split by date headers first
    date_sections = RE_DATE_HEADER.split(text)

    # Process each section
    current_date = None
    i = 0
    while i < len(date_sections):
        section = date_sections[i].strip()

        # Check if this is a date string
        if re.match(r"\d{4}/\d{2}/\d{2}", section):
            current_date = section
            if current_date not in dates_found:
                dates_found.append(current_date)
            i += 1
            continue

        if not section:
            i += 1
            continue

        # Split section by message headers (楊少凱贏家N)
        msg_parts = RE_MSG_HEADER.split(section)

        j = 0
        while j < len(msg_parts):
            part = msg_parts[j].strip()

            if not part or re.match(r"^\d*$", part):
                j += 1
                continue

            # This is a message body
            msg_type = classify_message(part)

            parsed_msg = ParsedMessage(
                message_type=msg_type,
                raw_text=part[:2000],  # limit stored text
            )

            # Extract data based on type
            if msg_type == MessageType.MARKET_ANALYSIS:
                support, resistance = extract_market_data(part)
                parsed_msg.market_support = support
                parsed_msg.market_resistance = resistance

                # Also extract institutional stocks from 大盤解析 section
                inst_stocks = extract_institutional_stocks(part)
                if inst_stocks:
                    parsed_msg.stocks = inst_stocks
                    for s in inst_stocks:
                        all_tickers.add(s.ticker)

            elif msg_type == MessageType.RECOMMENDATION:
                stocks = extract_recommendation_stocks(part)
                parsed_msg.stocks = stocks
                for s in stocks:
                    all_tickers.add(s.ticker)

            elif msg_type == MessageType.INSTITUTIONAL:
                stocks = extract_institutional_stocks(part)
                parsed_msg.stocks = stocks
                for s in stocks:
                    all_tickers.add(s.ticker)

            elif msg_type == MessageType.BUY_SIGNAL:
                stocks = extract_buy_signal_stocks(part)
                parsed_msg.stocks = stocks
                for s in stocks:
                    all_tickers.add(s.ticker)

            elif msg_type == MessageType.SELL_SIGNAL:
                stocks = extract_sell_signal_stocks(part)
                parsed_msg.stocks = stocks
                for s in stocks:
                    all_tickers.add(s.ticker)

            elif msg_type == MessageType.HOLD:
                stocks = extract_recommendation_stocks(part)
                parsed_msg.stocks = stocks
                for s in stocks:
                    all_tickers.add(s.ticker)

            # Only add non-greeting messages (or greeting with no stocks)
            if msg_type != MessageType.GREETING or parsed_msg.stocks:
                messages.append(parsed_msg)

            j += 1

        i += 1

    return ParseResponse(
        success=True,
        total_messages=len(messages),
        total_stocks=len(all_tickers),
        messages=messages,
        dates_found=dates_found,
    )


# ─── API endpoints ────────────────────────────────────────────

@router.post("/parse", response_model=ParseResponse)
async def parse_notifications(request: ParseRequest):
    """
    Parse advisory notification text into structured data.
    Does NOT write to database — preview only.
    """
    return parse_notification(request.text)


@router.post("/parse/import", response_model=ImportResponse)
async def import_notifications(request: ImportRequest):
    """
    Parse advisory notification text AND import into Supabase.
    Phase 1 stub — full implementation when Supabase tables are ready.
    """
    # First, parse the text
    parsed = parse_notification(request.text)

    # TODO: Phase 1.4 — write to Supabase tables
    # For now, return a stub response
    imported = 0
    skipped = 0
    details = []

    for msg in parsed.messages:
        for stock in msg.stocks:
            if request.selected_tickers and stock.ticker not in request.selected_tickers:
                skipped += 1
                details.append({
                    "ticker": stock.ticker,
                    "name": stock.name,
                    "action": "skipped",
                    "reason": "not in selected_tickers",
                })
            else:
                imported += 1
                details.append({
                    "ticker": stock.ticker,
                    "name": stock.name,
                    "action": "imported",
                    "defense_price": stock.defense_price,
                    "min_target": f"{stock.min_target_low}~{stock.min_target_high}" if stock.min_target_low else None,
                })

    return ImportResponse(
        success=True,
        imported_count=imported,
        skipped_count=skipped,
        details=details,
    )
