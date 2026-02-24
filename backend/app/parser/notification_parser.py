"""
Notification Parser — Regex-based engine for 楊少凱贏家 advisory messages.
==========================================================================

Parses 7 message types:
  1. greeting       — 問候語 (ignore)
  2. market_analysis — 大盤解析 + 法人鎖碼股
  3. recommendation — 個股推薦 with target prices
  4. institutional  — 法人鎖碼股 (only defense prices)
  5. buy_signal     — 買進建立
  6. hold           — 續抱 / 防守價不跌破
  7. sell_signal    — 賣出 / 離場

Output format (fixed for every stock):
  * 股票名稱(股票代號)
  * 操作訊號
  * 防守價
  * 最小漲幅
  * 合理漲幅
  * 操作策略

Fields that can't be parsed default to "待定" and are editable before import.

Usage:
    from app.parser.notification_parser import parse_notification
    result = parse_notification("楊少凱贏家1 ...")
"""
from __future__ import annotations

import logging
import re
from typing import Optional
from fastapi import APIRouter

from app.models.schemas import (
    PENDING,
    MessageType,
    ParsedStock,
    ParsedMessage,
    ParseRequest,
    ParseResponse,
    EditedStock,
    ImportRequest,
    ImportResponse,
)

logger = logging.getLogger(__name__)
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

    # Check for sell signal — multiple indicators:
    #   1. Explicit "賣出/離場" + context keywords
    #   2. "走勢不如預期" alone (implies sell even without explicit 賣出)
    #   3. "資金轉買" (compound sell→buy message)
    if "走勢不如預期" in text or "資金轉買" in text:
        return MessageType.SELL_SIGNAL
    if RE_SELL_SIGNAL.search(text) and ("獲利了結" in text or "目標價到" in text):
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
    if RE_INSTITUTIONAL_HEADER.search(text) and "大盤解析" not in text:
        return MessageType.INSTITUTIONAL

    # Supplementary analysis or commentary
    if "補充" in text and "持股" in text:
        return MessageType.HOLD

    # Default to greeting if nothing else matches
    return MessageType.GREETING


# ─── Action signal inference ─────────────────────────────────

def _infer_action_type(msg_type: MessageType, text: str) -> str:
    """
    Infer the action_type for a stock based on message type and context.

    Returns: 'buy', 'sell', 'hold', 'institutional', or ''
    """
    if msg_type == MessageType.BUY_SIGNAL:
        return "buy"
    if msg_type == MessageType.SELL_SIGNAL:
        return "sell"
    if msg_type == MessageType.HOLD:
        return "hold"
    if msg_type == MessageType.INSTITUTIONAL:
        return "institutional"
    if msg_type == MessageType.RECOMMENDATION:
        # Recommendations are implicitly buy-oriented
        if RE_BUY_SIGNAL.search(text) or RE_ENTRY_PRICE.search(text):
            return "buy"
        return "buy"  # default for recommendations
    if msg_type == MessageType.MARKET_ANALYSIS:
        return "institutional"  # stocks in 大盤解析 are 法人鎖碼股
    return ""


# ─── Helper functions ─────────────────────────────────────────

def _extract_defense_price(text: str) -> Optional[float]:
    """Extract defense price from text, handling multiple regex patterns."""
    match = RE_DEFENSE_PRICE.search(text)
    if match:
        val = match.group(1) or match.group(2)
        if val:
            return float(val)
    return None


def _extract_strategy(text: str, fallback: str = "") -> str:
    """
    Extract strategy notes from text.

    Looks for explicit "操作策略：" section first,
    then falls back to contextual extraction.
    """
    # Explicit 操作策略 section
    strategy_match = re.search(
        r"操作策略[：:]\s*(.+?)(?:\n\n|\Z)", text, re.DOTALL
    )
    if strategy_match:
        return strategy_match.group(1).strip()[:500]

    # Try to find parenthetical reasoning with CJK chars
    reason_match = re.search(r"[（(]([^）)\d]{2}[^）)]{2,48})[）)]", text)
    if reason_match:
        reason = reason_match.group(1)
        if "防守" not in reason:  # Don't use "防守價150元" as strategy
            return reason

    return fallback


