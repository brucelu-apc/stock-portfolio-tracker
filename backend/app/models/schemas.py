"""
Pydantic models for request/response validation.
==================================================

Key design: ParsedStock uses a **fixed output format** with 6 display fields.
Fields that can't be parsed from the advisory text default to "待定" (TBD),
and the frontend allows manual editing before import.
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


# ─── Action signal mapping ───────────────────────────────────

ACTION_SIGNAL_MAP: dict[str, str] = {
    "buy": "買進建立",
    "sell": "賣出",
    "hold": "續抱",
    "institutional": "法人鎖碼股",
}

PENDING = "待定"


# ─── Parsed stock info ───────────────────────────────────────

class ParsedStock(BaseModel):
    """
    A single stock extracted from an advisory notification.

    Fixed output format — every stock ALWAYS has these 6 display fields:
      1. 股票名稱(股票代號)  → display_name
      2. 操作訊號            → action_signal
      3. 防守價              → defense_price_display
      4. 最小漲幅            → min_target_display
      5. 合理漲幅            → reasonable_target_display
      6. 操作策略            → strategy_display

    Fields default to "待定" if the parser can't extract a value.
    All display fields are editable by the user before import.
    """
    # ── Core identifiers (always set by parser) ──
    ticker: str = Field(..., description="股票代號, e.g. '2393'")
    name: str = Field("", description="股票名稱, e.g. '億光'")

    # ── Raw numeric values (for DB storage / calculations) ──
    defense_price: Optional[float] = Field(None, description="防守價")
    min_target_low: Optional[float] = Field(None, description="最小漲幅下界")
    min_target_high: Optional[float] = Field(None, description="最小漲幅上界")
    reasonable_target_low: Optional[float] = Field(None, description="合理漲幅下界")
    reasonable_target_high: Optional[float] = Field(None, description="合理漲幅上界")
    entry_price: Optional[float] = Field(None, description="建議買進價")
    strategy_notes: str = Field("", description="操作策略備註")
    action_type: str = Field(
        "", description="個股操作類型: buy/sell/hold/institutional"
    )

    # ── Fixed-format display fields (always present, editable) ──
    display_name: str = Field(PENDING, description="股票名稱(股票代號)")
    action_signal: str = Field(PENDING, description="操作訊號")
    defense_price_display: str = Field(PENDING, description="防守價 顯示文字")
    min_target_display: str = Field(PENDING, description="最小漲幅 顯示文字")
    reasonable_target_display: str = Field(PENDING, description="合理漲幅 顯示文字")
    strategy_display: str = Field(PENDING, description="操作策略 顯示文字")

    def fill_display_fields(self) -> None:
        """
        Populate display fields from raw values.
        Called after parsing — any field without data stays "待定".
        """
        # 1. 股票名稱(股票代號)
        if self.name and self.ticker:
            self.display_name = f"{self.name}({self.ticker})"
        elif self.ticker:
            self.display_name = self.ticker
        # else stays "待定"

        # 2. 操作訊號
        if self.action_type:
            self.action_signal = ACTION_SIGNAL_MAP.get(
                self.action_type, self.action_type
            )
        # else stays "待定"

        # 3. 防守價
        if self.defense_price is not None:
            self.defense_price_display = f"{self.defense_price}元"
        # else stays "待定"

        # 4. 最小漲幅
        if self.min_target_low is not None and self.min_target_high is not None:
            self.min_target_display = (
                f"{self.min_target_low}~{self.min_target_high}元"
            )
        elif self.min_target_low is not None:
            self.min_target_display = f"{self.min_target_low}元"
        # else stays "待定"

        # 5. 合理漲幅
        if (self.reasonable_target_low is not None
                and self.reasonable_target_high is not None):
            self.reasonable_target_display = (
                f"{self.reasonable_target_low}~{self.reasonable_target_high}元"
            )
        elif self.reasonable_target_low is not None:
            self.reasonable_target_display = f"{self.reasonable_target_low}元"
        # else stays "待定"

        # 6. 操作策略
        if self.strategy_notes:
            self.strategy_display = self.strategy_notes
        # else stays "待定"


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
    formatted_output: list[dict] = Field(
        default_factory=list,
        description="固定格式輸出，每筆股票包含6個可編輯欄位"
    )


class EditedStock(BaseModel):
    """A stock with user-edited display fields, submitted for import."""
    ticker: str
    name: str = ""
    # Editable display fields
    display_name: str = PENDING
    action_signal: str = PENDING
    defense_price_display: str = PENDING
    min_target_display: str = PENDING
    reasonable_target_display: str = PENDING
    strategy_display: str = PENDING
    # Raw values (may be updated from edited display fields)
    defense_price: Optional[float] = None
    min_target_low: Optional[float] = None
    min_target_high: Optional[float] = None
    reasonable_target_low: Optional[float] = None
    reasonable_target_high: Optional[float] = None
    entry_price: Optional[float] = None
    strategy_notes: str = ""
    action_type: str = ""


class ImportRequest(BaseModel):
    """POST /api/parse/import request body."""
    text: str = Field("", description="原始文字（若用 edited_stocks 可為空）")
    source: NotificationSource = Field(NotificationSource.DASHBOARD)
    user_id: str = Field(..., description="Supabase auth user UUID")
    selected_tickers: list[str] = Field(
        default_factory=list,
        description="只匯入這些 ticker；空表示全部匯入"
    )
    edited_stocks: list[EditedStock] = Field(
        default_factory=list,
        description="手動編輯後的股票資料（優先於 text 解析結果）"
    )


class ImportResponse(BaseModel):
    """POST /api/parse/import response body."""
    success: bool = True
    imported_count: int = 0
    skipped_count: int = 0
    details: list[dict] = Field(default_factory=list)
