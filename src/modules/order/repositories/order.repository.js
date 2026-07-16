const mongoose = require('mongoose');
const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const Order = require('../models/order.model');
const {
  caseStatuses,
  costCenterStatuses,
  orderListTabs,
  orderStatuses,
  paymentStatuses,
  psdStatuses,
} = require('../constants/orderStatuses');

const DEFAULT_SORT = { orderedAt: -1, _id: -1 };
const SORT_FIELDS = new Set([
  'orderedAt',
  'shipByDate',
  'externalOrderId',
  'status',
  'salesChannelCode',
  'marketplaceCode',
  'createdAt',
  'updatedAt',
]);

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

function toObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function buildFilter({
  shopId,
  status,
  salesChannelCode,
  marketplaceCode,
  orderId,
  seller,
  assignedStaffId,
  costCenterStatus,
  psdStatus,
  caseStatus,
  shopIds,
  dateFrom,
  dateTo,
  createdAtFrom,
  createdAtTo,
  shipByDateFrom,
  shipByDateTo,
} = {}) {
  const filter = {};

  if (shopId) filter.shopId = toObjectId(shopId);
  if (shopIds && shopIds.length > 0) filter.shopId = { $in: shopIds.map(toObjectId) };
  if (status) filter.status = status;
  if (salesChannelCode) filter.salesChannelCode = salesChannelCode;
  if (marketplaceCode) filter.marketplaceCode = marketplaceCode;
  if (orderId) filter.externalOrderId = { $regex: escapeRegex(orderId), $options: 'i' };
  if (seller) filter.externalAccountId = seller;
  if (assignedStaffId) filter.assignedStaffId = toObjectId(assignedStaffId);
  if (costCenterStatus) filter.costCenterStatus = costCenterStatus;
  if (psdStatus) filter.psdStatus = psdStatus;
  if (caseStatus) filter.caseStatus = caseStatus;
  if (dateFrom || dateTo) {
    filter.orderedAt = {};
    if (dateFrom) filter.orderedAt.$gte = dateFrom;
    if (dateTo) filter.orderedAt.$lte = dateTo;
  }
  if (createdAtFrom || createdAtTo) {
    filter.createdAt = {};
    if (createdAtFrom) filter.createdAt.$gte = createdAtFrom;
    if (createdAtTo) filter.createdAt.$lte = createdAtTo;
  }
  if (shipByDateFrom || shipByDateTo) {
    filter.shipByDate = {};
    if (shipByDateFrom) filter.shipByDate.$gte = shipByDateFrom;
    if (shipByDateTo) filter.shipByDate.$lte = shipByDateTo;
  }

  return filter;
}

function buildJoinedFilter({ search, employeeCode } = {}) {
  const filters = [];
  const searchFilter = buildSearchFilter(search);
  if (searchFilter) filters.push(searchFilter);
  if (employeeCode) {
    filters.push({ 'items.sku': { $regex: `^${escapeRegex(employeeCode)}-`, $options: 'i' } });
  }

  if (filters.length === 0) return null;
  if (filters.length === 1) return filters[0];
  return { $and: filters };
}

function buildSearchFilter(search) {
  if (!search) return null;
  const regex = { $regex: escapeRegex(search), $options: 'i' };
  return {
    $or: [
      { externalOrderId: regex },
      { 'buyer.name': regex },
      { 'buyer.emailMasked': regex },
      { 'items.sku': regex },
      { 'items.title': regex },
    ],
  };
}

function applyTabFilter(filter, tab = orderListTabs.ALL) {
  const next = { ...filter };

  if (tab === orderListTabs.NEW_ORDER) mergeStatusFilter(next, orderStatuses.IMPORTED);
  if (tab === orderListTabs.NO_COST_CENTER) next.costCenterStatus = { $in: [costCenterStatuses.MISSING, null] };
  if (tab === orderListTabs.NO_PSD) next.psdStatus = { $in: [psdStatuses.MISSING, null] };
  if (tab === orderListTabs.PAYMENT_PENDING) next.paymentStatus = paymentStatuses.PENDING;
  if (tab === orderListTabs.IN_PROGRESS) {
    mergeStatusFilter(next, [orderStatuses.PROCESSING, orderStatuses.ON_HOLD, orderStatuses.PARTIALLY_SHIPPED]);
  }
  if (tab === orderListTabs.SHIPPED) {
    mergeStatusFilter(next, orderStatuses.SHIPPED);
    next.deliveredAt = null;
  }
  if (tab === orderListTabs.DELIVERED) next.deliveredAt = { $exists: true, $ne: null };
  if (tab === orderListTabs.CANCELLED) mergeStatusFilter(next, orderStatuses.CANCELLED);
  if (tab === orderListTabs.OPEN_CASE) next.caseStatus = caseStatuses.OPEN;

  return next;
}

