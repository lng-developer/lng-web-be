const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { isDuplicateKeyError } = require('../../../shared/utils/mongo');
const { orderItemStatuses } = require('../constants/orderStatuses');
const { orderStatuses } = require('../constants/orderStatuses');
const { orderTimelineEventTypes } = require('../constants/orderTimelineEventTypes');
const { orderTimelineSources } = require('../constants/orderTimelineSources');
const customizationPublic = require('../../customization/public');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderCaseRepository = require('../repositories/orderCase.repository');
const orderWorkbenchProjectionRepository = require('../repositories/orderWorkbenchProjection.repository');
const orderTimelineService = require('./orderTimeline.service');
const orderCaseService = require('./orderCase.service');
const orderWorkbenchProjectionService = require('./orderWorkbenchProjection.service');
const orderAccess = require('./orderAccess.service');
const orderNotificationService = require('./orderNotification.service');
const { recordOrderOperation } = require('./orderOperationAudit.service');

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function conflict(message, details) {
  return new AppError(message, httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR, details);
}

function zeroPrice(currency = 'USD') {
  return {
    itemPriceAmount: 0,
    itemTaxAmount: 0,
    shippingPriceAmount: 0,
    shippingTaxAmount: 0,
    giftWrapPriceAmount: 0,
    giftWrapTaxAmount: 0,
    itemPromotionDiscountAmount: 0,
    shipPromotionDiscountAmount: 0,
    currency,
  };
}

async function resolveReplacementRootOrder(originalOrder) {
  let rootOrder = originalOrder;
  const visitedOrderIds = new Set();
  while (rootOrder.replacementOfOrderId) {
    const orderId = toId(rootOrder);
    if (!orderId || visitedOrderIds.has(orderId)) {
      throw conflict('Replacement order lineage is invalid', { orderId });
    }
    visitedOrderIds.add(orderId);
    const parentOrder = await orderRepository.findById(rootOrder.replacementOfOrderId);
    if (!parentOrder) {
      throw conflict('Replacement order parent was not found', { orderId, parentOrderId: toId(rootOrder.replacementOfOrderId) });
    }
    rootOrder = parentOrder;
  }
  return rootOrder;
}

async function nextReplacementSequence(rootOrder, authContext) {
  const base = rootOrder.externalOrderId;
  for (let sequence = 1; sequence <= 100; sequence += 1) {
    const externalOrderId = `${base}-R${sequence}`;
    const existing = await orderRepository.findByExternalIdentity({
      salesChannelCode: rootOrder.salesChannelCode,
      marketplaceCode: rootOrder.marketplaceCode,
      externalOrderId,
    });
    if (!existing) return sequence;
  }

  throw conflict('Too many replacement orders for original order', {
    orderId: toId(originalOrder),
    actorId: authContext?.accountId || null,
  });
}

function buildReplacementOrderPayload(originalOrder, rootOrder, originalItem, { reason, sequence, now }) {
  const externalOrderId = `${rootOrder.externalOrderId}-R${sequence}`;

  return {
    shopId: originalOrder.shopId,
    shopConnectionId: originalOrder.shopConnectionId || null,
    salesChannelCode: originalOrder.salesChannelCode,
    marketplaceCode: originalOrder.marketplaceCode,
    externalOrderId,
    externalStatus: null,
    externalAccountId: originalOrder.externalAccountId || null,
    assignedStaffIds: originalOrder.assignedStaffIds || [],
    costCenterStatus: 'MISSING',
    psdStatus: originalOrder.psdStatus || 'MISSING',
    paymentStatus: 'UNKNOWN',
    caseStatus: 'NONE',
    importSources: originalOrder.importSources || [],
    orderedAt: now,
    shipByDate: originalOrder.shipByDate || null,
    deliveredByDate: originalOrder.deliveredByDate || null,
    buyer: originalOrder.buyer || {},
    shippingAddress: originalOrder.shippingAddress || {},
    addressValidationStatus: originalOrder.addressValidationStatus || 'NOT_CHECKED',
    shippingService: originalOrder.shippingService || {},
    replacementOfOrderId: toId(originalOrder),
    replacementOfOrderItemId: toId(originalItem),
    replacementSequence: sequence,
    replacementReason: reason || null,
    status: orderStatuses.IMPORTED,
    rawRecordIds: [],
    externalData: {
      replacement: {
        internal: true,
        originalExternalOrderId: originalOrder.externalOrderId,
        rootExternalOrderId: rootOrder.externalOrderId,
        replacementOfOrderId: toId(originalOrder),
        replacementOfOrderItemId: toId(originalItem),
      },
    },
    importedAt: now,
    lastImportedAt: now,
  };
}

