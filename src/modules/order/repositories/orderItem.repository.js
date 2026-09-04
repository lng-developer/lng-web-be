const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const mongoose = require('mongoose');
const OrderItem = require('../models/orderItem.model');

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFilter({
  orderId,
  orderIds,
  shopId,
  shopIds,
  status,
  salesChannelCode,
  marketplaceCode,
  externalOrderId,
  q,
  dateFrom,
  dateTo,
} = {}) {
  const filter = {};

  if (orderId) filter.orderId = toObjectId(orderId);
  if (orderIds?.length) filter.orderId = { $in: orderIds.map(toObjectId) };
  if (shopId) filter.shopId = toObjectId(shopId);
  if (shopIds && shopIds.length) filter.shopId = { $in: shopIds.map(toObjectId) };
  if (status) filter.status = status;
  if (salesChannelCode) filter.salesChannelCode = salesChannelCode;
  if (marketplaceCode) filter.marketplaceCode = marketplaceCode;
  if (externalOrderId) filter.externalOrderId = { $regex: escapeRegex(externalOrderId), $options: 'i' };
  if (q) {
    const search = { $regex: escapeRegex(q), $options: 'i' };
    filter.$or = [
      { externalOrderId: search },
      { externalItemId: search },
      { sku: search },
      { asin: search },
    ];
  }
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = dateFrom;
    if (dateTo) filter.createdAt.$lte = dateTo;
  }

  return filter;
}

async function create(payload) {
  const orderItem = await OrderItem.create(payload);
  return orderItem.toObject();
}

async function findById(orderItemId, { session } = {}) {
  const query = OrderItem.findById(orderItemId);
  if (session) query.session(session);
  return query.lean();
}

async function findByIds(orderItemIds = []) {
  if (!orderItemIds.length) return [];
  return OrderItem.find({ _id: { $in: orderItemIds.map(toObjectId) } }).lean();
}

async function findIds(query = {}) {
  return OrderItem.distinct('_id', buildFilter(query));
}

async function findListingIdsByOrderIds(orderIds = []) {
  if (!orderIds.length) return [];
  return OrderItem.distinct('listingId', {
    orderId: { $in: orderIds.map(toObjectId) },
    listingId: { $ne: null },
  });
}

async function findByExternalIdentity({ orderId, externalItemId }) {
  return OrderItem.findOne({ orderId, externalItemId }).lean();
}

