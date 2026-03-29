"""前台登入：代理 Strapi users-permissions，並寫入 HttpOnly Cookie。"""
from __future__ import annotations

import os

import requests as http
from flask import jsonify, make_response
from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from ..strapi_proxy import NOTES_AUTH_COOKIE

auth_bp = APIBlueprint("auth", __name__, url_prefix="/api")
_tag = Tag(name="Auth", description="Strapi 使用者登入／登出")

STRAPI = os.getenv("STRAPI_URL", "http://strapi:1337")
COOKIE_MAX_AGE = int(os.getenv("NOTES_AUTH_COOKIE_MAX_AGE", str(30 * 24 * 3600)))
COOKIE_SECURE = os.getenv("FLASK_COOKIE_SECURE", "0").strip() == "1"


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
    resp.set_cookie(
        NOTES_AUTH_COOKIE,
        token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="Lax",
        path="/",
        secure=COOKIE_SECURE,
    )
    return resp


@auth_bp.post("/auth/logout", tags=[_tag], summary="登出（清除 Cookie）")
def logout():
    resp = make_response(jsonify({"ok": True}))
    resp.delete_cookie(NOTES_AUTH_COOKIE, path="/")
    return resp
