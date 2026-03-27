'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

/** 僅允許 png / jpg / webp */
const ALLOWED_MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function getMaxInlineImageBytes() {
  const raw = process.env.INLINE_IMAGE_MAX_BYTES;
  if (raw === undefined || raw === '') return DEFAULT_MAX_BYTES;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
}

function toSafeBaseName(input) {
  return (input || 'pasted-image')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

/** Markdown 圖片 alt 內避免破壞語法 */
function sanitizeMarkdownAlt(text) {
  const s = (text || '').toString().trim().slice(0, 120);
  if (!s) return '';
  return s.replace(/\]/g, '）').replace(/\[/g, '（');
}

function buildAltText(articleBaseName, explicitAlt) {
  const explicit = (explicitAlt || '').toString().trim();
  if (explicit) return sanitizeMarkdownAlt(explicit);
  return sanitizeMarkdownAlt(articleBaseName) || 'image';
}

function parseDataUri(dataUri) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/.exec((dataUri || '').trim());
  if (!match) return { ok: false, reason: 'invalid-data-uri' };
  const mimeType = match[1].toLowerCase();
  const ext = ALLOWED_MIME_TO_EXT[mimeType];
  if (!ext) {
    return { ok: false, reason: 'unsupported-type' };
  }
  const rawBase64 = match[2].replace(/\s+/g, '');
  const buffer = Buffer.from(rawBase64, 'base64');
  if (!buffer.length) {
    return { ok: false, reason: 'empty-buffer' };
  }
  const maxBytes = getMaxInlineImageBytes();
  if (buffer.length > maxBytes) {
    return { ok: false, reason: 'too-large', maxBytes, size: buffer.length };
  }
  return { ok: true, mimeType, ext, buffer };
}

async function uploadDataUriImage(strapi, dataUri, articleBaseName, explicitAlt) {
  const parsed = parseDataUri(dataUri);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, maxBytes: parsed.maxBytes, size: parsed.size };
  }

  const altForMedia = buildAltText(articleBaseName, explicitAlt);
  const hash = crypto.createHash('sha1').update(parsed.buffer).digest('hex').slice(0, 10);
  const safeName = `${toSafeBaseName(articleBaseName)}-${hash}.${parsed.ext}`;
  const tmpPath = path.join(os.tmpdir(), `strapi-inline-${Date.now()}-${safeName}`);

  await fs.writeFile(tmpPath, parsed.buffer);
  try {
    const uploaded = await strapi.plugin('upload').service('upload').upload({
      data: {
        fileInfo: {
          name: safeName,
          alternativeText: altForMedia,
        },
      },
      files: {
        path: tmpPath,
        filepath: tmpPath,
        name: safeName,
        type: parsed.mimeType,
        mimetype: parsed.mimeType,
        size: parsed.buffer.length,
      },
    });

    const item = Array.isArray(uploaded) ? uploaded[0] : uploaded;
    const url = item?.url || null;
    if (!url) return { ok: false, reason: 'upload-no-url' };
    return { ok: true, url, altForMarkdown: altForMedia };
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

async function asyncReplace(input, regex, replacer) {
  const matches = [];
  let match;
  while ((match = regex.exec(input)) !== null) {
    matches.push({ match: match[0], index: match.index, groups: match });
  }
  if (!matches.length) return input;

  let output = '';
  let lastIndex = 0;
  for (const row of matches) {
    const replacement = await replacer(row.groups);
    output += input.slice(lastIndex, row.index);
    output += replacement;
    lastIndex = row.index + row.match.length;
  }
  output += input.slice(lastIndex);
  return output;
}

function skipPlaceholderMarkdown(articleBaseName, reason) {
  const maxMb = (getMaxInlineImageBytes() / (1024 * 1024)).toFixed(1);
  const base = sanitizeMarkdownAlt(articleBaseName) || 'image';
  if (reason === 'unsupported-type') {
    return `\n\n*（內嵌圖片未上傳：僅支援 PNG、JPG、WebP；圖片 alt：${base}）*\n\n`;
  }
  if (reason === 'too-large') {
    return `\n\n*（內嵌圖片未上傳：單張超過 ${maxMb} MB 上限；圖片 alt：${base}）*\n\n`;
  }
  return `\n\n*（內嵌圖片未上傳；圖片 alt：${base}）*\n\n`;
}

async function transformInlineImagesToMediaLinks(strapi, content, fileBaseName = 'pasted-image') {
  if (!content || !content.includes('data:image/')) {
    return { content, replaced: 0, skipped: 0 };
  }

  const articleBase = fileBaseName || 'article-image';
  const uploadCache = new Map();
  let replaced = 0;
  let skipped = 0;

  const markdownRegex = /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+)\)/g;
  const htmlRegex = /<img\b([^>]*?)\bsrc=["'](data:image\/[a-zA-Z0-9.+-]+;base64,[^"']+)["']([^>]*)>/g;

  const resolveUpload = async (dataUri, explicitAlt) => {
    if (uploadCache.has(dataUri)) {
      const cached = uploadCache.get(dataUri);
      if (cached.ok) {
        return { ok: true, url: cached.url, altForMarkdown: buildAltText(articleBase, explicitAlt) };
      }
      return cached;
    }
    const result = await uploadDataUriImage(strapi, dataUri, articleBase, explicitAlt);
    uploadCache.set(dataUri, result);
    return result;
  };

  let nextContent = await asyncReplace(content, markdownRegex, async (m) => {
    const explicitAlt = m[1] || '';
    const dataUri = m[2] || '';
    const result = await resolveUpload(dataUri, explicitAlt);
    if (result.ok) {
      replaced += 1;
      const alt = result.altForMarkdown || buildAltText(articleBase, explicitAlt);
      return `![${alt}](${result.url})`;
    }
    skipped += 1;
    return skipPlaceholderMarkdown(articleBase, result.reason);
  });

  nextContent = await asyncReplace(nextContent, htmlRegex, async (m) => {
    const fullTag = m[0] || '';
    const dataUri = m[2] || '';
    const altMatch = /\balt=["']([^"']*)["']/i.exec(fullTag);
    const existingAlt = altMatch ? altMatch[1] : '';
    const result = await resolveUpload(dataUri, existingAlt);
    if (result.ok) {
      replaced += 1;
      const alt = escapeHtml(result.altForMarkdown || buildAltText(articleBase, existingAlt));
      let tag = fullTag.replace(/src=["'][^"']+["']/i, `src="${result.url}"`);
      if (/\balt=/i.test(tag)) {
        tag = tag.replace(/\balt=["'][^"']*["']/i, `alt="${alt}"`);
      } else {
        tag = tag.replace(/<img\b/i, `<img alt="${alt}" `);
      }
      return tag;
    }
    skipped += 1;
    return skipPlaceholderMarkdown(articleBase, result.reason);
  });

  return { content: nextContent, replaced, skipped };
}