def _build_stock(
    ticker: str,
    name: str,
    text: str,
    action_type: str,
    *,
    defense_price: Optional[float] = None,
    skip_target_extraction: bool = False,
) -> ParsedStock:
    """
    Build a ParsedStock with all extractable fields, then fill display fields.

    This is the single factory function for creating stocks — ensures every
    stock goes through fill_display_fields() for consistent output.
    """
    # Clean common prefixes from stock names
    clean_name = re.sub(r"^(?:資金轉買|轉買|新增)", "", name).strip()
    if not clean_name:
        clean_name = name

    stock = ParsedStock(ticker=ticker, name=clean_name)
    stock.action_type = action_type

    # Defense price: explicit param overrides extraction
    if defense_price is not None:
        stock.defense_price = defense_price
    else:
        stock.defense_price = _extract_defense_price(text)

    if not skip_target_extraction:
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

    # Strategy notes
    stock.strategy_notes = _extract_strategy(text, fallback="")

    # ★ Fill fixed-format display fields (待定 for missing)
    stock.fill_display_fields()

    return stock


# ─── Stock extraction ─────────────────────────────────────────

def extract_institutional_stocks(
    text: str, action_type: str = "institutional"
) -> list[ParsedStock]:
    """Extract stocks from 法人鎖碼股 section."""
    stocks: list[ParsedStock] = []
    seen_tickers: set[str] = set()

    for match in RE_INSTITUTIONAL_STOCK.finditer(text):
        ticker = match.group(1)
        name = match.group(2).strip()
        defense = float(match.group(3))

        if ticker not in seen_tickers:
            seen_tickers.add(ticker)
            stock = _build_stock(
                ticker, name, text,
                action_type=action_type,
                defense_price=defense,
                skip_target_extraction=True,
            )
            # Override strategy for institutional stocks
            if not stock.strategy_notes:
                stock.strategy_notes = "法人鎖碼股"
                stock.strategy_display = "法人鎖碼股"
            stocks.append(stock)

    return stocks


def extract_recommendation_stocks(
    text: str, action_type: str = "buy"
) -> list[ParsedStock]:
    """Extract stocks from recommendation messages with target prices."""
    stocks: list[ParsedStock] = []

    # Find stock references: 名稱（代號）
    stock_refs: list[tuple[str, str]] = []
    for m in re.finditer(
        r"([^\d\s,，。（(）)\n]{1,6})[（(](\d{4,6})[）)]", text
    ):
        name = m.group(1).strip()
        ticker = m.group(2)
        if "防守" not in name:
            stock_refs.append((ticker, name))

    if not stock_refs:
        return stocks

    for ticker, name in stock_refs:
        stock = _build_stock(ticker, name, text, action_type=action_type)
        stocks.append(stock)

    return stocks


def extract_buy_signal_stocks(text: str) -> list[ParsedStock]:
    """Extract stocks from buy signal messages."""
    stocks: list[ParsedStock] = []

    for m in re.finditer(
        r"([^\d\s,，。（(）)\n]{1,6})[（(](\d{4,6})[）)]", text
    ):
        name = m.group(1).strip()
        ticker = m.group(2)
        if "防守" not in name:
            stock = _build_stock(ticker, name, text, action_type="buy")
            if not stock.strategy_notes:
                stock.strategy_notes = "買進建立"
                stock.strategy_display = "買進建立"
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

    # Detect compound sell + buy message
    buy_split_pos = text.find("資金轉買")
    if buy_split_pos >= 0:
        sell_part = text[:buy_split_pos]
        buy_part = text[buy_split_pos:]
    else:
        sell_part = text
        buy_part = ""

    # --- SELL stocks ---
    for m in re.finditer(
        r"([^\d\s,，。（(）)\n]{1,6})[（(](\d{4,6})[）)]", sell_part
    ):
        name = m.group(1).strip()
        ticker = m.group(2)
        if "防守" not in name:
            stock = _build_stock(
                ticker, name, sell_part,
                action_type="sell",
                skip_target_extraction=True,
            )
            # Extract sell reason
            sell_reason = re.search(
                r"(走勢不如預期|獲利了結|目標價到|離場)", sell_part
            )
            reason_text = (
                f"賣出 — {sell_reason.group(1)}" if sell_reason else "賣出"
            )
            stock.strategy_notes = reason_text
            stock.strategy_display = reason_text
            stocks.append(stock)

    # --- BUY stocks (after 資金轉買) ---
    if buy_part:
        for m in re.finditer(
            r"([^\d\s,，。（(）)\n]{1,6})[（(](\d{4,6})[）)]", buy_part
        ):
            raw_name = m.group(1).strip()
            ticker = m.group(2)
            name = re.sub(r"^(?:資金轉買|轉買)", "", raw_name).strip()
            if not name:
                name = raw_name

            if "防守" not in name:
                stock = _build_stock(
                    ticker, name, buy_part, action_type="buy"
                )
                if not stock.strategy_notes:
                    stock.strategy_notes = "資金轉買"
                    stock.strategy_display = "資金轉買"
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


