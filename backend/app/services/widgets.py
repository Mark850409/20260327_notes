"""Widget data aggregation service."""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests as http

from ..strapi_proxy import strapi_auth_headers

STRAPI = os.getenv("STRAPI_URL", "http://strapi:1337")
PLAUSIBLE_API_KEY = os.getenv("PLAUSIBLE_API_KEY", "").strip()
PLAUSIBLE_SITE_ID = os.getenv("PLAUSIBLE_SITE_ID", "").strip()


def _as_attrs(item):
    if isinstance(item, dict) and "attributes" in item:
        return item.get("attributes") or {}
    return item if isinstance(item, dict) else {}


def _relation_id(val):
    if isinstance(val, dict):
        if val.get("id") is not None:
            return val.get("id")
        if isinstance(val.get("data"), dict):
            return val["data"].get("id")
    return None


def _pick_datetime(item, include_created_fallback=False):
    """Support Strapi v4/v5 flattened and attributes styles."""
    src = _as_attrs(item)
    pub = (
        src.get("publishedAt")
        or src.get("published_at")
        or (item.get("publishedAt") if isinstance(item, dict) else None)
        or (item.get("published_at") if isinstance(item, dict) else None)
    )
    if pub:
        return pub
    if include_created_fallback:
        return (
            src.get("createdAt")
            or src.get("created_at")
            or (item.get("createdAt") if isinstance(item, dict) else None)
            or (item.get("created_at") if isinstance(item, dict) else None)
        )
    return None


def _safe_parse_dt(val):
    if not val:
        return None
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except Exception:
        return None


def _relation_list(val):
    """Normalize relation collections from Strapi responses."""
    if isinstance(val, list):
        return val
    if isinstance(val, dict):
        data = val.get("data")
        if isinstance(data, list):
            return data
    return []


def _fetch_json(path, params=None, timeout=10):
    res = http.get(
        f"{STRAPI}{path}",
        params=params or {},
        headers=strapi_auth_headers(),
        timeout=timeout,
    )
    if res.status_code in (401, 403):
        raise PermissionError("unauthorized")
    res.raise_for_status()
    return res.json()


def _fetch_all(path, params=None, page_size=200):
    p = dict(params or {})
    p["pagination[page]"] = 1
    p["pagination[pageSize]"] = page_size
    all_items = []
    while True:
        body = _fetch_json(path, p)
        items = body.get("data") or []
        all_items.extend(items)
        pag = body.get("meta", {}).get("pagination", {}) or {}
        cur = int(pag.get("page", p["pagination[page]"]))
        total_pages = int(pag.get("pageCount", 1))
        if cur >= total_pages:
            break
        p["pagination[page]"] = cur + 1
    return all_items


def get_site_profile_attrs():
    body = _fetch_json("/api/site-profile")
    raw = body.get("data") or {}
    return _as_attrs(raw)


def build_archive(limit=12):
    rows = _fetch_all(
        "/api/articles",
        {"fields[0]": "publishedAt", "fields[1]": "createdAt", "sort": "publishedAt:desc"},
        page_size=300,
    )
    counter = defaultdict(int)
    for it in rows:
        raw_dt = _pick_datetime(it, include_created_fallback=True)
        d = _safe_parse_dt(raw_dt)
        if not d:
            continue
        key = (d.year, d.month)
        counter[key] += 1

    pairs = sorted(counter.items(), key=lambda x: (x[0][0], x[0][1]), reverse=True)
    out = []
    for (year, month), count in pairs[: max(1, int(limit or 12))]:
        out.append(
            {
                "year": year,
                "month": month,
                "label": f"{year}年{month:02d}月",
                "period": f"{year}-{month:02d}",
                "count": count,
            }
        )
    return out