const DATA_URI_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\r\n]+/g;

async function replaceRemainingDataUrisInString(strapi, input, fileBaseName, uploadCache) {
  if (!input || typeof input !== 'string' || !input.includes('data:image/')) {
    return { text: input, replaced: 0, skipped: 0 };
  }

  let output = '';
  let lastIndex = 0;
  let replaced = 0;
  let skipped = 0;

  const regex = new RegExp(DATA_URI_RE.source, 'g');
  let match;
  while ((match = regex.exec(input)) !== null) {
    const dataUri = match[0];
    output += input.slice(lastIndex, match.index);

    let cached = uploadCache && uploadCache.has(dataUri) ? uploadCache.get(dataUri) : null;
    if (!cached) {
      cached = await uploadDataUriImage(strapi, dataUri, fileBaseName);
      if (uploadCache) uploadCache.set(dataUri, cached);
    }

    if (cached.ok && cached.url) {
      output += cached.url;
      replaced += 1;
    } else {
      skipped += 1;
      // 保留原始 data-uri，避免直接破壞 richtext 結構（但可確保「能轉換」的情況下正常顯示）
      output += dataUri;
    }

    lastIndex = match.index + dataUri.length;
  }
  output += input.slice(lastIndex);

  return { text: output, replaced, skipped };
}

/**
 * 針對任意內容（string / array / object）遞迴處理：
 * - 優先處理 markdown/html 包裝格式
 * - 再處理 richtext JSON 常見的 attrs.src 等純 data-uri 字串
 */
async function transformInlineImagesAny(strapi, node, fileBaseName, uploadCache) {
  if (node === null || node === undefined) return { node, replaced: 0, skipped: 0 };

  if (typeof node === 'string') {
    const transformed = await transformInlineImagesToMediaLinks(strapi, node, fileBaseName);
    let content = transformed.content;

    if (content && content.includes('data:image/')) {
      const remaining = await replaceRemainingDataUrisInString(strapi, content, fileBaseName, uploadCache);
      content = remaining.text;
      return {
        node: content,
        replaced: (transformed.replaced || 0) + (remaining.replaced || 0),
        skipped: (transformed.skipped || 0) + (remaining.skipped || 0),
      };
    }

    return {
      node: content,
      replaced: transformed.replaced || 0,
      skipped: transformed.skipped || 0,
    };
  }

  if (Array.isArray(node)) {
    let totalReplaced = 0;
    let totalSkipped = 0;
    const next = [];
    for (let i = 0; i < node.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await transformInlineImagesAny(strapi, node[i], fileBaseName, uploadCache);
      next.push(r.node);
      totalReplaced += r.replaced || 0;
      totalSkipped += r.skipped || 0;
    }
    return { node: next, replaced: totalReplaced, skipped: totalSkipped };
  }

  if (typeof node === 'object') {
    let totalReplaced = 0;
    let totalSkipped = 0;
    const next = { ...node };
    for (const key of Object.keys(next)) {
      // eslint-disable-next-line no-await-in-loop
      const r = await transformInlineImagesAny(strapi, next[key], fileBaseName, uploadCache);
      next[key] = r.node;
      totalReplaced += r.replaced || 0;
      totalSkipped += r.skipped || 0;
    }
    return { node: next, replaced: totalReplaced, skipped: totalSkipped };
  }

  return { node, replaced: 0, skipped: 0 };
}

function escapeHtml(s) {
  return (s || '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  transformInlineImagesToMediaLinks,
  transformInlineImagesAny,
  getMaxInlineImageBytes,
};
