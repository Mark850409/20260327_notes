'use strict';

/**
 * article controller
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const matter = require('gray-matter');
const slugify = require('slugify');
const { createCoreController } = require('@strapi/strapi').factories;
const {
  classifyCategoryWithOpenAI,
  safeFmSummary,
} = require('../utils/openai-category');

function toStableHash(input) {
  const str = (input || '').toString();
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const nested = pickFirstString(...value);
      if (nested) return nested;
    }
  }
  return '';
}

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

function getFallbackDescription(content) {
  const line = (content || '')
    .split('\n')
    .map((x) => x.trim())
    .find((x) => x.length > 0);
  if (!line) return '';
  return line.slice(0, 180);
}

function isMultipartFileLike(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return (
    'filepath' in obj ||
    'path' in obj ||
    'originalFilename' in obj ||
    'originalname' in obj ||
    Buffer.isBuffer(obj.buffer)
  );
}

function normalizeFiles(filesField) {
  if (!filesField) return [];
  if (Array.isArray(filesField)) return filesField;
  // koa-body / formidable：單一欄位、單檔時常是物件而非 [obj]，不可 Object.values 拆鍵
  if (isMultipartFileLike(filesField)) return [filesField];
  if (Array.isArray(filesField.files)) return filesField.files;
  if (filesField.files && isMultipartFileLike(filesField.files)) return [filesField.files];
  if (typeof filesField === 'object') return Object.values(filesField).flat();
  return [];
}

function parseCategoryCandidate(fmCategory, fmCategories) {
  const direct = pickFirstString(fmCategory);
  if (direct) return direct;
  if (Array.isArray(fmCategories)) return pickFirstString(...fmCategories);
  if (typeof fmCategories === 'string') {
    return pickFirstString(
      fmCategories
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    );
  }
  return '';
}

function normalizeCategoryName(input) {
  return (input || '').toString().trim().replace(/\s+/g, ' ');
}

function pickMeaningfulSegment(input) {
  return (input || '')
    .toString()
    .split(/[\\/]/)
    .map((x) => normalizeCategoryName(x))
    .filter((x) => x && !x.endsWith('.md') && x !== '未分類' && x.toLowerCase() !== 'uncategorized')[0];
}

/**
 * 剪貼簿貼圖常見問題：browser 產生的 File 可能沒有 type / mimetype。
 * 依副檔名與檔頭魔數推斷，供 upload plugin 使用。
 */
function sniffImageMimeFromBuffer(b) {
  if (!b || b.length < 3) return '';
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  if (b.length >= 6) {
    const sig = b.slice(0, 6).toString('ascii');
    if (sig === 'GIF89a' || sig === 'GIF87a') return 'image/gif';
  }
  if (
    b.length >= 12 &&
    b.slice(0, 4).toString('ascii') === 'RIFF' &&
    b.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) {
    return 'image/bmp';
  }
  return '';
}

async function inferImageMimeType(file) {
  let mime = (file.type || file.mimetype || file.mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return mime;

  const filename = (file.originalFilename || file.originalname || file.name || '').toLowerCase();
  const ext = path.extname(filename);
  const byExt = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
  };
  if (byExt[ext]) return byExt[ext];

  if (Buffer.isBuffer(file.buffer) && file.buffer.length) {
    const sniffed = sniffImageMimeFromBuffer(file.buffer.subarray(0, Math.min(16, file.buffer.length)));
    if (sniffed) return sniffed;
  }

  const filePath = file.filepath || file.path;
  if (!filePath) return '';

  let fh;
  try {
    fh = await fs.open(filePath, 'r');
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    const sniffed = sniffImageMimeFromBuffer(buf.subarray(0, bytesRead));
    if (sniffed) return sniffed;
  } catch {
    return '';
  } finally {
    if (fh) await fh.close();
  }
  return '';
}

