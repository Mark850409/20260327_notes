'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { mergeOwnerIntoFilters, getStartLimitFromSanitized } = require('../../../utils/owner-scoped-rest');
const { buildOwnerRelationValue } = require('../../../utils/owner-document-scope');

module.exports = createCoreController('api::category.category', ({ strapi }) => ({
  async find(ctx) {
    if (!ctx.state.user) {
      return ctx.unauthorized('請先登入（使用者與權限 JWT）');
    }
    const userId = ctx.state.user.id;
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);
    const mergedFilters = mergeOwnerIntoFilters(sanitizedQuery.filters, userId);
    const { start, limit } = getStartLimitFromSanitized(sanitizedQuery, ctx.query);

    const results = await strapi.entityService.findMany('api::category.category', {
      filters: mergedFilters,
      populate: sanitizedQuery.populate,
      sort: sanitizedQuery.sort,
      limit,
      start,
    });

    let total = results.length;
    try {
      total = await strapi.entityService.count('api::category.category', {
        filters: mergedFilters,
      });
    } catch (e) {
      strapi.log.warn(`[category.find] entityService.count: ${e.message}`);
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
    const userId = ctx.state.user.id;
    const { id } = ctx.params;
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    const entity = await strapi.entityService.findOne('api::category.category', id, {
      filters: { owner: { id: userId } },
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
    const existing = await strapi.entityService.findOne('api::category.category', id, {
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
    const existing = await strapi.entityService.findOne('api::category.category', id, {
      filters: { owner: { id: userId } },
    });
    if (!existing) {
      return ctx.notFound();
    }
    return super.delete(ctx);
  },
}));
