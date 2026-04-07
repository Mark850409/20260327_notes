'use strict';

const slugify = require('slugify');

function toStableHash(input) {
  const str = (input || '').toString();
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

/**
 * 與 importMarkdown 相同：產生 URL 友善的 slug（含 CJK fallback）。
 */
function normalizeSlug(input, fallback = 'note') {
  const base = (input || '').toString().trim() || fallback;
  const strictSlug = slugify(base, {
    lower: true,
    strict: true,
    trim: true,
  });
  if (strictSlug) return strictSlug;
  const relaxedSlug = slugify(base, {
    lower: true,
    strict: false,
    trim: true,
  })
    .replace(/\s+/g, '-')
    .replace(/[\\/]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (relaxedSlug) return relaxedSlug;
  return `note-${toStableHash(base)}`;
}

function isExplicitSlugProvided(data) {
  return data.slug !== undefined && data.slug !== null && String(data.slug).trim() !== '';
}

function isSameArticleRow(row, exclude) {
  if (!exclude || !row) return false;
  if (exclude.documentId && row.documentId === exclude.documentId) return true;
  if (exclude.id != null && row.id === exclude.id) return true;
  return false;
}

async function ensureUniqueArticleSlug(strapi, title, exclude) {
  const base = normalizeSlug(title, 'note');
  let candidate = base;
  let n = 0;
  while (n < 500) {
    const rows = await strapi.documents('api::article.article').findMany({
      filters: { slug: { $eq: candidate } },
      fields: ['documentId', 'id'],
      limit: 10,
    });
    if (!rows.length) return candidate;
    const conflict = rows.filter((r) => !isSameArticleRow(r, exclude));
    if (!conflict.length) return candidate;
    n += 1;
    candidate = n === 1 ? `${base}-1` : `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

async function resolveTitleForSlug(strapi, data, where, isCreate) {
  const t = (data.title || '').toString().trim();
  if (t) return t;
  if (isCreate || !where) return '';
  try {
    const docId = where.documentId || where.document_id;
    if (docId) {
      const existing = await strapi.documents('api::article.article').findOne({
        documentId: docId,
        fields: ['title'],
      });
      return (existing?.title || '').toString().trim();
    }
    if (where.id != null) {
      const row = await strapi.db.query('api::article.article').findOne({
        where: { id: where.id },
        select: ['title'],
      });
      return (row?.title || '').toString().trim();
    }
  } catch {
    return '';
  }
  return '';
}

/**
 * 未手動填寫 slug 時，依 title 自動產生並確保唯一。
 * - 建立：slug 空或省略時
 * - 更新：僅在 payload 帶入 slug（含空字串）時處理；部分更新未帶 slug 則不覆寫
 */
async function resolveArticleSlugLifecycle(strapi, event, isCreate) {
  const data = event.params.data;
  if (!data) return;
  if (isExplicitSlugProvided(data)) return;
  if (!isCreate && data.slug === undefined) return;

  const title = await resolveTitleForSlug(strapi, data, event.params.where, isCreate);
  if (!title) return;

  const w = event.params.where || {};
  const exclude = isCreate
    ? null
    : {
        documentId: w.documentId || w.document_id,
        id: w.id,
      };
  data.slug = await ensureUniqueArticleSlug(strapi, title, exclude);
}

module.exports = {
  normalizeSlug,
  ensureUniqueArticleSlug,
  resolveArticleSlugLifecycle,
};