async function findByFinanceIdentity({
  shopId,
  salesChannelCode,
  marketplaceCode,
  externalOrderId,
  sku,
  externalItemId,
} = {}) {
  if (!externalOrderId) return null;

  const filter = {
    shopId,
    salesChannelCode,
    marketplaceCode,
    externalOrderId,
  };

  if (externalItemId) {
    const item = await OrderItem.findOne({ ...filter, externalItemId }).lean();
    if (item) return item;
  }

  if (!sku) return null;
  const matches = await OrderItem.find({ ...filter, sku }).limit(2).lean();
  return matches.length === 1 ? matches[0] : null;
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

async function updateFromExternalImport(orderItemId, payload) {
  return OrderItem.findByIdAndUpdate(
    orderItemId,
    buildAtomicUpdate(payload),
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateStatus(orderItemId, status, { session } = {}) {
  return OrderItem.findByIdAndUpdate(
    orderItemId,
    { $set: { status } },
    { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) },
  ).lean();
}

async function updateExternalItemId(orderItemId, externalItemId) {
  return OrderItem.findByIdAndUpdate(
    orderItemId,
    { $set: { externalItemId } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateAsin(orderItemId, asin) {
  return OrderItem.findByIdAndUpdate(
    orderItemId,
    { $set: { asin } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateListingId(orderItemId, listingId) {
  return OrderItem.findByIdAndUpdate(
    orderItemId,
    { $set: { listingId } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateCsNote(orderItemId, csNote, { session } = {}) {
  return OrderItem.findByIdAndUpdate(
    orderItemId,
    { $set: { csNote: csNote || null } },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function listByOrder(orderId, { page = 1, limit = 20, status } = {}) {
  const filter = { orderId };

  if (status) {
    filter.status = status;
  }

  const [items, total] = await Promise.all([
    OrderItem.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    OrderItem.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

async function listAllByOrder(orderId, { session } = {}) {
  const query = OrderItem.find({ orderId }).sort({ createdAt: 1, _id: 1 });
  if (session) query.session(session);
  return query.lean();
}

async function listOrderIdsByListingId(listingId) {
  const orderIds = await OrderItem.distinct('orderId', { listingId: toObjectId(listingId) });
  return orderIds.map(String);
}

async function listByOrderIds(orderIds = [], { limitPerOrder = 100 } = {}) {
  if (!orderIds.length) return [];

  const items = await OrderItem.find({ orderId: { $in: orderIds } })
    .sort({ orderId: 1, createdAt: 1, _id: 1 })
    .lean();

  const counts = new Map();
  return items.filter((item) => {
    const orderId = String(item.orderId);
    const count = counts.get(orderId) || 0;
    if (count >= limitPerOrder) return false;
    counts.set(orderId, count + 1);
    return true;
  });
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [result = {}] = await OrderItem.aggregate([
    { $match: filter },
    { $sort: { createdAt: -1, _id: -1 } },
    { $facet: {
      items: [{ $skip: getPaginationOffset({ page, limit }) }, { $limit: limit }],
      total: [{ $count: 'count' }],
    } },
  ]);
  return toPaginatedResult({ items: result.items || [], total: result.total?.[0]?.count || 0, page, limit });
}

async function findByIdWithOrder(orderItemId) {
  const [row] = await OrderItem.aggregate([
    { $match: { _id: toObjectId(orderItemId) } },
    { $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', as: 'order' } },
    { $unwind: '$order' },
  ]);
  if (!row) return null;
  const { order, ...item } = row;
  return { item, order };
}

async function summarize(query = {}) {
  const filter = buildFilter(query);
  const rows = await OrderItem.aggregate([
    { $match: filter },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  return rows.reduce((result, row) => {
    result[row._id] = row.count;
    return result;
  }, {});
}

async function summarizeSalesByListingIds(listingIds = []) {
  if (mongoose.connection.readyState !== 1) return [];
  const ids = [...new Set((listingIds || []).filter(Boolean).map(String))]
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!ids.length) return [];
  return OrderItem.aggregate([
    { $match: { listingId: { $in: ids } } },
    {
      $group: {
        _id: '$listingId',
        orderIds: { $addToSet: '$orderId' },
        orderItemCount: { $sum: 1 },
        quantitySold: { $sum: '$quantity' },
        lastSoldAt: { $max: '$createdAt' },
      },
    },
    {
      $project: {
        _id: 0,
        listingId: '$_id',
        orderCount: { $size: '$orderIds' },
        orderItemCount: 1,
        quantitySold: 1,
        lastSoldAt: 1,
      },
    },
  ]);
}

async function listTopSalesByListing({
  shopId,
  shopIds,
  salesChannelCode,
  marketplaceCode,
  sort = 'quantitySoldDesc',
  limit = 5,
} = {}) {
  const match = { listingId: { $ne: null } };
  if (shopId) match.shopId = shopId;
  if (shopIds?.length) match.shopId = { $in: shopIds };
  if (salesChannelCode) match.salesChannelCode = salesChannelCode;
  if (marketplaceCode) match.marketplaceCode = marketplaceCode;
  const sortField = {
    orderCountDesc: 'orderCount',
    quantitySoldDesc: 'quantitySold',
    lastSoldAtDesc: 'lastSoldAt',
  }[sort] || 'quantitySold';

  return OrderItem.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$listingId',
        orderIds: { $addToSet: '$orderId' },
        orderItemCount: { $sum: 1 },
        quantitySold: { $sum: '$quantity' },
        lastSoldAt: { $max: '$createdAt' },
      },
    },
    {
      $project: {
        _id: 0,
        listingId: '$_id',
        orderCount: { $size: '$orderIds' },
        orderItemCount: 1,
        quantitySold: 1,
        lastSoldAt: 1,
      },
    },
    { $sort: { [sortField]: -1, listingId: 1 } },
    { $limit: Math.min(Math.max(Number(limit) || 5, 1), 5) },
  ]);
}

async function summarizeSalesByAsins(asins = []) {
  const normalizedAsins = [...new Set((asins || []).filter(Boolean).map((asin) => String(asin).trim().toUpperCase()))];
  if (!normalizedAsins.length) return [];
  return OrderItem.aggregate([
    { $match: { listingId: { $ne: null } } },
    {
      $lookup: {
        from: 'listings',
        localField: 'listingId',
        foreignField: '_id',
        as: 'listing',
      },
    },
    { $unwind: '$listing' },
    { $match: { 'listing.asin': { $in: normalizedAsins } } },
    {
      $group: {
        _id: '$listing.asin',
        orderIds: { $addToSet: '$orderId' },
        orderItemCount: { $sum: 1 },
        quantitySold: { $sum: '$quantity' },
        lastSoldAt: { $max: '$createdAt' },
      },
    },
    {
      $project: {
        _id: 0,
        asin: '$_id',
        orderCount: { $size: '$orderIds' },
        orderItemCount: 1,
        quantitySold: 1,
        lastSoldAt: 1,
      },
    },
  ]);
}

module.exports = {
  create,
  findById,
  findByIdWithOrder,
  findByIds,
  findIds,
  findListingIdsByOrderIds,
  findByExternalIdentity,
  findByFinanceIdentity,
  updateFromExternalImport,
  updateStatus,
  updateExternalItemId,
  updateAsin,
  updateListingId,
  updateCsNote,
  listAllByOrder,
  listOrderIdsByListingId,
  listByOrder,
  listByOrderIds,
  list,
  summarize,
  listTopSalesByListing,
  summarizeSalesByAsins,
  summarizeSalesByListingIds,
};
