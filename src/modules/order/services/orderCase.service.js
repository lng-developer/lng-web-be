const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { normalizePagination } = require('../../../shared/utils/pagination');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const { caseStatuses, orderCaseStatuses } = require('../constants/orderStatuses');
const { orderTimelineEventTypes } = require('../constants/orderTimelineEventTypes');
const { orderTimelineSources } = require('../constants/orderTimelineSources');
const repository = require('../repositories/orderCase.repository');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const { toOrderCaseDto, toPaginatedOrderCaseDto } = require('../dtos/orderCase.dto');
const orderTimelineService = require('./orderTimeline.service');

const ORDER_READ_PERMISSION = 'ORDERS:READ';
const ORDER_WRITE_PERMISSION = 'ORDERS:WRITE';
const SHOP_SCOPE_TYPE = 'shop';

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function notFound(message) {
  return appError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function validationError(message, details) {
  return appError(message, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR, details);
}

function conflict(message, details) {
  return appError(message, httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR, details);
}

function hasGlobal(authContext = {}, permission) {
  return (authContext.permissions || []).includes(permission);
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

function assertCanAccessShop(shopId, permission, authContext = {}) {
  if (hasGlobal(authContext, permission)) return;
  if (!authPublic.canAccessScope(authContext, permission, {
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shopId,
  })) {
    throw forbidden();
  }
}

function normalizeCasePatch(patch = {}) {
  const result = {};
  ['title', 'description', 'resolutionNote', 'cancelReason'].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) result[field] = patch[field] || null;
  });
  if (patch.caseType) result.caseType = String(patch.caseType).trim().toUpperCase();
  if (patch.severity) result.severity = String(patch.severity).trim().toUpperCase();
  return result;
}

async function emptyCases(query = {}) {
  const { page, limit } = normalizePagination(query);
  return { items: [], total: 0, page, limit };
}

async function loadOrder(orderId) {
  assertValidObjectId(orderId, 'orderId');
  const order = await orderRepository.findById(orderId);
  if (!order) throw notFound('Order not found');
  return order;
}

async function assertOrderItemBelongsToOrder(orderItemId, orderId) {
  if (!orderItemId) return null;
  assertValidObjectId(orderItemId, 'orderItemId');
  const item = await orderItemRepository.findById(orderItemId);
  if (!item) throw notFound('Order item not found');
  if (String(item.orderId) !== String(orderId)) {
    throw validationError('Order item does not belong to order', { orderId, orderItemId });
  }
  return item;
}

async function loadCase(caseId, permission, authContext) {
  assertValidObjectId(caseId, 'caseId');
  const orderCase = await repository.findById(caseId);
  if (!orderCase) throw notFound('Order case not found');
  assertCanAccessShop(orderCase.shopId, permission, authContext);
  return orderCase;
}

async function syncOrderCaseStatus(orderId) {
  const openCount = await repository.countOpenByOrder(orderId);
  return orderRepository.updateCaseStatus(orderId, openCount > 0 ? caseStatuses.OPEN : caseStatuses.NONE);
}

function appendCaseTimeline(orderCase, eventType, authContext = {}) {
  return orderTimelineService.appendTimeline({
    orderId: orderCase.orderId,
    orderItemId: orderCase.orderItemId || null,
    shopId: orderCase.shopId,
    eventType,
    source: orderTimelineSources.USER,
    actorId: authContext.accountId || null,
    metadata: {
      caseId: String(orderCase._id || orderCase.id),
      caseType: orderCase.caseType || null,
      severity: orderCase.severity || null,
    },
  });
}

async function listOrderCases(query = {}, authContext = {}) {
  if (hasGlobal(authContext, ORDER_READ_PERMISSION)) {
    return toPaginatedOrderCaseDto(await repository.list(query));
  }

  const scopedShopIds = getScopedShopIds(authContext, ORDER_READ_PERMISSION);
  if (scopedShopIds.length === 0) return emptyCases(query);
  if (query.shopId && !scopedShopIds.includes(String(query.shopId))) return emptyCases(query);

  return toPaginatedOrderCaseDto(await repository.list({
    ...query,
    shopIds: query.shopId ? [query.shopId] : scopedShopIds,
  }));
}

