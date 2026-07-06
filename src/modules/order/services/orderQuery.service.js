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

function getMappingPublic() {
  return require('../../mapping/public');
}

function getProductionPublic() {
  return require('../../production/public');
}

function getCatalogPublic() {
  return require('../../catalog/public');
}

function getShopPublic() {
  return require('../../shop/public');
}

function getShipmentPublic() {
  return require('../../shipment/public');
}

function parseEmployeeCodeFromSku(sku) {
  const [employeeCode] = String(sku || '').trim().split('-');
  return employeeCode || null;
}

async function getItemSeller(item = {}, sellerCache = new Map()) {
  const employeeCode = parseEmployeeCodeFromSku(item.sku);
  if (!employeeCode) return null;

  if (!sellerCache.has(employeeCode)) {
    sellerCache.set(employeeCode, authPublic.findProfileByEmployeeCode(employeeCode));
  }

  const profile = await sellerCache.get(employeeCode);
  return {
    employeeCode,
    name: profile?.fullName || null,
  };
}

async function getOrderShop(order = {}, shopCache = new Map()) {
  const shopId = order.shopId ? String(order.shopId) : null;
  if (!shopId) return null;

  if (!shopCache.has(shopId)) {
    shopCache.set(shopId, getShopPublic().findById(shopId));
  }

  return shopCache.get(shopId);
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

async function getItemListing(listingId) {
  if (!listingId) return null;
  try {
    return await getCatalogPublic().getListingById(listingId);
  } catch (error) {
    if (error && (error.code === errorCodes.RESOURCE_NOT_FOUND || error.statusCode === httpStatus.NOT_FOUND)) {
      return null;
    }

    throw error;
  }
}

async function getItemFulfillmentPlan(orderItemId) {
  try {
    return await getMappingPublic().getFulfillmentPlanForOrderItem(orderItemId);
  } catch (error) {
    if (error && (error.code === errorCodes.RESOURCE_NOT_FOUND || error.statusCode === httpStatus.NOT_FOUND)) {
      return null;
    }

    throw error;
  }
}

async function listItemCustomizations(orderItemIds = [], authContext) {
  if (orderItemIds.length === 0) return new Map();
  const customizations = await getCustomizationPublic().listOrderItemCustomizationViews(orderItemIds, authContext);
  return new Map((customizations || []).map((customization) => [String(customization.orderItemId), customization]));
}

async function listItemFulfillmentPlans(orderItemIds = []) {
  if (orderItemIds.length === 0) return new Map();
  const plans = await getMappingPublic().listFulfillmentPlansForOrderItems(orderItemIds);
  return new Map((plans || []).map((plan) => [String(plan.orderItemId), plan]));
}

async function listItemListings(items = []) {
  const listingIds = [...new Set(items.map((item) => item.listingId).filter(Boolean).map(String))];
  if (listingIds.length === 0) return new Map();
  const listings = await getCatalogPublic().getListingsByIds(listingIds);
  return new Map((listings || []).map((listing) => [String(listing._id || listing.id), listing]));
}

async function listItemProductionSummaries(orderItemIds = []) {
  if (orderItemIds.length === 0) return new Map();
  const summaries = await getProductionPublic().listTaskSummariesByOrderItemIds(orderItemIds);
  return new Map((summaries || []).map((summary) => [String(summary.orderItemId), summary]));
}

async function listItemShipmentSummaries(orderItemIds = []) {
  if (orderItemIds.length === 0) return new Map();
  const summaries = await getShipmentPublic().listSummariesByOrderItemIds(orderItemIds);
  return new Map((summaries || []).map((summary) => [String(summary.orderItemId), summary]));
}

async function getExpandedOrder(orderId, authContext = {}) {
  const order = await getOrder(orderId, authContext);
  const itemPage = await orderItemRepository.listByOrder(orderId, { page: 1, limit: 100 });
  const orderItemIds = (itemPage.items || []).map((item) => String(item._id || item.id));
  const productionByItemId = await listItemProductionSummaries(orderItemIds);
  const items = await Promise.all((itemPage.items || []).map(async (item) => ({
    item,
    listing: await getItemListing(item.listingId),
    customization: await getItemCustomization(item._id || item.id, authContext),
    fulfillmentPlan: await getItemFulfillmentPlan(item._id || item.id),
    production: productionByItemId.get(String(item._id || item.id)) || null,
  })));

  return { order, items };
}

async function listOrderWorkbench(query = {}, authContext = {}) {
  const orderPage = await listOrders(query, authContext);
  const orders = orderPage.items || [];
  const orderIds = orders.map((order) => order._id || order.id).filter(Boolean);
  const allItems = await orderItemRepository.listByOrderIds(orderIds, { limitPerOrder: 100 });
  const itemsByOrderId = allItems.reduce((result, item) => {
    const orderId = String(item.orderId);
    if (!result.has(orderId)) result.set(orderId, []);
    result.get(orderId).push(item);
    return result;
  }, new Map());
  const orderItemIds = allItems.map((item) => String(item._id || item.id));
  const sellerCache = new Map();
  const shopCache = new Map();
  const [
    productionByItemId,
    customizationByItemId,
    fulfillmentPlanByItemId,
    listingById,
    shipmentByItemId,
  ] = await Promise.all([
    listItemProductionSummaries(orderItemIds),
    listItemCustomizations(orderItemIds, authContext),
    listItemFulfillmentPlans(orderItemIds),
    listItemListings(allItems),
    listItemShipmentSummaries(orderItemIds),
  ]);
  const items = await Promise.all(orders.map(async (order) => ({
    order,
    shop: await getOrderShop(order, shopCache),
    items: await Promise.all((itemsByOrderId.get(String(order._id || order.id)) || []).map(async (item) => {
      const orderItemId = item._id || item.id;
      return {
        item,
        seller: await getItemSeller(item, sellerCache),
        listing: item.listingId ? listingById.get(String(item.listingId)) || null : null,
        customization: customizationByItemId.get(String(orderItemId)) || null,
        fulfillmentPlan: fulfillmentPlanByItemId.get(String(orderItemId)) || null,
        production: productionByItemId.get(String(orderItemId)) || null,
        tracking: shipmentByItemId.get(String(orderItemId)) || null,
      };
    })),
  })));

  return {
    items,
    total: orderPage.total,
    page: orderPage.page,
    limit: orderPage.limit,
    tabCounts: orderPage.tabCounts,
  };
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
  listOrderWorkbench,
  getOrderSummary,
  getOrder,
  getExpandedOrder,
  listOrderItems,
  getOrderItem,
  listOrderTimeline,
  listOrderItemTimeline,
};
