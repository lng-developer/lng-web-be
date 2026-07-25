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
  const [items, total] = await Promise.all([
    MappingNormalizationRule.find(filter).sort({ priority: 1, createdAt: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    MappingNormalizationRule.countDocuments(filter),
  ]);
  return { items, pagination: { total, page, limit } };
}

function findById(id) {
  return MappingNormalizationRule.findById(id).lean();
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
  listActiveForContext,
  update,
};
