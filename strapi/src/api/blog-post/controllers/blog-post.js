'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { getStartLimitFromSanitized } = require('../../../utils/owner-scoped-rest');

module.exports = createCoreController('api::blog-post.blog-post', ({ strapi }) => ({
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('請先登入（使用者與權限 JWT）');
    }
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);
    const { start, limit } = getStartLimitFromSanitized(sanitizedQuery, ctx.query);
    const results = await strapi.entityService.findMany('api::blog-post.blog-post', {
      filters: sanitizedQuery.filters,
      populate: sanitizedQuery.populate,
      sort: sanitizedQuery.sort,
      limit,
      start,
    });
    const sanitizedResults = await this.sanitizeOutput(results, ctx);
    let total = results.length;
    try {
      total = await strapi.entityService.count('api::blog-post.blog-post', {
        filters: sanitizedQuery.filters,
      });
    } catch (e) {
      strapi.log.warn(`[blog-post.find] entityService.count: ${e.message}`);
    }

    const page = Math.floor(start / limit) + 1;
    const pageSize = limit;
    const pageCount = Math.ceil(total / pageSize) || 1;
    const pagination = { page, pageSize, pageCount, total };

    return this.transformResponse(sanitizedResults, { pagination });
  },

  async findOne(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('請先登入（使用者與權限 JWT）');
    }
    const { id } = ctx.params;
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);
    const entity = await strapi.entityService.findOne('api::blog-post.blog-post', id, {
      populate: sanitizedQuery.populate,
    });
    if (!entity) return ctx.notFound();
    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    return this.transformResponse(sanitizedEntity);
  },
}));

