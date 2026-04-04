"""Articles routes — proxies Strapi v5 REST API."""
import math
import os
import re
from typing import Optional

import markdown as md_lib
import requests as http
from flask import jsonify
from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field, field_validator

from ..strapi_proxy import strapi_auth_headers

articles_bp = APIBlueprint("articles", __name__, url_prefix="/api")
_tag = Tag(name="Articles", description="Article listing and search")

STRAPI = os.getenv("STRAPI_URL", "http://strapi:1337")


class ArticleListQuery(BaseModel):
    page: int = Field(1, ge=1)
    limit: int = Field(10, ge=1, le=100)
    q: Optional[str] = Field(None)
    category: Optional[str] = Field(None)
    tag: Optional[str] = Field(None)
    sort: str = Field("title", description="title|published_at|category|word_count|reading_time")
    order: str = Field("asc", description="asc|desc")

    @field_validator("sort", mode="before")
    @classmethod
    def _coerce_sort(cls, v):
        allowed = {"title", "published_at", "category", "word_count", "reading_time"}
        s = (str(v).strip().lower() if v is not None else "") or "title"
        return s if s in allowed else "title"

    @field_validator("order", mode="before")
    @classmethod
    def _coerce_order(cls, v):
        o = (str(v).strip().lower() if v is not None else "") or "asc"
        return o if o in ("asc", "desc") else "asc"


def _unwrap(val):
    if not isinstance(val, dict):
        return {}
    if isinstance(val.get("attributes"), dict):
        return val.get("attributes") or {}
    if isinstance(val.get("data"), dict):
        d = val.get("data") or {}
        if isinstance(d.get("attributes"), dict):
            return d.get("attributes") or {}
        return d
    return val


def _flatten_strapi_entry(item: dict) -> dict:
    """Strapi v4 風格 { id, attributes } → 扁平；v5 已扁平則原樣回傳。"""
    if not isinstance(item, dict):
        return {}
    attrs = item.get("attributes")
    if isinstance(attrs, dict):
        out = dict(attrs)
        if item.get("id") is not None:
            out["id"] = item["id"]
        if item.get("documentId") is not None:
            out["documentId"] = item["documentId"]
        return out
    return item


def _fmt(item: dict) -> dict:
    """Transform Strapi item → our flat format."""
    item = _flatten_strapi_entry(item)
    cat_raw = _unwrap(item.get("category"))
    cat = {"id": cat_raw.get("id"), "name": cat_raw.get("name"), "slug": cat_raw.get("slug")} if cat_raw else None

    owner_raw = _unwrap(item.get("owner"))
    author = (
        owner_raw.get("username")
        or owner_raw.get("displayName")
        or owner_raw.get("firstname")
        or owner_raw.get("email")
        or ""
    )

    tags = item.get("tags")
    tags_items = []
    if isinstance(tags, dict) and isinstance(tags.get("data"), list):
        tags_items = tags.get("data") or []
    elif isinstance(tags, list):
        tags_items = tags
    tags_fmt = []
    for t in tags_items:
        x = _unwrap(t)
        tags_fmt.append({"id": x.get("id"), "name": x.get("name"), "slug": x.get("slug")})

    published = item.get("publishedAt") or item.get("published_at")
    if not published:
        published = item.get("createdAt") or item.get("created_at")

    return {
        "id": item.get("id"),
        "document_id": item.get("documentId"),
        "title": item.get("title"),
        "slug": item.get("slug"),
        "description": item.get("description"),
        "content": item.get("content") or "",
        "published_at": published,
        "created_at": item.get("createdAt"),
        "updated_at": item.get("updatedAt"),
        "category": cat,
        "tags": tags_fmt,
        "author": author,
    }


def _fetch_me_author(headers: dict) -> str:
    """Fallback current user display name for owner-scoped listings."""
    try:
        r = http.get(f"{STRAPI}/api/users/me", headers=headers, timeout=10)
        if r.status_code in (401, 403):
            return ""
        r.raise_for_status()
        me = r.json() or {}
        return me.get("username") or me.get("email") or ""
    except Exception:
        return ""


def _fmt_with_content(item: dict) -> dict:
    item = _flatten_strapi_entry(item)
    d = _fmt(item)
    raw = item.get("content") or ""
    d["content"] = raw
    d["html_content"] = md_lib.markdown(
        raw,
        extensions=["extra", "codehilite", "toc", "tables", "fenced_code"],
        extension_configs={"codehilite": {"css_class": "highlight", "guess_lang": False}},
    )
    return d


def _strip_mdish_for_count(raw: str) -> str:
    if not raw:
        return ""
    text = re.sub(r"```[\s\S]*?```", " ", raw)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", text)
    text = re.sub(r"\[[^\]]*\]\([^)]+\)", " ", text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)
    return " ".join(text.split())


