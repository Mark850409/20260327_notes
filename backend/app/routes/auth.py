"""前台登入：代理 Strapi users-permissions，並寫入 HttpOnly Cookie。"""
from __future__ import annotations

import os

import requests as http
from flask import jsonify, make_response, request
from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from ..strapi_proxy import NOTES_AUTH_COOKIE

auth_bp = APIBlueprint("auth", __name__, url_prefix="/api")
_tag = Tag(name="Auth", description="Strapi 使用者登入／登出")

STRAPI = os.getenv("STRAPI_URL", "http://strapi:1337")
COOKIE_MAX_AGE = int(os.getenv("NOTES_AUTH_COOKIE_MAX_AGE", str(30 * 24 * 3600)))


def _cookie_secure() -> bool:
    """
    notes_auth 是否加 Secure。NAS 常見錯誤：瀏覽器用 HTTPS，但此處為 False，部分環境會拒收 Cookie；
    或設 True 卻只用 http:// 內網 IP 存取，瀏覽器會直接丟棄 Set-Cookie。
    未設定 FLASK_COOKIE_SECURE 時為 auto：依 X-Forwarded-Proto / is_secure 判斷（需 Nginx 轉發 Proto）。
    """
    raw = os.getenv("FLASK_COOKIE_SECURE", "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    proto = (request.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip().lower()
    if proto == "https":
        return True
    return bool(request.is_secure)


class LoginBody(BaseModel):
    identifier: str = Field(..., min_length=1, description="Email 或使用者名稱")
    password: str = Field(..., min_length=1)


@auth_bp.post("/auth/login", tags=[_tag], summary="登入（寫入 notes_auth Cookie）")
def login(body: LoginBody):
    try:
        r = http.post(
            f"{STRAPI}/api/auth/local",
            json={"identifier": body.identifier.strip(), "password": body.password},
            timeout=20,
        )
        j = r.json() if r.text else {}
    except Exception as e:
        return jsonify({"error": str(e)}), 503

    if r.status_code != 200 or not j.get("jwt"):
        msg = (
            (j.get("error") or {}).get("message")
            if isinstance(j.get("error"), dict)
            else None
        ) or j.get("message") or "帳號或密碼錯誤"
        return jsonify({"error": msg}), 401

    token = j["jwt"]
    resp = make_response(jsonify({"user": j.get("user")}))
    secure = _cookie_secure()
    resp.set_cookie(
        NOTES_AUTH_COOKIE,
        token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="Lax",
        path="/",
        secure=secure,
    )
    return resp


@auth_bp.post("/auth/logout", tags=[_tag], summary="登出（清除 Cookie）")
def logout():
    resp = make_response(jsonify({"ok": True}))
    secure = _cookie_secure()
    resp.delete_cookie(
        NOTES_AUTH_COOKIE,
        path="/",
        secure=secure,
        httponly=True,
        samesite="Lax",
    )
    return resp
