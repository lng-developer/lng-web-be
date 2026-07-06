const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { recordStatuses } = require('../constants/mappingRule.constants');
const VendorRoutingRule = require('../models/vendorRoutingRule.model');

function scopedFilter(query = {}) {
  const filter = {};
  if (query.shopId) filter.shopId = query.shopId;
  if (query.shopIds) filter.$or = [{ shopId: null }, { shopId: { $in: query.shopIds } }];
  if (query.salesChannelCode) filter.salesChannelCode = String(query.salesChannelCode).trim().toUpperCase();
  if (query.marketplaceCode) filter.marketplaceCode = String(query.marketplaceCode).trim().toUpperCase();
  if (query.productTypeGroupId) filter.productTypeGroupId = query.productTypeGroupId;
  if (query.vendorId) filter.vendorId = query.vendorId;
  if (query.status) filter.status = String(query.status).trim().toUpperCase();
  return filter;
}

function contextFilter(context = {}) {
  return {
    status: recordStatuses.ACTIVE,
    productTypeGroupId: context.productTypeGroupId,
    $and: [
      { $or: [{ shopId: null }, { shopId: context.shopId || null }] },
      { $or: [{ salesChannelCode: null }, { salesChannelCode: context.salesChannelCode || null }] },
      { $or: [{ marketplaceCode: null }, { marketplaceCode: context.marketplaceCode || null }] },
    ],
  };
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query);
  const skip = getPaginationOffset({ page, limit });
  const filter = scopedFilter(query);
  const [items, total] = await Promise.all([
    VendorRoutingRule.find(filter).sort({ priority: 1, createdAt: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    VendorRoutingRule.countDocuments(filter),
  ]);
  return { items, pagination: { total, page, limit } };
}

function findById(id) {
  return VendorRoutingRule.findById(id).lean();
}

function create(payload) {
  return VendorRoutingRule.create(payload).then((doc) => doc.toObject());
}

function update(id, patch) {
  return VendorRoutingRule.findByIdAndUpdate(id, { $set: patch }, {
    returnDocument: 'after',
    runValidators: true,
  }).lean();
}

function upsertForScope(scope = {}, rank = {}) {
  const filter = {
    shopId: scope.shopId || null,
    salesChannelCode: scope.salesChannelCode || null,
    marketplaceCode: scope.marketplaceCode || null,
    productTypeGroupId: scope.productTypeGroupId,
    vendorId: rank.vendorId,
  };
  return VendorRoutingRule.findOneAndUpdate(filter, {
    $set: {
      priority: rank.priority,
      status: rank.status,
    },
    $setOnInsert: filter,
  }, {
    new: true,
    upsert: true,
    runValidators: true,
  }).lean();
}

function listActiveForContext(context = {}) {
  return VendorRoutingRule.find(contextFilter({
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
  upsertForScope,
};
