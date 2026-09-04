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
const SORT_FIELDS = new Set(['orderedAt', 'shipByDate', 'externalOrderId', 'status', 'salesChannelCode', 'marketplaceCode', 'createdAt', 'updatedAt']);

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

function applyTabFilter(filter, tab = orderListTabs.ALL) {
  const next = { ...filter };
  if (tab === orderListTabs.NEW_ORDER) mergeStatusFilter(next, orderStatuses.IMPORTED);
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

async function findPage({ page = 1, limit = 20, tab = orderListTabs.ALL, sort, search, employeeCode, vendorId, ...query } = {}) {
  const filter = applyTabFilter(buildFilter(query), tab);
  appendSearchFilters(filter, { search, employeeCode, vendorId });
  const [items, total] = await Promise.all([
    OrderWorkbenchProjection.find(filter)
      .sort(parseSort(sort))
      .skip(getPaginationOffset(page, limit))
      .limit(limit)
      .lean(),
    OrderWorkbenchProjection.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

module.exports = {
  buildFilter,
  findPage,
  upsertBase,
  setOrderFields,
  setItemFields,
};
