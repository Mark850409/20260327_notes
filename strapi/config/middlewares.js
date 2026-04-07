'use strict';

/**
 * 預覽／Markdown 內嵌圖若指向 MinIO（http://localhost:9000 等），需放寬 CSP 的 img-src / media-src，
 * 否則瀏覽器會拒絕載入（手動開新分頁不受影響）。
 * 見：https://docs.strapi.io/cms/configurations/middlewares#security
 */

function collectMinioCspOrigins(env) {
  const raw = (env('MINIO_PUBLIC_URL', '') || '').trim();
  const extra = (env('STRAPI_CSP_MEDIA_ORIGINS', '') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const out = new Set();
  for (const e of extra) out.add(e);

  if (!raw) return [...out];

  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const base = `${u.protocol}//${u.host}`;
    out.add(base);
    // localhost ↔ 127.0.0.1 常混用
    if (u.hostname === 'localhost') {
      out.add(`${u.protocol}//127.0.0.1${u.port ? `:${u.port}` : ''}`);
    }
    if (u.hostname === '127.0.0.1') {
      out.add(`${u.protocol}//localhost${u.port ? `:${u.port}` : ''}`);
    }
  } catch {
    /* ignore */
  }

  return [...out];
}

module.exports = ({ env }) => {
  const mediaOrigins = collectMinioCspOrigins(env);

  return [
    'strapi::logger',
    'strapi::errors',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'img-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', 'https:', ...mediaOrigins],
            'media-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', 'https:', ...mediaOrigins],
          },
        },
      },
    },
    'strapi::cors',
    'strapi::poweredBy',
    'strapi::session',
    'strapi::query',
    'strapi::body',
    'strapi::favicon',
    'strapi::public',
  ];
};
