"""Articles routes — proxies Strapi v5 REST API."""
import math, os
import requests as http
from flask_openapi3 import APIBlueprint, Tag
from flask import jsonify
from pydantic import BaseModel, Field
from typing import Optional
import markdown as md_lib

from ..strapi_proxy import strapi_auth_headers

articles_bp = APIBlueprint("articles", __name__, url_prefix="/api")
_tag = Tag(name="Articles", description="Article listing and search")

STRAPI = os.getenv("STRAPI_URL", "http://strapi:1337")


class ArticleListQuery(BaseModel):
    page:     int           = Field(1,   ge=1)
    limit:    int           = Field(10,  ge=1, le=100)
    q:        Optional[str] = Field(None)
    category: Optional[str] = Field(None)
    tag:      Optional[str] = Field(None)


def _fmt(item: dict) -> dict:
    """Transform Strapi item → our flat format."""
    cat = item.get("category")
    if isinstance(cat, dict):
        cat = {"id": cat.get("id"), "name": cat.get("name"), "slug": cat.get("slug")}

    tags = item.get("tags") or []
    tags_fmt = [{"id": t.get("id"), "name": t.get("name"), "slug": t.get("slug")} for t in tags]

    return {
        "id":           item.get("id"),
        "document_id":  item.get("documentId"),
        "title":        item.get("title"),
        "slug":         item.get("slug"),
        "description":  item.get("description"),
        "published_at": item.get("publishedAt"),
        "created_at":   item.get("createdAt"),
        "updated_at":   item.get("updatedAt"),
        "category":     cat,
        "tags":         tags_fmt,
    }


def _fmt_with_content(item: dict) -> dict:
    d = _fmt(item)
    raw = item.get("content") or ""
    d["content"] = raw
    d["html_content"] = md_lib.markdown(
        raw,
        extensions=["extra", "codehilite", "toc", "tables", "fenced_code"],
        extension_configs={"codehilite": {"css_class": "highlight", "guess_lang": False}},
    )
    return d


@articles_bp.get("/articles", tags=[_tag], summary="List articles")
def list_articles(query: ArticleListQuery):
    # Strapi 5：已發布為預設，勿再用 v4 的 publicationState=live（可能造成篩選異常）
    params = {
        "pagination[page]":     query.page,
        "pagination[pageSize]": query.limit,
        "populate":             "*",
        "sort":                 "publishedAt:desc",
    }
    if query.q:
        params["filters[$or][0][title][$containsi]"]   = query.q
        params["filters[$or][1][content][$containsi]"] = query.q

    if query.category:
        params["filters[category][slug][$eq]"] = query.category
    if query.tag:
        params["filters[tags][slug][$eq]"] = query.tag

    try:
        resp = http.get(
            f"{STRAPI}/api/articles",
            params=params,
            headers=strapi_auth_headers(),
            timeout=10,
        )
        if resp.status_code in (401, 403):
            return jsonify({"error": "unauthorized", "data": [], "meta": {}}), 401
        resp.raise_for_status()
        body = resp.json()
    except Exception as e:
        return jsonify({"data": [], "meta": {"total": 0, "page": query.page, "limit": query.limit, "pages": 0, "error": str(e)}}), 200

    items = body.get("data") or []
    pag   = body.get("meta", {}).get("pagination", {})
    total = pag.get("total", len(items))
    pages = pag.get("pageCount", math.ceil(total / query.limit) if query.limit else 1)

    return jsonify({
        "data": [_fmt(i) for i in items],
        "meta": {"total": total, "page": query.page, "limit": query.limit, "pages": pages},
    })


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
