const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const Order = require('../models/order.model');

function buildFilter({
  shopId,
  status,
  salesChannelCode,
  marketplaceCode,
  externalOrderId,
  shopIds,
  orderedAtFrom,
  orderedAtTo,
  shipByDateFrom,
  shipByDateTo,
} = {}) {
  const filter = {};

  if (shopId) filter.shopId = shopId;
  if (shopIds && shopIds.length > 0) filter.shopId = { $in: shopIds };
  if (status) filter.status = status;
  if (salesChannelCode) filter.salesChannelCode = salesChannelCode;
  if (marketplaceCode) filter.marketplaceCode = marketplaceCode;
  if (externalOrderId) filter.externalOrderId = externalOrderId;
  if (orderedAtFrom || orderedAtTo) {
    filter.orderedAt = {};
    if (orderedAtFrom) filter.orderedAt.$gte = orderedAtFrom;
    if (orderedAtTo) filter.orderedAt.$lte = orderedAtTo;
  }
  if (shipByDateFrom || shipByDateTo) {
    filter.shipByDate = {};
    if (shipByDateFrom) filter.shipByDate.$gte = shipByDateFrom;
    if (shipByDateTo) filter.shipByDate.$lte = shipByDateTo;
  }

  return filter;
}

async function create(payload) {
  const order = await Order.create(payload);
  return order.toObject();
}

async function findById(orderId) {
  return Order.findById(orderId).lean();
}

async function findByExternalIdentity({ salesChannelCode, marketplaceCode, externalOrderId }) {
  return Order.findOne({
    salesChannelCode,
    marketplaceCode,
    externalOrderId,
  }).lean();
}

function buildAtomicUpdate({ set = {}, addToSet = {} } = {}) {
  const update = {};

  if (Object.keys(set).length > 0) {
    update.$set = set;
  }

  Object.entries(addToSet).forEach(([field, values]) => {
    if (!Array.isArray(values) || values.length === 0) {
      return;
    }

    update.$addToSet = update.$addToSet || {};
    update.$addToSet[field] = { $each: values };
  });

  return update;
}

async function updateFromExternalImport(orderId, payload) {
  return Order.findByIdAndUpdate(
    orderId,
    buildAtomicUpdate(payload),
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateAddressValidation(orderId, patch) {
  return Order.findByIdAndUpdate(
    orderId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateShippingAddress(orderId, patch) {
  return Order.findByIdAndUpdate(
    orderId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    Order.find(filter)
      .sort({ orderedAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

module.exports = {
  create,
  findById,
  findByExternalIdentity,
  updateAddressValidation,
  updateShippingAddress,
  updateFromExternalImport,
  list,
};
