const mongoose = require('mongoose');
const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const Order = require('../models/order.model');
const {
  addressValidationStatuses,
  caseStatuses,
  costCenterStatuses,
  orderListTabs,
  orderItemStatuses,
  orderStatuses,
  paymentStatuses,
  psdStatuses,
} = require('../constants/orderStatuses');

const DEFAULT_SORT = { orderedAt: -1, _id: -1 };
const ITEM_STATUS_BY_TAB = Object.freeze({
  [orderListTabs.NEEDS_CUSTOMIZATION]: orderItemStatuses.CUSTOMIZATION_PENDING,
  [orderListTabs.NEEDS_MAPPING]: orderItemStatuses.MAPPING_PENDING,
  [orderListTabs.READY_FOR_PRODUCTION]: orderItemStatuses.NEED_PRODUCTION,
  [orderListTabs.SENT_TO_VENDOR]: orderItemStatuses.SENT_TO_VENDOR,
  [orderListTabs.TRACKING_PENDING]: orderItemStatuses.TRACKING_PENDING,
});
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
  assignedStaffIds,
  costCenterStatus,
  psdStatus,
  addressValidationStatus,
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
  if (assignedStaffIds?.length) filter.assignedStaffIds = { $in: assignedStaffIds.map(toObjectId) };
  if (costCenterStatus) filter.costCenterStatus = costCenterStatus;
  if (psdStatus) filter.psdStatus = psdStatus;
  if (addressValidationStatus) filter.addressValidationStatus = addressValidationStatus;
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

function getItemStatusForTab(tab) {
  return ITEM_STATUS_BY_TAB[tab] || null;
}

function buildVendorFilter(vendorId) {
  const id = String(vendorId);
  return {
    $or: [
      { 'fulfillmentPlans.snapshot.vendor.id': id },
      { 'fulfillmentPlans.snapshot.vendorProduct.vendor.id': id },
    ],
  };
}

function buildJoinedFilter({ search, employeeCode, itemStatus, vendorId } = {}) {
  const filters = [];
  const searchFilter = buildSearchFilter(search);
  if (searchFilter) filters.push(searchFilter);
  if (itemStatus) filters.push({ 'items.status': itemStatus });
  if (employeeCode) {
    filters.push({ 'items.sku': { $regex: `^${escapeRegex(employeeCode)}-`, $options: 'i' } });
  }
  if (vendorId) filters.push(buildVendorFilter(vendorId));

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
      { 'items.asin': regex },
      { 'items.title': regex },
    ],
  };
}

