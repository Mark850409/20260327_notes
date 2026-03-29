'use strict';

const { mergeConfig } = require('vite');

/**
 * Docker 內 Vite 預設綁 127.0.0.1 時，主機瀏覽器無法連線 ws://localhost:24678 → F12 洗版。
 * 一律 server.host=0.0.0.0；並在 docker-compose 對外映射 24678:24678。
 *
 * 若仍想關閉 HMR：STRAPI_ADMIN_DISABLE_HMR=true（改 admin 後需手動重整）。
 */
module.exports = (config) => {
  const raw = process.env.STRAPI_ADMIN_DISABLE_HMR;
  const off = raw === 'true' || raw === '1' || String(raw).toLowerCase() === 'true';

  const patch = {
    server: {
      host: '0.0.0.0',
      ...(off ? { hmr: false } : {}),
    },
  };

  return mergeConfig(config, patch);
};
