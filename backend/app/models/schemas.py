"""
Pydantic models for request/response validation.
"""
from __future__ import annotations
from datetime import date
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


# ─── Enum types ───────────────────────────────────────────────

class MessageType(str, Enum):
    GREETING = "greeting"
    MARKET_ANALYSIS = "market_analysis"
    RECOMMENDATION = "recommendation"
    INSTITUTIONAL = "institutional"
    BUY_SIGNAL = "buy_signal"
    HOLD = "hold"
    SELL_SIGNAL = "sell_signal"


class NotificationSource(str, Enum):
    DASHBOARD = "dashboard"
    LINE_BOT = "line_bot"


# ─── Parsed stock info ───────────────────────────────────────

class ParsedStock(BaseModel):
    """A single stock extracted from an advisory notification."""
    ticker: str = Field(..., description="股票代號, e.g. '2393'")
    name: str = Field("", description="股票名稱, e.g. '億光'")
    defense_price: Optional[float] = Field(None, description="防守價")
    min_target_low: Optional[float] = Field(None, description="最小漲幅下界")
    min_target_high: Optional[float] = Field(None, description="最小漲幅上界")
    reasonable_target_low: Optional[float] = Field(None, description="合理漲幅下界")
    reasonable_target_high: Optional[float] = Field(None, description="合理漲幅上界")
    entry_price: Optional[float] = Field(None, description="建議買進價")
    strategy_notes: str = Field("", description="操作策略備註")


class ParsedMessage(BaseModel):
    """A single parsed message block (one 楊少凱贏家N block)."""
    message_type: MessageType
    raw_text: str
    stocks: list[ParsedStock] = Field(default_factory=list)
    market_support: Optional[float] = Field(None, description="大盤支撐位")
    market_resistance: Optional[float] = Field(None, description="大盤壓力位")


# ─── API request/response ────────────────────────────────────

class ParseRequest(BaseModel):
    """POST /api/parse request body."""
    text: str = Field(..., min_length=1, description="投顧通知文字（可包含多日）")
    source: NotificationSource = Field(
        NotificationSource.DASHBOARD,
        description="通知來源"
    )


class ParseResponse(BaseModel):
    """POST /api/parse response body."""
    success: bool = True
    total_messages: int = Field(0, description="解析出的訊息區塊數")
    total_stocks: int = Field(0, description="解析出的不重複股票數")
    messages: list[ParsedMessage] = Field(default_factory=list)
    dates_found: list[str] = Field(default_factory=list, description="涵蓋日期")


class ImportRequest(BaseModel):
    """POST /api/parse/import request body."""
    text: str = Field(..., min_length=1)
    source: NotificationSource = Field(NotificationSource.DASHBOARD)
    user_id: str = Field(..., description="Supabase auth user UUID")
    selected_tickers: list[str] = Field(
        default_factory=list,
        description="只匯入這些 ticker；空表示全部匯入"
    )


class ImportResponse(BaseModel):
    """POST /api/parse/import response body."""
    success: bool = True
    imported_count: int = 0
    skipped_count: int = 0
    details: list[dict] = Field(default_factory=list)
