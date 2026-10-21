const VendorSubmission = require('../models/vendorSubmission.model');
const mongoose = require('mongoose');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');
const { escapeRegex } = require('../../../shared/utils/search');
const { vendorSubmissionStatuses } = require('../constants/vendorSubmission.constants');

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.sellerOrderItemIds) filter.$and = [{ orderItemId: { $in: query.sellerOrderItemIds.map(toObjectId) } }];
  if (query.id) filter._id = toObjectId(query.id);
  if (query.status) filter.status = query.status;
  else filter.status = { $ne: vendorSubmissionStatuses.CANCELLED };
  if (query.productionTaskId) filter.productionTaskId = toObjectId(query.productionTaskId);
  if (query.orderId) filter.orderId = toObjectId(query.orderId);
  if (query.orderItemId) filter.orderItemId = toObjectId(query.orderItemId);
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  if (query.shopIds && query.shopIds.length) filter.shopId = { $in: query.shopIds.map(toObjectId) };
  if (query.externalOrderId) {
    filter['payloadSnapshot.orderItem.externalOrderId'] = new RegExp(escapeRegex(String(query.externalOrderId).trim()), 'i');
  }
  if (query.vendorExternalOrderId) {
    filter.vendorExternalOrderId = new RegExp(escapeRegex(String(query.vendorExternalOrderId).trim()), 'i');
  }
  if (query.vendorId) {
    filter.$or = [
      { 'payloadSnapshot.vendorProduct.vendor.id': String(query.vendorId) },
      { 'payloadSnapshot.vendorProduct.vendor._id': String(query.vendorId) },
    ];
  }
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = query.dateFrom;
    if (query.dateTo) {
      const value = query.dateTo;
      filter.createdAt.$lte = new Date(
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? `${value}T23:59:59.999Z`
          : value,
      );
    }
  }
  return filter;
}

function buildTrackingFilter(query = {}) {
  const filter = {
    status: vendorSubmissionStatuses.SUBMITTED,
    provider: { $nin: [null, ''] },
    vendorExternalOrderId: { $nin: [null, ''] },
  };
  if (query.provider) filter.provider = String(query.provider).trim().toUpperCase();
  if (query.shopId) filter.shopId = toObjectId(query.shopId);
  if (query.shopIds && query.shopIds.length) filter.shopId = { $in: query.shopIds.map(toObjectId) };
  return filter;
}

async function create(payload) {
  const submission = await VendorSubmission.create(payload);
  return submission.toObject();
}

async function findById(submissionId) {
  return VendorSubmission.findById(submissionId).lean();
}

async function findActiveByProductionTask(productionTaskId) {
  return VendorSubmission.findOne({
    productionTaskId,
    status: { $ne: vendorSubmissionStatuses.CANCELLED },
  }).lean();
}

async function findByProductionTaskId(productionTaskId) {
  return VendorSubmission.findOne({ productionTaskId }).sort({ updatedAt: -1 }).lean();
}

async function findByOrderItemId(orderItemId) {
  return VendorSubmission.findOne({ orderItemId }).sort({ updatedAt: -1 }).lean();
}

async function findByProviderExternalOrderId({ provider, vendorExternalOrderId }) {
  return VendorSubmission.findOne({
    provider: String(provider || '').trim().toUpperCase(),
    vendorExternalOrderId: String(vendorExternalOrderId || '').trim(),
    status: vendorSubmissionStatuses.SUBMITTED,
  }).sort({ updatedAt: -1 }).lean();
}

