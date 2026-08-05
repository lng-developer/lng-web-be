const Shipment = require('../models/shipment.model');
const mongoose = require('mongoose');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');
const { escapeRegex } = require('../../../shared/utils/search');
const { shipmentStatuses } = require('../constants/shipment.constants');

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.id) filter._id = toObjectId(query.id);
  if (query.status) filter.status = query.status;
  if (query.vendorSubmissionId) filter.vendorSubmissionId = toObjectId(query.vendorSubmissionId);
  if (query.orderId) filter.orderId = toObjectId(query.orderId);
  if (query.orderItemId) filter.orderItemId = toObjectId(query.orderItemId);
  if (query.orderItemIds && query.orderItemIds.length) filter.orderItemId = { $in: query.orderItemIds.map(toObjectId) };
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  if (query.shopIds && query.shopIds.length) filter.shopId = { $in: query.shopIds.map(toObjectId) };
  if (query.externalOrderId) filter.externalOrderId = new RegExp(escapeRegex(String(query.externalOrderId).trim()), 'i');
  if (query.vendorExternalOrderId) filter.vendorExternalOrderId = new RegExp(escapeRegex(String(query.vendorExternalOrderId).trim()), 'i');
  if (query.trackingNumber) filter.trackingNumber = new RegExp(escapeRegex(String(query.trackingNumber).trim()), 'i');
  if (query.carrier) filter.carrier = new RegExp(`^${escapeRegex(String(query.carrier).trim())}$`, 'i');
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) {
      filter.createdAt.$lte = new Date(
        typeof query.dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo)
          ? `${query.dateTo}T23:59:59.999Z`
          : query.dateTo,
      );
    }
  }
  return filter;
}

async function create(payload) {
  const shipment = await Shipment.create(payload);
  return shipment.toObject();
}

async function findById(shipmentId) {
  return Shipment.findById(shipmentId).lean();
}

async function findActiveByVendorSubmission(vendorSubmissionId) {
  return Shipment.findOne({ vendorSubmissionId }).lean();
}

async function findByOrderItem(orderItemId) {
  return Shipment.findOne({ orderItemId }).sort({ updatedAt: -1 }).lean();
}

async function listByOrderItemIds(orderItemIds = []) {
  return Shipment.find({
    orderItemId: { $in: orderItemIds },
    status: { $ne: shipmentStatuses.CANCELLED },
  }).lean();
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = buildFilter(query);
  const [items, total] = await Promise.all([
    Shipment.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    Shipment.countDocuments(filter),
  ]);
  return toPaginatedResult({
    items, total, page, limit,
  });
}

async function summarize(query = {}) {
  const filter = buildFilter(query);
  const [result = {}] = await Shipment.aggregate([
    { $match: filter },
    {
      $facet: {
        total: [{ $count: 'count' }],
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        byCarrier: [
          { $group: { _id: { $ifNull: ['$carrier', 'UNKNOWN'] }, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
        ],
      },
    },
  ]);

  const byStatus = Object.fromEntries((result.byStatus || [])
    .filter((row) => row._id)
    .map((row) => [row._id, row.count || 0]));

  return {
    total: result.total?.[0]?.count || 0,
    byStatus,
    byCarrier: (result.byCarrier || []).map((row) => ({
      carrier: row._id === 'UNKNOWN' ? null : row._id,
      count: row.count || 0,
    })),
  };
}

async function summarizeShippedByOrderItemIds(orderItemIds = []) {
  const uniqueIds = [...new Set(orderItemIds.map(String).filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const rows = await Shipment.aggregate([
    {
      $match: {
        orderItemId: { $in: uniqueIds.map(toObjectId) },
        status: { $in: [shipmentStatuses.SHIPPED, shipmentStatuses.DELIVERED] },
      },
    },
    { $group: { _id: '$orderItemId', count: { $sum: 1 } } },
  ]);

  return rows.reduce((result, row) => {
    result[String(row._id)] = row.count;
    return result;
  }, {});
}

async function updateById(shipmentId, patch) {
  return Shipment.findByIdAndUpdate(
    shipmentId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateTrackingIfNotDelivered(shipmentId, patch) {
  return Shipment.findOneAndUpdate(
    {
      _id: shipmentId,
      status: {
        $in: [
          shipmentStatuses.TRACKING_PENDING,
          shipmentStatuses.SHIPPED,
        ],
      },
    },
    { $set: patch, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateStatusIfCurrent(shipmentId, currentStatus, patch) {
  return Shipment.findOneAndUpdate(
    { _id: shipmentId, status: currentStatus },
    { $set: patch, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  buildFilter,
  create,
  findActiveByVendorSubmission,
  findById,
  findByOrderItem,
  list,
  listByOrderItemIds,
  summarize,
  summarizeShippedByOrderItemIds,
  updateById,
  updateStatusIfCurrent,
  updateTrackingIfNotDelivered,
};