def build_tag_cloud(limit=30):
    # Prefer aggregating from articles, because some Strapi setups
    # may not expose /api/tags consistently while article tags still exist.
    article_rows = _fetch_all(
        "/api/articles",
        {
            "fields[0]": "id",
            "populate[tags][fields][0]": "name",
            "populate[tags][fields][1]": "slug",
        },
        page_size=500,
    )

    counter = {}

    def _add_tag(name, slug="", tag_id=None):
        key = str(tag_id) if tag_id is not None else (slug or name).strip().lower()
        if not key:
            return
        if key not in counter:
            counter[key] = {
                "id": tag_id,
                "name": name or slug or "",
                "slug": slug or "",
                "count": 0,
                "kind": "tag",
            }
        counter[key]["count"] += 1

    for a in article_rows:
        tags = (a or {}).get("tags")
        # relation form
        for t in _relation_list(tags):
            attrs = _as_attrs(t)
            _add_tag(attrs.get("name") or t.get("name"), attrs.get("slug") or t.get("slug"), t.get("id"))

        # custom-field form fallback (array of strings/dicts)
        if isinstance(tags, list):
            for t in tags:
                if isinstance(t, str):
                    _add_tag(t, t)
                elif isinstance(t, dict):
                    _add_tag(t.get("name") or t.get("label") or t.get("value"), t.get("slug") or "")

    tags_list = [v for v in counter.values() if v.get("name")]
    tags_list.sort(key=lambda x: (-x["count"], (x["name"] or "").lower()))
    if tags_list:
        return tags_list[: max(1, int(limit or 30))]

    # Fallback: no tag data yet, use categories as tag-like pills.
    category_rows = _fetch_all(
        "/api/categories",
        {
            "fields[0]": "name",
            "fields[1]": "slug",
            "populate[articles][fields][0]": "id",
            "sort": "name:asc",
        },
        page_size=300,
    )
    fallback = []
    for c in category_rows:
        items = _relation_list((c or {}).get("articles"))
        fallback.append(
            {
                "id": c.get("id"),
                "name": c.get("name") or "",
                "slug": c.get("slug") or "",
                "count": len(items),
                "kind": "category",
            }
        )
    fallback = [x for x in fallback if x.get("name")]
    fallback.sort(key=lambda x: (-x["count"], (x["name"] or "").lower()))
    return fallback[: max(1, int(limit or 30))]


def build_category_tree(depth=4):
    rows = _fetch_all(
        "/api/categories",
        {
            "fields[0]": "name",
            "fields[1]": "slug",
            "populate[parent][fields][0]": "id",
            "populate[articles][fields][0]": "id",
            "sort": "name:asc",
        },
        page_size=300,
    )

    article_rows = _fetch_all(
        "/api/articles",
        {
            "fields[0]": "id",
            "populate[category][fields][0]": "id",
        },
        page_size=500,
    )
    count_by_category_id = defaultdict(int)
    for a in article_rows:
        cat = (a or {}).get("category")
        cid = _relation_id(cat)
        if cid is not None:
            count_by_category_id[cid] += 1

    nodes = {}
    for c in rows:
        cid = c.get("id")
        nodes[c.get("id")] = {
            "id": cid,
            "name": c.get("name") or "",
            "slug": c.get("slug") or "",
            "count": int(count_by_category_id.get(cid, 0)),
            "parentId": _relation_id((c or {}).get("parent")),
            "children": [],
        }

    roots = []
    for _, node in nodes.items():
        pid = node["parentId"]
        if pid and pid in nodes:
            nodes[pid]["children"].append(node)
        else:
            roots.append(node)

    def trim(n, max_depth, current=1):
        out = {k: v for k, v in n.items() if k != "parentId"}
        out["children"] = []
        if current < max_depth:
            out["children"] = [trim(x, max_depth, current + 1) for x in n["children"]]
        return out

    max_depth = max(1, int(depth or 4))
    return [trim(r, max_depth) for r in roots]


def build_post_calendar(year=None, month=None, timezone_name="Asia/Taipei"):
    tz = ZoneInfo(timezone_name or "Asia/Taipei")
    now = datetime.now(tz)
    y = int(year or now.year)
    m = int(month or now.month)
    start = datetime(y, m, 1, tzinfo=tz)
    next_month = datetime(y + (1 if m == 12 else 0), 1 if m == 12 else m + 1, 1, tzinfo=tz)

    rows = _fetch_all(
        "/api/articles",
        {
            "fields[0]": "publishedAt",
            "filters[publishedAt][$gte]": start.isoformat(),
            "filters[publishedAt][$lt]": next_month.isoformat(),
            "pagination[pageSize]": 500,
        },
        page_size=500,
    )
    days = defaultdict(int)
    for it in rows:
        raw_dt = _pick_datetime(it, include_created_fallback=False)
        d = _safe_parse_dt(raw_dt)
        if not d:
            continue
        d = d.astimezone(tz)
        days[d.day] += 1
    return {
        "year": y,
        "month": m,
        "days": [{"day": k, "count": v} for k, v in sorted(days.items(), key=lambda x: x[0])],
    }