function buildReplacementItemPayload(originalItem, replacementOrder, { reason, quantity, sequence }) {
  const replacementExternalItemId = `${originalItem.externalItemId}-R${sequence}`;
  const currency = originalItem.price?.currency || 'USD';

  return {
    orderId: toId(replacementOrder),
    shopId: originalItem.shopId,
    shopConnectionId: originalItem.shopConnectionId || null,
    salesChannelCode: originalItem.salesChannelCode,
    marketplaceCode: originalItem.marketplaceCode,
    externalOrderId: replacementOrder.externalOrderId,
    externalItemId: replacementExternalItemId,
    externalAccountId: originalItem.externalAccountId || null,
    externalProductId: originalItem.externalProductId || null,
    externalListingId: originalItem.externalListingId || null,
    externalVariantId: originalItem.externalVariantId || null,
    asin: originalItem.asin || null,
    sku: originalItem.sku || null,
    title: originalItem.title || null,
    quantity: quantity || originalItem.quantity || 1,
    variantRaw: originalItem.variantRaw || null,
    customizationRawSummary: originalItem.customizationRawSummary || null,
    csNote: originalItem.csNote || null,
    price: zeroPrice(currency),
    listingId: originalItem.listingId || null,
    replacementOfOrderId: originalItem.orderId,
    replacementOfOrderItemId: toId(originalItem),
    replacementSequence: sequence,
    replacementReason: reason || null,
    externalStatus: null,
    status: orderItemStatuses.NEW,
    shipByDate: originalItem.shipByDate || null,
    rawRecordId: null,
    rawRecordIds: [],
    importSources: originalItem.importSources || [],
    externalData: {
      replacement: {
        internal: true,
        replacementOfOrderItemId: toId(originalItem),
        originalExternalItemId: originalItem.externalItemId,
      },
    },
  };
}

function hasPsdSnapshot(item = {}) {
  if (item.listingVariant?.psdReadiness) return item.listingVariant.psdReadiness.status !== 'MISSING';
  return Boolean(item.listing?.defaultPsdTemplateAssetId);
}

async function copyReplacementDisplayContext(originalOrder, originalItems, replacementOrder, replacements) {
  const source = await orderWorkbenchProjectionRepository.findByOrderId(toId(originalOrder));
  const sourceItems = new Map((source?.items || []).map((item) => [toId(item.orderItemId), item]));
  const copiedItems = originalItems.map((originalItem, index) => ({
    source: sourceItems.get(toId(originalItem)),
    replacement: replacements[index],
  })).filter(({ source, replacement }) => source && replacement);

  await Promise.all(copiedItems.map(({ source, replacement }) => {
    const patch = {};
    ['seller', 'listing', 'listingVariant'].forEach((field) => {
      if (source[field]) patch[field] = source[field];
    });
    return Object.keys(patch).length
      ? orderWorkbenchProjectionService.updateOrderWorkbenchItem(
        toId(replacementOrder),
        toId(replacement),
        patch,
        { source: 'ORDER_REPLACEMENT' },
      )
      : null;
  }).filter(Boolean));

  const hasCurrentPsd = copiedItems.length === replacements.length
    && copiedItems.every(({ source }) => hasPsdSnapshot(source));
  await orderWorkbenchProjectionService.updateOrderWorkbenchOrder(
    toId(replacementOrder),
    { psdStatus: originalOrder.psdStatus || 'MISSING', hasCurrentPsd },
    { source: 'ORDER_REPLACEMENT' },
  );
}

