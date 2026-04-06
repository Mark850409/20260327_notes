"""Tags routes — proxies Strapi v5 REST API."""
import os
import requests as http
from flask_openapi3 import APIBlueprint, Tag
from flask import jsonify

from ..strapi_proxy import strapi_auth_headers

tags_bp = APIBlueprint("tags", __name__, url_prefix="/api")
_tag = Tag(name="Tags", description="Tag management")

STRAPI = os.getenv("STRAPI_URL", "http://strapi:1337")


def _flatten(item: dict) -> dict:
    """Handle Strapi v4 {id, attributes} or v5 flat style."""
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


@tags_bp.get("/tags", tags=[_tag], summary="List all tags")
def list_tags():
    try:
        resp = http.get(
            f"{STRAPI}/api/tags",
            params={"sort": "name:asc", "pagination[pageSize]": 200},
            headers=strapi_auth_headers(),
            timeout=10,
        )
        if resp.status_code in (401, 403):
            return jsonify({"error": "unauthorized", "data": []}), 401
        resp.raise_for_status()
        items = resp.json().get("data") or []
    except Exception as e:
        return jsonify({"data": [], "meta": {"error": str(e)}}), 200

    result = []
    for t in items:
        flat = _flatten(t)
        result.append(
            {
                "id": flat.get("id"),
                "name": flat.get("name"),
                "slug": flat.get("slug"),
                "document_id": flat.get("documentId"),
            }
        )
    return jsonify({"data": result})
