import React from 'react';

/**
 * 後台介面語言：Strapi 內建檔為 zh.json（繁體）、zh-Hans.json（簡體），沒有 zh-Hant。
 * 見：https://docs.strapi.io/cms/admin-panel-customization/locales-translations
 */
export default {
  register(app) {
    app.addMenuLink({
      to: '/notes-import',
      icon: () => React.createElement('span', { style: { fontSize: '14px', lineHeight: 1 } }, '⇪'),
      intlLabel: {
        id: 'notes-import.label',
        defaultMessage: '批次匯入筆記',
      },
      Component: async () => {
        const mod = await import('./pages/NotesImportPage');
        return mod.default;
      },
      permissions: [],
    });
  },
  config: {
    // en 為預設／fallback，無法移除；zh 即繁體中文介面
    locales: ['zh'],
  },
  bootstrap() {},
};
