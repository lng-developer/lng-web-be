const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const smartyClient = require('../../../shared/clients/smartyClient');
const orderRepository = require('../repositories/order.repository');
const { addressValidationStatuses, orderCaseTypes } = require('../constants/orderStatuses');
const { orderTimelineEventTypes } = require('../constants/orderTimelineEventTypes');
const { orderTimelineSources } = require('../constants/orderTimelineSources');
const orderTimelineService = require('./orderTimeline.service');
const orderAccess = require('./orderAccess.service');
const { recordOrderOperation, withOrderOperation } = require('./orderOperationAudit.service');

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function conflict() {
  return new AppError('Order address was changed by another request', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
}

function appendAddressTimeline(order, eventType, authContext, session) {
  return orderTimelineService.appendTimeline({
    orderId: order._id,
    shopId: order.shopId,
    salesChannelCode: order.salesChannelCode,
    marketplaceCode: order.marketplaceCode,
    eventType,
    source: authContext?.accountId ? orderTimelineSources.USER : orderTimelineSources.SYSTEM,
    actorId: authContext?.accountId || null,
  }, { session });
}

function skipped(order) {
  return {
    ...order,
    addressValidationStatus: addressValidationStatuses.NOT_CHECKED,
    externalData: {
      ...(order.externalData || {}),
      addressValidation: {
        provider: 'smarty',
        skipped: true,
        reason: 'Only US addresses are supported in V1',
        checkedAt: new Date(),
      },
    },
  };
}

function stripUndefined(payload = {}) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

async function syncProductionOrderAddress(order) {
  const productionPublic = require('../../production/public');
  await productionPublic.syncOrderAddressSnapshot?.(order);
}

async function ensureAddressCase(order, reason) {
  if ([addressValidationStatuses.VALID, addressValidationStatuses.OVERRIDDEN].includes(order.addressValidationStatus)) return;
  const orderCaseService = require('./orderCase.service');
  await orderCaseService.ensureOpenOrderCase({
    orderId: order._id,
    caseType: orderCaseTypes.ADDRESS,
    severity: order.addressValidationStatus === addressValidationStatuses.INVALID ? 'HIGH' : 'MEDIUM',
    title: 'Address needs review',
    description: reason || 'Address validation did not pass.',
  }, { system: true });
}

function auditAddressValidation(order, authContext, skippedValidation, session) {
  const fields = ['addressValidationStatus'];
  if (!skippedValidation && order.addressValidationStatus === addressValidationStatuses.VALID) {
    fields.push('shippingAddress');
  }
  return recordOrderOperation({
    action: 'ORDER_ADDRESS_VALIDATED',
    entityType: 'ORDER',
    entityId: order._id,
    shopId: order.shopId,
    authContext: authContext || {},
    changes: { fields },
    metadata: { status: order.addressValidationStatus, skipped: skippedValidation },
    session,
  });
}

async function persistAddressValidation(order, patch, authContext, skippedValidation) {
  const updated = await withOrderOperation(async (session) => {
    const persisted = await orderRepository.updateAddressValidation(order._id, patch, {
      session,
      expectedUpdatedAt: order.updatedAt,
    });
    if (!persisted) throw conflict();
    await appendAddressTimeline(persisted, orderTimelineEventTypes.ADDRESS_VALIDATED, authContext, session);
    await auditAddressValidation(persisted, authContext, skippedValidation, session);
    return persisted;
  });
  await syncProductionOrderAddress(updated);
  if (!skippedValidation) {
    await ensureAddressCase(updated, updated.externalData?.addressValidation?.reason);
  }
  return updated;
}

function interpretCandidate(candidate) {
  if (!candidate) {
    return { status: addressValidationStatuses.INVALID, reason: 'No candidate returned' };
  }

  const enhancedMatch = String(candidate.analysis?.enhanced_match || '');
  if (
    enhancedMatch.includes('postal-match')
    && !enhancedMatch.includes('missing-secondary')
    && !enhancedMatch.includes('unknown-secondary')
  ) {
    return { status: addressValidationStatuses.VALID, reason: enhancedMatch };
  }

  if (enhancedMatch.includes('postal-match')) {
    return { status: addressValidationStatuses.WARNING, reason: enhancedMatch };
  }

  return { status: addressValidationStatuses.INVALID, reason: enhancedMatch || 'No enhanced postal match' };
}

function normalizedAddressFromCandidate(candidate) {
  if (!candidate) return null;

  return {
    addressLine1: candidate.delivery_line_1 || null,
    addressLine2: candidate.delivery_line_2 || null,
    city: candidate.components?.city_name || null,
    stateOrProvince: candidate.components?.state_abbreviation || null,
    stateOrProvinceCode: candidate.components?.state_abbreviation || null,
    postalCode: candidate.components?.zipcode
      ? `${candidate.components.zipcode}${candidate.components.plus4_code ? `-${candidate.components.plus4_code}` : ''}`
      : null,
    countryCode: 'US',
  };
}

function buildPatch(order, candidates) {
  const candidate = Array.isArray(candidates) ? candidates[0] : null;
  const interpretation = interpretCandidate(candidate);
  const normalizedAddress = normalizedAddressFromCandidate(candidate);
  const patch = {
    addressValidationStatus: interpretation.status,
    'externalData.addressValidation': {
      provider: 'smarty',
      checkedAt: new Date(),
      status: interpretation.status,
      reason: interpretation.reason,
      candidateCount: Array.isArray(candidates) ? candidates.length : 0,
      normalizedAddress,
      analysis: candidate?.analysis || null,
    },
  };

  if (interpretation.status === addressValidationStatuses.VALID && normalizedAddress) {
    patch.shippingAddress = {
      ...(order.shippingAddress || {}),
      ...normalizedAddress,
    };
  }

  return patch;
}

async function validateAddress(orderId) {
  return validateAddressForOrder(orderId);
}

async function validateAddressForOrder(orderId, authContext = null) {
  const order = await orderRepository.findById(orderId);
  if (!order) {
    throw notFound('Order not found');
  }

  if (authContext) orderAccess.assertCanWriteShop(order.shopId, authContext);

  if (order.shippingAddress?.countryCode !== 'US') {
    return persistAddressValidation(order, {
      addressValidationStatus: addressValidationStatuses.NOT_CHECKED,
      'externalData.addressValidation': skipped(order).externalData.addressValidation,
    }, authContext, true);
  }

  const candidates = await smartyClient.validateUsStreetAddress(order.shippingAddress);
  return persistAddressValidation(order, buildPatch(order, candidates), authContext, false);
}

async function overrideAddressValidation(orderId, payload = {}, authContext = null) {
  const order = await orderRepository.findById(orderId);
  if (!order) {
    throw notFound('Order not found');
  }

  if (authContext) orderAccess.assertCanWriteShop(order.shopId, authContext);

  const updated = await persistAddressValidation(order, {
    addressValidationStatus: addressValidationStatuses.OVERRIDDEN,
    'externalData.addressValidation': {
      provider: 'manual',
      status: addressValidationStatuses.OVERRIDDEN,
      reason: payload.reason || 'Address manually overridden',
      checkedAt: new Date(),
    },
  }, authContext, true);
  const orderCaseService = require('./orderCase.service');
  await orderCaseService.resolveOpenOrderCaseByType({
    orderId,
    caseType: orderCaseTypes.ADDRESS,
    resolutionNote: payload.reason || 'Address manually overridden',
  }, authContext || {});
  return updated;
}

async function updateShippingAddress(orderId, shippingAddressPatch = {}, authContext = null) {
  const order = await orderRepository.findById(orderId);
  if (!order) {
    throw notFound('Order not found');
  }

  if (authContext) orderAccess.assertCanWriteShop(order.shopId, authContext);

  const shippingAddress = {
    ...(order.shippingAddress || {}),
    ...stripUndefined(shippingAddressPatch),
  };
  const updated = await withOrderOperation(async (session) => {
    const persisted = await orderRepository.updateShippingAddress(orderId, {
      shippingAddress,
      addressValidationStatus: addressValidationStatuses.NOT_CHECKED,
      'externalData.addressValidation': {
        provider: 'smarty',
        status: addressValidationStatuses.NOT_CHECKED,
        reason: 'Shipping address updated manually',
        checkedAt: null,
      },
    }, { session, expectedUpdatedAt: order.updatedAt });
    if (!persisted) throw conflict();
    await appendAddressTimeline(persisted, orderTimelineEventTypes.SHIPPING_ADDRESS_UPDATED, authContext, session);
    await recordOrderOperation({
      action: 'ORDER_SHIPPING_ADDRESS_UPDATED', entityType: 'ORDER', entityId: orderId,
      shopId: order.shopId, authContext: authContext || {}, session,
      changes: { fields: Object.keys(stripUndefined(shippingAddressPatch)) },
    });
    return persisted;
  });
  await syncProductionOrderAddress(updated);
  return updated;
}

module.exports = {
  validateAddress,
  validateAddressForOrder,
  overrideAddressValidation,
  updateShippingAddress,
  interpretCandidate,
  buildPatch,
};
