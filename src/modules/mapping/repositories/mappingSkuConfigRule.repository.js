const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { recordStatuses } = require('../constants/mappingRule.constants');
const MappingSkuConfigRule = require('../models/mappingSkuConfigRule.model');

function scopedFilter(query = {}) {
  const filter = {};
  if (query.shopId) filter.shopId = query.shopId;
  if (query.shopIds) filter.$or = [{ shopId: null }, { shopId: { $in: query.shopIds } }];
  if (query.salesChannelCode) filter.salesChannelCode = String(query.salesChannelCode).trim().toUpperCase();
  if (query.marketplaceCode) filter.marketplaceCode = String(query.marketplaceCode).trim().toUpperCase();
  if (query.configCode) filter.configCode = String(query.configCode).trim().toUpperCase();
  if (query.countryCode) filter.countryCode = String(query.countryCode).trim().toUpperCase();
  if (query.productTypeGroupId) filter.productTypeGroupId = query.productTypeGroupId;
  if (query.status) filter.status = String(query.status).trim().toUpperCase();
  return filter;
}

function contextFilter(context = {}) {
  const filter = {
    status: recordStatuses.ACTIVE,
    configCode: String(context.configCode || '').trim().toUpperCase(),
    $and: [
      { $or: [{ shopId: null }, { shopId: context.shopId || null }] },
      { $or: [{ salesChannelCode: null }, { salesChannelCode: context.salesChannelCode || null }] },
      { $or: [{ marketplaceCode: null }, { marketplaceCode: context.marketplaceCode || null }] },
    ],
  };
  if (context.countryCode) {
    filter.$and.push({ $or: [{ countryCode: null }, { countryCode: context.countryCode }] });
  }
  return filter;
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query);
  const skip = getPaginationOffset({ page, limit });
  const filter = scopedFilter(query);
  const [result = {}] = await MappingSkuConfigRule.aggregate([
    { $match: filter },
    { $sort: { priority: 1, createdAt: 1, _id: 1 } },
    { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'count' }] } },
  ]);
  return { items: result.items || [], pagination: { total: result.total?.[0]?.count || 0, page, limit } };
}

function findById(id, { session } = {}) {
  const query = MappingSkuConfigRule.findById(id);
  if (session) query.session(session);
  return query.lean();
}

function create(payload, { session } = {}) {
  return MappingSkuConfigRule.create([payload], { session }).then(([doc]) => doc.toObject());
}

function update(id, patch, { session } = {}) {
  return MappingSkuConfigRule.findByIdAndUpdate(id, { $set: patch }, {
    returnDocument: 'after',
    runValidators: true,
    session,
  }).lean();
}

function findActiveForContext(context = {}) {
  return MappingSkuConfigRule.find(contextFilter({
    ...context,
    salesChannelCode: context.salesChannelCode && String(context.salesChannelCode).trim().toUpperCase(),
    marketplaceCode: context.marketplaceCode && String(context.marketplaceCode).trim().toUpperCase(),
  })).sort({ priority: 1, createdAt: 1, _id: 1 }).lean();
}

module.exports = {
  create,
  findActiveForContext,
  findById,
  list,
  update,
};
