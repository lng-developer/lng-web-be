const ProductionTask = require('../models/productionTask.model');
const mongoose = require('mongoose');
const { getPaginationOffset, normalizePagination, toPaginatedResult } = require('../../../shared/utils/pagination');
const { escapeRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const { productionQcStatuses, productionTaskStatuses } = require('../constants/production.constants');

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

async function findByOrderItem(orderItemId, { session } = {}) {
  const query = ProductionTask.findOne({ orderItemId });
  if (session) query.session(session);
  return query.lean();
}

async function listByOrderItemIds(orderItemIds = []) {
  return ProductionTask.find({ orderItemId: { $in: orderItemIds } }).lean();
}

async function listSummariesByOrderItemIds(orderItemIds = []) {
  return ProductionTask.find({ orderItemId: { $in: orderItemIds } })
    .select('orderId orderItemId orderSnapshot orderItemSnapshot shopId status scaleStatus qcStatus blockers fulfillQty assignedDesignUserId assignedAt designNote csAssigneeId csAssignedBy csAssignedAt csStatus csNote qcBy readyAt sentToVendorAt vendorSubmissionId vendorProductSnapshot vendorCostCenterSnapshot createdAt updatedAt')
    .lean();
}

function sellerCodeRegex(value) {
  const sellerCode = normalizeSearchTerm(value);
  return sellerCode ? new RegExp(`^${escapeRegex(sellerCode)}(?:-|$)`, 'i') : null;
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
    .select('_id orderItemId shopId blockers orderItemSnapshot')
    .lean();
}

async function listPsdBlockedByExternalOrderId(externalOrderId) {
  const search = normalizeSearchTerm(externalOrderId);
  if (!search) return [];
  return ProductionTask.find({
    blockers: 'PSD_MISSING',
    'orderItemSnapshot.externalOrderId': new RegExp(escapeRegex(search), 'i'),
  })
    .select('_id orderItemId shopId blockers orderItemSnapshot listingSnapshot')
    .lean();
}

function buildFilter(query = {}) {
  const filter = {};
  const andClauses = [];
  if (query.status) filter.status = query.status;
  if (query.scaleStatus) filter.scaleStatus = query.scaleStatus;
  if (query.qcStatus) filter.qcStatus = query.qcStatus;
  if (query.view === 'QC') filter.qcStatus = productionQcStatuses.PENDING;
  if (query.view === 'SCALE') {
    filter.status = { $in: [productionTaskStatuses.NEED_SCALE, productionTaskStatuses.QC_REJECTED] };
  }
  if (query.salesChannelCode) filter['orderItemSnapshot.salesChannelCode'] = query.salesChannelCode;
  if (query.listingVariantIds) filter.listingVariantId = { $in: query.listingVariantIds };
  if (query.blocker) filter.blockers = query.blocker;
  if (query.readyForScale === true) {
    filter.vendorProductSnapshot = { $ne: null };
    filter.vendorCostCenterSnapshot = { $ne: null };
    filter['orderSnapshot.addressValidationStatus'] = { $in: ['VALID', 'OVERRIDDEN'] };
    andClauses.push(
      { $or: [{ blockers: { $size: 0 } }, { blockers: { $exists: false } }] },
      { fileChecks: { $elemMatch: { sourceType: 'PSD_TEMPLATE', inputAssetId: { $ne: null } } } },
    );
  }
  if (query.shopId) filter.shopId = query.shopId;
  if (query.shopIds && query.shopIds.length) filter.shopId = { $in: query.shopIds };
  if (query.sellerCode) {
    const regex = sellerCodeRegex(query.sellerCode);
    if (regex) filter['orderItemSnapshot.sku'] = regex;
  }
  if (query.tab === 'ADDRESS_INVALID') filter['orderSnapshot.addressValidationStatus'] = 'INVALID';
  if (query.tab === 'FAILED') {
    andClauses.push({ $or: [
      { status: productionTaskStatuses.QC_REJECTED },
      { status: productionTaskStatuses.CANCELLED },
      { qcStatus: 'REJECTED' },
      { blockers: 'QC_REJECTED' },
    ] });
  }
  if (Object.prototype.hasOwnProperty.call(query, 'assignedDesignUserId')) {
    filter.assignedDesignUserId = query.assignedDesignUserId;
  }
  if (query.assignedDesignUserIds && query.assignedDesignUserIds.length) {
    filter.assignedDesignUserId = {
      $in: [
        ...query.assignedDesignUserIds,
        ...(query.includeUnassignedDesignUser ? [null] : []),
      ],
    };
  }
  if (query.qcBy) filter.qcBy = query.qcBy;
  if (Object.prototype.hasOwnProperty.call(query, 'csAssigneeId')) {
    filter.csAssigneeId = query.csAssigneeId;
  }
  if (query.csUnassigned === true) filter.csAssigneeId = null;
  if (query.csStatus) filter.csStatus = query.csStatus;
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
    andClauses.push({ $or: [
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
    ] });
  }

  if (andClauses.length === 1) Object.assign(filter, andClauses[0]);
  if (andClauses.length > 1) filter.$and = andClauses;

  return filter;
}

