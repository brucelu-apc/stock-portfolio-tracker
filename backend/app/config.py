"""
Application configuration — loads from environment variables.
"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Central configuration loaded from environment variables."""

    # --- Supabase ---
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""

    # --- LINE Messaging API ---
    LINE_CHANNEL_ACCESS_TOKEN: str = ""
    LINE_CHANNEL_SECRET: str = ""

    # --- Telegram Bot ---
    TELEGRAM_BOT_TOKEN: str = ""

    # --- OpenClaw (legacy, backup) ---
    OPENCLAW_GATEWAY_URL: str = ""
    OPENCLAW_GATEWAY_TOKEN: str = ""
    NOTIFICATION_TARGET_ID: str = ""

    # --- Monitor settings ---
    MONITOR_INTERVAL_SECONDS: int = 30
    MARKET_OPEN_TIME: str = "09:00"
    MARKET_CLOSE_TIME: str = "13:30"

    # --- CORS ---
    FRONTEND_URL: str = "http://localhost:5173"

    # --- SMTP Email (for admin registration notifications) ---
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 465
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_FROM_NAME: str = "Stock Dango"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
