'use strict';

const {
  transformInlineImagesAny,
} = require('./api/article/utils/inline-image-upload');

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application gets registered.
   *
   * This gives you an opportunity to extend code.
   */
  register(/*{ strapi }*/) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets launched.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap({ strapi }) {
    const processInlinePastedImages = async (event) => {
      const data = event?.params?.data;
      if (!data || data.content === undefined || data.content === null) return;

      const baseName = data.title || data.slug || 'article-image';
      try {
        let serialized = '';
        try {
          serialized = typeof data.content === 'string' ? data.content : JSON.stringify(data.content);
        } catch {
          // ignore
        }
        const hasDataUri = typeof serialized === 'string' && serialized.includes('data:image/');
        const hasBlob = typeof serialized === 'string' && serialized.includes('blob:');
        if (hasBlob && !hasDataUri) {
          strapi.log.info('[inline-image-upload] detected blob: in richtext content; clipboard-images may be blob-based (needs front-end handling).');
        }

        const uploadCache = new Map();
        const transformed = await transformInlineImagesAny(strapi, data.content, baseName, uploadCache);
        // 只有「成功替換」才寫回；避免因為跳過（unsupported/too-large/upload error）導致內容結構被重建而影響編輯器呈現。
        if (transformed.replaced > 0) {
          data.content = transformed.node;
        }
        if (transformed.skipped > 0) {
          strapi.log.info(
            `[inline-image-upload] skipped ${transformed.skipped} inline image(s) (type/size limit or upload error)`,
          );
        }
      } catch (error) {
        strapi.log.error(`[inline-image-upload] ${error.message}`);
      }
    };

    strapi.db.lifecycles.subscribe({
      models: ['api::article.article'],
      async beforeCreate(event) {
        await processInlinePastedImages(event);
      },
      async beforeUpdate(event) {
        await processInlinePastedImages(event);
      },
    });
  },
};
