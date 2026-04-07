'use strict';

/**
 * Strapi 5 關聯以 documentId 為主；寫入時僅傳數字 id 可能無法持久化 owner。
 */
async function buildOwnerRelationValue(strapi, numericUserId) {
  const id = parseInt(String(numericUserId), 10);
  if (Number.isNaN(id) || id < 1) return numericUserId;
  try {
    const row = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id },
      select: ['id', 'documentId'],
    });
    if (row?.documentId) {
      return { connect: [row.documentId] };
    }
  } catch (e) {
    strapi.log.warn(`[buildOwnerRelationValue] ${e.message}`);
  }
  return id;
}

/**
 * manyToOne（category 等）：Strapi 5 需以 documentId 做 connect，僅傳數字 id 常無法寫入關聯。
 */
async function buildDocumentRelationConnect(strapi, uid, numericId) {
  const id = parseInt(String(numericId), 10);
  if (Number.isNaN(id) || id < 1) return undefined;
  try {
    const row = await strapi.db.query(uid).findOne({
      where: { id },
      select: ['id', 'documentId'],
    });
    if (row?.documentId) {
      return { connect: [row.documentId] };
    }
    strapi.log.warn(`[buildDocumentRelationConnect] ${uid} id=${id} has no documentId`);
  } catch (e) {
    strapi.log.warn(`[buildDocumentRelationConnect] ${uid} ${e.message}`);
  }
  return undefined;
}

/**
 * manyToMany（tags 等）：批次匯入時以 set 覆寫整組關聯。
 */
async function buildDocumentRelationSetMany(strapi, uid, numericIds) {
  const ids = [
    ...new Set(
      numericIds
        .map((x) => parseInt(String(x), 10))
        .filter((n) => !Number.isNaN(n) && n > 0),
    ),
  ];
  if (!ids.length) return undefined;
  try {
    const rows = await strapi.db.query(uid).findMany({
      where: { id: { $in: ids } },
      select: ['id', 'documentId'],
    });
    const docIds = rows.map((r) => r.documentId).filter(Boolean);
    if (docIds.length) {
      return { set: docIds };
    }
    strapi.log.warn(`[buildDocumentRelationSetMany] ${uid} no documentIds for ids=${ids.join(',')}`);
  } catch (e) {
    strapi.log.warn(`[buildDocumentRelationSetMany] ${uid} ${e.message}`);
  }
  return undefined;
}

function isStrapiSuperAdmin(user) {
  if (!user) return false;
  if (user.isSuperAdmin === true) return true;
  const roles = user.roles;
  if (!Array.isArray(roles)) return false;
  return roles.some(
    (r) =>
      r &&
      (r.code === 'strapi-super-admin' ||
        r.code === 'Strapi Super Admin' ||
        String(r.code || '').toLowerCase() === 'strapi-super-admin'),
  );
}

function mergeNoRowsFilters(filters) {
  const block = { id: { $in: [] } };
  if (!filters || typeof filters !== 'object' || Object.keys(filters).length === 0) {
    return block;
  }
  return { $and: [filters, block] };
}

/**
 * @returns {Promise<{ mode: 'none' } | { mode: 'empty' } | { mode: 'owner', userId: number }>}
 */
async function resolveOwnerDocumentScope(strapi) {
  const ctx = strapi.requestContext?.get?.();
  if (!ctx) return { mode: 'none' };

  if (isStrapiSuperAdmin(ctx.state.user)) return { mode: 'none' };

  const path = ctx.path || ctx.request?.path || '';

  if (path.startsWith('/content-manager')) {
    const adminUser = ctx.state.user;
    if (!adminUser?.email) return { mode: 'empty' };
    try {
      const rows = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: { email: adminUser.email },
        limit: 1,
      });
      const uid = rows?.[0]?.id;
      if (uid == null) return { mode: 'empty' };
      return { mode: 'owner', userId: uid };
    } catch (e) {
      strapi.log.warn(`[owner-document-scope] CM email→user: ${e.message}`);
      return { mode: 'empty' };
    }
  }

  /** 前台 REST（/api/*）不再依 owner 篩選，讓已登入成員可互相讀取筆記／分類。 */
  return { mode: 'none' };
}

module.exports = {
  buildOwnerRelationValue,
  buildDocumentRelationConnect,
  buildDocumentRelationSetMany,
  isStrapiSuperAdmin,
  mergeNoRowsFilters,
  resolveOwnerDocumentScope,
};