def _count_readable_units_from_article_parts(content: str, description: str, title: str) -> int:
    raw = content or description or title or ""
    t = _strip_mdish_for_count(raw)
    if not t:
        return 0
    cjk = len(re.findall(r"[\u3400-\u9FFF]", t))
    non_cjk = re.sub(r"[\u3400-\u9FFF]", " ", t)
    latin = len(re.findall(r"[A-Za-z0-9_]+", non_cjk))
    return cjk + latin


def _reading_minutes_from_units(units: int) -> int:
    return max(1, math.ceil(units / 300))


def _article_filter_params(query: ArticleListQuery, *, omit_category: bool = False) -> dict:
    """Strapi：filters + populate（不含 pagination、sort）。
    omit_category=True：不加 category 條件（供「未分類」在後端用 Python 篩選）。
    """
    params = {
        "populate[category][fields][0]": "name",
        "populate[category][fields][1]": "slug",
        "populate[tags][fields][0]": "name",
        "populate[tags][fields][1]": "slug",
        "populate[owner]": "true",
    }
    if query.q:
        params["filters[$or][0][title][$containsi]"] = query.q
        params["filters[$or][1][content][$containsi]"] = query.q
    if not omit_category and query.category and query.category != "_uncategorized":
        params["filters[category][slug][$eq]"] = query.category
    if query.tag:
        params["filters[tags][slug][$eq]"] = query.tag
    return params


def _formatted_row_is_uncategorized(row: dict) -> bool:
    """與前台「未分類」連結一致：無分類，或分類存在但 slug 為空。"""
    c = row.get("category")
    if not c:
        return True
    return not str(c.get("slug") or "").strip()


def _sort_list_formatted(formatted: list, sort_key: str, order: str) -> None:
    """列表排序（全在記憶體時使用，含 title / published_at）。"""
    if sort_key in ("category", "word_count", "reading_time"):
        _sort_formatted_in_memory(formatted, sort_key, order)
        return
    reverse = order == "desc"
    if sort_key == "title":
        formatted.sort(key=lambda x: (x.get("title") or "").casefold(), reverse=reverse)
    else:
        formatted.sort(
            key=lambda x: (x.get("published_at") or x.get("created_at") or ""),
            reverse=reverse,
        )


def _fetch_all_filtered_articles(params_base: dict, headers: dict) -> list:
    items = []
    pg = 1
    page_size = 100
    while True:
        params = {
            **params_base,
            "pagination[page]": pg,
            "pagination[pageSize]": page_size,
            "sort": "publishedAt:desc",
        }
        r = http.get(f"{STRAPI}/api/articles", params=params, headers=headers, timeout=60)
        r.raise_for_status()
        chunk = (r.json() or {}).get("data") or []
        items.extend(chunk)
        if len(chunk) < page_size:
            break
        pg += 1
        if pg > 200:
            break
    return items


def _apply_author_fallback(formatted: list, headers: dict) -> None:
    if not formatted or not any(not (x.get("author") or "").strip() for x in formatted):
        return
    fb = _fetch_me_author(headers)
    if not fb:
        return
    for x in formatted:
        if not (x.get("author") or "").strip():
            x["author"] = fb


def _sort_formatted_in_memory(formatted: list, sort_key: str, order: str) -> None:
    reverse = order == "desc"

    def title_tie(x):
        return (x.get("title") or "").casefold()

    if sort_key == "category":
        formatted.sort(key=title_tie)
        formatted.sort(
            key=lambda x: ((x.get("category") or {}).get("name") or "").casefold(),
            reverse=reverse,
        )
    elif sort_key == "word_count":

        def wc(x):
            return _count_readable_units_from_article_parts(
                x.get("content") or "",
                x.get("description") or "",
                x.get("title") or "",
            )

        formatted.sort(key=title_tie)
        formatted.sort(key=wc, reverse=reverse)
    elif sort_key == "reading_time":

        def rt(x):
            u = _count_readable_units_from_article_parts(
                x.get("content") or "",
                x.get("description") or "",
                x.get("title") or "",
            )
            return _reading_minutes_from_units(u)

        formatted.sort(key=title_tie)
        formatted.sort(key=rt, reverse=reverse)


