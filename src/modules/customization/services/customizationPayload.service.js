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
const { toOrderItemCustomizationViewDto } = require('../dtos/customizationPayload.dto');

const supportedSources = ['AMAZON_EXTENSION_REPORT', 'MANUAL_EXCEL'];
const ORDER_READ_PERMISSION = 'ORDERS:READ';
const ORDER_WRITE_PERMISSION = 'ORDERS:WRITE';
const SHOP_SCOPE_TYPE = 'shop';

function getOrderPublic() {
  return require('../../order/public');
}

function getShopPublic() {
  return require('../../shop/public');
}

async function syncWorkbenchCustomization(payload) {
  if (!payload?.orderId || !payload?.orderItemId) return;
  const customization = toOrderItemCustomizationViewDto(payload);
  delete customization.listingPreviewImageUrl;
  delete customization.sourceCustomizationUrl;
  await getOrderPublic().updateOrderWorkbenchItem(
    payload.orderId,
    payload.orderItemId,
    { customization },
    { source: 'CUSTOMIZATION' },
  );
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
  if (authContext && authContext.system) return true;
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
    await syncWorkbenchCustomization(existing);
    return { payload: existing, created: false };
  }

  try {
    const createdPayload = await repository.create({
      ...normalizedPayload,
      status: customizationStatuses.PENDING,
    });

    await syncWorkbenchCustomization(createdPayload);
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

    await syncWorkbenchCustomization(recovered);
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

async function listLatestByOrderItems(orderItemIds = [], authContext) {
  const payloads = await repository.findLatestByOrderItems([...new Set((orderItemIds || []).map(String))]);
  payloads.forEach((payload) => assertCanAccessShop(payload.shopId, ORDER_READ_PERMISSION, authContext));
  return payloads;
}

async function cloneLatestPayloadForReplacement({
  originalOrderItemId,
  replacementOrderId,
  replacementOrderItemId,
  replacementShopId,
} = {}) {
  assertRequired(originalOrderItemId, 'originalOrderItemId');
  assertRequired(replacementOrderId, 'replacementOrderId');
  assertRequired(replacementOrderItemId, 'replacementOrderItemId');
  assertRequired(replacementShopId, 'replacementShopId');

  const original = await repository.findByOrderItem(originalOrderItemId);
  if (!original) return null;

  return repository.create({
    orderItemId: replacementOrderItemId,
    orderId: replacementOrderId,
    shopId: replacementShopId,
    source: original.source,
    rawRecordId: original.rawRecordId || null,
    rawCustomization: original.rawCustomization,
    rawCustomizationHash: original.rawCustomizationHash,
    assets: original.assets || [],
    parsedData: original.parsedData || {},
    status: original.status,
    errorCode: original.errorCode || null,
    errorMessage: original.errorMessage || null,
    retryCount: original.retryCount || 0,
    lastTriedAt: original.lastTriedAt || null,
    reviewedBy: original.reviewedBy || null,
    reviewedAt: original.reviewedAt || null,
    createdBy: original.createdBy || null,
  });
}

async function listPayloads(params = {}, authContext) {
  const query = { ...params };
  if (query.q) {
    const orderPublic = getOrderPublic();
    const [directItemIds, buyerOrderIds] = await Promise.all([
      orderPublic.findItemIds({ q: query.q }),
      orderPublic.findOrderIdsByBuyerSearch(query.q),
    ]);
    const buyerItemIds = buyerOrderIds.length ? await orderPublic.findItemIds({ orderIds: buyerOrderIds }) : [];
    query.orderItemIds = [...new Set([...directItemIds, ...buyerItemIds].map(String))];
    delete query.q;
    if (!query.orderItemIds.length) return emptyPaginatedResult(query);
  }

  if (authContext && !hasGlobalPermission(authContext, ORDER_READ_PERMISSION)) {
    const scopedShopIds = getScopedShopIds(authContext, ORDER_READ_PERMISSION);
    if (!scopedShopIds.length || (query.shopId && !scopedShopIds.includes(String(query.shopId)))) {
      return emptyPaginatedResult(query);
    }
    if (!query.shopId) query.shopIds = scopedShopIds;
  }

  const result = await repository.listOperational(query);
  if (!result.items.length) return result;

  const orderPublic = getOrderPublic();
  const orderItems = await orderPublic.findItemsByIds(result.items.map((item) => item.orderItemId));
  const orders = await orderPublic.findOrdersByIds(orderItems.map((item) => item.orderId));
  const shops = await getShopPublic().findByIds(result.items.map((item) => item.shopId));
  const itemById = new Map(orderItems.map((item) => [String(item._id), item]));
  const orderById = new Map(orders.map((order) => [String(order._id), order]));
  const shopById = new Map(shops.map((shop) => [String(shop._id), shop]));

  return {
    ...result,
    items: result.items.map((payload) => {
      const item = itemById.get(String(payload.orderItemId));
      return {
        ...payload,
        context: {
          order: orderById.get(String(item?.orderId)) || null,
          item: item || null,
          shop: shopById.get(String(payload.shopId)) || null,
        },
      };
    }),
  };
}

async function summarizePayloads(params = {}, authContext) {
  const query = { ...params };
  if (authContext && !hasGlobalPermission(authContext, ORDER_READ_PERMISSION)) {
    const scopedShopIds = getScopedShopIds(authContext, ORDER_READ_PERMISSION);
    if (!scopedShopIds.length || (query.shopId && !scopedShopIds.includes(String(query.shopId)))) {
      return { pending: 0, needsReview: 0, failed: 0, oldestBlockedAt: null };
    }
    if (!query.shopId) query.shopIds = scopedShopIds;
  }
  return repository.summarizeOperational(query);
}

async function updatePayloadStatus(payloadId, status, patch, authContext) {
  const existing = await loadPayload(payloadId);
  assertCanAccessShop(existing.shopId, ORDER_WRITE_PERMISSION, authContext);
  const payload = await repository.updateStatus(payloadId, status, patch);

  if (!payload) {
    throw notFound('Customization payload not found');
  }

  await syncWorkbenchCustomization(payload);

  return payload;
}

async function updatePayloadParsedData(payloadId, parsedData, patch, authContext) {
  const existing = await loadPayload(payloadId);
  assertCanAccessShop(existing.shopId, ORDER_WRITE_PERMISSION, authContext);
  const payload = await repository.updateParsedData(payloadId, parsedData, patch);

  if (!payload) {
    throw notFound('Customization payload not found');
  }

  await syncWorkbenchCustomization(payload);

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
    reviewedBy: authContext?.accountId || null,
    reviewedAt: new Date(),
  }, authContext);
}

async function markParsed(payloadId, parsedData, authContext) {
  const existing = await loadPayload(payloadId);
  return updatePayloadParsedData(payloadId, parsedData || existing.parsedData || {}, {
    status: customizationStatuses.PARSED,
    errorCode: null,
    errorMessage: null,
    lastTriedAt: new Date(),
    reviewedBy: authContext?.accountId || null,
    reviewedAt: new Date(),
  }, authContext);
}

async function prepareRetry(payloadId, authContext) {
  const existing = await loadPayload(payloadId);
  assertCanAccessShop(existing.shopId, ORDER_WRITE_PERMISSION, authContext);
  return repository.incrementRetry(payloadId, { lastTriedAt: new Date() });
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
  syncWorkbenchCustomization,
  getByOrderItem: getByOrderItemWithAuth,
  listLatestByOrderItems,
  cloneLatestPayloadForReplacement,
  getById,
  listPayloads,
  summarizePayloads,
  markNeedsReview,
  markFailed,
  markParsed,
  prepareRetry,
  assertCustomizationReady,
  buildRawCustomizationHash,
};
