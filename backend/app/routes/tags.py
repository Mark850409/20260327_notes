"""Tags routes — proxies Strapi v5 REST API."""
import os
import requests as http
from flask_openapi3 import APIBlueprint, Tag
from flask import jsonify

tags_bp = APIBlueprint("tags", __name__, url_prefix="/api")
_tag = Tag(name="Tags", description="Tag management")

STRAPI = os.getenv("STRAPI_URL", "http://strapi:1337")


@tags_bp.get("/tags", tags=[_tag], summary="List all tags")
def list_tags():
    try:
        resp = http.get(
            f"{STRAPI}/api/tags",
            params={"sort": "name:asc", "pagination[pageSize]": 200},
            timeout=10,
        )
        resp.raise_for_status()
        items = resp.json().get("data") or []
    except Exception as e:
        return jsonify({"data": [], "meta": {"error": str(e)}}), 200

    result = [
        {"id": t.get("id"), "name": t.get("name"), "slug": t.get("slug"), "document_id": t.get("documentId")}
        for t in items
    ]
    return jsonify({"data": result})
