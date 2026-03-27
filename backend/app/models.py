"""
SQLAlchemy models mirroring Strapi v5 auto-generated MySQL tables.

Strapi v5 prefixes tables with the content-type's plural name in snake_case.
All Flask access is READ-ONLY except for write-through endpoints that
proxy to Strapi's own REST API.
"""
from datetime import datetime
from . import db

# ── Association table (articles ↔ tags) ─────────────────────
article_tags = db.Table(
    "articles_tags_lnk",
    db.Column("article_id",    db.Integer, db.ForeignKey("articles.id"), primary_key=True),
    db.Column("tag_id",        db.Integer, db.ForeignKey("tags.id"),     primary_key=True),
    db.Column("article_ord",   db.Double),
    db.Column("tag_ord",       db.Double),
)


class Article(db.Model):
    """Mirrors Strapi's `articles` table."""
    __tablename__ = "articles"

    id             = db.Column(db.Integer, primary_key=True)
    document_id    = db.Column(db.String(255), unique=True, nullable=False)
    title          = db.Column(db.String(255), nullable=False)
    slug           = db.Column(db.String(255), unique=True, nullable=False)
    content        = db.Column(db.Text)           # Markdown content
    description    = db.Column(db.Text)
    published_at   = db.Column(db.DateTime)
    created_at     = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at     = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    locale         = db.Column(db.String(20), default="en")

    # Relationships
    category_id    = db.Column(db.Integer, db.ForeignKey("categories.id"))
    category       = db.relationship("Category", back_populates="articles")
    tags           = db.relationship("Tag", secondary=article_tags, back_populates="articles")

    def to_dict(self, include_content: bool = False) -> dict:
        data = {
            "id":           self.id,
            "document_id":  self.document_id,
            "title":        self.title,
            "slug":         self.slug,
            "description":  self.description,
            "published_at": self.published_at.isoformat() if self.published_at else None,
            "created_at":   self.created_at.isoformat() if self.created_at else None,
            "updated_at":   self.updated_at.isoformat() if self.updated_at else None,
            "category":     self.category.to_dict() if self.category else None,
            "tags":         [t.to_dict() for t in self.tags],
        }
        if include_content:
            data["content"] = self.content
            data["html_content"] = self._render_html()
        return data

    def _render_html(self) -> str:
        """Render Markdown content to HTML with syntax highlighting."""
        import markdown
        from pygments.formatters import HtmlFormatter
        md = markdown.Markdown(
            extensions=["extra", "codehilite", "toc", "tables", "fenced_code"],
            extension_configs={
                "codehilite": {"css_class": "highlight", "guess_lang": False},
            }
        )
        return md.convert(self.content or "")


class Category(db.Model):
    """Mirrors Strapi's `categories` table."""
    __tablename__ = "categories"

    id          = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.String(255), unique=True)
    name        = db.Column(db.String(100), nullable=False)
    slug        = db.Column(db.String(100), unique=True, nullable=False)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at  = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    articles    = db.relationship("Article", back_populates="category")

    def to_dict(self) -> dict:
        return {
            "id":   self.id,
            "name": self.name,
            "slug": self.slug,
        }


class Tag(db.Model):
    """Mirrors Strapi's `tags` table."""
    __tablename__ = "tags"

    id          = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.String(255), unique=True)
    name        = db.Column(db.String(50), nullable=False)
    slug        = db.Column(db.String(50), unique=True, nullable=False)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at  = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    articles    = db.relationship("Article", secondary=article_tags, back_populates="tags")

    def to_dict(self) -> dict:
        return {
            "id":   self.id,
            "name": self.name,
            "slug": self.slug,
        }