function itemProjection() {
  return {
    _id: 1,
    orderId: 1,
    externalItemId: 1,
    sku: 1,
    title: 1,
    asin: 1,
    quantity: 1,
    status: 1,
    listingId: 1,
    price: 1,
    replacementOfOrderId: 1,
    replacementOfOrderItemId: 1,
    replacementSequence: 1,
    replacementReason: 1,
  };
}

function itemsLookupStage({ projectItems = false } = {}) {
  if (projectItems) {
    return {
      $lookup: {
        from: 'orderitems',
        let: { orderId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$orderId', '$$orderId'] } } },
          { $project: itemProjection() },
        ],
        as: 'items',
      },
    };
  }

  return {
    $lookup: {
      from: 'orderitems',
      localField: '_id',
      foreignField: 'orderId',
      as: 'items',
    },
  };
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

function listPipeline({
  filter, sort, page, limit, search, employeeCode, includeItems = false, projectItems = false,
}) {
  const joinedFilter = buildJoinedFilter({ search, employeeCode });
  const prePagination = joinedFilter
    ? [itemsLookupStage({ projectItems }), { $match: { ...filter, ...joinedFilter } }]
    : [{ $match: filter }];

  return [
    ...prePagination,
    { $sort: sort },
    { $skip: getPaginationOffset({ page, limit }) },
    { $limit: limit },
    ...(joinedFilter ? [] : [itemsLookupStage({ projectItems })]),
    {
      $addFields: {
        itemsCount: { $size: '$items' },
        currency: { $ifNull: [{ $arrayElemAt: ['$items.price.currency', 0] }, null] },
        itemsSummary: {
          $map: {
            input: { $slice: ['$items', 3] },
            as: 'item',
            in: {
              orderItemId: '$$item._id',
              sku: '$$item.sku',
              title: '$$item.title',
              quantity: '$$item.quantity',
            },
          },
        },
        totalAmount: {
          $sum: {
            $map: {
              input: '$items',
              as: 'item',
              in: {
                $add: [
                  { $ifNull: ['$$item.price.itemPriceAmount', 0] },
                  { $ifNull: ['$$item.price.itemTaxAmount', 0] },
                  { $ifNull: ['$$item.price.shippingPriceAmount', 0] },
                  { $ifNull: ['$$item.price.shippingTaxAmount', 0] },
                  { $ifNull: ['$$item.price.giftWrapPriceAmount', 0] },
                  { $ifNull: ['$$item.price.giftWrapTaxAmount', 0] },
                  { $multiply: [{ $ifNull: ['$$item.price.itemPromotionDiscountAmount', 0] }, -1] },
                  { $multiply: [{ $ifNull: ['$$item.price.shipPromotionDiscountAmount', 0] }, -1] },
                ],
              },
            },
          },
        },
      },
    },
    ...(includeItems ? [] : [{ $project: { items: 0 } }]),
  ];
}

function listWithTabCountsPipeline({
  baseFilter, filter, sort, page, limit, includeItems = false,
}) {
  return [
    { $match: baseFilter },
    {
      $facet: {
        items: listPipeline({
          filter,
          sort,
          page,
          limit,
          search: null,
          includeItems,
        }),
        tabCounts: [
          { $group: tabCountGroupStage() },
          { $project: { _id: 0 } },
        ],
      },
    },
  ];
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

async function updateAssignedStaff(orderId, assignedStaffId) {
  return Order.findByIdAndUpdate(
    orderId,
    { $set: { assignedStaffId: assignedStaffId || null } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateBuyer(orderId, buyer) {
  return Order.findByIdAndUpdate(
    orderId,
    { $set: { buyer } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateShippingService(orderId, shippingService) {
  return Order.findByIdAndUpdate(
    orderId,
    { $set: { shippingService } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateCaseStatus(orderId, caseStatus) {
  return Order.findByIdAndUpdate(
    orderId,
    { $set: { caseStatus } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateCostCenterStatus(orderId, costCenterStatus) {
  return Order.findByIdAndUpdate(
    orderId,
    { $set: { costCenterStatus } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updatePsdStatus(orderId, psdStatus) {
  return Order.findByIdAndUpdate(
    orderId,
    { $set: { psdStatus } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function countMatching(filter, { search, employeeCode } = {}) {
  const joinedFilter = buildJoinedFilter({ search, employeeCode });
  if (!joinedFilter) return Order.countDocuments(filter);

  const [result] = await Order.aggregate([
    itemsLookupStage(),
    { $match: { ...filter, ...joinedFilter } },
    { $count: 'total' },
  ]);
  return result ? result.total : 0;
}

function emptyTabCounts() {
  return Object.fromEntries(Object.values(orderListTabs).map((tabName) => [tabName, 0]));
}

function tabCountGroupStage() {
  return {
    _id: null,
    [orderListTabs.ALL]: { $sum: 1 },
    [orderListTabs.NEW_ORDER]: {
      $sum: { $cond: [{ $eq: ['$status', orderStatuses.IMPORTED] }, 1, 0] },
    },
    [orderListTabs.NO_COST_CENTER]: {
      $sum: { $cond: [{ $in: ['$costCenterStatus', [costCenterStatuses.MISSING, null]] }, 1, 0] },
    },
    [orderListTabs.NO_PSD]: {
      $sum: { $cond: [{ $in: ['$psdStatus', [psdStatuses.MISSING, null]] }, 1, 0] },
    },
    [orderListTabs.PAYMENT_PENDING]: {
      $sum: { $cond: [{ $eq: ['$paymentStatus', paymentStatuses.PENDING] }, 1, 0] },
    },
    [orderListTabs.IN_PROGRESS]: {
      $sum: {
        $cond: [{
          $in: ['$status', [orderStatuses.PROCESSING, orderStatuses.ON_HOLD, orderStatuses.PARTIALLY_SHIPPED]],
        }, 1, 0],
      },
    },
    [orderListTabs.SHIPPED]: {
      $sum: {
        $cond: [{
          $and: [
            { $eq: ['$status', orderStatuses.SHIPPED] },
            { $eq: ['$deliveredAt', null] },
          ],
        }, 1, 0],
      },
    },
    [orderListTabs.DELIVERED]: {
      $sum: { $cond: [{ $ne: ['$deliveredAt', null] }, 1, 0] },
    },
    [orderListTabs.CANCELLED]: {
      $sum: { $cond: [{ $eq: ['$status', orderStatuses.CANCELLED] }, 1, 0] },
    },
    [orderListTabs.OPEN_CASE]: {
      $sum: { $cond: [{ $eq: ['$caseStatus', caseStatuses.OPEN] }, 1, 0] },
    },
  };
}

async function list({
  page = 1,
  limit = 20,
  tab = orderListTabs.ALL,
  sort,
  search,
  employeeCode,
  includeItems = false,
  includeTabCounts = true,
  projectItems = false,
  ...filters
} = {}) {
  const baseFilter = buildFilter(filters);
  const filter = applyTabFilter(baseFilter, tab);

  if (!search && !employeeCode && includeTabCounts) {
    const [result = {}] = await Order.aggregate(listWithTabCountsPipeline({
      baseFilter,
      filter,
      sort: parseSort(sort),
      page,
      limit,
      includeItems,
    }));
    const tabCounts = { ...emptyTabCounts(), ...(result.tabCounts?.[0] || {}) };
    const total = tabCounts[tab] || 0;

    return {
      ...toPaginatedResult({
        items: result.items || [], total, page, limit,
      }),
      tabCounts,
    };
  }

  const countPromise = includeTabCounts
    ? countByTabs({ ...filters, search, employeeCode })
    : countMatching(filter, { search, employeeCode });

  const [items, countResult] = await Promise.all([
    Order.aggregate(listPipeline({
      filter,
      sort: parseSort(sort),
      page,
      limit,
      search,
      employeeCode,
      includeItems,
      projectItems,
    })),
    countPromise,
  ]);
  const total = includeTabCounts ? countResult[tab] || 0 : countResult;

  return {
    ...toPaginatedResult({ items, total, page, limit }),
    ...(includeTabCounts ? { tabCounts: countResult } : {}),
  };
}

async function listWorkbench(query = {}) {
  return list({
    ...query,
    includeItems: true,
    includeTabCounts: false,
    projectItems: true,
  });
}

async function countByTabs({ search, employeeCode, ...filters } = {}) {
  const baseFilter = buildFilter(filters);
  if (!search && !employeeCode) {
    const [result] = await Order.aggregate([
      { $match: baseFilter },
      { $group: tabCountGroupStage() },
      { $project: { _id: 0 } },
    ]);
    return { ...emptyTabCounts(), ...(result || {}) };
  }

  const tabEntries = Object.values(orderListTabs).map((tabName) => [
    tabName,
    countMatching(applyTabFilter(baseFilter, tabName), { search, employeeCode }),
  ]);
  const counts = await Promise.all(tabEntries.map(([, promise]) => promise));

  return Object.fromEntries(tabEntries.map(([tabName], index) => [tabName, counts[index]]));
}

async function updateStatus(orderId, status, patch = {}) {
  return Order.findByIdAndUpdate(
    orderId,
    { $set: { ...patch, status } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function updateDeliveredAt(orderId, deliveredAt) {
  return Order.findByIdAndUpdate(
    orderId,
    { $set: { deliveredAt } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  create,
  findById,
  findByExternalIdentity,
  updateAddressValidation,
  updateShippingAddress,
  updateAssignedStaff,
  updateBuyer,
  updateShippingService,
  updateCaseStatus,
  updateCostCenterStatus,
  updatePsdStatus,
  updateStatus,
  updateDeliveredAt,
  updateFromExternalImport,
  countByTabs,
  list,
  listWorkbench,
};
