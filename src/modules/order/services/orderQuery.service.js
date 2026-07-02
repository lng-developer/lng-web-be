const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { normalizePagination } = require('../../../shared/utils/pagination');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const authPublic = require('../../auth/public');
const { orderListTabs } = require('../constants/orderStatuses');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderTimelineService = require('./orderTimeline.service');

const ORDER_READ_PERMISSION = 'ORDERS:READ';
const SHOP_SCOPE_TYPE = 'shop';

function hasGlobalOrderRead(authContext = {}) {
  return (authContext.permissions || []).includes(ORDER_READ_PERMISSION);
}

function getScopedReadableShopIds(authContext = {}) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => (
      scope.scopeType === SHOP_SCOPE_TYPE
      && scope.scopeId
      && (scope.permissions || []).includes(ORDER_READ_PERMISSION)
    ))
    .map((scope) => String(scope.scopeId)))];
}

function emptyPaginatedResult(query = {}) {
  const { page, limit } = normalizePagination(query);
  return {
    items: [],
    total: 0,
    page,
    limit,
    tabCounts: Object.fromEntries(Object.values(orderListTabs).map((tab) => [tab, 0])),
  };
}

function emptySummaryResult() {
  return {
    tabCounts: Object.fromEntries(Object.values(orderListTabs).map((tab) => [tab, 0])),
  };
}

function notFound(message) {
  return new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
}

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function assertCanReadShop(shopId, authContext = {}) {
  if (hasGlobalOrderRead(authContext)) {
    return;
  }

  if (!authPublic.canAccessScope(authContext, ORDER_READ_PERMISSION, {
    scopeType: SHOP_SCOPE_TYPE,
    scopeId: shopId,
  })) {
    throw forbidden();
  }
}

async function listOrders(query = {}, authContext = {}) {
  if (hasGlobalOrderRead(authContext)) {
    return orderRepository.list(query);
  }

  const scopedShopIds = getScopedReadableShopIds(authContext);

  if (scopedShopIds.length === 0) {
    return emptyPaginatedResult(query);
  }

  if (query.shopId && !scopedShopIds.includes(String(query.shopId))) {
    return emptyPaginatedResult(query);
  }

  return orderRepository.list({
    ...query,
    shopIds: query.shopId ? [query.shopId] : scopedShopIds,
  });
}

async function getOrderSummary(query = {}, authContext = {}) {
  if (hasGlobalOrderRead(authContext)) {
    return { tabCounts: await orderRepository.countByTabs(query) };
  }

  const scopedShopIds = getScopedReadableShopIds(authContext);

  if (scopedShopIds.length === 0) {
    return emptySummaryResult();
  }

  if (query.shopId && !scopedShopIds.includes(String(query.shopId))) {
    return emptySummaryResult();
  }

  return {
    tabCounts: await orderRepository.countByTabs({
      ...query,
      shopIds: query.shopId ? [query.shopId] : scopedShopIds,
    }),
  };
}

async function getOrder(orderId, authContext = {}) {
  assertValidObjectId(orderId, 'orderId');
  const order = await orderRepository.findById(orderId);

  if (!order) {
    throw notFound('Order not found');
  }

  assertCanReadShop(order.shopId, authContext);
  return order;
}

function getCustomizationPublic() {
  return require('../../customization/public');
}

async function getItemCustomization(orderItemId, authContext) {
  try {
    return await getCustomizationPublic().getOrderItemCustomizationView(orderItemId, authContext);
  } catch (error) {
    if (error && (error.code === errorCodes.RESOURCE_NOT_FOUND || error.statusCode === httpStatus.NOT_FOUND)) {
      return null;
    }

    throw error;
  }
}

async function getExpandedOrder(orderId, authContext = {}) {
  const order = await getOrder(orderId, authContext);
  const itemPage = await orderItemRepository.listByOrder(orderId, { page: 1, limit: 100 });
  const items = await Promise.all((itemPage.items || []).map(async (item) => ({
    item,
    customization: await getItemCustomization(item._id || item.id, authContext),
  })));

  return { order, items };
}

async function listOrderItems(orderId, query = {}, authContext = {}) {
  await getOrder(orderId, authContext);
  return orderItemRepository.listByOrder(orderId, query);
}

async function getOrderItem(orderItemId, authContext = {}) {
  assertValidObjectId(orderItemId, 'orderItemId');
  const item = await orderItemRepository.findById(orderItemId);

  if (!item) {
    throw notFound('Order item not found');
  }

  assertCanReadShop(item.shopId, authContext);
  return item;
}

async function listOrderTimeline(orderId, query = {}, authContext = {}) {
  await getOrder(orderId, authContext);
  return orderTimelineService.listByOrder(orderId, query);
}

async function listOrderItemTimeline(orderItemId, query = {}, authContext = {}) {
  await getOrderItem(orderItemId, authContext);
  return orderTimelineService.listByOrderItem(orderItemId, query);
}

module.exports = {
  listOrders,
  getOrderSummary,
  getOrder,
  getExpandedOrder,
  listOrderItems,
  getOrderItem,
  listOrderTimeline,
  listOrderItemTimeline,
};
