"""Blog posts routes — proxies Strapi v5 REST API."""
import math, os
import requests as http
from flask_openapi3 import APIBlueprint, Tag
from flask import jsonify
from pydantic import BaseModel, Field
from typing import Optional

from ..strapi_proxy import strapi_auth_headers


blog_posts_bp = APIBlueprint("blog_posts", __name__, url_prefix="/api")
_tag = Tag(name="BlogPosts", description="Blog post listing and reading")

STRAPI = os.getenv("STRAPI_URL", "http://strapi:1337")


class BlogPostListQuery(BaseModel):
    page:  int           = Field(1,  ge=1)
    limit: int           = Field(10, ge=1, le=100)
    q:     Optional[str] = Field(None)


def _fmt(item: dict) -> dict:
    def _get_field(obj: dict, key: str):
        if not isinstance(obj, dict):
            return None
        if key in obj:
            return obj.get(key)
        attrs = obj.get("attributes")
        if isinstance(attrs, dict) and key in attrs:
            return attrs.get(key)
        return None

    def _fmt_cover(cover_obj: dict):
        if not isinstance(cover_obj, dict):
            return None

        # Strapi 媒體在某些回傳格式可能長這樣：
        # - v5 扁平：{ url, mime, width, height, ... }
        # - v4：{ data: { id, attributes: { url, ... } } }
        url = cover_obj.get("url")
        name = cover_obj.get("name")
        mime = cover_obj.get("mime")
        width = cover_obj.get("width")
        height = cover_obj.get("height")
        cid = cover_obj.get("id")

        if url is None and isinstance(cover_obj.get("data"), dict):
            data = cover_obj.get("data") or {}
            cid = data.get("id") or cid
            attrs = data.get("attributes") or {}
            url = attrs.get("url") or url
            name = attrs.get("name") or name
            mime = attrs.get("mime") or mime
            width = attrs.get("width") or width
            height = attrs.get("height") or height

        if url is None:
            return None

        return {
            "id": cid,
            "name": name,
            "url": url,
            "mime": mime,
            "width": width,
            "height": height,
        }

    cover = _fmt_cover(item.get("cover"))

    return {
        "id":           _get_field(item, "id"),
        "document_id":  _get_field(item, "documentId"),
        "title":        _get_field(item, "title"),
        "slug":         _get_field(item, "slug"),
        "excerpt":      _get_field(item, "excerpt"),
        "published_at": _get_field(item, "publishedAt"),
        "created_at":   _get_field(item, "createdAt"),
        "updated_at":   _get_field(item, "updatedAt"),
        "cover":        cover,
    }


def _fmt_with_body(item: dict) -> dict:
    d = _fmt(item)
    # richtext/blocks 在某些回傳格式可能會落在 attributes.body
    if isinstance(item, dict) and "body" in item:
        d["body"] = item.get("body")
    else:
        d["body"] = (item.get("attributes", {}) or {}).get("body")
    return d


@blog_posts_bp.get("/blog-posts", tags=[_tag], summary="List blog posts")
def list_blog_posts(query: BlogPostListQuery):
    params = {
        "pagination[page]":     query.page,
        "pagination[pageSize]": query.limit,
        "populate":             "*",
        "sort":                 "publishedAt:desc",
    }
    if query.q:
        params["filters[$or][0][title][$containsi]"]  = query.q
        params["filters[$or][1][excerpt][$containsi]"] = query.q
        params["filters[$or][2][body][$containsi]"]    = query.q

    try:
        resp = http.get(
            f"{STRAPI}/api/blog-posts",
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


class BlogPostPath(BaseModel):
    slug: str


@blog_posts_bp.get("/blog-posts/<string:slug>", tags=[_tag], summary="Get blog post by slug")
def get_blog_post(path: BlogPostPath):
    slug = path.slug
    try:
        r = http.get(
            f"{STRAPI}/api/blog-posts",
            params={"populate": "*", "filters[slug][$eq]": slug},
            headers=strapi_auth_headers(),
            timeout=10,
        )
        if r.status_code in (401, 403):
            return jsonify({"error": "unauthorized"}), 401
        r.raise_for_status()
        items = r.json().get("data") or []
        item = items[0] if items else None
    except Exception as e:
        return jsonify({"error": str(e)}), 503

    if not item:
        return jsonify({"error": f"Blog post '{slug}' not found."}), 404

    return jsonify({"data": _fmt_with_body(item)})

