"""Widget aggregation routes."""
from flask import jsonify
from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field
from typing import Optional

from ..services.widgets import (
    build_archive,
    build_category_tree,
    build_post_calendar,
    build_site_stats,
    build_tag_cloud,
    build_weather,
    get_site_profile_attrs,
)

widgets_bp = APIBlueprint("widgets", __name__, url_prefix="/api/widgets")
_tag = Tag(name="Widgets", description="Sidebar widgets")


class ArchiveQuery(BaseModel):
    limit: int = Field(12, ge=1, le=60)


@widgets_bp.get("/archive", tags=[_tag], summary="Archive by month")
def archive(query: ArchiveQuery):
    try:
        data = build_archive(query.limit)
        return jsonify({"data": data})
    except PermissionError:
        return jsonify({"error": "unauthorized", "data": []}), 401
    except Exception as e:
        return jsonify({"data": [], "meta": {"error": str(e)}}), 200


class TagCloudQuery(BaseModel):
    limit: int = Field(30, ge=1, le=200)


@widgets_bp.get("/tag-cloud", tags=[_tag], summary="Tag cloud")
def tag_cloud(query: TagCloudQuery):
    try:
        data = build_tag_cloud(query.limit)
        return jsonify({"data": data})
    except PermissionError:
        return jsonify({"error": "unauthorized", "data": []}), 401
    except Exception as e:
        return jsonify({"data": [], "meta": {"error": str(e)}}), 200


class CategoryTreeQuery(BaseModel):
    depth: int = Field(4, ge=1, le=10)


@widgets_bp.get("/category-tree", tags=[_tag], summary="Category tree")
def category_tree(query: CategoryTreeQuery):
    try:
        data = build_category_tree(query.depth)
        return jsonify({"data": data})
    except PermissionError:
        return jsonify({"error": "unauthorized", "data": []}), 401
    except Exception as e:
        return jsonify({"data": [], "meta": {"error": str(e)}}), 200


class CalendarQuery(BaseModel):
    year: Optional[int] = Field(None, ge=1970, le=2200)
    month: Optional[int] = Field(None, ge=1, le=12)


@widgets_bp.get("/post-calendar", tags=[_tag], summary="Post calendar for month")
def post_calendar(query: CalendarQuery):
    try:
        profile = get_site_profile_attrs()
        timezone_name = (profile.get("siteTimezone") or "Asia/Taipei").strip() or "Asia/Taipei"
        data = build_post_calendar(query.year, query.month, timezone_name)
        return jsonify({"data": data})
    except PermissionError:
        return jsonify({"error": "unauthorized", "data": {}}), 401
    except Exception as e:
        return jsonify({"data": {}, "meta": {"error": str(e)}}), 200


@widgets_bp.get("/site-stats", tags=[_tag], summary="Site statistics")
def site_stats():
    try:
        profile = get_site_profile_attrs()
        data = build_site_stats(profile)
        return jsonify({"data": data})
    except PermissionError:
        return jsonify({"error": "unauthorized", "data": {}}), 401
    except Exception as e:
        return jsonify({"data": {}, "meta": {"error": str(e)}}), 200


@widgets_bp.get("/weather", tags=[_tag], summary="Weather widget")
def weather():
    try:
        profile = get_site_profile_attrs()
        data = build_weather(profile)
        return jsonify({"data": data})
    except PermissionError:
        return jsonify({"error": "unauthorized", "data": {}}), 401
    except Exception as e:
        return jsonify({"data": {}, "meta": {"error": str(e)}}), 200
