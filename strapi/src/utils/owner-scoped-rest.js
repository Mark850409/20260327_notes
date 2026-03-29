'use strict';

/**
 * REST 對 users-permissions 關聯篩選易失效，列表改走 entityService 時共用。
 */
function mergeOwnerIntoFilters(filters, userId) {
  const ownerFilter = { owner: { id: userId } };
  if (!filters || typeof filters !== 'object' || Object.keys(filters).length === 0) {
    return ownerFilter;
  }
  return { $and: [filters, ownerFilter] };
}

function getStartLimitFromSanitized(sanitizedQuery, query) {
  const p = sanitizedQuery.pagination || {};
  if (Number.isFinite(p.start) && Number.isFinite(p.limit)) {
    return { start: p.start, limit: p.limit };
  }
  const page = Math.max(1, parseInt(p.page ?? query['pagination[page]'] ?? '1', 10));
  const pageSize = Math.max(1, parseInt(p.pageSize ?? query['pagination[pageSize]'] ?? '25', 10));
  return { start: (page - 1) * pageSize, limit: pageSize };
}

module.exports = {
  mergeOwnerIntoFilters,
  getStartLimitFromSanitized,
};