async function copyOpenCases(originalOrder, originalItems, replacementOrder, replacements, authContext) {
  const replacementItemIds = new Map(originalItems.map((item, index) => [toId(item), toId(replacements[index])]));
  const openCases = await orderCaseRepository.listOpenByOrder(toId(originalOrder));
  await Promise.all(openCases
    .filter((orderCase) => !orderCase.orderItemId || replacementItemIds.has(toId(orderCase.orderItemId)))
    .map((orderCase) => orderCaseService.createOrderCase({
      orderId: toId(replacementOrder),
      orderItemId: orderCase.orderItemId ? replacementItemIds.get(toId(orderCase.orderItemId)) : null,
      caseType: orderCase.caseType,
      severity: orderCase.severity,
      title: orderCase.title,
      description: orderCase.description || null,
    }, authContext)));
}

async function createReplacementForItem(orderItemId, payload = {}, authContext = {}) {
  const originalItem = await orderItemRepository.findById(orderItemId);
  if (!originalItem) throw notFound('Order item not found');

  const originalOrder = await orderRepository.findById(originalItem.orderId);
  if (!originalOrder) throw notFound('Order not found');
  await orderAccess.assertCanWriteOrder(originalOrder, authContext);
  const rootOrder = await resolveReplacementRootOrder(originalOrder);
  const sequence = await nextReplacementSequence(rootOrder, authContext);
  const now = new Date();
  let replacementOrder;
  try {
    replacementOrder = await orderRepository.create(buildReplacementOrderPayload(originalOrder, rootOrder, originalItem, {
      reason: payload.reason || null,
      sequence,
      now,
    }));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw conflict('Replacement order already exists', { sequence });
    }
    throw error;
  }

  const replacement = await orderItemRepository.create(buildReplacementItemPayload(originalItem, replacementOrder, {
    reason: payload.reason || null,
    quantity: payload.quantity,
    sequence,
  }));
  await orderWorkbenchProjectionService.upsertOrderWorkbenchBase(replacementOrder, [replacement], {
    source: 'ORDER_REPLACEMENT',
  });

  await customizationPublic.cloneLatestPayloadForReplacement({
    originalOrderItemId: toId(originalItem),
    replacementOrderId: toId(replacementOrder),
    replacementOrderItemId: toId(replacement),
    replacementShopId: toId(replacement.shopId),
  });
  await copyOpenCases(originalOrder, [originalItem], replacementOrder, [replacement], authContext);

  await orderTimelineService.appendTimeline({
    orderId: replacement.orderId,
    orderItemId: toId(replacement),
    shopId: replacement.shopId,
    salesChannelCode: replacement.salesChannelCode,
    marketplaceCode: replacement.marketplaceCode,
    eventType: orderTimelineEventTypes.ORDER_ITEM_REPLACEMENT_CREATED,
    source: authContext ? orderTimelineSources.USER : orderTimelineSources.SYSTEM,
    metadata: {
      replacementOfOrderItemId: toId(originalItem),
      originalExternalItemId: originalItem.externalItemId,
      replacementExternalItemId: replacement.externalItemId,
      replacementSequence: sequence,
      reason: payload.reason || null,
    },
  });

  await copyReplacementDisplayContext(originalOrder, [originalItem], replacementOrder, [replacement]);
  await recordOrderOperation({
    action: 'ORDER_ITEM_REPLACEMENT_CREATED', entityType: 'ORDER_ITEM', entityId: toId(replacement),
    shopId: replacement.shopId, authContext,
    metadata: {
      replacementOfOrderItemId: toId(originalItem),
      replacementOrderId: toId(replacementOrder),
      sequence,
      reasonProvided: Boolean(payload.reason),
    },
  });
  await orderNotificationService.notifyAssignedStaff({
    order: originalOrder,
    actorAccountId: authContext.accountId || null,
    type: 'ORDER_ITEM_REPLACEMENT_CREATED',
    title: 'Replacement item created',
    message: 'A replacement was created for an assigned order.',
    deduplicationScope: toId(replacement),
  });

  return replacement;
}

