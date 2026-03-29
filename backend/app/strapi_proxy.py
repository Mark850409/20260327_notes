"""從 Flask 請求取出 Strapi 使用者 JWT，轉成轉發 Strapi 用的 Authorization 標頭。"""
from __future__ import annotations

from flask import request

NOTES_AUTH_COOKIE = "notes_auth"


def strapi_auth_headers() -> dict:
    h: dict[str, str] = {}
    auth = request.headers.get("Authorization")
    if auth and auth.strip():
        h["Authorization"] = auth.strip()
        return h
    cookie = request.headers.get("Cookie") or ""
    for part in cookie.split(";"):
        part = part.strip()
        if part.startswith(f"{NOTES_AUTH_COOKIE}="):
            token = part.split("=", 1)[1].strip()
            if token:
                h["Authorization"] = f"Bearer {token}"
            break
    return h
