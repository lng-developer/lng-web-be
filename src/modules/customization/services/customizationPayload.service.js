const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { hashString } = require('../../../shared/utils/crypto');
const { isDuplicateKeyError } = require('../../../shared/utils/mongo');
const { normalizePagination } = require('../../../shared/utils/pagination');
const authPublic = require('../../auth/public');
const repository = require('../repositories/customizationPayload.repository');
const { customizationStatuses } = require('../constants/customizationStatuses');
const { customizationErrorCodes } = require('../constants/customizationErrorCodes');

const supportedSources = ['AMAZON_EXTENSION_REPORT', 'MANUAL_EXCEL'];
const ORDER_READ_PERMISSION = 'ORDERS:READ';
const ORDER_WRITE_PERMISSION = 'ORDERS:WRITE';
const SHOP_SCOPE_TYPE = 'shop';

function getOrderPublic() {
  return require('../../order/public');
}

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function validationError(message, details) {
  return appError(message, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR, details);
}

function notFound(message) {
  return appError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function hasGlobalPermission(authContext, permission) {
  return Boolean(authContext && (authContext.permissions || []).includes(permission));
}

function getScopedShopIds(authContext = {}, permission) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => (
      scope.scopeType === SHOP_SCOPE_TYPE
      && scope.scopeId
      && (scope.permissions || []).includes(permission)
    ))
    .map((scope) => String(scope.scopeId)))];
}

function emptyPaginatedResult(query = {}) {
  const { page, limit } = normalizePagination(query);
  return { items: [], total: 0, page, limit };
}

function assertCanAccessShop(shopId, permission, authContext) {
  if (!authContext || hasGlobalPermission(authContext, permission)) {
    return;
  }

  if (!authPublic.canAccessScope(authContext, permission, {
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shopId,
  })) {
    throw forbidden();
  }
}

function assertRequired(value, field) {
  if (value === undefined || value === null || value === '') {
    throw validationError(`${field} is required`, { field });
  }
}

function assertRawCustomization(rawCustomization) {
  if (
    rawCustomization === undefined
    || rawCustomization === null
    || Array.isArray(rawCustomization)
    || typeof rawCustomization !== 'object'
    || Object.keys(rawCustomization).length === 0
  ) {
    throw validationError('rawCustomization is required', {
      field: 'rawCustomization',
      errorCode: customizationErrorCodes.MISSING_RAW_CUSTOMIZATION,
    });
  }
}

function stableStringify(value) {
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }

  return JSON.stringify(value);
}

function buildRawCustomizationHash(rawCustomization) {
  return hashString(stableStringify(rawCustomization));
}

function validateCreatePayload(payload = {}) {
  assertRequired(payload.orderItemId, 'orderItemId');
  assertRequired(payload.orderId, 'orderId');
  assertRequired(payload.shopId, 'shopId');
  assertRequired(payload.source, 'source');
  assertRawCustomization(payload.rawCustomization);

  const source = String(payload.source).trim().toUpperCase();

  if (!supportedSources.includes(source)) {
    throw validationError('source is invalid', { field: 'source' });
  }

  return {
    ...payload,
    source,
    rawCustomizationHash: buildRawCustomizationHash(payload.rawCustomization),
  };
}

function assertSameId(actual, expected, field) {
  if (String(actual) !== String(expected)) {
    throw validationError(`${field} does not match order item`, { field });
  }
}

async function assertOrderItemMatchesPayload(payload) {
  const orderPublic = getOrderPublic();
  const orderItem = await orderPublic.findItemById(payload.orderItemId);

  if (!orderItem) {
    throw notFound('Order item not found');
  }

  assertSameId(orderItem.orderId, payload.orderId, 'orderId');
  assertSameId(orderItem.shopId, payload.shopId, 'shopId');

  return orderItem;
}

async function loadPayload(payloadId) {
  assertRequired(payloadId, 'payloadId');
  const payload = await repository.findById(payloadId);

  if (!payload) {
    throw notFound('Customization payload not found');
  }

  return payload;
}