async function createReplacementForOrder(orderId, payload = {}, authContext = {}) {
  const originalOrder = await orderRepository.findById(orderId);
  if (!originalOrder) throw notFound('Order not found');
  await orderAccess.assertCanWriteOrder(originalOrder, authContext);

  const selections = payload.items || [];
  const selectedIds = selections.map(({ orderItemId }) => String(orderItemId));
  const originalItems = await orderItemRepository.findByIds(selectedIds);
  const itemsById = new Map(originalItems.map((item) => [toId(item), item]));
  if (originalItems.length !== selectedIds.length
    || originalItems.some((item) => toId(item.orderId) !== toId(originalOrder))) {
    throw conflict('Replacement items must belong to the selected order');
  }

  const rootOrder = await resolveReplacementRootOrder(originalOrder);
  const sequence = await nextReplacementSequence(rootOrder, authContext);
  const now = new Date();
  const replacementOrder = await orderRepository.create(buildReplacementOrderPayload(
    originalOrder,
    rootOrder,
    null,
    { reason: payload.reason || null, sequence, now },
  ));
  const replacements = [];

  for (const selection of selections) {
    const originalItem = itemsById.get(String(selection.orderItemId));
    const replacement = await orderItemRepository.create(buildReplacementItemPayload(
      originalItem,
      replacementOrder,
      { reason: payload.reason || null, quantity: selection.quantity, sequence },
    ));
    replacements.push(replacement);
  }
  await orderWorkbenchProjectionService.upsertOrderWorkbenchBase(replacementOrder, replacements, {
    source: 'ORDER_REPLACEMENT',
  });
  for (let index = 0; index < selections.length; index += 1) {
    const selection = selections[index];
    const originalItem = itemsById.get(String(selection.orderItemId));
    const replacement = replacements[index];
    await customizationPublic.cloneLatestPayloadForReplacement({
      originalOrderItemId: toId(originalItem),
      replacementOrderId: toId(replacementOrder),
      replacementOrderItemId: toId(replacement),
      replacementShopId: toId(replacement.shopId),
    });
    await orderTimelineService.appendTimeline({
      orderId: toId(replacementOrder),
      orderItemId: toId(replacement),
      shopId: replacement.shopId,
      salesChannelCode: replacement.salesChannelCode,
      marketplaceCode: replacement.marketplaceCode,
      eventType: orderTimelineEventTypes.ORDER_ITEM_REPLACEMENT_CREATED,
      source: authContext ? orderTimelineSources.USER : orderTimelineSources.SYSTEM,
      metadata: {
        replacementOfOrderItemId: toId(originalItem),
        originalExternalItemId: originalItem.externalItemId,
        replacementExternalItemId: replacement.externalItemId,
        replacementSequence: sequence,
        reason: payload.reason || null,
      },
    });
    await recordOrderOperation({
      action: 'ORDER_ITEM_REPLACEMENT_CREATED', entityType: 'ORDER_ITEM', entityId: toId(replacement),
      shopId: replacement.shopId, authContext,
      metadata: {
        replacementOfOrderItemId: toId(originalItem),
        replacementOrderId: toId(replacementOrder),
        sequence,
        reasonProvided: Boolean(payload.reason),
      },
    });
  }

  await copyOpenCases(originalOrder, originalItems, replacementOrder, replacements, authContext);
  await copyReplacementDisplayContext(originalOrder, originalItems, replacementOrder, replacements);
  await orderNotificationService.notifyAssignedStaff({
    order: originalOrder,
    actorAccountId: authContext.accountId || null,
    type: 'ORDER_REPLACEMENT_CREATED',
    title: 'Replacement order created',
    message: 'A replacement order was created for an assigned order.',
    deduplicationScope: toId(replacementOrder),
  });
  return { order: replacementOrder, items: replacements };
}

module.exports = {
  createReplacementForItem,
  createReplacementForOrder,
};