function mapCountRows(rows = []) {
  return (rows || []).reduce((result, row) => {
    if (row && row._id !== null && row._id !== undefined) result[row._id] = row.count || 0;
    return result;
  }, {});
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
  const [facetResult = {}] = await ProductionTask.aggregate([
      { $match: filter },
      {
        $facet: {
          totals: [{
            $group: {
              _id: null,
              total: { $sum: 1 },
              unassigned: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$assignedDesignUserId', null] }, null] }, 1, 0] } },
              assigned: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$assignedDesignUserId', null] }, null] }, 1, 0] } },
              blocked: { $sum: { $cond: [{ $eq: ['$status', productionTaskStatuses.BLOCKED] }, 1, 0] } },
              needScale: { $sum: { $cond: [{ $eq: ['$status', productionTaskStatuses.NEED_SCALE] }, 1, 0] } },
              qcPending: { $sum: { $cond: [{ $eq: ['$status', productionTaskStatuses.QC_PENDING] }, 1, 0] } },
              scaleQueue: { $sum: { $cond: [{ $in: ['$status', [productionTaskStatuses.NEED_SCALE, productionTaskStatuses.QC_REJECTED]] }, 1, 0] } },
              qcQueue: { $sum: { $cond: [{ $eq: ['$qcStatus', productionQcStatuses.PENDING] }, 1, 0] } },
              readyToSendVendor: { $sum: { $cond: [{ $eq: ['$status', productionTaskStatuses.READY_TO_SEND_VENDOR] }, 1, 0] } },
              addressInvalid: { $sum: { $cond: [{ $eq: ['$orderSnapshot.addressValidationStatus', 'INVALID'] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $or: [
                { $eq: ['$status', productionTaskStatuses.QC_REJECTED] },
                { $eq: ['$status', productionTaskStatuses.CANCELLED] },
                { $eq: ['$qcStatus', 'REJECTED'] },
                { $in: ['QC_REJECTED', { $ifNull: ['$blockers', []] }] },
              ] }, 1, 0] } },
              csUnassigned: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$csAssigneeId', null] }, null] }, 1, 0] } },
              csAssigned: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$csAssigneeId', null] }, null] }, 1, 0] } },
            },
          }],
          blockers: [
            { $unwind: '$blockers' },
            { $group: { _id: '$blockers', count: { $sum: 1 } } },
          ],
          scaleStatuses: [
            { $group: { _id: '$scaleStatus', count: { $sum: 1 } } },
          ],
          qcStatuses: [
            { $group: { _id: '$qcStatus', count: { $sum: 1 } } },
          ],
          assignmentStatuses: [
            {
              $project: {
                assignmentStatus: {
                  $cond: [
                    { $in: ['$status', OUTPUT_UPLOADED_STATUSES] },
                    'OUTPUT_UPLOADED',
                    { $cond: [{ $eq: ['$assignedDesignUserId', null] }, 'UNASSIGNED', 'ASSIGNED'] },
                  ],
                },
              },
            },
            { $group: { _id: '$assignmentStatus', count: { $sum: 1 } } },
          ],
          csStatuses: [
            { $group: { _id: { $ifNull: ['$csStatus', 'UNASSIGNED'] }, count: { $sum: 1 } } },
          ],
          salesChannels: [
            { $group: { _id: '$orderItemSnapshot.salesChannelCode', count: { $sum: 1 } } },
          ],
        },
      },
    ]);
  const totals = facetResult.totals?.[0] || {};

  return {
    total: totals.total || 0,
    unassigned: totals.unassigned || 0,
    assigned: totals.assigned || 0,
    blocked: totals.blocked || 0,
    needScale: totals.needScale || 0,
    qcPending: totals.qcPending || 0,
    scaleQueue: totals.scaleQueue || 0,
    qcQueue: totals.qcQueue || 0,
    readyToSendVendor: totals.readyToSendVendor || 0,
    addressInvalid: totals.addressInvalid || 0,
    failed: totals.failed || 0,
    csUnassigned: totals.csUnassigned || 0,
    csAssigned: totals.csAssigned || 0,
    byScaleStatus: mapCountRows(facetResult.scaleStatuses),
    byQcStatus: mapCountRows(facetResult.qcStatuses),
    byAssignmentStatus: mapCountRows(facetResult.assignmentStatuses),
    byCsStatus: mapCountRows(facetResult.csStatuses),
    bySalesChannelCode: mapCountRows(facetResult.salesChannels),
    blockers: mapCountRows(facetResult.blockers),
  };
}

