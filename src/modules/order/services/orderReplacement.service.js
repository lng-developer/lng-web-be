const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { isDuplicateKeyError } = require('../../../shared/utils/mongo');
const { orderItemStatuses } = require('../constants/orderStatuses');
const { orderStatuses } = require('../constants/orderStatuses');
const { orderTimelineEventTypes } = require('../constants/orderTimelineEventTypes');
const { orderTimelineSources } = require('../constants/orderTimelineSources');
const customizationPublic = require('../../customization/public');
const mappingPublic = require('../../mapping/public');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderTimelineService = require('./orderTimeline.service');
const orderReadinessService = require('./orderCostCenterStatus.service');
const orderAccess = require('./orderAccess.service');

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

async function nextReplacementSequence(originalOrder, authContext) {
  const base = originalOrder.externalOrderId;
  for (let sequence = 1; sequence <= 100; sequence += 1) {
    const externalOrderId = `${base}-R${sequence}`;
    const existing = await orderRepository.findByExternalIdentity({
      salesChannelCode: originalOrder.salesChannelCode,
      marketplaceCode: originalOrder.marketplaceCode,
      externalOrderId,
    });
    if (!existing) return sequence;
  }

  throw conflict('Too many replacement orders for original order', {
    orderId: toId(originalOrder),
    actorId: authContext?.accountId || null,
  });
}

function buildReplacementOrderPayload(originalOrder, originalItem, { reason, sequence, now }) {
  const externalOrderId = `${originalOrder.externalOrderId}-R${sequence}`;

  return {
    shopId: originalOrder.shopId,
    shopConnectionId: originalOrder.shopConnectionId || null,
    salesChannelCode: originalOrder.salesChannelCode,
    marketplaceCode: originalOrder.marketplaceCode,
    externalOrderId,
    externalStatus: null,
    externalAccountId: originalOrder.externalAccountId || null,
    assignedStaffId: originalOrder.assignedStaffId || null,
    costCenterStatus: 'MISSING',
    psdStatus: 'MISSING',
    paymentStatus: 'UNKNOWN',
    caseStatus: originalOrder.caseStatus || 'NONE',
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

async function recheckReplacementMapping(orderItemId) {
  try {
    await mappingPublic.recheckFulfillmentPlan(orderItemId, {}, {
      system: true,
      source: 'ORDER_REPLACEMENT',
    });
  } catch (_) {
    // Replacement creation must not fail after the order/item has already been created.
  }
}

async function createReplacementForItem(orderItemId, payload = {}, authContext = {}) {
  const originalItem = await orderItemRepository.findById(orderItemId);
  if (!originalItem) throw notFound('Order item not found');
  orderAccess.assertCanWriteShop(originalItem.shopId, authContext);

  const originalOrder = await orderRepository.findById(originalItem.orderId);
  if (!originalOrder) throw notFound('Order not found');
  const sequence = await nextReplacementSequence(originalOrder, authContext);
  const now = new Date();
  let replacementOrder;
  try {
    replacementOrder = await orderRepository.create(buildReplacementOrderPayload(originalOrder, originalItem, {
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

  await customizationPublic.cloneLatestPayloadForReplacement({
    originalOrderItemId: toId(originalItem),
    replacementOrderId: toId(replacementOrder),
    replacementOrderItemId: toId(replacement),
    replacementShopId: toId(replacement.shopId),
  });
  await recheckReplacementMapping(toId(replacement));

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

  await orderReadinessService.updateCostCenterStatusForOrder(replacement.orderId);
  await orderReadinessService.updatePsdStatusForOrder(replacement.orderId);

  return replacement;
}

module.exports = {
  createReplacementForItem,
};
