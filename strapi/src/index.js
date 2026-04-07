'use strict';

const jwt = require('jsonwebtoken');

const {
  transformInlineImagesAny,
} = require('./api/article/utils/inline-image-upload');
const { mergeOwnerIntoFilters } = require('./utils/owner-scoped-rest');
const {
  buildOwnerRelationValue,
  mergeNoRowsFilters,
  resolveOwnerDocumentScope,
} = require('./utils/owner-document-scope');
const { resolveArticleSlugLifecycle } = require('./utils/article-slug');

const OWNER_SCOPED_CONTENT_TYPES = [
  'api::article.article',
  'api::category.category',
  'api::blog-post.blog-post',
  'api::tag.tag',
];

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application gets registered.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }) {
    /** Docker / 編排用存活檢查（預設 Strapi 無此路徑，舊 healthcheck 會一直失敗） */
    strapi.server.routes([
      {
        method: 'GET',
        path: '/_health',
        async handler(ctx) {
          ctx.set('Content-Type', 'application/json');
          ctx.body = { status: 'ok' };
        },
        config: {
          auth: false,
          policies: [],
        },
      },
      /**
       * 批次匯入頁下拉選單：Content Manager 對 plugin::users-permissions.user 常回 401，
       * 改由已登入管理員 JWT（Cookie jwtToken 或 Authorization Bearer）換取安全欄位清單。
       */
      {
        method: 'GET',
        path: '/notes-import/api-users',
        async handler(ctx) {
          const secret = strapi.config.get('admin.auth.secret');
          const bearer = (ctx.request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
          const token = bearer || ctx.cookies.get('jwtToken') || '';
          if (!secret || !token) {
            return ctx.unauthorized('Missing or invalid credentials');
          }
          try {
            jwt.verify(token, secret);
          } catch {
            return ctx.unauthorized('Missing or invalid credentials');
          }
          try {
            const rows = await strapi.db.query('plugin::users-permissions.user').findMany({
              orderBy: { username: 'asc' },
              limit: 500,
            });
            const data = (rows || []).map((r) => ({
              id: r.id,
              username: r.username,
              email: r.email,
            }));
            ctx.set('Content-Type', 'application/json');
            ctx.body = { data };
          } catch (e) {
            strapi.log.error(`[notes-import/api-users] ${e.message}`);
            ctx.throw(500, e.message);
          }
        },
        config: {
          auth: false,
          policies: [],
        },
      },
    ]);

    /**
     * 後台 Content Manager 走 Document Service：依「管理員 email = API 使用者 email」篩選 owner。
     * 前台 REST（/api/*）不在此處依 owner 篩選（見 resolveOwnerDocumentScope）。
     * 設 STRAPI_CM_OWNER_SCOPE_DISABLED=true 可關閉（除錯／遷移用）。
     */
    strapi.documents.use(async (context, next) => {
      if (process.env.STRAPI_CM_OWNER_SCOPE_DISABLED === 'true') {
        return next();
      }
      if (!OWNER_SCOPED_CONTENT_TYPES.includes(context.uid)) {
        return next();
      }

      const scope = await resolveOwnerDocumentScope(strapi);
      if (scope.mode === 'none') {
        return next();
      }

      const { action, params } = context;
      if (!params || typeof params !== 'object') {
        return next();
      }

      if (scope.mode === 'empty') {
        if (['findMany', 'findFirst', 'count', 'findOne', 'update', 'delete'].includes(action)) {
          params.filters = mergeNoRowsFilters(params.filters);
        }
        return next();
      }

      if (scope.mode === 'owner') {
        const uid = scope.userId;
        if (['findMany', 'findFirst', 'count', 'findOne', 'update', 'delete'].includes(action)) {
          params.filters = mergeOwnerIntoFilters(params.filters, uid);
        } else if (action === 'create' && params.data && params.data.owner == null) {
          try {
            params.data.owner = await buildOwnerRelationValue(strapi, uid);
          } catch (e) {
            strapi.log.warn(`[owner-document-scope] create default owner: ${e.message}`);
          }
        }
      }

      return next();
    });
  },

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
        await resolveArticleSlugLifecycle(strapi, event, true);
        const data = event?.params?.data;
        if (data && (data.owner === undefined || data.owner === null)) {
          const def = process.env.STRAPI_DEFAULT_ARTICLE_OWNER_ID;
          if (def) {
            const n = parseInt(String(def).trim(), 10);
            if (!Number.isNaN(n) && n > 0) {
              data.owner = await buildOwnerRelationValue(strapi, n);
            }
          }
        }
        await processInlinePastedImages(event);
      },
      async beforeUpdate(event) {
        await resolveArticleSlugLifecycle(strapi, event, false);
        await processInlinePastedImages(event);
      },
    });

    strapi.db.lifecycles.subscribe({
      models: ['api::category.category'],
      async beforeCreate(event) {
        const data = event?.params?.data;
        if (data && (data.owner === undefined || data.owner === null)) {
          const def = process.env.STRAPI_DEFAULT_ARTICLE_OWNER_ID;
          if (def) {
            const n = parseInt(String(def).trim(), 10);
            if (!Number.isNaN(n) && n > 0) {
              data.owner = await buildOwnerRelationValue(strapi, n);
            }
          }
        }
      },
    });

    strapi.db.lifecycles.subscribe({
      models: ['api::tag.tag'],
      async beforeCreate(event) {
        const data = event?.params?.data;
        if (data && (data.owner === undefined || data.owner === null)) {
          const def = process.env.STRAPI_DEFAULT_ARTICLE_OWNER_ID;
          if (def) {
            const n = parseInt(String(def).trim(), 10);
            if (!Number.isNaN(n) && n > 0) {
              data.owner = await buildOwnerRelationValue(strapi, n);
            }
          }
        }
      },
    });
    
    /**
     * 自動修正：檢查無擁有者的分類與標籤，並將其指派給預設擁有者。
     * 解決前台因為 owner-scoping 而看不到標籤的問題。
     */
    process.nextTick(async () => {
      try {
        const def = process.env.STRAPI_DEFAULT_ARTICLE_OWNER_ID;
        if (!def) return;
        const ownerId = parseInt(String(def).trim(), 10);
        if (Number.isNaN(ownerId) || ownerId <= 0) return;

        const ownerVal = await buildOwnerRelationValue(strapi, ownerId);

        for (const uid of ['api::category.category', 'api::tag.tag']) {
          const orphans = await strapi.documents(uid).findMany({
            filters: { owner: { $null: true } },
            fields: ['documentId'],
            limit: 1000,
          });
          if (orphans.length > 0) {
            strapi.log.info(`[bootstrap] Found ${orphans.length} orphan ${uid.split('.')[1]}(s), assigning to owner ${ownerId}`);
            for (const item of orphans) {
              await strapi.documents(uid).update({
                documentId: item.documentId,
                data: { owner: ownerVal },
              });
            }
          }
        }
      } catch (e) {
        strapi.log.error(`[bootstrap] cleanup orphans: ${e.message}`);
      }
    });
  },
};
