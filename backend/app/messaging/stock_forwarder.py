"""
Stock Forwarder — Forward advisory stock info to contacts & groups.
====================================================================

Fan-out forwarding to LINE and Telegram targets.

Flow:
  1. User selects stocks from parsed advisory results
  2. User picks forward targets (LINE friends, LINE groups, TG contacts, TG groups)
  3. ForwardRequest hits POST /api/forward
  4. This module sends formatted messages to each target
  5. Logs each forward in forward_logs table

Supported platforms:
  - LINE: push via LINE Messaging API (consumes quota!)
  - Telegram: send via Telegram Bot API (unlimited)
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import get_settings

logger = logging.getLogger(__name__)
TST = ZoneInfo("Asia/Taipei")

router = APIRouter()


# ─── Request/Response Models ────────────────────────────────

class ForwardStock(BaseModel):
    """A stock to include in the forwarded message."""
    ticker: str
    name: str = ""
    defense_price: Optional[float] = None
    min_target_low: Optional[float] = None
    min_target_high: Optional[float] = None
    reasonable_target_low: Optional[float] = None
    reasonable_target_high: Optional[float] = None
    entry_price: Optional[float] = None


class ForwardTarget(BaseModel):
    """A forward destination."""
    forward_target_id: Optional[str] = Field(
        None, description="UUID from forward_targets table"
    )
    platform: str = Field(..., description="'line' or 'telegram'")
    target_id: str = Field(..., description="LINE user ID or Telegram chat ID")
    target_name: str = Field("", description="Display name for logging")


class ForwardRequest(BaseModel):
    """POST /api/forward request body."""
    user_id: str = Field(..., description="Supabase auth user UUID")
    stocks: list[ForwardStock] = Field(
        ..., min_length=1, description="Stocks to forward"
    )
    targets: list[ForwardTarget] = Field(
        ..., min_length=1, description="Forward destinations"
    )
    sender_name: str = Field("Stock Tracker", description="Sender display name")


class ForwardResult(BaseModel):
    """Result for a single forward target."""
    target_name: str
    platform: str
    success: bool
    error: str = ""


class ForwardResponse(BaseModel):
    """POST /api/forward response body."""
    success: bool = True
    total_targets: int = 0
    sent_count: int = 0
    failed_count: int = 0
    results: list[ForwardResult] = Field(default_factory=list)


# ─── API Endpoint ───────────────────────────────────────────

@router.post("/api/forward", response_model=ForwardResponse)
async def forward_stocks(req: ForwardRequest):
    """
    Forward selected stock information to LINE/Telegram targets.

    Sends formatted messages to each target and logs the forward.
    """
    results: list[ForwardResult] = []
    sent = 0
    failed = 0

    for target in req.targets:
        try:
            ok = await _send_to_target(
                platform=target.platform,
                target_id=target.target_id,
                stocks=[s.model_dump() for s in req.stocks],
                sender_name=req.sender_name,
            )

            if ok:
                sent += 1
                results.append(ForwardResult(
                    target_name=target.target_name,
                    platform=target.platform,
                    success=True,
                ))

                # Log successful forward
                await _log_forward(
                    user_id=req.user_id,
                    forward_target_id=target.forward_target_id,
                    tickers=[s.ticker for s in req.stocks],
                    stocks=[s.model_dump() for s in req.stocks],
                )
            else:
                failed += 1
                results.append(ForwardResult(
                    target_name=target.target_name,
                    platform=target.platform,
                    success=False,
                    error="Send failed",
                ))

        except Exception as e:
            failed += 1
            results.append(ForwardResult(
                target_name=target.target_name,
                platform=target.platform,
                success=False,
                error=str(e)[:100],
            ))
            logger.error(
                f"Forward error to {target.platform}/{target.target_name}: {e}"
            )

    return ForwardResponse(
        success=sent > 0,
        total_targets=len(req.targets),
        sent_count=sent,
        failed_count=failed,
        results=results,
    )


# ─── Forward Targets CRUD ──────────────────────────────────

@router.get("/api/forward/targets")
async def get_forward_targets(user_id: str):
    """Get all forward targets for a user."""
    try:
        from supabase import create_client
        settings = get_settings()
        supabase = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,
        )

        res = (
            supabase.table("forward_targets")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=False)
            .execute()
        )
        return {"targets": res.data}

    except Exception as e:
        logger.error(f"Get forward targets error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/forward/targets")
async def add_forward_target(
    user_id: str,
    platform: str,
    target_id: str,
    target_name: str,
    target_type: str = "user",
    is_default: bool = False,
):
    """Add a new forward target."""
    if platform not in ("line", "telegram"):
        raise HTTPException(status_code=400, detail="Platform must be 'line' or 'telegram'")
    if target_type not in ("user", "group"):
        raise HTTPException(status_code=400, detail="Target type must be 'user' or 'group'")

    try:
        from supabase import create_client
        settings = get_settings()
        supabase = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,
        )

        res = supabase.table("forward_targets").upsert(
            {
                "user_id": user_id,
                "platform": platform,
                "target_id": target_id,
                "target_name": target_name,
                "target_type": target_type,
                "is_default": is_default,
            },
            on_conflict="user_id,platform,target_id",
        ).execute()

        return {"success": True, "target": res.data[0] if res.data else None}

    except Exception as e:
        logger.error(f"Add forward target error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/forward/targets/{target_id}")
async def delete_forward_target(target_id: str, user_id: str):
    """Delete a forward target."""
    try:
        from supabase import create_client
        settings = get_settings()
        supabase = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,
        )

        supabase.table("forward_targets").delete().eq(
            "id", target_id
        ).eq("user_id", user_id).execute()

        return {"success": True}

    except Exception as e:
        logger.error(f"Delete forward target error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Forward History ────────────────────────────────────────

@router.get("/api/forward/logs")
async def get_forward_logs(user_id: str, limit: int = 20):
    """Get recent forward logs for a user."""
    try:
        from supabase import create_client
        settings = get_settings()
        supabase = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,
        )

        res = (
            supabase.table("forward_logs")
            .select("*, forward_targets(target_name, platform)")
            .eq("user_id", user_id)
            .order("forwarded_at", desc=True)
            .limit(limit)
            .execute()
        )
        return {"logs": res.data}

    except Exception as e:
        logger.error(f"Get forward logs error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Internal Helpers ───────────────────────────────────────

async def _send_to_target(
    platform: str,
    target_id: str,
    stocks: list[dict],
    sender_name: str = "Stock Tracker",
) -> bool:
    """Route message to the correct platform sender."""

    if platform == "telegram":
        from app.messaging.telegram_notifier import send_forward_message
        return await send_forward_message(
            chat_id=target_id,
            stocks=stocks,
            sender_name=sender_name,
        )

    elif platform == "line":
        from app.messaging.line_notifier import send_forward_push
        return await send_forward_push(
            to=target_id,
            stocks=stocks,
            sender_name=sender_name,
        )

    else:
        logger.warning(f"Unknown platform: {platform}")
        return False


async def _log_forward(
    user_id: str,
    forward_target_id: Optional[str],
    tickers: list[str],
    stocks: list[dict],
):
    """Log a successful forward to forward_logs table."""
    try:
        from supabase import create_client
        settings = get_settings()
        supabase = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,
        )

        insert_data: dict = {
            "user_id": user_id,
            "tickers": tickers,
            "message_content": {"stocks": stocks},
        }
        if forward_target_id:
            insert_data["forward_target_id"] = forward_target_id

        supabase.table("forward_logs").insert(insert_data).execute()
        logger.info(f"Forward logged: {len(tickers)} tickers to {forward_target_id}")

    except Exception as e:
        logger.error(f"Forward log error: {e}")
