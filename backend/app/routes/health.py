"""Health check route."""
from flask_openapi3 import APIBlueprint, Tag
from flask import jsonify
from .. import db

health_bp = APIBlueprint("health", __name__, url_prefix="/api")

_tag = Tag(name="Health", description="Service health check")


@health_bp.get("/health", tags=[_tag], summary="Service health check")
def health():
    """Returns 200 if the service is healthy. Checks database connectivity."""
    try:
        db.session.execute(db.text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    status = "ok" if db_ok else "degraded"
    return jsonify({"status": status, "db": db_ok}), (200 if db_ok else 503)