async function createPendingPayload(payload = {}, authContext) {
  const normalizedPayload = validateCreatePayload(payload);
  await assertOrderItemMatchesPayload(normalizedPayload);
  assertCanAccessShop(normalizedPayload.shopId, ORDER_WRITE_PERMISSION, authContext);

  const existing = await repository.findByOrderItemAndHash(
    normalizedPayload.orderItemId,
    normalizedPayload.rawCustomizationHash,
  );

  if (existing) {
    return { payload: existing, created: false };
  }

  try {
    const createdPayload = await repository.create({
      ...normalizedPayload,
      status: customizationStatuses.PENDING,
    });

    return { payload: createdPayload, created: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    const recovered = await repository.findByOrderItemAndHash(
      normalizedPayload.orderItemId,
      normalizedPayload.rawCustomizationHash,
    );

    if (!recovered) {
      throw appError(
        'Duplicate customization payload detected but existing payload could not be loaded',
        httpStatus.CONFLICT,
        customizationErrorCodes.DUPLICATE_PAYLOAD,
      );
    }

    return { payload: recovered, created: false };
  }
}

async function getByOrderItem(orderItemId) {
  assertRequired(orderItemId, 'orderItemId');
  const payload = await repository.findByOrderItem(orderItemId);

  if (!payload) {
    throw notFound('Customization payload not found');
  }

  return payload;
}

async function getById(payloadId, authContext) {
  const payload = await loadPayload(payloadId);
  assertCanAccessShop(payload.shopId, ORDER_READ_PERMISSION, authContext);

  return payload;
}

async function getByOrderItemWithAuth(orderItemId, authContext) {
  const payload = await getByOrderItem(orderItemId);
  assertCanAccessShop(payload.shopId, ORDER_READ_PERMISSION, authContext);

  return payload;
}

async function listPayloads(params = {}, authContext) {
  if (!authContext || hasGlobalPermission(authContext, ORDER_READ_PERMISSION)) {
    return repository.list(params);
  }

  const scopedShopIds = getScopedShopIds(authContext, ORDER_READ_PERMISSION);

  if (scopedShopIds.length === 0) {
    return emptyPaginatedResult(params);
  }

  if (params.shopId && !scopedShopIds.includes(String(params.shopId))) {
    return emptyPaginatedResult(params);
  }

  if (params.shopId) {
    return repository.list(params);
  }

  return repository.list({
    ...params,
    shopIds: scopedShopIds,
  });
}

async function updatePayloadStatus(payloadId, status, patch, authContext) {
  const existing = await loadPayload(payloadId);
  assertCanAccessShop(existing.shopId, ORDER_WRITE_PERMISSION, authContext);
  const payload = await repository.updateStatus(payloadId, status, patch);

  if (!payload) {
    throw notFound('Customization payload not found');
  }

  return payload;
}

async function updatePayloadParsedData(payloadId, parsedData, patch, authContext) {
  const existing = await loadPayload(payloadId);
  assertCanAccessShop(existing.shopId, ORDER_WRITE_PERMISSION, authContext);
  const payload = await repository.updateParsedData(payloadId, parsedData, patch);

  if (!payload) {
    throw notFound('Customization payload not found');
  }

  return payload;
}

async function markNeedsReview(payloadId, reason, authContext) {
  return updatePayloadStatus(payloadId, customizationStatuses.NEEDS_REVIEW, {
    errorCode: customizationErrorCodes.MANUAL_REVIEW_REQUIRED,
    errorMessage: reason || null,
  }, authContext);
}

async function markFailed(payloadId, { errorCode, errorMessage } = {}, authContext) {
  return updatePayloadStatus(payloadId, customizationStatuses.FAILED, {
    errorCode: errorCode || customizationErrorCodes.INVALID_RAW_CUSTOMIZATION,
    errorMessage: errorMessage || null,
    lastTriedAt: new Date(),
  }, authContext);
}

async function markParsed(payloadId, parsedData, authContext) {
  return updatePayloadParsedData(payloadId, parsedData || {}, {
    status: customizationStatuses.PARSED,
    errorCode: null,
    errorMessage: null,
    lastTriedAt: new Date(),
  }, authContext);
}

async function assertCustomizationReady(orderItemId) {
  const payload = await getByOrderItem(orderItemId);

  if (payload.status !== customizationStatuses.PARSED) {
    throw appError(
      'Customization payload is not ready',
      httpStatus.CONFLICT,
      errorCodes.CONFLICT_ERROR,
      { errorCode: customizationErrorCodes.PAYLOAD_NOT_READY },
    );
  }

  return payload;
}

module.exports = {
  createPendingPayload,
  getByOrderItem: getByOrderItemWithAuth,
  getById,
  listPayloads,
  markNeedsReview,
  markFailed,
  markParsed,
  assertCustomizationReady,
  buildRawCustomizationHash,
};
