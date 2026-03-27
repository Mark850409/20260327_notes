'use strict';

/**
 * article controller
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const matter = require('gray-matter');
const slugify = require('slugify');
const { createCoreController } = require('@strapi/strapi').factories;

function normalizeSlug(input, fallback = 'note') {
  const base = (input || '').toString().trim() || fallback;
  return (
    slugify(base, {
      lower: true,
      strict: true,
      trim: true,
    }) || `note-${Date.now()}`
  );
}

function getFallbackDescription(content) {
  const line = (content || '')
    .split('\n')
    .map((x) => x.trim())
    .find((x) => x.length > 0);
  if (!line) return '';
  return line.slice(0, 180);
}

function normalizeFiles(filesField) {
  if (!filesField) return [];
  if (Array.isArray(filesField)) return filesField;
  if (Array.isArray(filesField.files)) return filesField.files;
  if (typeof filesField === 'object') return Object.values(filesField).flat();
  return [];
}

module.exports = createCoreController('api::article.article', ({ strapi }) => ({
  async importMarkdown(ctx) {
    try {
      const files = normalizeFiles(ctx.request.files?.files || ctx.request.files);
      const body = ctx.request.body || {};

      let relativePaths = [];
      if (Array.isArray(body.relativePaths)) {
        relativePaths = body.relativePaths;
      } else if (typeof body.relativePaths === 'string' && body.relativePaths.trim()) {
        try {
          relativePaths = JSON.parse(body.relativePaths);
        } catch {
          relativePaths = body.relativePaths
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
        }
      }

      if (!files.length) {
        return ctx.badRequest('No markdown files uploaded.');
      }

      const relativePathQueues = new Map();
      for (const p of relativePaths) {
        const key = path.basename(String(p || '')).toLowerCase();
        if (!key) continue;
        if (!relativePathQueues.has(key)) relativePathQueues.set(key, []);
        relativePathQueues.get(key).push(String(p));
      }

      const results = [];
      const summary = { created: 0, updated: 0, failed: 0, skipped: 0 };

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const fileName = file.originalFilename || file.name || `file-${i}.md`;
        const fileKey = fileName.toLowerCase();
        const queued = relativePathQueues.get(fileKey);
        const relPath = (queued && queued.length ? queued.shift() : null) || relativePaths[i] || file.webkitRelativePath || fileName;
        const ext = path.extname(fileName).toLowerCase();

        if (ext !== '.md') {
          summary.skipped += 1;
          results.push({
            path: relPath,
            status: 'skipped',
            message: 'Only .md files are supported',
          });
          continue;
        }

        try {
          const raw = await fs.readFile(file.filepath || file.path, 'utf8');
          const parsed = matter(raw);
          const fm = parsed.data || {};
          const content = (parsed.content || '').trim();
          const fileBase = path.basename(fileName, '.md');

          const title = (fm.title || fileBase || '').toString().trim();
          const slug = normalizeSlug(fm.slug || title || fileBase, fileBase || 'note');
          const description = (fm.description || getFallbackDescription(content) || '').toString().trim();

          const folderSeg = relPath.split(/[\\/]/).filter(Boolean);
          const fallbackCategoryName = folderSeg.length > 1 ? folderSeg[0] : '';
          const categoryName = (fm.category || fallbackCategoryName || '').toString().trim();

          let categoryId = null;
          if (categoryName) {
            const catSlug = normalizeSlug(categoryName, categoryName);
            const existingCategories = await strapi.entityService.findMany('api::category.category', {
              filters: { slug: catSlug },
              limit: 1,
            });
            if (existingCategories?.length) {
              categoryId = existingCategories[0].id;
            } else {
              const createdCategory = await strapi.entityService.create('api::category.category', {
                data: {
                  name: categoryName,
                  slug: catSlug,
                  publishedAt: new Date().toISOString(),
                },
              });
              categoryId = createdCategory.id;
            }
          }

          const existingArticles = await strapi.entityService.findMany('api::article.article', {
            filters: { slug },
            limit: 1,
          });

          const payload = {
            title,
            slug,
            description,
            content,
            publishedAt: new Date().toISOString(),
          };
          if (categoryId) payload.category = categoryId;

          if (existingArticles?.length) {
            const updated = await strapi.entityService.update('api::article.article', existingArticles[0].id, {
              data: payload,
            });
            summary.updated += 1;
            results.push({
              path: relPath,
              status: 'updated',
              id: updated.id,
              slug,
              message: 'updated by slug',
            });
          } else {
            const created = await strapi.entityService.create('api::article.article', { data: payload });
            summary.created += 1;
            results.push({
              path: relPath,
              status: 'created',
              id: created.id,
              slug,
              message: 'created',
            });
          }
        } catch (e) {
          summary.failed += 1;
          results.push({
            path: relPath,
            status: 'failed',
            message: e.message || 'unknown error',
          });
        }
      }

      ctx.body = { summary, results };
    } catch (e) {
      ctx.throw(500, e.message || 'Import failed');
    }
  },
}));