def _fetch_plausible(site_id):
    if not site_id or not PLAUSIBLE_API_KEY:
        return {}
    try:
        r = http.get(
            "https://plausible.io/api/v1/stats/aggregate",
            params={
                "site_id": site_id,
                "period": "30d",
                "metrics": "visitors,visits,pageviews",
            },
            headers={"Authorization": f"Bearer {PLAUSIBLE_API_KEY}"},
            timeout=8,
        )
        r.raise_for_status()
        body = r.json() or {}
        results = body.get("results") or {}
        return {
            "visitors": results.get("visitors"),
            "visits": results.get("visits"),
            "pageviews": results.get("pageviews"),
        }
    except Exception:
        return {}


def build_site_stats(profile_attrs):
    p = _fetch_json("/api/articles", {"pagination[page]": 1, "pagination[pageSize]": 1})
    total_posts = int(((p.get("meta") or {}).get("pagination") or {}).get("total", 0))

    timezone_name = (profile_attrs.get("siteTimezone") or "Asia/Taipei").strip() or "Asia/Taipei"
    tz = ZoneInfo(timezone_name)
    launch_date = profile_attrs.get("siteLaunchDate")
    running_days = 0
    if launch_date:
        try:
            d = datetime.fromisoformat(str(launch_date)).replace(tzinfo=tz)
            running_days = max(0, (datetime.now(tz).date() - d.date()).days)
        except Exception:
            running_days = 0

    site_id = (profile_attrs.get("plausibleSiteDomain") or "").strip() or PLAUSIBLE_SITE_ID
    plausible = _fetch_plausible(site_id)
    return {
        "posts": total_posts,
        "runningDays": running_days,
        "visitors": plausible.get("visitors"),
        "visits": plausible.get("visits"),
        "pageviews": plausible.get("pageviews"),
    }


def _resolve_coords(profile_attrs):
    lat = profile_attrs.get("weatherLatitude")
    lon = profile_attrs.get("weatherLongitude")
    try:
        if lat is not None and lon is not None:
            return float(lat), float(lon), profile_attrs.get("weatherCity") or ""
    except Exception:
        pass

    city = (profile_attrs.get("weatherCity") or "").strip()
    if not city:
        return None, None, ""
    try:
        geo = http.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": city, "count": 1, "language": "zh", "format": "json"},
            timeout=8,
        )
        geo.raise_for_status()
        first = ((geo.json() or {}).get("results") or [None])[0]
        if not first:
            return None, None, city
        return float(first.get("latitude")), float(first.get("longitude")), first.get("name") or city
    except Exception:
        return None, None, city


def build_weather(profile_attrs):
    if (profile_attrs.get("weatherProvider") or "open-meteo") != "open-meteo":
        return {}
    lat, lon, resolved_city = _resolve_coords(profile_attrs)
    if lat is None or lon is None:
        return {}

    unit = (profile_attrs.get("weatherTempUnit") or "celsius").strip().lower()
    temp_param = "temperature_unit=fahrenheit" if unit == "fahrenheit" else "temperature_unit=celsius"
    try:
        w = http.get(
            f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code,wind_speed_10m&{temp_param}",
            timeout=8,
        )
        w.raise_for_status()
        cur = (w.json() or {}).get("current") or {}
        return {
            "city": resolved_city or profile_attrs.get("weatherCity") or "",
            "temperature": cur.get("temperature_2m"),
            "temperatureUnit": "F" if unit == "fahrenheit" else "C",
            "windSpeed": cur.get("wind_speed_10m"),
            "weatherCode": cur.get("weather_code"),
            "updatedAt": datetime.utcnow().isoformat() + "Z",
        }
    except Exception:
        return {}
