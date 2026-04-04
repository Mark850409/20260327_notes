"""Site profile (Strapi single type) — sidebar copy, social links, license."""
import os
import requests as http
from flask_openapi3 import APIBlueprint, Tag
from flask import jsonify

from ..strapi_proxy import strapi_auth_headers

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


def _resolve_media_url(media_field):
    """Strapi v4/v5 媒體欄位 → 絕對 URL。"""
    if not media_field:
        return ""
    m = media_field
    if isinstance(m, dict):
        if m.get("data") is not None:
            inner = m["data"]
            if isinstance(inner, dict):
                m = inner.get("attributes") or inner
        elif isinstance(m.get("attributes"), dict):
            m = m["attributes"]
        url = m.get("url") or ""
        if not url:
            return ""
        if url.startswith("http://") or url.startswith("https://"):
            return url
        path = url if url.startswith("/") else f"/{url}"
        return f"{STRAPI_PUBLIC_URL}{path}"
    return ""


def _media_url(media):
    return _resolve_media_url(media)


def _posts_per_page(val):
    try:
        n = int(val)
    except (TypeError, ValueError):
        n = 10
    return max(1, min(50, n))


def _unwrap_component(comp):
    """Strapi component 可能為扁平、data 包一層或 attributes。"""
    if comp is None:
        return None
    if not isinstance(comp, dict):
        return None
    if comp.get("data") is not None:
        d = comp["data"]
        if isinstance(d, dict):
            return d.get("attributes") or d
        return None
    if isinstance(comp.get("attributes"), dict):
        return comp["attributes"]
    return comp


def _fmt_hero(comp) -> dict | None:
    """shared.page-hero：coverImage, title, subtitle → 前台用。"""
    c = _unwrap_component(comp)
    if not isinstance(c, dict):
        return None
    title = (c.get("title") or "").strip()
    subtitle = (c.get("subtitle") or "").strip()
    cover_url = _resolve_media_url(c.get("coverImage"))
    if not cover_url and not title and not subtitle:
        return None
    return {"coverUrl": cover_url, "title": title, "subtitle": subtitle}


def _fmt_profile(data: dict) -> dict:
    if not data:
        return {"postsPerPage": 10}
    def _to_int(val, fallback):
        try:
            return int(val)
        except (TypeError, ValueError):
            return fallback
    widgets_enabled = data.get("widgetsEnabled") if isinstance(data.get("widgetsEnabled"), dict) else {}
    widget_titles = data.get("widgetTitles") if isinstance(data.get("widgetTitles"), dict) else {}
    widget_order = data.get("widgetOrder") if isinstance(data.get("widgetOrder"), list) else []
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
        "notesHero": _fmt_hero(data.get("notesHero")),
        "blogHero": _fmt_hero(data.get("blogHero")),
        "articleHero": _fmt_hero(data.get("articleHero")),
        "widgetConfig": {
            "enabled": widgets_enabled,
            "titles": widget_titles,
            "order": widget_order,
            "archiveLimit": _to_int(data.get("archiveLimit"), 12),
            "tagCloudLimit": _to_int(data.get("tagCloudLimit"), 30),
            "categoryTreeDepth": _to_int(data.get("categoryTreeDepth"), 4),
            "calendarStartWeekOn": data.get("calendarStartWeekOn") or "sunday",
            "calendarShowOutsideDays": bool(
                True if data.get("calendarShowOutsideDays") is None else data.get("calendarShowOutsideDays")
            ),
            "siteLaunchDate": data.get("siteLaunchDate"),
            "siteTimezone": (data.get("siteTimezone") or "Asia/Taipei").strip() or "Asia/Taipei",
            "plausibleSharedLink": data.get("plausibleSharedLink") or "",
            "plausibleSiteDomain": data.get("plausibleSiteDomain") or "",
            "weather": {
                "provider": data.get("weatherProvider") or "open-meteo",
                "city": data.get("weatherCity") or "",
                "latitude": data.get("weatherLatitude"),
                "longitude": data.get("weatherLongitude"),
                "tempUnit": data.get("weatherTempUnit") or "celsius",
            },
        },
    }


@site_profile_bp.get("/site-profile", tags=[_tag], summary="Get site profile (sidebar)")
def get_site_profile():
    try:
        resp = http.get(
            f"{STRAPI}/api/site-profile",
            params={
                "populate[avatar]": "true",
                "populate[socialLinks]": "true",
                "populate[notesHero][populate][0]": "coverImage",
                "populate[blogHero][populate][0]": "coverImage",
                "populate[articleHero][populate][0]": "coverImage",
            },
            headers=strapi_auth_headers(),
            timeout=10,
        )
        if resp.status_code in (401, 403):
            return jsonify({"error": "unauthorized", "data": {}}), 401
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