function applyTabFilter(filter, tab = orderListTabs.ALL) {
  const next = { ...filter };

  if (tab === orderListTabs.NEW_ORDER) mergeStatusFilter(next, orderStatuses.IMPORTED);
  if (tab === orderListTabs.NO_COST_CENTER) next.costCenterStatus = { $in: [costCenterStatuses.MISSING, null] };
  if (tab === orderListTabs.ADDRESS_ISSUE) {
    next.addressValidationStatus = { $nin: [addressValidationStatuses.VALID, addressValidationStatuses.OVERRIDDEN] };
  }
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
    csNote: 1,
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

function currentPsdStages() {
  return [
    {
      $lookup: {
        from: 'fulfillmentplans',
        localField: 'items._id',
        foreignField: 'orderItemId',
        as: 'fulfillmentPlans',
      },
    },
    {
      $lookup: {
        from: 'listingvariants',
        localField: 'fulfillmentPlans.listingVariantId',
        foreignField: '_id',
        as: 'listingVariants',
      },
    },
    {
      $lookup: {
        from: 'listings',
        let: { listingIds: { $setUnion: ['$items.listingId', '$fulfillmentPlans.listingId'] } },
        pipeline: [{ $match: { $expr: { $in: ['$_id', '$$listingIds'] } } }],
        as: 'listings',
      },
    },
    {
      $lookup: {
        from: 'internaltemplates',
        localField: 'listingVariants.internalTemplateId',
        foreignField: '_id',
        as: 'internalTemplates',
      },
    },
    {
      $addFields: {
        hasCurrentPsd: {
          $and: [
            { $gt: [{ $size: '$items' }, 0] },
            {
              $allElementsTrue: {
                $map: {
                  input: '$items',
                  as: 'item',
                  in: {
                    $let: {
                      vars: {
                        plan: {
                          $arrayElemAt: [{
                            $filter: {
                              input: '$fulfillmentPlans',
                              as: 'plan',
                              cond: { $eq: ['$$plan.orderItemId', '$$item._id'] },
                            },
                          }, 0],
                        },
                      },
                      in: {
                        $let: {
                          vars: {
                            listing: {
                              $arrayElemAt: [{
                                $filter: {
                                  input: '$listings',
                                  as: 'listing',
                                  cond: { $eq: ['$$listing._id', { $ifNull: ['$$plan.listingId', '$$item.listingId'] }] },
                                },
                              }, 0],
                            },
                            variant: {
                              $arrayElemAt: [{
                                $filter: {
                                  input: '$listingVariants',
                                  as: 'variant',
                                  cond: { $eq: ['$$variant._id', '$$plan.listingVariantId'] },
                                },
                              }, 0],
                            },
                          },
                          in: {
                            $let: {
                              vars: {
                                template: {
                                  $arrayElemAt: [{
                                    $filter: {
                                      input: '$internalTemplates',
                                      as: 'template',
                                      cond: { $eq: ['$$template._id', '$$variant.internalTemplateId'] },
                                    },
                                  }, 0],
                                },
                              },
                              in: {
                                $or: [
                                  { $and: [{ $eq: ['$$template.status', 'ACTIVE'] }, { $eq: ['$$template.requiresPsd', false] }] },
                                  { $ne: [{ $ifNull: ['$$variant.psdTemplateAssetId', null] }, null] },
                                  { $ne: [{ $ifNull: ['$$listing.defaultPsdTemplateAssetId', null] }, null] },
                                  {
                                    $gt: [{
                                      $size: {
                                        $filter: {
                                          input: { $ifNull: ['$$template.designAssets', []] },
                                          as: 'asset',
                                          cond: {
                                            $and: [
                                              { $eq: ['$$template.status', 'ACTIVE'] },
                                              { $eq: ['$$asset.type', 'PSD_TEMPLATE'] },
                                              { $ne: ['$$asset.status', 'INACTIVE'] },
                                              { $ne: [{ $ifNull: ['$$asset.mediaAssetId', null] }, null] },
                                            ],
                                          },
                                        },
                                      },
                                    }, 0],
                                  },
                                ],
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
  ];
}

function listPipeline({
  filter, sort, page, limit, search, employeeCode, itemStatus, vendorId, includeItems = false, projectItems = false, currentPsd = false, prePagination,
}) {
  const matching = prePagination || matchingStages({
    filter, search, employeeCode, itemStatus, vendorId, projectItems, currentPsd,
  });

  return [
    ...matching,
    { $sort: sort },
    { $skip: getPaginationOffset({ page, limit }) },
    { $limit: limit },
    ...(matching.some((stage) => stage.$lookup) ? [] : [itemsLookupStage({ projectItems })]),
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

function matchingStages({ filter, search, employeeCode, itemStatus, vendorId, projectItems = false, currentPsd = false }) {
  const joinedFilter = buildJoinedFilter({ search, employeeCode, itemStatus, vendorId });
  return (joinedFilter || currentPsd)
    ? [
      itemsLookupStage({ projectItems }),
      ...(currentPsd ? currentPsdStages() : []),
      ...(vendorId ? [{
        $lookup: {
          from: 'fulfillmentplans',
          localField: 'items._id',
          foreignField: 'orderItemId',
          as: 'fulfillmentPlans',
        },
      }] : []),
      { $match: { ...filter, ...(currentPsd ? { hasCurrentPsd: false } : {}), ...joinedFilter } },
    ]
    : [{ $match: filter }];
}

function listWithTabCountsPipeline({
  baseFilter, filter, sort, page, limit, vendorId, includeItems = false, currentPsd = false,
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
          vendorId,
          includeItems,
          currentPsd,
        }),
        tabCounts: [
          itemsLookupStage(),
          ...currentPsdStages(),
          ...(vendorId ? [{
            $lookup: {
              from: 'fulfillmentplans',
              localField: 'items._id',
              foreignField: 'orderItemId',
              as: 'fulfillmentPlans',
            },
          }, { $match: buildVendorFilter(vendorId) }] : []),
          { $group: tabCountGroupStage({ includeItemStatus: true, currentPsd: true }) },
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

async function findById(orderId, { session } = {}) {
  const query = Order.findById(orderId);
  if (session) query.session(session);
  return query.lean();
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

async function updateAddressValidation(orderId, patch, { session, expectedUpdatedAt } = {}) {
  return Order.findOneAndUpdate(
    { _id: orderId, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function updateShippingAddress(orderId, patch, { session, expectedUpdatedAt } = {}) {
  return Order.findOneAndUpdate(
    { _id: orderId, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
    { $set: patch },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function updateAssignedStaffIds(orderId, assignedStaffIds, { session, expectedUpdatedAt } = {}) {
  return Order.findOneAndUpdate(
    { _id: orderId, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
    { $set: { assignedStaffIds: assignedStaffIds || [] } },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function updateBuyer(orderId, buyer, { session, expectedUpdatedAt } = {}) {
  return Order.findOneAndUpdate(
    { _id: orderId, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
    { $set: { buyer } },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function updateShippingService(orderId, shippingService, { session, expectedUpdatedAt } = {}) {
  return Order.findOneAndUpdate(
    { _id: orderId, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
    { $set: { shippingService } },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function updateCaseStatus(orderId, caseStatus, { session } = {}) {
  return Order.findByIdAndUpdate(
    orderId,
    { $set: { caseStatus } },
    { returnDocument: 'after', runValidators: true, session },
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

async function countMatching(filter, { search, employeeCode, itemStatus, vendorId, currentPsd = false } = {}) {
  const joinedFilter = buildJoinedFilter({ search, employeeCode, itemStatus, vendorId });
  if (!joinedFilter && !currentPsd) return Order.countDocuments(filter);

  const [result] = await Order.aggregate([
    ...matchingStages({ filter, search, employeeCode, itemStatus, vendorId, currentPsd }),
    { $count: 'total' },
  ]);
  return result ? result.total : 0;
}

function emptyTabCounts() {
  return Object.fromEntries(Object.values(orderListTabs).map((tabName) => [tabName, 0]));
}

function tabCountGroupStage({ includeItemStatus = false, currentPsd = false } = {}) {
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
      $sum: { $cond: [currentPsd ? { $eq: ['$hasCurrentPsd', false] } : { $in: ['$psdStatus', [psdStatuses.MISSING, null]] }, 1, 0] },
    },
    [orderListTabs.ADDRESS_ISSUE]: {
      $sum: {
        $cond: [{
          $not: [{ $in: ['$addressValidationStatus', [addressValidationStatuses.VALID, addressValidationStatuses.OVERRIDDEN]] }],
        }, 1, 0],
      },
    },
    ...(includeItemStatus ? {
      [orderListTabs.NEEDS_CUSTOMIZATION]: {
        $sum: {
          $cond: [{ $in: [orderItemStatuses.CUSTOMIZATION_PENDING, '$items.status'] }, 1, 0],
        },
      },
      [orderListTabs.NEEDS_MAPPING]: {
        $sum: {
          $cond: [{ $in: [orderItemStatuses.MAPPING_PENDING, '$items.status'] }, 1, 0],
        },
      },
      [orderListTabs.READY_FOR_PRODUCTION]: {
        $sum: {
          $cond: [{ $in: [orderItemStatuses.NEED_PRODUCTION, '$items.status'] }, 1, 0],
        },
      },
      [orderListTabs.SENT_TO_VENDOR]: {
        $sum: {
          $cond: [{ $in: [orderItemStatuses.SENT_TO_VENDOR, '$items.status'] }, 1, 0],
        },
      },
      [orderListTabs.TRACKING_PENDING]: {
        $sum: {
          $cond: [{ $in: [orderItemStatuses.TRACKING_PENDING, '$items.status'] }, 1, 0],
        },
      },
    } : {}),
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
  vendorId,
  includeItems = false,
  includeTabCounts = true,
  projectItems = false,
  ...filters
} = {}) {
  const baseFilter = buildFilter(filters);
  const filter = applyTabFilter(baseFilter, tab);
  if (tab === orderListTabs.NO_PSD) filter.hasCurrentPsd = false;
  const itemStatus = getItemStatusForTab(tab);

  if (!search && !employeeCode && !itemStatus && includeTabCounts) {
    const [result = {}] = await Order.aggregate(listWithTabCountsPipeline({
      baseFilter,
      filter,
      sort: parseSort(sort),
      page,
      limit,
      vendorId,
      includeItems,
      currentPsd: tab === orderListTabs.NO_PSD,
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
    ? countByTabs({ ...filters, search, employeeCode, vendorId })
    : countMatching(filter, { search, employeeCode, vendorId, currentPsd: tab === orderListTabs.NO_PSD });

  const [items, countResult] = await Promise.all([
    Order.aggregate(listPipeline({
      filter,
      sort: parseSort(sort),
      page,
      limit,
      search,
      employeeCode,
      itemStatus,
      vendorId,
      includeItems,
      projectItems,
      currentPsd: tab === orderListTabs.NO_PSD,
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
  const {
    page = 1, limit = 20, tab = orderListTabs.ALL, sort, search, employeeCode, vendorId, ...filters
  } = query;
  const filter = applyTabFilter(buildFilter(filters), tab);
  if (tab === orderListTabs.NO_PSD) filter.hasCurrentPsd = false;
  const itemStatus = getItemStatusForTab(tab);
  const currentPsd = tab === orderListTabs.NO_PSD;
  const prePagination = matchingStages({
    filter, search, employeeCode, itemStatus, vendorId, projectItems: true, currentPsd,
  });
  const itemsPipeline = listPipeline({
    filter,
    sort: parseSort(sort),
    page,
    limit,
    search,
    employeeCode,
    itemStatus,
    vendorId,
    includeItems: true,
    projectItems: true,
    currentPsd,
    prePagination,
  });
  const [result = {}] = await Order.aggregate([
    ...prePagination,
    {
      $facet: {
        items: itemsPipeline.slice(prePagination.length),
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

async function countByTabs({ search, employeeCode, vendorId, ...filters } = {}) {
  const baseFilter = buildFilter(filters);
  if (!search && !employeeCode) {
    const [result] = await Order.aggregate([
      { $match: baseFilter },
      itemsLookupStage(),
      ...(vendorId ? [{
        $lookup: {
          from: 'fulfillmentplans',
          localField: 'items._id',
          foreignField: 'orderItemId',
          as: 'fulfillmentPlans',
        },
      }, { $match: buildVendorFilter(vendorId) }] : []),
      ...currentPsdStages(),
      { $group: tabCountGroupStage({ includeItemStatus: true, currentPsd: true }) },
      { $project: { _id: 0 } },
    ]);

    return {
      ...emptyTabCounts(),
      ...(result || {}),
    };
  }

  const tabEntries = Object.values(orderListTabs).map((tabName) => [
    tabName,
    countMatching(applyTabFilter(baseFilter, tabName), {
      search,
      employeeCode,
      vendorId,
      itemStatus: getItemStatusForTab(tabName),
      currentPsd: tabName === orderListTabs.NO_PSD,
    }),
  ]);
  const counts = await Promise.all(tabEntries.map(([, promise]) => promise));

  return Object.fromEntries(tabEntries.map(([tabName], index) => [tabName, counts[index]]));
}

function buyerIdentityFilter() {
  return {
    $and: [
      { 'buyer.externalBuyerId': { $ne: null } },
      { 'buyer.externalBuyerId': { $ne: '' } },
    ],
  };
}

async function summarizeBuyerInsights(query = {}) {
  const periodFilter = buildFilter(query);
  const scopeFilter = buildFilter({ ...query, dateFrom: undefined, dateTo: undefined });
  const periodConditions = [];
  if (query.dateFrom) periodConditions.push({ $gte: ['$orderedAt', new Date(query.dateFrom)] });
  if (query.dateTo) periodConditions.push({ $lte: ['$orderedAt', new Date(query.dateTo)] });
  const inPeriod = periodConditions.length === 0
    ? true
    : periodConditions.length === 1 ? periodConditions[0] : { $and: periodConditions };
  const [buyerRows, totalOrderCount, unidentifiedOrderCount] = await Promise.all([
    Order.aggregate([
      { $match: { ...scopeFilter, ...buyerIdentityFilter() } },
      {
        $group: {
          _id: {
            shopId: '$shopId',
            salesChannelCode: '$salesChannelCode',
            marketplaceCode: '$marketplaceCode',
            externalBuyerId: '$buyer.externalBuyerId',
          },
          firstOrderAt: { $min: '$orderedAt' },
          periodOrderCount: { $sum: { $cond: [inPeriod, 1, 0] } },
        },
      },
      { $match: { periodOrderCount: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          knownBuyerCount: { $sum: 1 },
          newBuyerCount: {
            $sum: {
              $cond: [
                query.dateFrom ? { $gte: ['$firstOrderAt', new Date(query.dateFrom)] } : false,
                1,
                0,
              ],
            },
          },
          repeatBuyerCount: { $sum: { $cond: [{ $gt: ['$periodOrderCount', 1] }, 1, 0] } },
        },
      },
      { $project: { _id: 0, knownBuyerCount: 1, newBuyerCount: 1, repeatBuyerCount: 1 } },
    ]),
    Order.countDocuments(periodFilter),
    Order.countDocuments({
      ...periodFilter,
      $or: [
        { 'buyer.externalBuyerId': null },
        { 'buyer.externalBuyerId': '' },
        { 'buyer.externalBuyerId': { $exists: false } },
      ],
    }),
  ]);
  const summary = buyerRows[0] || {};
  const knownBuyerCount = Number(summary.knownBuyerCount || 0);
  const newBuyerCount = Number(summary.newBuyerCount || 0);

  return {
    knownBuyerCount,
    newBuyerCount,
    returningBuyerCount: Math.max(knownBuyerCount - newBuyerCount, 0),
    repeatBuyerCount: Number(summary.repeatBuyerCount || 0),
    unidentifiedOrderCount,
    totalOrderCount,
  };
}

async function summarizeNewBuyersByChannel(query = {}) {
  const scopeFilter = buildFilter({ ...query, dateFrom: undefined, dateTo: undefined });
  const firstOrderConditions = [];
  if (query.dateFrom) firstOrderConditions.push({ $gte: ['$firstOrderAt', new Date(query.dateFrom)] });
  if (query.dateTo) firstOrderConditions.push({ $lte: ['$firstOrderAt', new Date(query.dateTo)] });

  return Order.aggregate([
    { $match: { ...scopeFilter, ...buyerIdentityFilter() } },
    { $sort: { orderedAt: 1, _id: 1 } },
    {
      $group: {
        _id: {
          shopId: '$shopId',
          salesChannelCode: '$salesChannelCode',
          marketplaceCode: '$marketplaceCode',
          externalBuyerId: '$buyer.externalBuyerId',
        },
        firstOrderId: { $first: '$_id' },
        firstOrderAt: { $first: '$orderedAt' },
      },
    },
    ...(firstOrderConditions.length > 0 ? [{
      $match: {
        $expr: firstOrderConditions.length === 1 ? firstOrderConditions[0] : { $and: firstOrderConditions },
      },
    }] : []),
    {
      $lookup: {
        from: 'orderitems',
        let: { orderId: '$firstOrderId' },
        pipeline: [
          { $match: { $expr: { $eq: ['$orderId', '$$orderId'] } } },
          { $sort: { createdAt: 1, _id: 1 } },
          { $limit: 1 },
          { $project: { _id: 0, currency: '$price.currency' } },
        ],
        as: 'firstOrderItems',
      },
    },
    {
      $set: {
        currency: { $ifNull: [{ $arrayElemAt: ['$firstOrderItems.currency', 0] }, null] },
      },
    },
    {
      $group: {
        _id: {
          salesChannelCode: '$_id.salesChannelCode',
          marketplaceCode: '$_id.marketplaceCode',
          currency: '$currency',
        },
        newBuyerCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        salesChannelCode: '$_id.salesChannelCode',
        marketplaceCode: '$_id.marketplaceCode',
        currency: '$_id.currency',
        newBuyerCount: 1,
      },
    },
    { $sort: { salesChannelCode: 1, marketplaceCode: 1, currency: 1 } },
  ]);
}

async function updateStatus(orderId, status, patch = {}, { session } = {}) {
  return Order.findByIdAndUpdate(
    orderId,
    { $set: { ...patch, status } },
    { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) },
  ).lean();
}

async function updateDeliveredAt(orderId, deliveredAt) {
  return Order.findByIdAndUpdate(
    orderId,
    { $set: { deliveredAt } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function findByIds(orderIds = []) {
  if (!orderIds.length) return [];
  return Order.find({ _id: { $in: orderIds } }).lean();
}

async function findIdsByAssignedStaff(accountIds) {
  const ids = (Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean);
  if (!ids.length) return [];
  return Order.distinct('_id', { assignedStaffIds: { $in: ids.map(toObjectId) } });
}

async function findIdsByBuyerSearch(q) {
  if (!q) return [];
  const search = { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  return Order.distinct('_id', { $or: [{ 'buyer.name': search }, { 'buyer.emailMasked': search }] });
}

module.exports = {
  create,
  findById,
  findByIds,
  findIdsByAssignedStaff,
  findIdsByBuyerSearch,
  findByExternalIdentity,
  updateAddressValidation,
  updateShippingAddress,
  updateAssignedStaffIds,
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
  summarizeBuyerInsights,
  summarizeNewBuyersByChannel,
};
