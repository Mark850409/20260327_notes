-- MySQL Initialization Script
-- This runs once when the container is first created.
-- Strapi will create all tables automatically on first run.
-- Flask reads from the same strapi_db database (read-only).

-- Ensure the database and user exist (already set via env, but just in case)
CREATE DATABASE IF NOT EXISTS strapi_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON strapi_db.* TO 'strapi'@'%';
FLUSH PRIVILEGES;
