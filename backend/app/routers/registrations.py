"""
Registration notification router — sends email to admin list when a new user registers.

Endpoint:
  POST /api/registrations/notify
"""
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client

from app.config import get_settings
from app.email.sender import send_registration_notify

logger = logging.getLogger(__name__)
router = APIRouter()


class NotifyRequest(BaseModel):
    user_id: str
    email: str
    display_name: str = ""
    phone: str = ""
    company: str = ""
    notes: str = ""


@router.post("/registrations/notify")
async def notify_admins_of_registration(req: NotifyRequest):
    """
    Send email notification to all active admin emails
    about a new user registration.
    """
    settings = get_settings()

    # Check SMTP is configured
    if not settings.SMTP_USER or not settings.SMTP_PASS:
        logger.warning("SMTP not configured — skipping registration email")
        return {
            "success": False,
            "reason": "SMTP not configured",
            "sent_count": 0,
        }

    # Fetch active admin emails from Supabase
    try:
        sb = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
        result = sb.table("admin_email_config").select("email").eq("is_active", True).execute()
        to_emails = [row["email"] for row in (result.data or [])]
    except Exception as e:
        logger.error(f"Failed to fetch admin emails: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch admin emails: {e}")

    if not to_emails:
        logger.info("No active admin emails configured — skipping notification")
        return {
            "success": True,
            "reason": "No admin emails configured",
            "sent_count": 0,
        }

    # Send email
    user_info = {
        "email": req.email,
        "display_name": req.display_name,
        "phone": req.phone,
        "company": req.company,
        "notes": req.notes,
    }

    ok = await send_registration_notify(settings, to_emails, user_info)

    return {
        "success": ok,
        "sent_count": len(to_emails) if ok else 0,
        "recipients": to_emails if ok else [],
    }
