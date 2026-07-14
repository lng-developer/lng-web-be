const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const customizationPublic = require('../../customization/public');
const mappingPublic = require('../../mapping/public');
const productionPublic = require('../../production/public');
const shipmentPublic = require('../../shipment/public');
const orderItemRepository = require('../repositories/orderItem.repository');

const ORDER_WRITE_PERMISSION = 'ORDERS:WRITE';
const SHOP_SCOPE_TYPE = 'shop';

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function hasGlobalOrderWrite(authContext = {}) {
  return (authContext.permissions || []).includes(ORDER_WRITE_PERMISSION);
}

function assertCanWriteShop(shopId, authContext = {}) {
  if (hasGlobalOrderWrite(authContext)) return;
  if (!authPublic.canAccessScope(authContext, ORDER_WRITE_PERMISSION, {
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shopId,
  })) {
    throw forbidden();
  }
}

function compactError(error) {
  return {
    ok: false,
    status: 'ERROR',
    errorCode: error.code || errorCodes.INTERNAL_SERVER_ERROR,
    message: error.message,
  };
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

async function loadItem(orderItemId) {
  const item = await orderItemRepository.findById(orderItemId);
  if (!item) throw notFound('Order item not found');
  return item;
}

async function recheckCustomization(item, authContext) {
  if (!item.customizationRawSummary?.hasCustomization) {
    return { ok: true, status: 'NOT_REQUIRED' };
  }

  try {
    const payload = await customizationPublic.getByOrderItemDto(toId(item), authContext);
    return {
      ok: payload?.status === 'PARSED',
      status: payload?.status || 'UNKNOWN',
      payloadId: payload?.id || payload?.payloadId || null,
    };
  } catch (error) {
    return compactError(error);
  }
}

async function recheckMapping(orderItemId, authContext) {
  try {
    const result = await mappingPublic.recheckFulfillmentPlan(orderItemId, {}, authContext);
    return {
      ok: result?.status === 'READY',
      status: result?.status || (result?.ready === false ? 'BLOCKED' : 'UNKNOWN'),
      planId: result?.id || null,
      blockingReasons: result?.blockingReasons || [],
    };
  } catch (error) {
    return compactError(error);
  }
}

async function recheckProduction(orderItemId, mappingStep, authContext) {
  if (mappingStep.status !== 'READY') return { ok: true, status: 'SKIPPED' };

  try {
    const task = await productionPublic.createOrRecheckTaskForOrderItem(orderItemId, authContext);
    return {
      ok: true,
      status: task?.status || null,
      taskId: task?.id || null,
      blockers: task?.blockers || [],
    };
  } catch (error) {
    return compactError(error);
  }
}

async function recheckShipment(orderItemId, authContext) {
  try {
    const shipment = await shipmentPublic.getShipmentByOrderItem(orderItemId, authContext);
    return {
      ok: true,
      status: shipment?.status || null,
      shipmentId: shipment?.id || null,
      trackingNumber: shipment?.trackingNumber || null,
    };
  } catch (error) {
    return compactError(error);
  }
}

async function recheckOrderItem(orderItemId, authContext = {}) {
  const before = await loadItem(orderItemId);
  assertCanWriteShop(before.shopId, authContext);

  const customization = await recheckCustomization(before, authContext);
  const mapping = await recheckMapping(orderItemId, authContext);
  const production = await recheckProduction(orderItemId, mapping, authContext);
  const shipment = await recheckShipment(orderItemId, authContext);
  const after = await loadItem(orderItemId);

  return {
    orderItemId,
    statusBefore: before.status || null,
    statusAfter: after.status || null,
    steps: {
      customization,
      mapping,
      production,
      shipment,
    },
    blockingReasons: unique([
      ...(!customization.ok ? ['CUSTOMIZATION_NOT_READY'] : []),
      ...(mapping.blockingReasons || []),
      ...(production.blockers || []),
      ...(!shipment.ok ? ['SHIPMENT_RECHECK_FAILED'] : []),
    ]),
  };
}

module.exports = {
  recheckOrderItem,
};
