"""
Flask Application Factory + flask-openapi3 setup.

Flask reads from Strapi's MySQL database (strapi_db) read-only,
mirroring Strapi's auto-generated table schema.
"""
from flask_openapi3 import OpenAPI, Info, Tag
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from .config import Config

# ── Extensions (created here, initialised in factory) ───────
db = SQLAlchemy()

# ── OpenAPI Info ─────────────────────────────────────────────
info = Info(
    title="Notes Site API",
    version="1.0.0",
    description=(
        "REST API for the Markdown notes site. "
        "Data is sourced from Strapi CMS and exposed "
        "via Flask with full OpenAPI 3.0 documentation."
    ),
)

# ── Tags for grouping endpoints ───────────────────────────────
articles_tag   = Tag(name="Articles",   description="Article CRUD & search")
categories_tag = Tag(name="Categories", description="Category management")
tags_tag       = Tag(name="Tags",       description="Tag management")
health_tag     = Tag(name="Health",       description="Service health check")
site_profile_tag = Tag(name="SiteProfile", description="Site sidebar profile")
blog_posts_tag = Tag(name="BlogPosts", description="Blog post listing and reading")


def create_app(config=None) -> OpenAPI:
    app = OpenAPI(__name__, info=info)
    app.config.from_object(Config)
    if config:
        app.config.update(config)

    # Init extensions
    db.init_app(app)
    CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})

    # Register blueprints / routers
    from .routes.articles   import articles_bp
    from .routes.categories import categories_bp
    from .routes.tags       import tags_bp
    from .routes.health       import health_bp
    from .routes.site_profile import site_profile_bp
    from .routes.auth import auth_bp
    from .routes.blog_posts import blog_posts_bp
    from .routes.widgets import widgets_bp

    app.register_api(articles_bp)
    app.register_api(categories_bp)
    app.register_api(tags_bp)
    app.register_api(health_bp)
    app.register_api(site_profile_bp)
    app.register_api(auth_bp)
    app.register_api(blog_posts_bp)
    app.register_api(widgets_bp)

    return app