# ─── Formatted output builder ─────────────────────────────────

def _build_formatted_output(stocks: list[ParsedStock]) -> list[dict]:
    """
    Build the fixed-format output list for the API response.

    Each item is a dict with the 6 editable fields + ticker for identification.
    This is what the frontend renders as editable cards/rows.
    """
    output: list[dict] = []
    for stock in stocks:
        output.append({
            "ticker": stock.ticker,
            "name": stock.name,
            "display_name": stock.display_name,
            "action_signal": stock.action_signal,
            "defense_price_display": stock.defense_price_display,
            "min_target_display": stock.min_target_display,
            "reasonable_target_display": stock.reasonable_target_display,
            "strategy_display": stock.strategy_display,
            # Raw values for backend use
            "defense_price": stock.defense_price,
            "min_target_low": stock.min_target_low,
            "min_target_high": stock.min_target_high,
            "reasonable_target_low": stock.reasonable_target_low,
            "reasonable_target_high": stock.reasonable_target_high,
            "entry_price": stock.entry_price,
            "action_type": stock.action_type,
        })
    return output


# ─── Main parse function ─────────────────────────────────────

def parse_notification(text: str) -> ParseResponse:
    """
    Parse a full notification text (potentially multi-day) into
    structured messages and stock data.

    Returns a ParseResponse with:
      - messages: detailed per-block breakdown
      - formatted_output: fixed-format list of all unique stocks (editable)
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
            action_type = _infer_action_type(msg_type, part)

            parsed_msg = ParsedMessage(
                message_type=msg_type,
                raw_text=part[:2000],
            )

            # Extract data based on type
            if msg_type == MessageType.MARKET_ANALYSIS:
                support, resistance = extract_market_data(part)
                parsed_msg.market_support = support
                parsed_msg.market_resistance = resistance
                inst_stocks = extract_institutional_stocks(part)
                if inst_stocks:
                    parsed_msg.stocks = inst_stocks
                    for s in inst_stocks:
                        all_tickers.add(s.ticker)

            elif msg_type == MessageType.RECOMMENDATION:
                stocks = extract_recommendation_stocks(part, action_type)
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
                stocks = extract_recommendation_stocks(part, action_type="hold")
                parsed_msg.stocks = stocks
                for s in stocks:
                    all_tickers.add(s.ticker)

            # Only add non-greeting messages
            if msg_type != MessageType.GREETING or parsed_msg.stocks:
                messages.append(parsed_msg)

            j += 1

        i += 1

    # ── Build deduplicated formatted output ──
    # If same ticker appears in multiple messages, keep the version
    # with the most complete price data
    best_stocks: dict[str, ParsedStock] = {}

    for msg in messages:
        for stock in msg.stocks:
            score = sum(1 for v in [
                stock.defense_price, stock.min_target_low,
                stock.min_target_high, stock.reasonable_target_low,
                stock.reasonable_target_high, stock.entry_price,
            ] if v is not None)

            if stock.ticker not in best_stocks:
                best_stocks[stock.ticker] = stock
            else:
                existing = best_stocks[stock.ticker]
                existing_score = sum(1 for v in [
                    existing.defense_price, existing.min_target_low,
                    existing.min_target_high, existing.reasonable_target_low,
                    existing.reasonable_target_high, existing.entry_price,
                ] if v is not None)
                if score > existing_score:
                    best_stocks[stock.ticker] = stock

    formatted_output = _build_formatted_output(list(best_stocks.values()))

    return ParseResponse(
        success=True,
        total_messages=len(messages),
        total_stocks=len(all_tickers),
        messages=messages,
        dates_found=dates_found,
        formatted_output=formatted_output,
    )


# ─── Display text helper ─────────────────────────────────────

def parse_display_values(edited: EditedStock) -> EditedStock:
    """
    Parse user-edited display strings back into numeric values.

    E.g. "53元" → defense_price=53.0
         "68~69.5元" → min_target_low=68.0, min_target_high=69.5
    """
    # Defense price
    if edited.defense_price_display and edited.defense_price_display != PENDING:
        m = re.search(r"(\d+(?:\.\d+)?)", edited.defense_price_display)
        if m:
            edited.defense_price = float(m.group(1))

    # Min target range
    if edited.min_target_display and edited.min_target_display != PENDING:
        m = re.search(
            r"(\d+(?:\.\d+)?)\s*[~～至到]\s*(\d+(?:\.\d+)?)",
            edited.min_target_display,
        )
        if m:
            edited.min_target_low = float(m.group(1))
            edited.min_target_high = float(m.group(2))
        else:
            single = re.search(r"(\d+(?:\.\d+)?)", edited.min_target_display)
            if single:
                edited.min_target_low = float(single.group(1))

    # Reasonable target range
    if (edited.reasonable_target_display
            and edited.reasonable_target_display != PENDING):
        m = re.search(
            r"(\d+(?:\.\d+)?)\s*[~～至到]\s*(\d+(?:\.\d+)?)",
            edited.reasonable_target_display,
        )
        if m:
            edited.reasonable_target_low = float(m.group(1))
            edited.reasonable_target_high = float(m.group(2))
        else:
            single = re.search(
                r"(\d+(?:\.\d+)?)", edited.reasonable_target_display
            )
            if single:
                edited.reasonable_target_low = float(single.group(1))

    # Strategy notes
    if edited.strategy_display and edited.strategy_display != PENDING:
        edited.strategy_notes = edited.strategy_display

    return edited


# ─── API endpoints ────────────────────────────────────────────

@router.post("/parse", response_model=ParseResponse)
async def parse_notifications(request: ParseRequest):
    """
    Parse advisory notification text into structured data.
    Does NOT write to database — preview only.

    Returns fixed-format output with 6 fields per stock.
    Fields that couldn't be parsed show "待定".
    """
    return parse_notification(request.text)


@router.post("/parse/import", response_model=ImportResponse)
async def import_notifications(request: ImportRequest):
    """
    Parse advisory notification text AND import into Supabase.

    Supports two modes:
      1. text-based: Parse raw text, then import (original flow)
      2. edited_stocks: Import user-edited stocks directly (new flow)

    When edited_stocks is provided, display values are parsed back
    into numeric fields before writing to price_targets.
    """
    from datetime import date as date_type
    from supabase import create_client
    from app.config import get_settings

    settings = get_settings()
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        return ImportResponse(
            success=False,
            imported_count=0,
            skipped_count=0,
            details=[{"ticker": "", "name": "", "action": "error",
                       "reason": "Supabase credentials not configured"}],
        )

    supabase = create_client(
        settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY
    )

    # Determine import source: edited_stocks takes priority over text parsing
    if request.edited_stocks:
        stocks_to_import = _prepare_edited_stocks(request.edited_stocks)
        notification_date = str(date_type.today())
    else:
        # Parse from text
        parsed = parse_notification(request.text)
        notification_date = str(date_type.today())
        if parsed.dates_found:
            try:
                notification_date = parsed.dates_found[-1].replace("/", "-")
            except Exception:
                pass
        stocks_to_import = _prepare_parsed_stocks(
            parsed, request.selected_tickers
        )

    imported = 0
    skipped = 0
    details = []

    for ticker, stock_data in stocks_to_import.items():
        try:
            # Insert advisory_notifications
            notif_res = supabase.table("advisory_notifications").insert({
                "user_id": request.user_id,
                "notification_date": notification_date,
                "message_type": stock_data.get("message_type", "recommendation"),
                "raw_text": stock_data.get("raw_text", "")[:2000],
                "source": (
                    request.source.value
                    if hasattr(request.source, 'value')
                    else str(request.source)
                ),
            }).execute()

            notification_id = None
            if notif_res.data and len(notif_res.data) > 0:
                notification_id = notif_res.data[0].get("id")

            # Retire old price_targets
            supabase.table("price_targets").update({
                "is_latest": False,
            }).eq(
                "user_id", request.user_id
            ).eq(
                "ticker", ticker
            ).eq(
                "is_latest", True
            ).execute()

            # Insert new price_target
            target_data = {
                "user_id": request.user_id,
                "ticker": ticker,
                "stock_name": stock_data.get("name", ""),
                "notification_id": notification_id,
                "defense_price": stock_data.get("defense_price"),
                "min_target_low": stock_data.get("min_target_low"),
                "min_target_high": stock_data.get("min_target_high"),
                "reasonable_target_low": stock_data.get("reasonable_target_low"),
                "reasonable_target_high": stock_data.get("reasonable_target_high"),
                "entry_price": stock_data.get("entry_price"),
                "strategy_notes": stock_data.get("strategy_notes", ""),
                "effective_date": notification_date,
                "is_latest": True,
            }
            supabase.table("price_targets").insert(target_data).execute()

            # UPSERT advisory_tracking
            supabase.table("advisory_tracking").upsert(
                {
                    "user_id": request.user_id,
                    "ticker": ticker,
                    "tracking_status": "watching",
                },
                on_conflict="user_id,ticker",
                ignore_duplicates=True,
            ).execute()

            imported += 1
            details.append({
                "ticker": ticker,
                "name": stock_data.get("name", ""),
                "action": "imported",
                "defense_price": stock_data.get("defense_price"),
                "min_target": (
                    f"{stock_data['min_target_low']}~{stock_data['min_target_high']}"
                    if stock_data.get("min_target_low") else None
                ),
            })
            logger.info(
                "Imported %s(%s) — defense=%s",
                stock_data.get("name", ""), ticker,
                stock_data.get("defense_price"),
            )

        except Exception as e:
            logger.error(f"Failed to import {ticker}: {e}")
            details.append({
                "ticker": ticker,
                "name": stock_data.get("name", ""),
                "action": "error",
                "reason": str(e)[:200],
            })

    return ImportResponse(
        success=imported > 0 or skipped > 0,
        imported_count=imported,
        skipped_count=skipped,
        details=details,
    )


# ─── Import helpers ───────────────────────────────────────────

def _prepare_edited_stocks(
    edited_stocks: list[EditedStock],
) -> dict[str, dict]:
    """
    Convert user-edited stocks into import-ready dicts.

    Parses display strings back into numeric values so the DB
    gets clean numbers even after manual editing.
    """
    result: dict[str, dict] = {}

    for edited in edited_stocks:
        # Parse display values → numeric fields
        edited = parse_display_values(edited)

        result[edited.ticker] = {
            "name": edited.name,
            "defense_price": edited.defense_price,
            "min_target_low": edited.min_target_low,
            "min_target_high": edited.min_target_high,
            "reasonable_target_low": edited.reasonable_target_low,
            "reasonable_target_high": edited.reasonable_target_high,
            "entry_price": edited.entry_price,
            "strategy_notes": edited.strategy_notes or edited.strategy_display,
            "message_type": "recommendation",
            "raw_text": "",
        }

    return result


def _prepare_parsed_stocks(
    parsed: ParseResponse,
    selected_tickers: list[str],
) -> dict[str, dict]:
    """
    Deduplicate and prepare parsed stocks for import.

    Same logic as before: keeps version with most complete price data.
    """
    best: dict[str, tuple[ParsedStock, str, str]] = {}

    for msg in parsed.messages:
        for stock in msg.stocks:
            if selected_tickers and stock.ticker not in selected_tickers:
                continue

            score = sum(1 for v in [
                stock.defense_price, stock.min_target_low,
                stock.min_target_high, stock.reasonable_target_low,
                stock.reasonable_target_high, stock.entry_price,
            ] if v is not None)

            if stock.ticker not in best:
                best[stock.ticker] = (stock, msg.message_type, msg.raw_text)
            else:
                existing_score = sum(1 for v in [
                    best[stock.ticker][0].defense_price,
                    best[stock.ticker][0].min_target_low,
                    best[stock.ticker][0].min_target_high,
                    best[stock.ticker][0].reasonable_target_low,
                    best[stock.ticker][0].reasonable_target_high,
                    best[stock.ticker][0].entry_price,
                ] if v is not None)
                if score > existing_score:
                    best[stock.ticker] = (stock, msg.message_type, msg.raw_text)

    result: dict[str, dict] = {}
    for ticker, (stock, msg_type, raw_text) in best.items():
        result[ticker] = {
            "name": stock.name,
            "defense_price": stock.defense_price,
            "min_target_low": stock.min_target_low,
            "min_target_high": stock.min_target_high,
            "reasonable_target_low": stock.reasonable_target_low,
            "reasonable_target_high": stock.reasonable_target_high,
            "entry_price": stock.entry_price,
            "strategy_notes": stock.strategy_notes,
            "message_type": msg_type,
            "raw_text": raw_text,
        }

    return result
