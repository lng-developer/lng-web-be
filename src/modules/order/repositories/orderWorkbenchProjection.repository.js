const mongoose = require('mongoose');
const OrderWorkbenchProjection = require('../models/orderWorkbenchProjection.model');
const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const {
  addressValidationStatuses, caseStatuses, costCenterStatuses, orderItemStatuses, orderListTabs, orderStatuses, paymentStatuses,
} = require('../constants/orderStatuses');

const ITEM_STATUS_BY_TAB = Object.freeze({
  [orderListTabs.NEEDS_CUSTOMIZATION]: orderItemStatuses.CUSTOMIZATION_PENDING,
  [orderListTabs.NEEDS_MAPPING]: orderItemStatuses.MAPPING_PENDING,
  [orderListTabs.READY_FOR_PRODUCTION]: orderItemStatuses.NEED_PRODUCTION,
  [orderListTabs.SENT_TO_VENDOR]: orderItemStatuses.SENT_TO_VENDOR,
  [orderListTabs.TRACKING_PENDING]: orderItemStatuses.TRACKING_PENDING,
});
const NEW_ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const SORT_FIELDS = new Set(['orderedAt', 'shipByDate', 'externalOrderId', 'status', 'salesChannelCode', 'marketplaceCode', 'createdAt', 'updatedAt']);

function newOrderCutoff() {
  return new Date(Date.now() - NEW_ORDER_WINDOW_MS);
}

