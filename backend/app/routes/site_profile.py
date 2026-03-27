"""Site profile (Strapi single type) — sidebar copy, social links, license."""
import os
import requests as http
from flask_openapi3 import APIBlueprint, Tag
from flask import jsonify

site_profile_bp = APIBlueprint("site_profile", __name__, url_prefix="/api")
_tag = Tag(name="SiteProfile", description="Site sidebar profile from Strapi")

STRAPI = os.getenv("STRAPI_URL", "http://strapi:1337")
STRAPI_PUBLIC_URL = os.getenv("STRAPI_PUBLIC_URL", "http://localhost:1337").rstrip("/")


def _flatten_social(items):
    out = []
    for x in items or []:
        if not isinstance(x, dict):
            continue
        n = x.get("attributes") or x
        out.append(
            {
                "label": n.get("label") or x.get("label") or "",
                "url": n.get("url") or x.get("url") or "",
                "iconKey": (n.get("iconKey") or x.get("iconKey") or "link").strip() or "link",
            }
        )
    return out


def _license_html(val):
    if val is None:
        return ""
    if isinstance(val, str):
        return val
    if isinstance(val, list):
        # Strapi blocks → rough text fallback
        parts = []
        for b in val:
            if isinstance(b, dict) and b.get("children"):
                for c in b["children"]:
                    if isinstance(c, dict) and c.get("text"):
                        parts.append(c["text"])
        return "".join(parts)
    return str(val)


def _media_url(media):
    if not isinstance(media, dict):
        return ""
    n = media.get("attributes") or media
    url = n.get("url") or ""
    if not url:
        return ""
    if url.startswith("http://") or url.startswith("https://"):
        return url
    path = url if url.startswith("/") else f"/{url}"
    return f"{STRAPI_PUBLIC_URL}{path}"


def _posts_per_page(val):
    try:
        n = int(val)
    except (TypeError, ValueError):
        n = 10
    return max(1, min(50, n))


def _fmt_profile(data: dict) -> dict:
    if not data:
        return {"postsPerPage": 10}
    return {
        "authorLabel": data.get("authorLabel") or "",
        "displayName": data.get("displayName") or "",
        "siteTitle": data.get("siteTitle") or "",
        "motto": data.get("motto") or "",
        "quote": data.get("quote") or "",
        "quoteSource": data.get("quoteSource") or "",
        "avatarUrl": _media_url(data.get("avatar")),
        "socialLinks": _flatten_social(data.get("socialLinks")),
        "licenseImageUrl": data.get("licenseImageUrl") or "",
        "licenseHtml": _license_html(data.get("licenseHtml")),
        "postsPerPage": _posts_per_page(data.get("postsPerPage")),
    }


@site_profile_bp.get("/site-profile", tags=[_tag], summary="Get site profile (sidebar)")
def get_site_profile():
    try:
        resp = http.get(
            f"{STRAPI}/api/site-profile",
            params={"populate": "*"},
            timeout=10,
        )
        resp.raise_for_status()
        body = resp.json()
    except Exception as e:
        return jsonify({"data": {}, "meta": {"error": str(e)}}), 200

    raw = body.get("data")
    if not raw:
        return jsonify({"data": {}}), 200

    if isinstance(raw, dict) and "attributes" in raw:
        attrs = raw.get("attributes") or {}
    else:
        attrs = raw if isinstance(raw, dict) else {}

    if attrs.get("socialLinks") is None:
        attrs["socialLinks"] = []

    return jsonify({"data": _fmt_profile(attrs)}), 200
