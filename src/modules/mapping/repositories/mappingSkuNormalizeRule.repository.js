const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { recordStatuses } = require('../constants/mappingRule.constants');
const MappingSkuNormalizeRule = require('../models/mappingSkuNormalizeRule.model');

function scopedFilter(query = {}) {
  const filter = {};
  if (query.shopId) filter.shopId = query.shopId;
  if (query.shopIds) filter.$or = [{ shopId: null }, { shopId: { $in: query.shopIds } }];
  if (query.salesChannelCode) filter.salesChannelCode = String(query.salesChannelCode).trim().toUpperCase();
  if (query.marketplaceCode) filter.marketplaceCode = String(query.marketplaceCode).trim().toUpperCase();
  if (query.configCode) filter.configCode = String(query.configCode).trim().toUpperCase();
  if (query.patternType) filter.patternType = String(query.patternType).trim().toUpperCase();
  if (query.segmentRole) filter.segmentRole = String(query.segmentRole).trim().toUpperCase();
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
      { $or: [{ configCode: null }, { configCode: context.configCode || null }] },
    ],
  };
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query);
  const skip = getPaginationOffset({ page, limit });
  const filter = scopedFilter(query);
  const [items, total] = await Promise.all([
    MappingSkuNormalizeRule.find(filter).sort({ priority: 1, createdAt: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    MappingSkuNormalizeRule.countDocuments(filter),
  ]);
  return { items, pagination: { total, page, limit } };
}

function findById(id) {
  return MappingSkuNormalizeRule.findById(id).lean();
}

function create(payload) {
  return MappingSkuNormalizeRule.create(payload).then((doc) => doc.toObject());
}

function update(id, patch) {
  return MappingSkuNormalizeRule.findByIdAndUpdate(id, { $set: patch }, {
    returnDocument: 'after',
    runValidators: true,
  }).lean();
}

function listActiveForContext(context = {}) {
  return MappingSkuNormalizeRule.find(contextFilter({
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
