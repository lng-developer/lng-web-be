const ProductionTask = require('../models/productionTask.model');
const mongoose = require('mongoose');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');
const { escapeRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const { productionTaskStatuses } = require('../constants/production.constants');

const OUTPUT_UPLOADED_STATUSES = [
  productionTaskStatuses.QC_PENDING,
  productionTaskStatuses.QC_REJECTED,
  productionTaskStatuses.READY_TO_SEND_VENDOR,
  productionTaskStatuses.SENT_TO_VENDOR,
];

const DESIGN_OPEN_STATUSES = [
  productionTaskStatuses.BLOCKED,
  productionTaskStatuses.NEED_SCALE,
];
const DEFAULT_SORT = { updatedAt: -1 };
const SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'assignedAt',
  'readyAt',
  'sentToVendorAt',
  'status',
  'scaleStatus',
  'qcStatus',
]);

function addDateRange(filter, field, from, to) {
  if (!from && !to) return;
  filter[field] = {};
  if (from) filter[field].$gte = from;
  if (to) filter[field].$lte = to;
}

function parseSort(sort) {
  if (!sort) return DEFAULT_SORT;
  const parsed = {};
  String(sort).split(',').forEach((part) => {
    const value = part.trim();
    if (!value) return;
    const direction = value.startsWith('-') ? -1 : 1;
    const field = value.replace(/^-/, '');
    if (SORT_FIELDS.has(field)) parsed[field] = direction;
  });
  return { ...(Object.keys(parsed).length ? parsed : DEFAULT_SORT), _id: 1 };
}

async function findById(taskId) {
  return ProductionTask.findById(taskId).lean();
}

async function findByOrderItem(orderItemId) {
  return ProductionTask.findOne({ orderItemId }).lean();
}

async function listByOrderItemIds(orderItemIds = []) {
  return ProductionTask.find({ orderItemId: { $in: orderItemIds } }).lean();
}

async function listSummariesByOrderItemIds(orderItemIds = []) {
  return ProductionTask.find({ orderItemId: { $in: orderItemIds } })
    .select('orderItemId orderItemSnapshot shopId status scaleStatus qcStatus blockers fulfillQty assignedDesignUserId assignedAt designNote qcBy readyAt sentToVendorAt')
    .lean();
}

async function listPsdBlockedByListingId(listingId) {
  const listingObjectId = mongoose.Types.ObjectId.isValid(listingId)
    ? new mongoose.Types.ObjectId(listingId)
    : null;
  const listingMatches = [
    { 'listingSnapshot.id': String(listingId) },
    { 'listingSnapshot._id': String(listingId) },
  ];
  if (listingObjectId) listingMatches.push({ 'listingSnapshot._id': listingObjectId });

  return ProductionTask.find({
    blockers: 'PSD_MISSING',
    $or: listingMatches,
  })
    .select('_id orderItemId shopId blockers')
    .lean();
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.scaleStatus) filter.scaleStatus = query.scaleStatus;
  if (query.qcStatus) filter.qcStatus = query.qcStatus;
  if (query.blocker) filter.blockers = query.blocker;
  if (query.shopId) filter.shopId = query.shopId;
  if (query.shopIds && query.shopIds.length) filter.shopId = { $in: query.shopIds };
  if (Object.prototype.hasOwnProperty.call(query, 'assignedDesignUserId')) {
    filter.assignedDesignUserId = query.assignedDesignUserId;
  }
  if (query.qcBy) filter.qcBy = query.qcBy;
  addDateRange(filter, 'createdAt', query.dateFrom, query.dateTo);
  addDateRange(filter, 'assignedAt', query.assignedAtFrom, query.assignedAtTo);
  addDateRange(filter, 'readyAt', query.readyAtFrom, query.readyAtTo);
  if (query.designAssignmentStatus === 'UNASSIGNED') {
    filter.assignedDesignUserId = null;
  }
  if (query.designAssignmentStatus === 'ASSIGNED') {
    if (!Object.prototype.hasOwnProperty.call(filter, 'assignedDesignUserId')) {
      filter.assignedDesignUserId = { $ne: null };
    }
    if (!filter.status) filter.status = { $in: DESIGN_OPEN_STATUSES };
  }
  if (query.designAssignmentStatus === 'OUTPUT_UPLOADED' && !filter.status) {
    filter.status = { $in: OUTPUT_UPLOADED_STATUSES };
  }

  const search = normalizeSearchTerm(query.search);
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    filter.$or = [
      { 'orderItemSnapshot.externalOrderId': regex },
      { 'orderItemSnapshot.externalItemId': regex },
      { 'orderItemSnapshot.sku': regex },
      { 'orderItemSnapshot.asin': regex },
      { 'orderItemSnapshot.title': regex },
      { 'listingSnapshot.sku': regex },
      { 'listingSnapshot.title': regex },
      { 'listingSnapshot.code': regex },
      { 'templateSnapshot.code': regex },
      { 'templateSnapshot.name': regex },
      { 'vendorProductSnapshot.code': regex },
      { 'vendorProductSnapshot.name': regex },
      { 'vendorCostCenterSnapshot.code': regex },
      { 'vendorCostCenterSnapshot.name': regex },
    ];
  }

  return filter;
}

async function list(query = {}) {
  const filter = buildFilter(query);

  const { page, limit } = normalizePagination(query, { defaultLimit: 50, maxLimit: 100 });
  const [items, total] = await Promise.all([
    ProductionTask.find(filter)
      .sort(parseSort(query.sort))
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    ProductionTask.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

async function summarize(query = {}) {
  const filter = buildFilter(query);
  const withFilter = (extra) => ({ ...filter, ...extra });
  const [
    total,
    unassigned,
    assigned,
    blocked,
    needScale,
    qcPending,
    readyToSendVendor,
    blockerRows,
  ] = await Promise.all([
    ProductionTask.countDocuments(filter),
    ProductionTask.countDocuments(withFilter({ assignedDesignUserId: null })),
    ProductionTask.countDocuments(withFilter({ assignedDesignUserId: { $ne: null } })),
    ProductionTask.countDocuments(withFilter({ status: productionTaskStatuses.BLOCKED })),
    ProductionTask.countDocuments(withFilter({ status: productionTaskStatuses.NEED_SCALE })),
    ProductionTask.countDocuments(withFilter({ status: productionTaskStatuses.QC_PENDING })),
    ProductionTask.countDocuments(withFilter({ status: productionTaskStatuses.READY_TO_SEND_VENDOR })),
    ProductionTask.aggregate([
      { $match: filter },
      { $unwind: '$blockers' },
      { $group: { _id: '$blockers', count: { $sum: 1 } } },
    ]),
  ]);

  return {
    total,
    unassigned,
    assigned,
    blocked,
    needScale,
    qcPending,
    readyToSendVendor,
    blockers: blockerRows.reduce((result, row) => {
      result[row._id] = row.count;
      return result;
    }, {}),
  };
}

async function upsertByOrderItem(orderItemId, payload) {
  return ProductionTask.findOneAndUpdate(
    { orderItemId },
    { $set: payload },
    {
      upsert: true,
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  ).lean();
}

async function updateById(taskId, patch) {
  return ProductionTask.findByIdAndUpdate(
    taskId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  findById,
  findByOrderItem,
  list,
  listPsdBlockedByListingId,
  listByOrderItemIds,
  listSummariesByOrderItemIds,
  summarize,
  updateById,
  upsertByOrderItem,
};
