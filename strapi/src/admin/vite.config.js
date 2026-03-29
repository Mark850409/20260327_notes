'use strict';

const { mergeConfig } = require('vite');

/**
 * Docker 內 Vite 預設綁 127.0.0.1 時，主機瀏覽器無法連線 ws://localhost:24678 → F12 洗版。
 * 一律 server.host=0.0.0.0；並在 docker-compose 對外映射 24678:24678。
 *
 * 若仍想關閉 HMR：STRAPI_ADMIN_DISABLE_HMR=true（改 admin 後需手動重整）。
 *
 * Vite 6+ 會檢查 Host，經 NAS / DDNS（如 *.myqnapcloud.com）會出現 Blocked request。
 * STRAPI_ADMIN_ALLOWED_HOSTS：未設或空＝允許所有主機；逗號分隔白名單；strict＝使用 Vite 預設嚴格模式。
 */
function resolveAllowedHosts() {
  const raw = process.env.STRAPI_ADMIN_ALLOWED_HOSTS;
  if (raw === undefined || raw === '') {
    return true;
  }
  const t = String(raw).trim();
  if (t === 'strict' || t === 'false' || t === '0') {
    return undefined;
  }
  if (t === 'all' || t === '*') {
    return true;
  }
  const list = t.split(',').map((h) => h.trim()).filter(Boolean);
  return list.length ? list : true;
}

module.exports = (config) => {
  const raw = process.env.STRAPI_ADMIN_DISABLE_HMR;
  const off = raw === 'true' || raw === '1' || String(raw).toLowerCase() === 'true';

  const server = {
    host: '0.0.0.0',
    ...(off ? { hmr: false } : {}),
  };
  const allowedHosts = resolveAllowedHosts();
  if (allowedHosts !== undefined) {
    server.allowedHosts = allowedHosts;
  }

  const patch = { server };

  return mergeConfig(config, patch);
};
