'use strict';

/**
 * article controller
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const matter = require('gray-matter');
const { createCoreController } = require('@strapi/strapi').factories;
const {
  classifyWithOpenAI,
  safeFmSummary,
} = require('../utils/openai-category');
const { getStartLimitFromSanitized } = require('../../../utils/owner-scoped-rest');
const {
  buildOwnerRelationValue,
  buildDocumentRelationConnect,
  buildDocumentRelationSetMany,
} = require('../../../utils/owner-document-scope');
const {
  replaceLocalImagesWithMinioUrls,
  normalizeRelPath,
  isImageExt,
  isMinioEnabled,
  normalizeNestedObjectPrefix,
  uploadBufferToMinioObject,
} = require('../../../utils/minio-import');
const { normalizeSlug } = require('../../../utils/article-slug');

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

function resolveImportOwnerId(ctx) {
  const body = ctx.request.body || {};
  if (ctx.state.user?.id != null) return ctx.state.user.id;
  const raw = pickFirstString(body.ownerId, body.owner_id);
  if (raw) {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const envId =
    process.env.STRAPI_DEFAULT_ARTICLE_OWNER_ID || process.env.STRAPI_IMPORT_DEFAULT_OWNER_ID;
  if (envId) {
    const n = parseInt(String(envId).trim(), 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return null;
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
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('請先登入（使用者與權限 JWT）');
    }
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);
    const mergedFilters = sanitizedQuery.filters;
    const { start, limit } = getStartLimitFromSanitized(sanitizedQuery, ctx.query);

    const results = await strapi.entityService.findMany('api::article.article', {
      filters: mergedFilters,
      populate: sanitizedQuery.populate,
      sort: sanitizedQuery.sort,
      limit,
      start,
    });

    let total = results.length;
    try {
      total = await strapi.entityService.count('api::article.article', {
        filters: mergedFilters,
      });
    } catch (e) {
      strapi.log.warn(`[article.find] entityService.count: ${e.message}`);
    }

    const page = Math.floor(start / limit) + 1;
    const pageSize = limit;
    const pageCount = Math.ceil(total / pageSize) || 1;
    const pagination = { page, pageSize, pageCount, total };

    const sanitizedResults = await this.sanitizeOutput(results, ctx);
    return this.transformResponse(sanitizedResults, { pagination });
  },

  async findOne(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('請先登入（使用者與權限 JWT）');
    }
    const { id } = ctx.params;
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    const entity = await strapi.entityService.findOne('api::article.article', id, {
      populate: sanitizedQuery.populate,
    });
    if (!entity) {
      return ctx.notFound();
    }
    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  async create(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('請先登入（使用者與權限 JWT）');
    }
    const raw = ctx.request.body || {};
    const data = { ...(raw.data && typeof raw.data === 'object' ? raw.data : {}) };
    data.owner = await buildOwnerRelationValue(strapi, ctx.state.user.id);
    ctx.request.body = { ...raw, data };
    return super.create(ctx);
  },

  async update(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('請先登入（使用者與權限 JWT）');
    }
    const userId = ctx.state.user.id;
    const { id } = ctx.params;
    const existing = await strapi.entityService.findOne('api::article.article', id, {
      filters: { owner: { id: userId } },
    });
    if (!existing) {
      return ctx.notFound();
    }
    const raw = ctx.request.body || {};
    if (raw.data && typeof raw.data === 'object' && Object.prototype.hasOwnProperty.call(raw.data, 'owner')) {
      const next = { ...raw, data: { ...raw.data } };
      delete next.data.owner;
      ctx.request.body = next;
    }
    return super.update(ctx);
  },

  async delete(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('請先登入（使用者與權限 JWT）');
    }
    const userId = ctx.state.user.id;
    const { id } = ctx.params;
    const existing = await strapi.entityService.findOne('api::article.article', id, {
      filters: { owner: { id: userId } },
    });
    if (!existing) {
      return ctx.notFound();
    }
    return super.delete(ctx);
  },

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

  async uploadPasteMinio(ctx) {
    try {
      if (!isMinioEnabled()) {
        return ctx.badRequest(
          'MinIO 未設定：請設定 MINIO_ENDPOINT、MINIO_BUCKET、MINIO_ACCESS_KEY、MINIO_SECRET_KEY、MINIO_PUBLIC_URL 等環境變數。',
        );
      }

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
      const prefix = normalizeNestedObjectPrefix(
        pickFirstString(body.objectPathPrefix, body.minioPathPrefix, body.folderPath),
      );

      const displayName = ensureImageExtension(
        rawFileName || file.originalFilename || file.name,
        mime,
      );
      const safeName = path.basename(String(displayName).replace(/\\/g, '/'));
      const objectKey = prefix ? `${prefix}/${safeName}` : safeName;

      let buffer;
      if (Buffer.isBuffer(file.buffer) && file.buffer.length) {
        buffer = file.buffer;
      } else {
        const filePath = file.filepath || file.path;
        if (filePath) {
          buffer = await fs.readFile(filePath);
        } else {
          return ctx.badRequest('無法讀取上傳檔案內容。');
        }
      }

      const url = await uploadBufferToMinioObject({
        buffer,
        contentType: mime,
        objectKey,
      });

      const altBase =
        path.basename(safeName, path.extname(safeName)) || 'pasted-image';

      ctx.body = {
        url,
        name: altBase,
        objectKey,
      };
    } catch (e) {
      ctx.throw(500, e.message || 'MinIO paste upload failed');
    }
  },

  async importMarkdown(ctx) {
    try {
      const files = normalizeFiles(ctx.request.files?.files || ctx.request.files);
      const body = ctx.request.body || {};
      const categoryMode = (body.categoryMode || 'ai').toString().trim().toLowerCase() === 'manual' ? 'manual' : 'ai';
      const manualCategoryInput = pickFirstString(body.manualCategory, body.category, body.categoryName);
      const categoryCache = new Map();
      const tagCache = new Map(); // slug → { id, name, slug }

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

      const importOwnerId = resolveImportOwnerId(ctx);
      if (importOwnerId == null) {
        return ctx.badRequest(
          '匯入需指定文章擁有者：請在表單填寫「API 使用者 ID（ownerId）」、或使用 API 使用者 JWT，或在環境變數設定 STRAPI_DEFAULT_ARTICLE_OWNER_ID。',
        );
      }

      const ownerRelation = await buildOwnerRelationValue(strapi, importOwnerId);

      const existingCategoryPool = await strapi.entityService.findMany('api::category.category', {
        filters: { owner: { id: importOwnerId } },
        fields: ['id', 'name', 'slug'],
        sort: { id: 'asc' },
        limit: 1000,
      });

      const existingTagPool = await strapi.entityService.findMany('api::tag.tag', {
        filters: { owner: { id: importOwnerId } },
        fields: ['id', 'name', 'slug'],
        sort: { id: 'asc' },
        limit: 2000,
      });

      const basenameQueues = new Map();
      for (const p of relativePaths) {
        const key = path.basename(String(p || '')).toLowerCase();
        if (!key) continue;
        if (!basenameQueues.has(key)) basenameQueues.set(key, []);
        basenameQueues.get(key).push(String(p));
      }

      const resolvedRelPaths = [];
      for (let fi = 0; fi < files.length; fi += 1) {
        const f = files[fi];
        const fn = f.originalFilename || f.name || `file-${fi}`;
        const fk = fn.toLowerCase();
        const q = basenameQueues.get(fk);
        const rp = (q && q.length ? q.shift() : null) || relativePaths[fi] || f.webkitRelativePath || fn;
        resolvedRelPaths.push(rp);
      }

      const allFilesByPath = new Map();
      for (let fi = 0; fi < files.length; fi += 1) {
        allFilesByPath.set(normalizeRelPath(resolvedRelPaths[fi]), files[fi]);
      }

      const results = [];
      const summary = { created: 0, updated: 0, failed: 0, skipped: 0, minioImagesUploaded: 0 };

      const findOrCreateCategory = async (inputName) => {
        const resolvedName = pickFirstString(inputName) || '未分類';
        const catSlug = normalizeSlug(resolvedName, resolvedName);
        const cacheKey = `${importOwnerId}:${catSlug}`;
        if (categoryCache.has(cacheKey)) return categoryCache.get(cacheKey);

        const existingCategories = await strapi.entityService.findMany('api::category.category', {
          filters: {
            $and: [
              { owner: { id: importOwnerId } },
              { $or: [{ slug: { $eqi: catSlug } }, { name: { $eqi: resolvedName } }] },
            ],
          },
          limit: 1,
        });
        let categoryEntity = existingCategories?.[0] || null;

        if (!categoryEntity) {
          const baseData = {
            name: resolvedName,
            slug: catSlug,
            owner: ownerRelation,
            publishedAt: new Date().toISOString(),
          };
          try {
            categoryEntity = await strapi.entityService.create('api::category.category', {
              data: baseData,
            });
          } catch (e) {
            const msg = `${e.message || ''} ${e.name || ''}`.toLowerCase();
            const isUnique =
              msg.includes('unique') ||
              msg.includes('duplicate') ||
              msg.includes('validation') ||
              msg.includes('slug');
            if (!isUnique) throw e;
            const suffix = `-u${importOwnerId}`;
            const maxLen = 255;
            const trimmedBase = catSlug.slice(0, Math.max(1, maxLen - suffix.length));
            const altSlug = `${trimmedBase}${suffix}`;
            categoryEntity = await strapi.entityService.create('api::category.category', {
              data: {
                ...baseData,
                slug: altSlug,
              },
            });
          }
        }

        const payload = {
          id: categoryEntity.id,
          name: categoryEntity.name || resolvedName,
          slug: categoryEntity.slug || catSlug,
        };
        categoryCache.set(cacheKey, payload);
        return payload;
      };

      /**
       * 依 tag 名稱找到或建立 tag，回傳 { id, name, slug }。
       * 同一 importOwnerId 下，同名 tag 只建一次（tagCache 避免重複 DB 請求）。
       */
      const findOrCreateTag = async (tagName) => {
        const resolvedName = (tagName || '').toString().trim();
        if (!resolvedName) return null;
        const tagSlug = normalizeSlug(resolvedName, resolvedName);
        const cacheKey = `${importOwnerId}:${tagSlug}`;
        if (tagCache.has(cacheKey)) return tagCache.get(cacheKey);

        const existingTags = await strapi.entityService.findMany('api::tag.tag', {
          filters: {
            $and: [
              { owner: { id: importOwnerId } },
              { $or: [{ slug: { $eqi: tagSlug } }, { name: { $eqi: resolvedName } }] },
            ],
          },
          limit: 1,
        });
        let tagEntity = existingTags?.[0] || null;

        if (!tagEntity) {
          const baseData = {
            name: resolvedName,
            slug: tagSlug,
            owner: ownerRelation,
            publishedAt: new Date().toISOString(),
          };
          try {
            tagEntity = await strapi.entityService.create('api::tag.tag', { data: baseData });
          } catch (e) {
            const msg = `${e.message || ''} ${e.name || ''}`.toLowerCase();
            const isUnique =
              msg.includes('unique') ||
              msg.includes('duplicate') ||
              msg.includes('validation') ||
              msg.includes('slug');
            if (!isUnique) throw e;
            const suffix = `-u${importOwnerId}`;
            const maxLen = 255;
            const trimmedBase = tagSlug.slice(0, Math.max(1, maxLen - suffix.length));
            tagEntity = await strapi.entityService.create('api::tag.tag', {
              data: { ...baseData, slug: `${trimmedBase}${suffix}` },
            });
          }
        }

        const result = {
          id: tagEntity.id,
          name: tagEntity.name || resolvedName,
          slug: tagEntity.slug || tagSlug,
        };
        tagCache.set(cacheKey, result);
        return result;
      };

      /**
       * 呼叫 OpenAI，一次取得 category + description + tags。
       * 若 frontmatter 已有分類，仍讓 AI 產生 description 與 tags；
       * 分類則直接沿用 frontmatter（省去 category 的 token 消耗）。
       */
      const resolveAiMetadata = async ({ relPath, title, description, contentSnippet, fm, fmCategoryCandidate }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        const model = process.env.OPENAI_MODEL;

        if (!apiKey) {
          const catFallback = fmCategoryCandidate
            ? normalizeCategoryName(fmCategoryCandidate)
            : pickMeaningfulSegment(relPath) || '未分類';
          return {
            category: catFallback,
            description: '',
            tags: [],
            source: 'fallback-no-key',
            detail: 'OPENAI_API_KEY missing',
          };
        }

        try {
          const result = await classifyWithOpenAI({
            apiKey,
            model,
            title,
            relPath,
            description,
            contentSnippet,
            fmSummary: safeFmSummary(fm),
            existingCategories: fmCategoryCandidate ? [] : existingCategoryPool,
            existingTags: existingTagPool,
          });
          // 若 frontmatter 已明確指定分類，優先沿用
          return {
            category: fmCategoryCandidate
              ? normalizeCategoryName(fmCategoryCandidate)
              : normalizeCategoryName(result.category) || '未分類',
            description: result.description || '',
            tags: result.tags || [],
            source: fmCategoryCandidate ? 'fm+openai' : 'openai',
          };
        } catch (e) {
          const catFallback = fmCategoryCandidate
            ? normalizeCategoryName(fmCategoryCandidate)
            : pickMeaningfulSegment(relPath) || '未分類';
          return {
            category: catFallback,
            description: '',
            tags: [],
            source: 'fallback-error',
            detail: e.message || 'openai error',
          };
        }
      };

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const fileName = file.originalFilename || file.name || `file-${i}`;
        const relPath = resolvedRelPaths[i];
        const ext = path.extname(fileName).toLowerCase();

        if (ext !== '.md') {
          if (isImageExt(ext)) {
            continue;
          }
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

          // description 先從 frontmatter 取（若有意義的話），僅供 AI 參考
          const fmDescription = pickFirstString(fm.description, fm.desc, fm.summary);
          const roughDescription = fmDescription || getFallbackDescription(content) || title;

          const fmCategoryCandidate = parseCategoryCandidate(fm.category, fm.categories);

          // ── AI 自動產生 category + description + tags ──────────────────
          const aiMeta = await resolveAiMetadata({
            relPath,
            title,
            description: roughDescription,
            contentSnippet: safeContent.slice(0, 6000),
            fm,
            fmCategoryCandidate,
          });

          // 決定最終分類
          let categoryName;
          if (categoryMode === 'manual') {
            categoryName = manualCategoryInput || '未分類';
            normalizeNotes.push('category:manual');
          } else {
            categoryName = aiMeta.category || '未分類';
            if (aiMeta.source === 'fm+openai' || aiMeta.source === 'fm') {
              normalizeNotes.push('category:fm');
            } else if (aiMeta.source === 'openai') {
              normalizeNotes.push('category:openai');
            } else if (aiMeta.source === 'fallback-no-key') {
              normalizeNotes.push('category:openai-missing-key');
              if (aiMeta.detail) normalizeNotes.push(aiMeta.detail);
            } else {
              normalizeNotes.push('category:openai-fallback');
              if (aiMeta.detail) normalizeNotes.push(aiMeta.detail);
            }
          }

          // 決定最終摘要（AI 優先，無 AI 才退回原始 frontmatter / 內文前幾行）
          const finalDescription = aiMeta.description || roughDescription;
          if (aiMeta.source === 'openai' || aiMeta.source === 'fm+openai') {
            normalizeNotes.push('description:openai');
          } else if (!fmDescription) {
            normalizeNotes.push('description:auto-filled');
          }

          if (!content) normalizeNotes.push('content:auto-filled');

          const categoryEntity = await findOrCreateCategory(categoryName);

          const minioOutcome = await replaceLocalImagesWithMinioUrls({
            content: safeContent,
            mdRelPath: relPath,
            categoryName: categoryEntity?.name || categoryName,
            noteTitle: title,
            pathToFile: allFilesByPath,
          });
          const finalContent = minioOutcome.content;
          if (minioOutcome.replaced > 0) {
            summary.minioImagesUploaded += minioOutcome.replaced;
          }

          // 決定最終標籤（手動模式也做 AI 標籤；frontmatter tags 優先追加）
          let finalTagNames = [];
          const fmTags = [];
          if (Array.isArray(fm.tags)) fmTags.push(...fm.tags.map((t) => String(t || '').trim()).filter(Boolean));
          else if (typeof fm.tags === 'string') fmTags.push(...fm.tags.split(',').map((t) => t.trim()).filter(Boolean));
          if (Array.isArray(fm.tag)) fmTags.push(...fm.tag.map((t) => String(t || '').trim()).filter(Boolean));

          if (fmTags.length) {
            // frontmatter 有 tags → 沿用，不超過 5 個
            finalTagNames = [...new Set(fmTags)].slice(0, 5);
            normalizeNotes.push('tags:fm');
          } else if (aiMeta.tags && aiMeta.tags.length) {
            finalTagNames = aiMeta.tags.slice(0, 5);
            normalizeNotes.push('tags:openai');
          } else {
            normalizeNotes.push('tags:none');
          }

          const tagEntities = [];
          for (const tagName of finalTagNames) {
            try {
              const t = await findOrCreateTag(tagName);
              if (t) tagEntities.push(t);
            } catch (e) {
              strapi.log.warn(`[importMarkdown] tag "${tagName}" 建立失敗：${e.message}`);
            }
          }

          const existingArticles = await strapi.entityService.findMany('api::article.article', {
            filters: { slug, owner: { id: importOwnerId } },
            limit: 1,
          });

          const payload = {
            title,
            slug,
            description: finalDescription,
            content: finalContent,
            publishedAt: new Date().toISOString(),
            owner: ownerRelation,
          };
          if (categoryEntity?.id) {
            const catRel = await buildDocumentRelationConnect(strapi, 'api::category.category', categoryEntity.id);
            if (catRel !== undefined) payload.category = catRel;
          }
          if (tagEntities.length) {
            const tagRel = await buildDocumentRelationSetMany(
              strapi,
              'api::tag.tag',
              tagEntities.map((t) => t.id),
            );
            if (tagRel !== undefined) payload.tags = tagRel;
          }

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
              tags: tagEntities.map((t) => t.name),
              categoryMode,
              normalized: normalizeNotes,
              minioImages: minioOutcome.replaced,
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
              tags: tagEntities.map((t) => t.name),
              categoryMode,
              normalized: normalizeNotes,
              minioImages: minioOutcome.replaced,
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