async function listForExport(query = {}) {
  return ProductionTask.find(buildFilter(query))
    .sort(parseSort(query.sort))
    .limit(Math.min(Number(query.limit || 1000), 5000))
    .lean();
}

async function upsertByOrderItem(orderItemId, payload, { session } = {}) {
  return ProductionTask.findOneAndUpdate(
    { orderItemId },
    { $set: payload },
    {
      upsert: true,
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: true,
      session,
    },
  ).lean();
}

async function updateById(taskId, patch, { session } = {}) {
  return ProductionTask.findByIdAndUpdate(
    taskId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function upsertByOrderItemWithResult(
  orderItemId, payload, { session, setOnInsert = {} } = {},
) {
  const result = await ProductionTask.findOneAndUpdate(
    { orderItemId },
    { $set: payload, $setOnInsert: setOnInsert },
    {
      upsert: true,
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: true,
      includeResultMetadata: true,
      session,
    },
  ).lean();
  return { task: result.value, created: !result.lastErrorObject?.updatedExisting };
}

async function updateByIdIf(taskId, filter, patch, { session } = {}) {
  return ProductionTask.findOneAndUpdate(
    { _id: taskId, ...filter },
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function updateScaledOutputIfMutable(taskId, patch, { session } = {}) {
  return ProductionTask.findOneAndUpdate(
    {
      _id: taskId,
      status: {
        $nin: [
          productionTaskStatuses.READY_TO_SEND_VENDOR,
          productionTaskStatuses.SENT_TO_VENDOR,
          productionTaskStatuses.CANCELLED,
        ],
      },
      qcStatus: { $ne: 'PASSED' },
    },
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

function mutableScaleFilter(taskId) {
  return {
    _id: taskId,
    status: {
      $nin: [
        productionTaskStatuses.READY_TO_SEND_VENDOR,
        productionTaskStatuses.SENT_TO_VENDOR,
        productionTaskStatuses.CANCELLED,
      ],
    },
    qcStatus: { $ne: 'PASSED' },
  };
}

async function appendFileCheckIfMutable(taskId, fileCheck, { session } = {}) {
  return ProductionTask.findOneAndUpdate(
    { ...mutableScaleFilter(taskId), 'fileChecks.slotKey': { $ne: fileCheck.slotKey } },
    { $push: { fileChecks: fileCheck } },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function updateFileCheckOutputIfMutable(
  taskId, fileCheckId, expected, patch, { session } = {},
) {
  return ProductionTask.findOneAndUpdate(
    {
      ...mutableScaleFilter(taskId),
      fileChecks: { $elemMatch: { _id: fileCheckId, ...expected } },
    },
    {
      $set: Object.fromEntries(
        Object.entries(patch).map(([key, value]) => [`fileChecks.$[check].${key}`, value]),
      ),
    },
    {
      arrayFilters: [{ 'check._id': fileCheckId }],
      returnDocument: 'after',
      runValidators: true,
      session,
    },
  ).lean();
}

async function updateOrderAddressSnapshot(orderId, order = {}) {
  return ProductionTask.updateMany(
    { orderId },
    {
      $set: {
        'orderSnapshot.addressValidationStatus': order.addressValidationStatus || null,
        'orderSnapshot.shippingAddress': order.shippingAddress || null,
      },
    },
  );
}

function listQcPassedForWorkScore(limit) {
  return ProductionTask.find({ qcStatus: productionQcStatuses.PASSED })
    .sort({ _id: 1 }).limit(limit).lean();
}

module.exports = {
  findById,
  findByOrderItem,
  list,
  listForExport,
  listQcPassedForWorkScore,
  listPsdBlockedByListingId,
  listPsdBlockedByExternalOrderId,
  listByOrderItemIds,
  listSummariesByOrderItemIds,
  summarize,
  updateById,
  updateByIdIf,
  appendFileCheckIfMutable,
  updateFileCheckOutputIfMutable,
  updateScaledOutputIfMutable,
  updateOrderAddressSnapshot,
  upsertByOrderItem,
  upsertByOrderItemWithResult,
};
