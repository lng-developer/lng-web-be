const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { recordStatuses } = require('../constants/mappingRule.constants');
const MappingNormalizationRule = require('../models/mappingNormalizationRule.model');

function scopedFilter(query = {}) {
  const filter = {};
  if (query.shopId) filter.shopId = query.shopId;
  if (query.shopIds) filter.$or = [{ shopId: null }, { shopId: { $in: query.shopIds } }];
  if (query.salesChannelCode) filter.salesChannelCode = String(query.salesChannelCode).trim().toUpperCase();
  if (query.marketplaceCode) filter.marketplaceCode = String(query.marketplaceCode).trim().toUpperCase();
  if (query.productTypeGroupId) filter.productTypeGroupId = query.productTypeGroupId;
  if (query.semanticRole) filter.semanticRole = String(query.semanticRole).trim().toUpperCase();
  if (query.matchTarget) filter.matchTarget = String(query.matchTarget).trim().toUpperCase();
  if (query.hasNormalizedValue) filter.normalizedValue = { $nin: [null, ''] };
  if (query.status) filter.status = String(query.status).trim().toUpperCase();
  return filter;
}

function contextFilter(context = {}) {
  return {
    status: recordStatuses.ACTIVE,
    $and: [
      { $or: [{ shopId: null }, { shopId: context.shopId || null }] },
      { $or: [{ salesChannelCode: null }, { salesChannelCode: context.salesChannelCode || null }] },
      { $or: [{ marketplaceCode: null }, { marketplaceCode: context.marketplaceCode || null }] },
      { $or: [{ productTypeGroupId: null }, { productTypeGroupId: context.productTypeGroupId || null }] },
    ],
  };
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query);
  const skip = getPaginationOffset({ page, limit });
  const filter = scopedFilter(query);
  const [result = {}] = await MappingNormalizationRule.aggregate([
    { $match: filter },
    { $sort: { priority: 1, createdAt: 1, _id: 1 } },
    { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'count' }] } },
  ]);
  return { items: result.items || [], pagination: { total: result.total?.[0]?.count || 0, page, limit } };
}

async function listGrouped(query = {}) {
  const { page, limit } = normalizePagination(query);
  const skip = getPaginationOffset({ page, limit });
  const filter = scopedFilter(query);
  const pageStages = [{ $sort: { priority: 1, createdAt: 1, _id: 1 } }, { $skip: skip }, { $limit: limit }];
  const [result = {}] = await MappingNormalizationRule.aggregate([{
    $facet: {
      semanticRules: [{ $match: { ...filter, matchTarget: 'LABEL' } }, ...pageStages],
      semanticTotal: [{ $match: { ...filter, matchTarget: 'LABEL' } }, { $count: 'count' }],
      valueAliases: [{ $match: { ...filter, matchTarget: 'VALUE', normalizedValue: { $nin: [null, ''] } } }, ...pageStages],
      valueAliasTotal: [{ $match: { ...filter, matchTarget: 'VALUE', normalizedValue: { $nin: [null, ''] } } }, { $count: 'count' }],
    },
  }]);
  const pageResult = (items, total) => ({
    items: items || [],
    pagination: { total: total?.[0]?.count || 0, page, limit },
  });
  return {
    semanticRules: pageResult(result.semanticRules, result.semanticTotal),
    valueAliases: pageResult(result.valueAliases, result.valueAliasTotal),
  };
}

function findById(id, { session } = {}) {
  const query = MappingNormalizationRule.findById(id);
  if (session) query.session(session);
  return query.lean();
}

function create(payload, { session } = {}) {
  return MappingNormalizationRule.create([payload], { session }).then(([doc]) => doc.toObject());
}

function update(id, patch, { session } = {}) {
  return MappingNormalizationRule.findByIdAndUpdate(id, { $set: patch }, {
    returnDocument: 'after',
    runValidators: true,
    session,
  }).lean();
}

function listActiveForContext(context = {}) {
  return MappingNormalizationRule.find(contextFilter({
    ...context,
    salesChannelCode: context.salesChannelCode && String(context.salesChannelCode).trim().toUpperCase(),
    marketplaceCode: context.marketplaceCode && String(context.marketplaceCode).trim().toUpperCase(),
  })).sort({ priority: 1, createdAt: 1, _id: 1 }).lean();
}

module.exports = {
  create,
  findById,
  list,
  listGrouped,
  listActiveForContext,
  update,
};