function applyNewOrderWindow(filter) {
  const cutoff = newOrderCutoff();
  const existing = filter.orderedAt || {};
  const existingLowerBound = existing.$gte ? new Date(existing.$gte) : null;
  filter.orderedAt = {
    ...existing,
    $gte: existingLowerBound && existingLowerBound > cutoff ? existingLowerBound : cutoff,
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mergeStatusFilter(filter, statuses) {
  const allowed = Array.isArray(statuses) ? statuses : [statuses];
  if (!filter.status) {
    filter.status = allowed.length === 1 ? allowed[0] : { $in: allowed };
    return;
  }
  const current = filter.status.$in || [filter.status];
  const intersection = current.filter((status) => allowed.includes(status));
  filter.status = intersection.length === 1 ? intersection[0] : { $in: intersection };
}

function buildFilter(query = {}) {
  const filter = {};
  const directFields = ['shopId', 'status', 'salesChannelCode', 'marketplaceCode', 'externalAccountId', 'costCenterStatus', 'psdStatus', 'addressValidationStatus', 'caseStatus'];
  directFields.forEach((field) => {
    const source = field === 'externalAccountId' ? query.seller : query[field];
    if (source) filter[field] = source;
  });
  if (query.shopIds?.length) filter.shopId = { $in: query.shopIds };
  if (query.assignedStaffIds?.length) filter.assignedStaffIds = { $in: query.assignedStaffIds };
  if (query.orderId) filter.externalOrderId = { $regex: escapeRegex(query.orderId), $options: 'i' };
  [['dateFrom', 'dateTo', 'orderedAt'], ['createdAtFrom', 'createdAtTo', 'sourceCreatedAt'], ['shipByDateFrom', 'shipByDateTo', 'shipByDate']]
    .forEach(([from, to, field]) => {
      if (!query[from] && !query[to]) return;
      filter[field] = { ...(query[from] ? { $gte: query[from] } : {}), ...(query[to] ? { $lte: query[to] } : {}) };
    });
  return filter;
}

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function buildSummaryFilter(query = {}) {
  const filter = buildFilter(query);
  if (filter.shopId) {
    filter.shopId = Array.isArray(filter.shopId.$in)
      ? { $in: filter.shopId.$in.map(toObjectId) }
      : toObjectId(filter.shopId);
  }
  if (filter.assignedStaffIds?.$in) {
    filter.assignedStaffIds = { $in: filter.assignedStaffIds.$in.map(toObjectId) };
  }
  return filter;
}

function emptyTabCounts() {
  return Object.fromEntries(Object.values(orderListTabs).map((tabName) => [tabName, 0]));
}

function tabCountGroupStage() {
  const cutoff = newOrderCutoff();
  const hasItemStatus = (status) => ({ $in: [status, '$items.item.status'] });
  return {
    _id: null,
    [orderListTabs.ALL]: { $sum: 1 },
    [orderListTabs.NEW_ORDER]: { $sum: { $cond: [{ $gte: ['$orderedAt', cutoff] }, 1, 0] } },
    [orderListTabs.NO_COST_CENTER]: { $sum: { $cond: [{ $in: ['$costCenterStatus', [costCenterStatuses.MISSING, null]] }, 1, 0] } },
    [orderListTabs.NO_PSD]: { $sum: { $cond: [{ $eq: ['$hasCurrentPsd', false] }, 1, 0] } },
    [orderListTabs.ADDRESS_ISSUE]: {
      $sum: { $cond: [{ $not: [{ $in: ['$addressValidationStatus', [addressValidationStatuses.VALID, addressValidationStatuses.OVERRIDDEN]] }] }, 1, 0] },
    },
    [orderListTabs.NEEDS_CUSTOMIZATION]: { $sum: { $cond: [hasItemStatus(orderItemStatuses.CUSTOMIZATION_PENDING), 1, 0] } },
    [orderListTabs.NEEDS_MAPPING]: { $sum: { $cond: [hasItemStatus(orderItemStatuses.MAPPING_PENDING), 1, 0] } },
    [orderListTabs.READY_FOR_PRODUCTION]: { $sum: { $cond: [hasItemStatus(orderItemStatuses.NEED_PRODUCTION), 1, 0] } },
    [orderListTabs.SENT_TO_VENDOR]: { $sum: { $cond: [hasItemStatus(orderItemStatuses.SENT_TO_VENDOR), 1, 0] } },
    [orderListTabs.TRACKING_PENDING]: { $sum: { $cond: [hasItemStatus(orderItemStatuses.TRACKING_PENDING), 1, 0] } },
    [orderListTabs.PAYMENT_PENDING]: { $sum: { $cond: [{ $eq: ['$paymentStatus', paymentStatuses.PENDING] }, 1, 0] } },
    [orderListTabs.IN_PROGRESS]: {
      $sum: { $cond: [{ $in: ['$status', [orderStatuses.PROCESSING, orderStatuses.ON_HOLD, orderStatuses.PARTIALLY_SHIPPED]] }, 1, 0] },
    },
    [orderListTabs.SHIPPED]: {
      $sum: { $cond: [{ $and: [{ $eq: ['$status', orderStatuses.SHIPPED] }, { $eq: ['$deliveredAt', null] }] }, 1, 0] },
    },
    [orderListTabs.DELIVERED]: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$deliveredAt', null] }, null] }, 1, 0] } },
    [orderListTabs.CANCELLED]: { $sum: { $cond: [{ $eq: ['$status', orderStatuses.CANCELLED] }, 1, 0] } },
    [orderListTabs.OPEN_CASE]: { $sum: { $cond: [{ $eq: ['$caseStatus', caseStatuses.OPEN] }, 1, 0] } },
  };
}

function applyTabFilter(filter, tab = orderListTabs.ALL) {
  const next = { ...filter };
  if (tab === orderListTabs.NEW_ORDER) applyNewOrderWindow(next);
  if (tab === orderListTabs.NO_COST_CENTER) next.costCenterStatus = { $in: [costCenterStatuses.MISSING, null] };
  if (tab === orderListTabs.NO_PSD) next.hasCurrentPsd = false;
  if (tab === orderListTabs.ADDRESS_ISSUE) next.addressValidationStatus = { $nin: [addressValidationStatuses.VALID, addressValidationStatuses.OVERRIDDEN] };
  if (tab === orderListTabs.PAYMENT_PENDING) next.paymentStatus = paymentStatuses.PENDING;
  if (tab === orderListTabs.IN_PROGRESS) mergeStatusFilter(next, [orderStatuses.PROCESSING, orderStatuses.ON_HOLD, orderStatuses.PARTIALLY_SHIPPED]);
  if (tab === orderListTabs.SHIPPED) { mergeStatusFilter(next, orderStatuses.SHIPPED); next.deliveredAt = null; }
  if (tab === orderListTabs.DELIVERED) next.deliveredAt = { $exists: true, $ne: null };
  if (tab === orderListTabs.CANCELLED) mergeStatusFilter(next, orderStatuses.CANCELLED);
  if (tab === orderListTabs.OPEN_CASE) next.caseStatus = caseStatuses.OPEN;
  const itemStatus = ITEM_STATUS_BY_TAB[tab];
  if (itemStatus) next['items.item.status'] = itemStatus;
  return next;
}

function appendSearchFilters(filter, { search, employeeCode, vendorId } = {}) {
  if (search) {
    const regex = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [
      { externalOrderId: regex }, { 'order.buyer.name': regex }, { 'order.buyer.emailMasked': regex },
      { 'items.item.sku': regex }, { 'items.item.asin': regex }, { 'items.item.title': regex },
    ];
  }
  if (employeeCode) filter['items.item.sku'] = { $regex: `^${escapeRegex(employeeCode)}-`, $options: 'i' };
  if (vendorId) {
    filter.$and = [...(filter.$and || []), { $or: [
      { 'items.fulfillmentPlan.vendor.id': String(vendorId) },
      { 'items.fulfillmentPlan.vendorProduct.vendor.id': String(vendorId) },
    ] }];
  }
}

function parseSort(sort) {
  if (!sort) return { orderedAt: -1, _id: -1 };
  const parsed = {};
  String(sort).split(',').forEach((part) => {
    const value = part.trim();
    const field = value.replace(/^-/, '');
    if (SORT_FIELDS.has(field)) {
      const projectionField = field === 'createdAt' ? 'sourceCreatedAt' : field === 'updatedAt' ? 'sourceUpdatedAt' : field;
      parsed[projectionField] = value.startsWith('-') ? -1 : 1;
    }
  });
  return { ...(Object.keys(parsed).length ? parsed : { orderedAt: -1 }), _id: 1 };
}

function withSession(options = {}) {
  return options.session ? { session: options.session } : {};
}

async function upsertBase(projection, options = {}) {
  return OrderWorkbenchProjection.findOneAndUpdate(
    { orderId: projection.orderId },
    { $set: projection },
    { upsert: true, returnDocument: 'after', runValidators: true, ...withSession(options) },
  ).lean();
}

async function setOrderFields(orderId, patch, options = {}) {
  const fields = Object.fromEntries(Object.entries(patch || {}).map(([key, value]) => [key, value]));
  if (!Object.keys(fields).length) return null;
  return OrderWorkbenchProjection.findOneAndUpdate(
    { orderId },
    { $set: fields },
    { returnDocument: 'after', runValidators: true, ...withSession(options) },
  ).lean();
}

async function setItemFields(orderId, orderItemId, patch, options = {}) {
  const fields = Object.fromEntries(Object.entries(patch || {}).map(([key, value]) => [`items.$[item].${key}`, value]));
  if (!Object.keys(fields).length) return null;
  return OrderWorkbenchProjection.findOneAndUpdate(
    { orderId },
    { $set: fields },
    {
      arrayFilters: [{ 'item.orderItemId': orderItemId }],
      returnDocument: 'after',
      runValidators: true,
      ...withSession(options),
    },
  ).lean();
}

async function createBase(projection, options = {}) {
  return OrderWorkbenchProjection.findOneAndUpdate(
    { orderId: projection.orderId },
    { $setOnInsert: projection },
    { upsert: true, returnDocument: 'after', runValidators: true, ...withSession(options) },
  ).lean();
}

async function setListingImageByListingId(listingId, productImageUrl) {
  if (!listingId || !productImageUrl) return { modifiedCount: 0 };
  const normalizedListingId = toObjectId(listingId);
  return OrderWorkbenchProjection.updateMany(
    { 'items.item.listingId': normalizedListingId },
    [{
      $set: {
        items: {
          $map: {
            input: '$items',
            as: 'entry',
            in: {
              $cond: [
                { $eq: ['$$entry.item.listingId', normalizedListingId] },
                {
                  $mergeObjects: [
                    '$$entry',
                    {
                      listing: {
                        $mergeObjects: [
                          { $ifNull: ['$$entry.listing', {}] },
                          { productImageUrl: { $literal: productImageUrl } },
                        ],
                      },
                    },
                  ],
                },
                '$$entry',
              ],
            },
          },
        },
      },
    }],
    {
      runValidators: true,
      updatePipeline: true,
    },
  );
}

async function findPage({ page = 1, limit = 20, tab = orderListTabs.ALL, sort, search, employeeCode, vendorId, ...query } = {}) {
  const filter = applyTabFilter(buildFilter(query), tab);
  appendSearchFilters(filter, { search, employeeCode, vendorId });
  const [items, total] = await Promise.all([
    OrderWorkbenchProjection.find(filter)
      .sort(parseSort(sort))
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    OrderWorkbenchProjection.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

async function countByTabs({ search, employeeCode, vendorId, ...query } = {}) {
  const filter = buildSummaryFilter(query);
  appendSearchFilters(filter, { search, employeeCode, vendorId });
  const [result = {}] = await OrderWorkbenchProjection.aggregate([
    { $match: filter },
    { $group: tabCountGroupStage() },
    { $project: { _id: 0 } },
  ]);
  return { ...emptyTabCounts(), ...result };
}

module.exports = {
  buildFilter,
  countByTabs,
  findPage,
  createBase,
  upsertBase,
  setOrderFields,
  setItemFields,
  setListingImageByListingId,
};
