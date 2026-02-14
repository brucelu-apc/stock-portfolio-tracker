"""
SMTP email sender — uses Python stdlib (no extra dependencies).

Usage:
    from app.email.sender import send_registration_notify
    await send_registration_notify(settings, to_emails, user_info)
"""
import logging
import smtplib
import asyncio
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from concurrent.futures import ThreadPoolExecutor
from typing import List

logger = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=2)


def _send_email_sync(
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_pass: str,
    from_name: str,
    to_emails: List[str],
    subject: str,
    body_html: str,
) -> None:
    """Blocking SMTP send — runs in thread pool."""
    msg = MIMEMultipart("alternative")
    msg["From"] = f"{from_name} <{smtp_user}>"
    msg["Subject"] = subject
    msg["To"] = ", ".join(to_emails)
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    with smtplib.SMTP_SSL(smtp_host, smtp_port) as server:
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_user, to_emails, msg.as_string())


async def send_email(
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_pass: str,
    from_name: str,
    to_emails: List[str],
    subject: str,
    body_html: str,
) -> bool:
    """Async wrapper for SMTP send."""
    if not to_emails:
        logger.warning("No recipients — skipping email")
        return False

    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(
            _executor,
            _send_email_sync,
            smtp_host,
            smtp_port,
            smtp_user,
            smtp_pass,
            from_name,
            to_emails,
            subject,
            body_html,
        )
        logger.info(f"Email sent to {len(to_emails)} recipients: {subject}")
        return True
    except Exception as e:
        logger.error(f"Email send failed: {e}")
        return False


async def send_registration_notify(settings, to_emails: List[str], user_info: dict) -> bool:
    """
    Send new-user registration notification to admin list.

    user_info keys: email, display_name, phone, company, notes
    """
    subject = f"[Stock Dango] 新用戶註冊通知 — {user_info.get('display_name', '(未填)')} ({user_info.get('email', '')})"

    body_html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0ea5e9, #0369a1); padding: 24px; border-radius: 12px 12px 0 0;">
            <h2 style="color: white; margin: 0;">Stock Dango — 新用戶註冊通知</h2>
        </div>
        <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 8px 0; color: #64748b; width: 100px;">Email</td>
                    <td style="padding: 8px 0; font-weight: bold;">{user_info.get('email', '-')}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #64748b;">姓名</td>
                    <td style="padding: 8px 0; font-weight: bold;">{user_info.get('display_name', '-')}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #64748b;">電話</td>
                    <td style="padding: 8px 0;">{user_info.get('phone', '-')}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #64748b;">公司</td>
                    <td style="padding: 8px 0;">{user_info.get('company', '-')}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #64748b;">備註</td>
                    <td style="padding: 8px 0;">{user_info.get('notes', '-')}</td>
                </tr>
            </table>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                請前往管理後台審核此用戶的帳號狀態。
            </p>
        </div>
    </div>
    """

    return await send_email(
        smtp_host=settings.SMTP_HOST,
        smtp_port=settings.SMTP_PORT,
        smtp_user=settings.SMTP_USER,
        smtp_pass=settings.SMTP_PASS,
        from_name=settings.SMTP_FROM_NAME,
        to_emails=to_emails,
        subject=subject,
        body_html=body_html,
    )