async function getOrderCase(caseId, authContext = {}) {
  return toOrderCaseDto(await loadCase(caseId, ORDER_READ_PERMISSION, authContext));
}

async function createOrderCase(payload = {}, authContext = {}) {
  const order = await loadOrder(payload.orderId);
  assertCanAccessShop(order.shopId, ORDER_WRITE_PERMISSION, authContext);
  await assertOrderItemBelongsToOrder(payload.orderItemId, payload.orderId);

  const created = await repository.create({
    orderId: payload.orderId,
    orderItemId: payload.orderItemId || null,
    shopId: order.shopId,
    status: orderCaseStatuses.OPEN,
    severity: payload.severity || 'MEDIUM',
    caseType: payload.caseType || 'OTHER',
    title: payload.title,
    description: payload.description || null,
    createdBy: authContext.accountId || null,
  });
  await orderRepository.updateCaseStatus(payload.orderId, caseStatuses.OPEN);
  await appendCaseTimeline(created, orderTimelineEventTypes.ORDER_CASE_OPENED, authContext);
  return toOrderCaseDto(created);
}

async function updateOrderCase(caseId, patch = {}, authContext = {}) {
  const orderCase = await loadCase(caseId, ORDER_WRITE_PERMISSION, authContext);
  const updated = await repository.update(caseId, normalizeCasePatch(patch));
  return toOrderCaseDto(updated || orderCase);
}

async function resolveOrderCase(caseId, payload = {}, authContext = {}) {
  const orderCase = await loadCase(caseId, ORDER_WRITE_PERMISSION, authContext);
  if (orderCase.status !== orderCaseStatuses.OPEN) throw conflict('Order case is not open');
  const updated = await repository.update(caseId, {
    status: orderCaseStatuses.RESOLVED,
    resolutionNote: payload.resolutionNote || null,
    resolvedBy: authContext.accountId || null,
    resolvedAt: new Date(),
  });
  await syncOrderCaseStatus(orderCase.orderId);
  await appendCaseTimeline({ ...orderCase, ...updated }, orderTimelineEventTypes.ORDER_CASE_RESOLVED, authContext);
  return toOrderCaseDto(updated);
}

async function cancelOrderCase(caseId, payload = {}, authContext = {}) {
  const orderCase = await loadCase(caseId, ORDER_WRITE_PERMISSION, authContext);
  if (orderCase.status !== orderCaseStatuses.OPEN) throw conflict('Order case is not open');
  const updated = await repository.update(caseId, {
    status: orderCaseStatuses.CANCELLED,
    cancelReason: payload.cancelReason || null,
    cancelledBy: authContext.accountId || null,
    cancelledAt: new Date(),
  });
  await syncOrderCaseStatus(orderCase.orderId);
  await appendCaseTimeline({ ...orderCase, ...updated }, orderTimelineEventTypes.ORDER_CASE_CANCELLED, authContext);
  return toOrderCaseDto(updated);
}

async function addOrderCaseComment(caseId, payload = {}, authContext = {}) {
  const orderCase = await loadCase(caseId, ORDER_WRITE_PERMISSION, authContext);
  const updated = await repository.addComment(caseId, {
    body: payload.body,
    createdBy: authContext.accountId || null,
    createdAt: new Date(),
  });
  await appendCaseTimeline(orderCase, orderTimelineEventTypes.ORDER_CASE_COMMENT_ADDED, authContext);
  return toOrderCaseDto(updated);
}

module.exports = {
  listOrderCases,
  getOrderCase,
  createOrderCase,
  updateOrderCase,
  resolveOrderCase,
  cancelOrderCase,
  addOrderCaseComment,
};
