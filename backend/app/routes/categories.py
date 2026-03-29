"""Categories routes — proxies Strapi v5 REST API."""
import os
import requests as http
from flask_openapi3 import APIBlueprint, Tag
from flask import jsonify

from ..strapi_proxy import strapi_auth_headers

categories_bp = APIBlueprint("categories", __name__, url_prefix="/api")
_tag = Tag(name="Categories", description="Category management")

STRAPI = os.getenv("STRAPI_URL", "http://strapi:1337")


@categories_bp.get("/categories", tags=[_tag], summary="List all categories")
def list_categories():
    try:
        resp = http.get(
            f"{STRAPI}/api/categories",
            params={"sort": "name:asc", "pagination[pageSize]": 100},
            headers=strapi_auth_headers(),
            timeout=10,
        )
        if resp.status_code in (401, 403):
            return jsonify({"error": "unauthorized", "data": []}), 401
        resp.raise_for_status()
        items = resp.json().get("data") or []
    except Exception as e:
        return jsonify({"data": [], "meta": {"error": str(e)}}), 200

    result = [
        {"id": c.get("id"), "name": c.get("name"), "slug": c.get("slug"), "document_id": c.get("documentId")}
        for c in items
    ]
    return jsonify({"data": result})