@articles_bp.get("/articles", tags=[_tag], summary="List articles")
def list_articles(query: ArticleListQuery):
    headers = strapi_auth_headers()
    mem_sort = query.sort in ("category", "word_count", "reading_time")

    try:
        # 「未分類」：Strapi 的 category[$null] 常與 v5 不相容，且後台可能建了「未分類」但 slug 為空（仍算有 relation）
        if query.category == "_uncategorized":
            base = _article_filter_params(query, omit_category=True)
            raw_items = _fetch_all_filtered_articles(base, headers)
            formatted = [_fmt(i) for i in raw_items]
            formatted = [x for x in formatted if _formatted_row_is_uncategorized(x)]
            _apply_author_fallback(formatted, headers)
            _sort_list_formatted(formatted, query.sort, query.order)
            total = len(formatted)
            pages = math.ceil(total / query.limit) if query.limit else 1
            start = (query.page - 1) * query.limit
            page_rows = formatted[start : start + query.limit]
            return jsonify(
                {
                    "data": page_rows,
                    "meta": {
                        "total": total,
                        "page": query.page,
                        "limit": query.limit,
                        "pages": max(1, pages),
                        "sort": query.sort,
                        "order": query.order,
                    },
                }
            )

        if mem_sort:
            base = _article_filter_params(query)
            raw_items = _fetch_all_filtered_articles(base, headers)
            formatted = [_fmt(i) for i in raw_items]
            _apply_author_fallback(formatted, headers)
            _sort_formatted_in_memory(formatted, query.sort, query.order)
            total = len(formatted)
            pages = math.ceil(total / query.limit) if query.limit else 1
            start = (query.page - 1) * query.limit
            page_rows = formatted[start : start + query.limit]
            return jsonify(
                {
                    "data": page_rows,
                    "meta": {
                        "total": total,
                        "page": query.page,
                        "limit": query.limit,
                        "pages": max(1, pages),
                        "sort": query.sort,
                        "order": query.order,
                    },
                }
            )

        order = query.order
        if query.sort == "title":
            sort_str = f"title:{order}"
        else:
            sort_str = f"publishedAt:{order}"

        params = {
            **_article_filter_params(query),
            "pagination[page]": query.page,
            "pagination[pageSize]": query.limit,
            "sort": sort_str,
        }
        resp = http.get(
            f"{STRAPI}/api/articles",
            params=params,
            headers=headers,
            timeout=15,
        )
        if resp.status_code in (401, 403):
            return jsonify({"error": "unauthorized", "data": [], "meta": {}}), 401
        resp.raise_for_status()
        body = resp.json()
    except Exception as e:
        return jsonify(
            {
                "data": [],
                "meta": {
                    "total": 0,
                    "page": query.page,
                    "limit": query.limit,
                    "pages": 0,
                    "sort": query.sort,
                    "order": query.order,
                    "error": str(e),
                },
            }
        ), 200

    items = body.get("data") or []
    formatted = [_fmt(i) for i in items]
    _apply_author_fallback(formatted, headers)
    pag = body.get("meta", {}).get("pagination", {})
    total = pag.get("total", len(items))
    pages = pag.get("pageCount", math.ceil(total / query.limit) if query.limit else 1)

    return jsonify(
        {
            "data": formatted,
            "meta": {
                "total": total,
                "page": query.page,
                "limit": query.limit,
                "pages": pages,
                "sort": query.sort,
                "order": query.order,
            },
        }
    )


class ArticlePath(BaseModel):
    slug: str


def _strapi_find_article_by_path_segment(segment: str):
    """先依 slug、再依 title 查 Strapi（分兩次請求，避免 $or 查詢字串與 Strapi 5 不相容）。"""
    base = {"populate": "*"}
    headers = strapi_auth_headers()
    r = http.get(
        f"{STRAPI}/api/articles",
        params={**base, "filters[slug][$eq]": segment},
        headers=headers,
        timeout=10,
    )
    if r.status_code in (401, 403):
        raise PermissionError("unauthorized")
    r.raise_for_status()
    items = r.json().get("data") or []
    if items:
        return items[0]
    r2 = http.get(
        f"{STRAPI}/api/articles",
        params={**base, "filters[title][$eq]": segment},
        headers=headers,
        timeout=10,
    )
    if r2.status_code in (401, 403):
        raise PermissionError("unauthorized")
    r2.raise_for_status()
    items = r2.json().get("data") or []
    return items[0] if items else None


# 必須使用 Flask/Werkzeug 變數語法 <string:slug>；{slug} 會被當成字面路徑，導致 /api/articles/a 永遠 404
@articles_bp.get("/articles/<string:slug>", tags=[_tag], summary="Get article by slug")
def get_article(path: ArticlePath):
    """依網址片段查詢：比對 slug；若無則比對 title（與 Strapi 標題／slug 不一致時仍可用標題當路徑）。"""
    slug = path.slug
    try:
        item = _strapi_find_article_by_path_segment(slug)
    except PermissionError:
        return jsonify({"error": "unauthorized"}), 401
    except Exception as e:
        return jsonify({"error": str(e)}), 503

    if not item:
        return jsonify({"error": f"Article '{slug}' not found."}), 404

    return jsonify({"data": _fmt_with_content(item)})
