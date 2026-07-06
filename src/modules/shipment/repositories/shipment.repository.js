const Shipment = require('../models/shipment.model');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');
const { shipmentStatuses } = require('../constants/shipment.constants');

function buildFilter(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.vendorSubmissionId) filter.vendorSubmissionId = query.vendorSubmissionId;
  if (query.orderId) filter.orderId = query.orderId;
  if (query.orderItemId) filter.orderItemId = query.orderItemId;
  if (query.shopId) filter.shopId = query.shopId;
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
  return Shipment.findOne({
    vendorSubmissionId,
    status: { $ne: shipmentStatuses.CANCELLED },
  }).lean();
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

async function updateById(shipmentId, patch) {
  return Shipment.findByIdAndUpdate(
    shipmentId,
    { $set: patch },
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
  updateById,
};
