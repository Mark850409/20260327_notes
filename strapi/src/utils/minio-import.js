'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} = require('@aws-sdk/client-s3');

let cachedClient;
let bucketEnsured;
let publicReadPolicyAttempted;

function isMinioEnabled() {
  const endpoint = (process.env.MINIO_ENDPOINT || '').trim();
  const bucket = (process.env.MINIO_BUCKET || '').trim();
  const ak = (process.env.MINIO_ACCESS_KEY || '').trim();
  const sk = (process.env.MINIO_SECRET_KEY || '').trim();
  return Boolean(endpoint && bucket && ak && sk);
}

function getS3Client() {
  if (cachedClient) return cachedClient;
  const endpoint = (process.env.MINIO_ENDPOINT || '').trim();
  const region = (process.env.MINIO_REGION || 'us-east-1').trim();
  cachedClient = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY,
      secretAccessKey: process.env.MINIO_SECRET_KEY,
    },
  });
  return cachedClient;
}

async function ensureBucket() {
  if (bucketEnsured) return;
  const bucket = (process.env.MINIO_BUCKET || '').trim();
  if (!bucket) return;
  const client = getS3Client();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (e) {
    const code = e?.$metadata?.httpStatusCode;
    const name = e?.name || '';
    if (code === 404 || name === 'NotFound' || String(e?.Code || '').includes('NotFound')) {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } else {
      throw e;
    }
  }

  await ensureBucketPublicReadPolicy(client, bucket);

  bucketEnsured = true;
}

/**
 * MinIO 預設 bucket 為 PRIVATE，瀏覽器直接開圖會 AccessDenied。
 * 預設套用「匿名可讀物件」政策；若需完全私有請設 MINIO_BUCKET_PUBLIC_READ=false。
 */
async function ensureBucketPublicReadPolicy(client, bucket) {
  if (publicReadPolicyAttempted) return;
  publicReadPolicyAttempted = true;

  const raw = (process.env.MINIO_BUCKET_PUBLIC_READ || 'true').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') {
    return;
  }

  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  };

  try {
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify(policy),
      }),
    );
  } catch (e) {
    console.warn(
      `[minio-import] PutBucketPolicy failed (images may show AccessDenied until policy is set): ${e.message || e}`,
    );
  }
}

function sanitizePathSegment(s, maxLen = 160) {
  const t = String(s || '')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.\./g, '')
    .slice(0, maxLen);
  return t || 'untitled';
}

function sanitizeFileNameBase(s, maxLen = 100) {
  const t = String(s || '')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/\.\./g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, maxLen);
  return t || 'note';
}

