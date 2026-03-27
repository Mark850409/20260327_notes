import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # ── Database ─────────────────────────────────────────────
    # Flask reads from Strapi's MySQL database (read-only access)
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://strapi:strapipassword@mysql:3306/strapi_db"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_recycle": 300,
        "pool_pre_ping": True,
        "pool_size": 5,
        "max_overflow": 10,
    }

    # ── Flask ─────────────────────────────────────────────────
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
    DEBUG = os.getenv("FLASK_DEBUG", "0") == "1"

    # ── CORS ──────────────────────────────────────────────────
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")