function parseMultipartBool(value) {
  if (value === true || value === false) return value;
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function sanitizeMediaFileLabel(name) {
  const s = String(name || '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\.\./g, '')
    .trim()
    .slice(0, 200);
  return s;
}

function ensureImageExtension(fileName, mime) {
  const extMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/bmp': '.bmp',
  };
  const want = extMap[(mime || '').toLowerCase()] || '.png';
  const base = sanitizeMediaFileLabel(fileName);
  const safeBase = base || `pasted-${Date.now()}`;
  if (/\.[a-z0-9]{2,8}$/i.test(safeBase)) return safeBase.slice(0, 255);
  return `${safeBase}${want}`.slice(0, 255);
}

/**
 * Strapi upload 的 fileInfo.folder 必須是 upload_folders.id（整數），
 * 見 @strapi/upload formatFileInfo → getFolderPath(folderId)。
 */
async function findRootFolderRowByName(strapi, name) {
  const uid = 'plugin::upload.folder';
  let list;
  try {
    list = await strapi.db.query(uid).findMany({
      where: { name },
      populate: { parent: true },
      limit: 50,
    });
  } catch {
    list = await strapi.db.query(uid).findMany({
      where: { name },
      limit: 50,
    });
  }
  const rows = Array.isArray(list) ? list : [];
  const rootish = rows.find((f) => f.parent == null || f.parent === undefined);
  return rootish || rows[0] || null;
}

async function findOrCreateRootFolderId(strapi, rawName, mustCreate) {
  const name = sanitizeMediaFileLabel(rawName).slice(0, 255);
  if (!name) return { id: null };

  try {
    const existing = await findRootFolderRowByName(strapi, name);
    if (existing?.id != null) return { id: existing.id };

    if (!mustCreate) return { id: null };

    const folderSvc = strapi.plugin('upload').service('folder');
    const created = await folderSvc.create({ name, parent: null }, {});
    if (created?.id != null) return { id: created.id };
  } catch (e) {
    strapi.log.warn(`[uploadInlineImage] findOrCreateRootFolderId: ${e.message}`);
    try {
      const again = await findRootFolderRowByName(strapi, name);
      if (again?.id != null) return { id: again.id };
    } catch {
      /* ignore */
    }
  }

  return { id: null };
}

module.exports = createCoreController('api::article.article', ({ strapi }) => ({
  async uploadInlineImage(ctx) {
    try {
      const files = normalizeFiles(ctx.request.files?.files || ctx.request.files);
      const file = files[0];
      if (!file) return ctx.badRequest('No image file uploaded.');

      const mime = await inferImageMimeType(file);
      if (!mime || !mime.startsWith('image/')) {
        return ctx.badRequest('Only image files are supported.');
      }
      file.type = mime;
      file.mimetype = mime;

      const body = ctx.request.body || {};
      const rawFileName = pickFirstString(body.fileName, body.filename);
      const useFolder = parseMultipartBool(body.useFolder);
      const rawFolderName = pickFirstString(body.folderName);

      if (useFolder && !rawFolderName) {
        return ctx.badRequest('已選擇資料夾時請提供資料夾名稱。');
      }

      let folderId = null;
      if (useFolder && rawFolderName) {
        const { id } = await findOrCreateRootFolderId(strapi, rawFolderName, true);
        folderId = id;
        if (folderId == null) {
          strapi.log.warn('[uploadInlineImage] 無法建立或解析資料夾，檔案將先上傳至預設位置');
        }
      }

      const displayName = ensureImageExtension(
        rawFileName || file.originalFilename || file.name,
        mime,
      );
      const altBase =
        path.basename(displayName, path.extname(displayName)) || 'pasted-image';

      const fileInfoPayload = {
        name: displayName,
        alternativeText: altBase,
      };
      if (folderId != null) {
        fileInfoPayload.folder = folderId;
      }

      const uploaded = await strapi.plugin('upload').service('upload').upload({
        data: {
          fileInfo: fileInfoPayload,
        },
        files: file,
      });

      const item = Array.isArray(uploaded) ? uploaded[0] : uploaded;
      if (!item?.url) {
        return ctx.throw(500, 'Upload succeeded but URL is missing.');
      }

      ctx.body = {
        url: item.url,
        name: altBase,
      };
    } catch (e) {
      ctx.throw(500, e.message || 'Inline image upload failed');
    }
  },

  async importMarkdown(ctx) {
    try {
      const files = normalizeFiles(ctx.request.files?.files || ctx.request.files);
      const body = ctx.request.body || {};
      const categoryMode = (body.categoryMode || 'ai').toString().trim().toLowerCase() === 'manual' ? 'manual' : 'ai';
      const manualCategoryInput = pickFirstString(body.manualCategory, body.category, body.categoryName);
      const categoryCache = new Map();
      const existingCategoryPool = await strapi.entityService.findMany('api::category.category', {
        fields: ['id', 'name', 'slug'],
        sort: { id: 'asc' },
        limit: 1000,
      });

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

      const findOrCreateCategory = async (inputName) => {
        const resolvedName = pickFirstString(inputName) || '未分類';
        const catSlug = normalizeSlug(resolvedName, resolvedName);
        if (categoryCache.has(catSlug)) return categoryCache.get(catSlug);
        const existingCategories = await strapi.entityService.findMany('api::category.category', {
          filters: {
            $or: [{ slug: { $eqi: catSlug } }, { name: { $eqi: resolvedName } }],
          },
          limit: 1,
        });
        let categoryEntity = existingCategories?.[0] || null;
        if (!categoryEntity) {
          categoryEntity = await strapi.entityService.create('api::category.category', {
            data: {
              name: resolvedName,
              slug: catSlug,
              publishedAt: new Date().toISOString(),
            },
          });
        }
        const payload = { id: categoryEntity.id, name: categoryEntity.name || resolvedName, slug: categoryEntity.slug || catSlug };
        categoryCache.set(catSlug, payload);
        return payload;
      };

      const resolveAiCategoryName = async ({ relPath, title, description, contentSnippet, fm, fmCategoryCandidate }) => {
        if (fmCategoryCandidate) {
          return { name: normalizeCategoryName(fmCategoryCandidate), source: 'fm' };
        }

        const apiKey = process.env.OPENAI_API_KEY;
        const model = process.env.OPENAI_MODEL;

        if (!apiKey) {
          const fallback = pickMeaningfulSegment(relPath) || '未分類';
          return { name: fallback, source: 'fallback-no-key', detail: 'OPENAI_API_KEY missing' };
        }

        try {
          const name = await classifyCategoryWithOpenAI({
            apiKey,
            model,
            title,
            relPath,
            description,
            contentSnippet,
            fmSummary: safeFmSummary(fm),
            existingCategories: existingCategoryPool,
          });
          return { name: normalizeCategoryName(name) || '未分類', source: 'openai' };
        } catch (e) {
          const fallback = pickMeaningfulSegment(relPath) || '未分類';
          return {
            name: fallback,
            source: 'fallback-error',
            detail: e.message || 'openai error',
          };
        }
      };

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
          const safeContent = content || `# ${path.basename(fileName, '.md') || 'Untitled'}`;
          const fileBase = path.basename(fileName, '.md');
          const normalizeNotes = [];

          const title = pickFirstString(fm.title, fm.name, fm.topic, fileBase) || fileBase || 'Untitled';
          if (!pickFirstString(fm.title, fm.name, fm.topic)) normalizeNotes.push('title:auto-filled');
          const slugSource = pickFirstString(fm.slug, fm.permalink, title, fileBase);
          const slug = normalizeSlug(slugSource, fileBase || 'note');
          if (!pickFirstString(fm.slug, fm.permalink)) normalizeNotes.push('slug:normalized');
          const description = pickFirstString(fm.description, fm.desc, fm.summary, getFallbackDescription(content), title);
          if (!pickFirstString(fm.description, fm.desc, fm.summary)) normalizeNotes.push('description:auto-filled');
          if (!content) normalizeNotes.push('content:auto-filled');

          const fmCategoryCandidate = parseCategoryCandidate(fm.category, fm.categories);
          const aiResult = await resolveAiCategoryName({
            relPath,
            title,
            description,
            contentSnippet: safeContent.slice(0, 6000),
            fm,
            fmCategoryCandidate,
          });
          const categoryName = categoryMode === 'manual' ? manualCategoryInput || '未分類' : aiResult.name;
          if (categoryMode === 'manual') {
            normalizeNotes.push('category:manual');
          } else if (fmCategoryCandidate) {
            normalizeNotes.push('category:fm');
          } else if (aiResult.source === 'openai') {
            normalizeNotes.push('category:openai');
          } else if (aiResult.source === 'fallback-no-key') {
            normalizeNotes.push('category:openai-missing-key');
            if (aiResult.detail) normalizeNotes.push(aiResult.detail);
          } else {
            normalizeNotes.push('category:openai-fallback');
            if (aiResult.detail) normalizeNotes.push(aiResult.detail);
          }
          const categoryEntity = await findOrCreateCategory(categoryName);

          const existingArticles = await strapi.entityService.findMany('api::article.article', {
            filters: { slug },
            limit: 1,
          });

          const payload = {
            title,
            slug,
            description,
            content: safeContent,
            publishedAt: new Date().toISOString(),
          };
          if (categoryEntity?.id) payload.category = categoryEntity.id;

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
              category: categoryEntity?.name || '-',
              categoryMode,
              normalized: normalizeNotes,
              message: normalizeNotes.length ? `updated by slug (${normalizeNotes.join(', ')})` : 'updated by slug',
            });
          } else {
            const created = await strapi.entityService.create('api::article.article', { data: payload });
            summary.created += 1;
            results.push({
              path: relPath,
              status: 'created',
              id: created.id,
              slug,
              category: categoryEntity?.name || '-',
              categoryMode,
              normalized: normalizeNotes,
              message: normalizeNotes.length ? `created (${normalizeNotes.join(', ')})` : 'created',
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
