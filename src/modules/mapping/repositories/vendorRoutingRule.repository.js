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
  if (query.asin) filter.asin = String(query.asin).trim().toUpperCase();
  if (query.configCode) filter.configCode = String(query.configCode).trim().toUpperCase();
  if (query.normalizedSize) filter.normalizedSize = String(query.normalizedSize).trim().toUpperCase();
  if (query.normalizedColor) filter.normalizedColor = String(query.normalizedColor).trim().toUpperCase();
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
      { $or: [{ asin: null }, { asin: context.asin || null }] },
      { $or: [{ configCode: null }, { configCode: context.configCode || null }] },
      { $or: [{ normalizedSize: null }, { normalizedSize: context.normalizedSize || null }] },
      { $or: [{ normalizedColor: null }, { normalizedColor: context.normalizedColor || null }] },
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

function create(payload, { session } = {}) {
  return VendorRoutingRule.create([payload], { session }).then(([doc]) => doc.toObject());
}

function update(id, patch, { session } = {}) {
  return VendorRoutingRule.findByIdAndUpdate(id, { $set: patch }, {
    returnDocument: 'after',
    runValidators: true,
    session,
  }).lean();
}

function findForScopeVendor(scope = {}, vendorId, { session } = {}) {
  const filter = {
    shopId: scope.shopId || null,
    salesChannelCode: scope.salesChannelCode || null,
    marketplaceCode: scope.marketplaceCode || null,
    productTypeGroupId: scope.productTypeGroupId,
    vendorId,
  };
  const query = VendorRoutingRule.findOne(filter);
  if (session) query.session(session);
  return query.lean();
}

function upsertForScope(scope = {}, rank = {}, { session } = {}) {
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
    session,
  }).lean();
}

function listActiveForContext(context = {}) {
  return VendorRoutingRule.find(contextFilter({
    ...context,
    salesChannelCode: context.salesChannelCode && String(context.salesChannelCode).trim().toUpperCase(),
    marketplaceCode: context.marketplaceCode && String(context.marketplaceCode).trim().toUpperCase(),
    asin: context.asin && String(context.asin).trim().toUpperCase(),
    configCode: context.configCode && String(context.configCode).trim().toUpperCase(),
    normalizedSize: context.normalizedSize && String(context.normalizedSize).trim().toUpperCase(),
    normalizedColor: context.normalizedColor && String(context.normalizedColor).trim().toUpperCase(),
  })).sort({ priority: 1, createdAt: 1, _id: 1 }).lean();
}

module.exports = {
  create,
  findById,
  findForScopeVendor,
  list,
  listActiveForContext,
  update,
  upsertForScope,
};