function stripMarkdownImageInner(inner) {
  const s = String(inner || '').trim();
  const idx = s.search(/\s+["']/);
  if (idx !== -1) return s.slice(0, idx).trim();
  return s;
}

function buildPublicObjectUrl(bucket, objectKey) {
  let base = (process.env.MINIO_PUBLIC_URL || process.env.MINIO_ENDPOINT || '').trim().replace(/\/$/, '');
  if (!base) return '';
  const encodedKey = objectKey
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${base}/${encodeURIComponent(bucket).replace(/%2F/g, '/')}/${encodedKey}`;
}

function normalizeRelPath(p) {
  return path.posix.normalize(String(p || '').replace(/\\/g, '/'));
}

function isAbsoluteOrRemoteRef(ref) {
  const u = String(ref || '').trim();
  if (!u) return true;
  const lower = u.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('//')) return true;
  if (lower.startsWith('data:')) return true;
  if (lower.startsWith('blob:')) return true;
  return false;
}

function resolveRelativeToMd(mdRelPath, imageRef) {
  const raw = stripMarkdownImageInner(imageRef);
  if (!raw || isAbsoluteOrRemoteRef(raw)) return null;
  const dir = path.posix.dirname(normalizeRelPath(mdRelPath));
  const joined = path.posix.join(dir, raw);
  return normalizeRelPath(joined);
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

function isImageExt(ext) {
  return IMAGE_EXT.has(String(ext || '').toLowerCase());
}

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

/** 設為 0 / false / no 時不進行遠端圖片下載（僅本機相對路徑仍處理） */
function remoteDownloadEnabled() {
  const v = (process.env.MINIO_REMOTE_DOWNLOAD || '').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

/** 未設定或空字串時使用預設 BookStack 舊站 → 新站；可覆寫為自訂前綴 */
function getRemoteSrcPrefix() {
  if (!remoteDownloadEnabled()) return '';
  const v = process.env.MINIO_REMOTE_SRC_URL_PREFIX;
  if (typeof v === 'string' && v.trim() !== '') return v.trim().replace(/\/$/, '');
  return 'https://zanehsu.myqnapcloud.com:6876';
}

function getRemoteDstPrefix() {
  if (!remoteDownloadEnabled()) return '';
  const v = process.env.MINIO_REMOTE_DST_URL_PREFIX;
  if (typeof v === 'string' && v.trim() !== '') return v.trim().replace(/\/$/, '');
  return 'https://bookstack.zanehsu.site';
}

/**
 * 將舊網域換成可下載的新網址；若已是新網域則原樣回傳。
 */
function mapRemoteFetchUrl(rawUrl) {
  if (!remoteDownloadEnabled()) return null;
  const u = stripMarkdownImageInner(rawUrl).trim();
  if (!/^https?:\/\//i.test(u)) return null;
  const src = getRemoteSrcPrefix();
  const dst = getRemoteDstPrefix();
  if (!src && !dst) return null;
  if (src && u.startsWith(src)) {
    const rest = u.slice(src.length);
    if (!dst) return null;
    return dst + rest;
  }
  if (dst && u.startsWith(dst)) {
    return u;
  }
  return null;
}

function pickNestedDownloadUrl(innerUrl, outerUrl) {
  const o = mapRemoteFetchUrl(outerUrl);
  const i = mapRemoteFetchUrl(innerUrl);
  if (o) return o;
  if (i) return i;
  return null;
}

function inferExtFromUrlPath(urlString) {
  try {
    const p = new URL(urlString).pathname;
    const ext = path.extname(p).toLowerCase();
    if (ext && isImageExt(ext)) return ext;
  } catch {
    /* ignore */
  }
  return '';
}

function sniffImageExtFromBuffer(b) {
  if (!b || b.length < 3) return '';
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return '.png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (b.length >= 6) {
    const sig = b.slice(0, 6).toString('ascii');
    if (sig === 'GIF89a' || sig === 'GIF87a') return '.gif';
  }
  if (
    b.length >= 12 &&
    b.slice(0, 4).toString('ascii') === 'RIFF' &&
    b.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return '.webp';
  }
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return '.bmp';
  if (b.length >= 5 && b.slice(0, 5).toString('utf8').includes('<svg')) return '.svg';
  return '';
}

function extFromContentType(ct) {
  const c = (ct || '').toLowerCase();
  if (c.includes('image/png')) return '.png';
  if (c.includes('image/jpeg')) return '.jpg';
  if (c.includes('image/gif')) return '.gif';
  if (c.includes('image/webp')) return '.webp';
  if (c.includes('image/bmp')) return '.bmp';
  if (c.includes('image/svg')) return '.svg';
  return '';
}

function getMaxImageBytes() {
  const fromRemote = parseInt(process.env.MINIO_REMOTE_MAX_BYTES || '', 10);
  if (Number.isFinite(fromRemote) && fromRemote > 0) return fromRemote;
  const inline = parseInt(process.env.INLINE_IMAGE_MAX_BYTES || '5242880', 10);
  return Number.isFinite(inline) && inline > 0 ? inline : 5242880;
}

function isAlreadyOurMinioPublicUrl(urlStr) {
  const pub = (process.env.MINIO_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (!pub) return false;
  const u = stripMarkdownImageInner(urlStr).trim();
  return u.startsWith(pub);
}

async function downloadRemoteImage(fetchUrl, maxBytes) {
  const res = await fetch(fetchUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'NotesMarkdownImport/1.0',
      Accept: 'image/*,*/*',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new Error(`exceeds max bytes (${maxBytes})`);
  }
  let ext = inferExtFromUrlPath(fetchUrl);
  if (!ext) ext = extFromContentType(res.headers.get('content-type'));
  if (!ext) ext = sniffImageExtFromBuffer(buf.subarray(0, Math.min(32, buf.length)));
  if (!ext || !isImageExt(ext)) ext = '.png';
  const contentType = MIME_BY_EXT[ext] || res.headers.get('content-type') || 'application/octet-stream';
  return { buffer: buf, ext, contentType };
}

async function uploadImageBuffer(client, bucket, objectKey, buffer, contentType) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType,
    }),
  );
  const publicUrl = buildPublicObjectUrl(bucket, objectKey);
  if (!publicUrl) throw new Error('MINIO_PUBLIC_URL missing');
  return publicUrl;
}

/**
 * 將 Markdown 中相對路徑圖片上傳至 MinIO，路徑：分類/筆記名稱/timestamp_筆記名稱_流水號.ext
 * 另支援 BookStack 式 [![](內)](外) 與遠端圖片（舊網域會先換成新網址再下載）。
 * @returns {Promise<{ content: string, replaced: number, detail: string[] }>}
 */
async function replaceLocalImagesWithMinioUrls({
  content,
  mdRelPath,
  categoryName,
  noteTitle,
  pathToFile,
}) {
  const detail = [];
  let text = String(content || '');
  if (!isMinioEnabled()) {
    return { content: text, replaced: 0, detail: ['minio:disabled'] };
  }

  const client = getS3Client();
  const bucket = (process.env.MINIO_BUCKET || '').trim();
  await ensureBucket();

  const catSeg = sanitizePathSegment(categoryName);
  const noteSeg = sanitizePathSegment(noteTitle);
  const noteFileBase = sanitizeFileNameBase(noteTitle);
  const prefix = `${catSeg}/${noteSeg}`;

  const urlCache = new Map();
  let serial = 0;
  const stamp = Date.now();
  const maxBytes = getMaxImageBytes();
  let replacedCount = 0;

  async function uploadFromBuffer(buffer, ext, contentType) {
    serial += 1;
    const objectName = `${stamp}_${noteFileBase}_${String(serial).padStart(3, '0')}${ext}`;
    const objectKey = `${prefix}/${objectName}`;
    const publicUrl = await uploadImageBuffer(client, bucket, objectKey, buffer, contentType);
    detail.push(`ok:${objectKey}`);
    return publicUrl;
  }

  // ── Pass 1：BookStack 縮圖連結 [![alt](內層)](外層) → 下載外層優先（較常為原圖）──
  const nestedRe = /\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)/g;
  const nestedMatches = [...text.matchAll(nestedRe)];
  if (nestedMatches.length) {
    let last = 0;
    let out = '';
    for (const m of nestedMatches) {
      out += text.slice(last, m.index);
      last = m.index + m[0].length;

      const alt = m[1];
      const innerRaw = stripMarkdownImageInner(m[2]);
      const outerRaw = stripMarkdownImageInner(m[3]);
      const fetchUrl = pickNestedDownloadUrl(innerRaw, outerRaw);

      if (!fetchUrl) {
        detail.push('nested:skip-domain');
        out += m[0];
        continue;
      }

      const cacheKey = `remote:${fetchUrl}`;
      try {
        let publicUrl;
        if (urlCache.has(cacheKey)) {
          publicUrl = urlCache.get(cacheKey);
        } else {
          const { buffer, ext, contentType } = await downloadRemoteImage(fetchUrl, maxBytes);
          publicUrl = await uploadFromBuffer(buffer, ext, contentType);
          urlCache.set(cacheKey, publicUrl);
        }
        out += `![${alt}](${publicUrl})`;
        replacedCount += 1;
      } catch (e) {
        detail.push(`err:nested:${fetchUrl}:${e.message || e}`);
        out += m[0];
      }
    }
    out += text.slice(last);
    text = out;
  }

  // ── Pass 2：一般 ![alt](url)（相對檔案或遠端）──
  const mdImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const matches = [...text.matchAll(mdImageRegex)];

  if (!matches.length) {
    return {
      content: text,
      replaced: replacedCount,
      detail: replacedCount ? detail : [...detail, 'images:none'],
    };
  }

  let last = 0;
  let out = '';
  for (const hit of matches) {
    out += text.slice(last, hit.index);
    last = hit.index + hit[0].length;

    const alt = hit[1];
    const rawUrl = stripMarkdownImageInner(hit[2]);

    if (isAlreadyOurMinioPublicUrl(rawUrl)) {
      out += hit[0];
      continue;
    }

    const resolved = resolveRelativeToMd(mdRelPath, rawUrl);

    if (resolved) {
      if (urlCache.has(resolved)) {
        out += `![${alt}](${urlCache.get(resolved)})`;
        replacedCount += 1;
        continue;
      }

      const file = pathToFile.get(resolved);
      if (!file) {
        detail.push(`missing:${resolved}`);
        out += hit[0];
        continue;
      }

      const ext =
        path.extname(resolved).toLowerCase() ||
        path.extname(file.originalFilename || file.name || '').toLowerCase();
      if (!isImageExt(ext)) {
        detail.push(`skip-ext:${resolved}`);
        out += hit[0];
        continue;
      }

      try {
        let body;
        if (Buffer.isBuffer(file.buffer) && file.buffer.length) {
          body = file.buffer;
        } else {
          const fp = file.filepath || file.path;
          if (!fp) {
            detail.push(`no-path:${resolved}`);
            out += hit[0];
            continue;
          }
          body = await fs.readFile(fp);
        }

        const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
        const publicUrl = await uploadFromBuffer(body, ext, contentType);
        urlCache.set(resolved, publicUrl);
        out += `![${alt}](${publicUrl})`;
        replacedCount += 1;
      } catch (e) {
        detail.push(`err:${resolved}:${e.message || e}`);
        out += hit[0];
      }
      continue;
    }

    const fetchUrl = mapRemoteFetchUrl(rawUrl);
    if (!fetchUrl) {
      out += hit[0];
      continue;
    }

    const cacheKey = `remote:${fetchUrl}`;
    try {
      let publicUrl;
      if (urlCache.has(cacheKey)) {
        publicUrl = urlCache.get(cacheKey);
      } else {
        const dl = await downloadRemoteImage(fetchUrl, maxBytes);
        publicUrl = await uploadFromBuffer(dl.buffer, dl.ext, dl.contentType);
        urlCache.set(cacheKey, publicUrl);
      }
      out += `![${alt}](${publicUrl})`;
      replacedCount += 1;
    } catch (e) {
      detail.push(`err:remote:${fetchUrl}:${e.message || e}`);
      out += hit[0];
    }
  }

  out += text.slice(last);
  return { content: out, replaced: replacedCount, detail };
}

/**
 * 巢狀路徑前綴（不含檔名），例如 "分類/筆記名稱" → 各段 sanitize 後以 / 連接。
 */
function normalizeNestedObjectPrefix(input) {
  const raw = String(input || '')
    .trim()
    .replace(/\\/g, '/');
  if (!raw) return '';
  return raw
    .split('/')
    .map((seg) => sanitizePathSegment(seg))
    .filter(Boolean)
    .join('/');
}

/**
 * 後台剪貼簿直傳 MinIO：依完整 object key 上傳。
 */
async function uploadBufferToMinioObject({ buffer, contentType, objectKey }) {
  if (!isMinioEnabled()) {
    throw new Error('MinIO is not configured');
  }
  await ensureBucket();
  const client = getS3Client();
  const bucket = (process.env.MINIO_BUCKET || '').trim();
  return uploadImageBuffer(client, bucket, objectKey, buffer, contentType);
}

module.exports = {
  isMinioEnabled,
  sanitizePathSegment,
  sanitizeFileNameBase,
  replaceLocalImagesWithMinioUrls,
  normalizeRelPath,
  isImageExt,
  IMAGE_EXT,
  mapRemoteFetchUrl,
  normalizeNestedObjectPrefix,
  uploadBufferToMinioObject,
};
