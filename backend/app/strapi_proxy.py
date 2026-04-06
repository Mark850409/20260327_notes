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
    # 使用 Werkzeug 解析的 Cookie（RFC 6265：引號、轉義、編碼），避免手動 split 導致 JWT 含引號時 Strapi 回 401。
    token = request.cookies.get(NOTES_AUTH_COOKIE)
    if token:
        h["Authorization"] = f"Bearer {token.strip()}"
    return h
