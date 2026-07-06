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

function buildFilter({
  shopId,
  status,
  salesChannelCode,
  marketplaceCode,
  orderId,
  seller,
  assignedStaffId,
  shopIds,
  dateFrom,
  dateTo,
  shipByDateFrom,
  shipByDateTo,
} = {}) {
  const filter = {};

  if (shopId) filter.shopId = shopId;
  if (shopIds && shopIds.length > 0) filter.shopId = { $in: shopIds };
  if (status) filter.status = status;
  if (salesChannelCode) filter.salesChannelCode = salesChannelCode;
  if (marketplaceCode) filter.marketplaceCode = marketplaceCode;
  if (orderId) filter.externalOrderId = { $regex: escapeRegex(orderId), $options: 'i' };
  if (seller) filter.externalAccountId = seller;
  if (assignedStaffId) filter.assignedStaffId = assignedStaffId;
  if (dateFrom || dateTo) {
    filter.orderedAt = {};
    if (dateFrom) filter.orderedAt.$gte = dateFrom;
    if (dateTo) filter.orderedAt.$lte = dateTo;
  }
  if (shipByDateFrom || shipByDateTo) {
    filter.shipByDate = {};
    if (shipByDateFrom) filter.shipByDate.$gte = shipByDateFrom;
    if (shipByDateTo) filter.shipByDate.$lte = shipByDateTo;
  }

  return filter;
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

function itemsLookupStage() {
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

function listPipeline({ filter, sort, page, limit, search }) {
  const searchFilter = buildSearchFilter(search);
  const prePagination = searchFilter
    ? [itemsLookupStage(), { $match: { ...filter, ...searchFilter } }]
    : [{ $match: filter }];

  return [
    ...prePagination,
    { $sort: sort },
    { $skip: getPaginationOffset({ page, limit }) },
    { $limit: limit },
    ...(searchFilter ? [] : [itemsLookupStage()]),
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
    { $project: { items: 0 } },
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

async function countMatching(filter, search) {
  const searchFilter = buildSearchFilter(search);
  if (!searchFilter) return Order.countDocuments(filter);

  const [result] = await Order.aggregate([
    itemsLookupStage(),
    { $match: { ...filter, ...searchFilter } },
    { $count: 'total' },
  ]);
  return result ? result.total : 0;
}

async function list({ page = 1, limit = 20, tab = orderListTabs.ALL, sort, search, ...filters } = {}) {
  const baseFilter = buildFilter(filters);
  const filter = applyTabFilter(baseFilter, tab);
  const tabCountsPromise = countByTabs({ ...filters, search });

  const [items, total, tabCounts] = await Promise.all([
    Order.aggregate(listPipeline({
      filter,
      sort: parseSort(sort),
      page,
      limit,
      search,
    })),
    countMatching(filter, search),
    tabCountsPromise,
  ]);

  return {
    ...toPaginatedResult({ items, total, page, limit }),
    tabCounts,
  };
}

async function countByTabs({ search, ...filters } = {}) {
  const baseFilter = buildFilter(filters);
  const tabEntries = Object.values(orderListTabs).map((tabName) => [
    tabName,
    countMatching(applyTabFilter(baseFilter, tabName), search),
  ]);
  const counts = await Promise.all(tabEntries.map(([, promise]) => promise));

  return Object.fromEntries(tabEntries.map(([tabName], index) => [tabName, counts[index]]));
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
  updateFromExternalImport,
  countByTabs,
  list,
};