async function listLatestByProductionTaskIds(productionTaskIds = []) {
  const ids = [...new Set(productionTaskIds.map(toObjectId))];
  if (!ids.length) return [];
  const submissions = await VendorSubmission.find({ productionTaskId: { $in: ids } })
    .sort({ productionTaskId: 1, updatedAt: -1, _id: -1 })
    .select('_id productionTaskId status submittedAt failedAt failureReason updatedAt')
    .lean();
  const latestByTaskId = new Map();
  for (const submission of submissions) {
    const key = String(submission.productionTaskId);
    if (!latestByTaskId.has(key)) latestByTaskId.set(key, submission);
  }
  return [...latestByTaskId.values()];
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = buildFilter(query);
  const [items, total] = await Promise.all([
    VendorSubmission.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    VendorSubmission.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

async function listSubmittedForTracking(query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  return VendorSubmission.aggregate([
    { $match: buildTrackingFilter(query) },
    {
      $lookup: {
        from: 'shipments',
        let: { vendorSubmissionId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$vendorSubmissionId', '$$vendorSubmissionId'] } } },
          { $sort: { updatedAt: -1, _id: -1 } },
          { $limit: 1 },
          { $project: { lastCheckedAt: 1 } },
        ],
        as: 'trackingShipment',
      },
    },
    { $unwind: { path: '$trackingShipment', preserveNullAndEmptyArrays: true } },
    { $sort: { 'trackingShipment.lastCheckedAt': 1, updatedAt: 1, _id: 1 } },
    { $limit: limit },
    { $project: { _id: 1, shopId: 1, orderItemId: 1, provider: 1, vendorExternalOrderId: 1 } },
  ]);
}

async function summarizePerformance(query = {}) {
  const filter = buildFilter(query);
  return VendorSubmission.aggregate([
    ...performancePipeline(filter),
  ]);
}

async function summarize(query = {}) {
  const filter = buildFilter(query);
  const [result = {}] = await VendorSubmission.aggregate([
    { $match: filter },
    {
      $addFields: {
        vendorRef: {
          $ifNull: [
            '$payloadSnapshot.vendorProduct.vendor.id',
            { $ifNull: ['$payloadSnapshot.vendorProduct.vendor._id', '$vendorProductId'] },
          ],
        },
      },
    },
    {
      $facet: {
        total: [{ $count: 'count' }],
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        byShop: [{ $group: { _id: '$shopId', count: { $sum: 1 } } }],
        byVendor: [
          {
            $group: {
              _id: '$vendorRef',
              vendorCode: { $first: '$payloadSnapshot.vendorProduct.vendor.code' },
              vendorName: { $first: '$payloadSnapshot.vendorProduct.vendor.name' },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1, vendorCode: 1 } },
        ],
      },
    },
  ]);

  const mapRows = (rows = []) => Object.fromEntries(
    rows.filter((row) => row._id !== null && row._id !== undefined).map((row) => [String(row._id), row.count || 0]),
  );

  return {
    total: result.total?.[0]?.count || 0,
    byStatus: mapRows(result.byStatus),
    byShop: (result.byShop || []).map((row) => ({ shopId: String(row._id), count: row.count || 0 })),
    byVendor: (result.byVendor || []).map((row) => ({
      vendorId: row._id === null || row._id === undefined ? null : String(row._id),
      vendorCode: row.vendorCode || null,
      vendorName: row.vendorName || null,
      count: row.count || 0,
    })),
  };
}

function performancePipeline(filter) {
  return [
    { $match: filter },
    {
      $addFields: {
        vendorRef: {
          $ifNull: [
            '$payloadSnapshot.vendorProduct.vendor.id',
            { $ifNull: ['$payloadSnapshot.vendorProduct.vendor._id', '$vendorProductId'] },
          ],
        },
        processingMs: {
          $cond: [
            { $and: ['$submittedAt', '$createdAt'] },
            { $subtract: ['$submittedAt', '$createdAt'] },
            null,
          ],
        },
      },
    },
    {
      $group: {
        _id: '$vendorRef',
        vendorCode: { $first: '$payloadSnapshot.vendorProduct.vendor.code' },
        vendorName: { $first: '$payloadSnapshot.vendorProduct.vendor.name' },
        orderItemIds: { $addToSet: '$orderItemId' },
        readyCount: { $sum: { $cond: [{ $eq: ['$status', vendorSubmissionStatuses.READY] }, 1, 0] } },
        submittedCount: { $sum: { $cond: [{ $eq: ['$status', vendorSubmissionStatuses.SUBMITTED] }, 1, 0] } },
        failedCount: { $sum: { $cond: [{ $eq: ['$status', vendorSubmissionStatuses.FAILED] }, 1, 0] } },
        cancelledCount: { $sum: { $cond: [{ $eq: ['$status', vendorSubmissionStatuses.CANCELLED] }, 1, 0] } },
        avgProcessingMs: { $avg: '$processingMs' },
      },
    },
    { $sort: { submittedCount: -1, failedCount: -1, vendorCode: 1 } },
  ];
}

async function summarizePerformancePage(query = {}) {
  const { page, limit } = normalizePagination(query, { defaultLimit: 100, maxLimit: 500 });
  const filter = buildFilter(query);
  const [result = {}] = await VendorSubmission.aggregate([
    ...performancePipeline(filter),
    {
      $facet: {
        items: [
          { $skip: getPaginationOffset({ page, limit }) },
          { $limit: limit },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ]);

  return toPaginatedResult({
    items: result.items || [],
    total: result.total?.[0]?.count || 0,
    page,
    limit,
  });
}

async function updateById(submissionId, patch) {
  return VendorSubmission.findByIdAndUpdate(
    submissionId,
    { $set: patch, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function claimReadyForSubmit(submissionId, { provider, operationKey, claimedAt }) {
  return VendorSubmission.findOneAndUpdate(
    { _id: submissionId, status: vendorSubmissionStatuses.READY },
    {
      $set: {
        status: vendorSubmissionStatuses.SUBMITTING,
        provider,
        submitOperationKey: operationKey,
        submitClaimedAt: claimedAt,
      },
      $inc: { __v: 1, submitAttemptCount: 1 },
    },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function transitionStatus(submissionId, fromStatuses, patch) {
  return VendorSubmission.findOneAndUpdate(
    { _id: submissionId, status: { $in: fromStatuses } },
    { $set: patch, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  buildFilter,
  claimReadyForSubmit,
  create,
  findActiveByProductionTask,
  findById,
  findByOrderItemId,
  findByProviderExternalOrderId,
  findByProductionTaskId,
  listLatestByProductionTaskIds,
  listSubmittedForTracking,
  list,
  summarize,
  summarizePerformance,
  summarizePerformancePage,
  transitionStatus,
  updateById,
};
