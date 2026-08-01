const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { normalizePagination } = require('../../../shared/utils/pagination');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const logger = require('../../../shared/utils/logger');
const authPublic = require('../../auth/public');
const hrPublic = require('../../hr/public');
const orderAccess = require('./orderAccess.service');
const { orderListTabs } = require('../constants/orderStatuses');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderCaseRepository = require('../repositories/orderCase.repository');
const orderTimelineService = require('./orderTimeline.service');
const { parseEmployeeCodeFromSku } = require('./orderImport.helpers');

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

async function listOrders(query = {}, authContext = {}) {
  const { shopIds: scopedShopIds, assignedStaffIds } = orderAccess.getOrderReadConstraint(authContext);
  if (scopedShopIds === null) {
    return orderRepository.list(query);
  }

  if (assignedStaffIds?.length) {
    return orderRepository.list({ ...query, assignedStaffIds });
  }

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

async function listWorkbenchOrders(query = {}, authContext = {}) {
  const { shopIds: scopedShopIds, assignedStaffIds } = orderAccess.getOrderReadConstraint(authContext);
  if (scopedShopIds === null) {
    return orderRepository.listWorkbench(query);
  }

  if (assignedStaffIds?.length) {
    return orderRepository.listWorkbench({ ...query, assignedStaffIds });
  }

  if (scopedShopIds.length === 0) {
    return emptyPaginatedResult(query);
  }

  if (query.shopId && !scopedShopIds.includes(String(query.shopId))) {
    return emptyPaginatedResult(query);
  }

  return orderRepository.listWorkbench({
    ...query,
    shopIds: query.shopId ? [query.shopId] : scopedShopIds,
  });
}

async function getOrderSummary(query = {}, authContext = {}) {
  const { shopIds: scopedShopIds, assignedStaffIds } = orderAccess.getOrderReadConstraint(authContext);
  if (scopedShopIds === null) {
    return { tabCounts: await orderRepository.countByTabs(query) };
  }

  if (assignedStaffIds?.length) {
    return { tabCounts: await orderRepository.countByTabs({ ...query, assignedStaffIds }) };
  }

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

  orderAccess.assertCanReadOrder(order, authContext);
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

function internalReadContext(authContext = {}, source = 'ORDER_READ_MODEL') {
  return {
    system: true,
    source,
    accountId: authContext.accountId,
  };
}

async function listSellerProfiles(items = []) {
  const employeeCodes = [...new Set(items
    .map((item) => parseEmployeeCodeFromSku(item.sku))
    .filter(Boolean))];

  if (employeeCodes.length === 0) return new Map();

  const profiles = await hrPublic.listEmployeeProfilesByEmployeeCodes(employeeCodes);
  return new Map((profiles || [])
    .filter((profile) => profile && profile.employeeCode)
    .map((profile) => [String(profile.employeeCode).toUpperCase(), profile]));
}

function getItemSeller(item = {}, sellerByEmployeeCode = new Map()) {
  const employeeCode = parseEmployeeCodeFromSku(item.sku);
  if (!employeeCode) return null;

  const profile = sellerByEmployeeCode.get(String(employeeCode).toUpperCase());
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
    return await getCustomizationPublic().getOrderItemCustomizationView(orderItemId, internalReadContext(authContext));
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
    return await getMappingPublic().getFulfillmentPlanForOrderItem(orderItemId, internalReadContext({}, 'ORDER_FULFILLMENT_PLAN_READ'));
  } catch (error) {
    if (error && (error.code === errorCodes.RESOURCE_NOT_FOUND || error.statusCode === httpStatus.NOT_FOUND)) {
      return null;
    }

    throw error;
  }
}

function toItemMap(items = []) {
  return new Map((items || [])
    .filter((item) => item && item.orderItemId)
    .map((item) => [String(item.orderItemId), item]));
}

async function listItemCustomizations(orderItemIds = [], authContext) {
  if (orderItemIds.length === 0) return new Map();
  const customizations = await getCustomizationPublic().listOrderItemCustomizationViews(
    orderItemIds,
    internalReadContext(authContext),
  );
  return toItemMap(customizations);
}

async function listItemFulfillmentPlans(orderItemIds = [], authContext) {
  if (orderItemIds.length === 0) return new Map();
  const plans = await getMappingPublic().listFulfillmentPlansByOrderItemIds(
    orderItemIds,
    internalReadContext(authContext, 'ORDER_FULFILLMENT_PLAN_READ'),
  );
  return toItemMap(plans);
}

async function listItemProductionSummaries(orderItemIds = [], authContext) {
  if (orderItemIds.length === 0) return new Map();
  const summaries = await getProductionPublic().listTaskSummariesByOrderItemIds(
    orderItemIds,
    internalReadContext(authContext, 'ORDER_PRODUCTION_SUMMARY_READ'),
  );
  return toItemMap(summaries);
}

async function listItemListings(items = []) {
  const listingIds = [...new Set(items.map((item) => item.listingId).filter(Boolean).map(String))];
  if (listingIds.length === 0) return new Map();
  const listings = await getCatalogPublic().getListingSummariesByIds(listingIds);
  return new Map((listings || []).map((listing) => [String(listing._id || listing.id), listing]));
}

function warnIfExpandedOrderSlow(startedAt, { orderId, resultCount }) {
  const durationMs = Date.now() - startedAt;
  const thresholdMs = Number(process.env.ORDER_EXPANDED_SLOW_MS || 500);

  if (durationMs >= thresholdMs) {
    logger.warn('slow_order_expanded_request', {
      module: 'order',
      route: 'GET /api/orders/:orderId/expanded',
      durationMs,
      orderId,
      resultCount,
    });
  }
}

async function listItemShipmentSummaries(orderItemIds = []) {
  if (orderItemIds.length === 0) return new Map();
  const summaries = await getShipmentPublic().listSummariesByOrderItemIds(orderItemIds);
  return new Map((summaries || []).map((summary) => [String(summary.orderItemId), summary]));
}

async function listLatestOpenCases(orderIds = []) {
  if (orderIds.length === 0) return new Map();
  const cases = await orderCaseRepository.listLatestOpenByOrderIds(orderIds);
  return new Map((cases || []).map((orderCase) => [String(orderCase.orderId), orderCase]));
}

async function enrichTimelineActors(result = {}) {
  const items = result.items || [];
  const actorIds = [...new Set(items.map((item) => item.actorId).filter(Boolean).map(String))];
  if (actorIds.length === 0) return result;

  const profiles = await hrPublic.listEmployeeProfilesByAccountIds(actorIds);
  const profileByAccountId = new Map((profiles || []).map((profile) => [String(profile.accountId), profile]));
  const missingActorIds = actorIds.filter((actorId) => !profileByAccountId.has(actorId));
  if (missingActorIds.length > 0 && typeof authPublic.getCurrentAccount === 'function') {
    const fallbackAuthModels = await Promise.all(missingActorIds.map(async (actorId) => {
      try {
        return await authPublic.getCurrentAccount(actorId);
      } catch {
        return null;
      }
    }));
    fallbackAuthModels.forEach((authModel, index) => {
      const profile = authModel?.profile;
      if (!profile) return;
      profileByAccountId.set(missingActorIds[index], {
        accountId: authModel.account?._id || profile.accountId || missingActorIds[index],
        fullName: profile.fullName || null,
        employeeCode: profile.employeeCode || null,
      });
    });
  }

  return {
    ...result,
    items: items.map((item) => {
      const profile = profileByAccountId.get(String(item.actorId));
      return {
        ...item,
        actor: profile ? {
          accountId: String(profile.accountId),
          fullName: profile.fullName || null,
          employeeCode: profile.employeeCode || null,
          displayName: profile.fullName || profile.employeeCode || null,
        } : null,
      };
    }),
  };
}

async function getExpandedOrder(orderId, authContext = {}) {
  const startedAt = Date.now();
  const order = await getOrder(orderId, authContext);
  const orderItems = await orderItemRepository.listAllByOrder(orderId);
  const orderItemIds = (orderItems || []).map((item) => String(item._id || item.id));
  const [customizationByItemId, fulfillmentPlanByItemId, productionByItemId, listingById, shipmentByItemId] = await Promise.all([
    listItemCustomizations(orderItemIds, authContext),
    listItemFulfillmentPlans(orderItemIds, authContext),
    listItemProductionSummaries(orderItemIds, authContext),
    listItemListings(orderItems || []),
    listItemShipmentSummaries(orderItemIds),
  ]);
  const items = (orderItems || []).map((item) => {
    const itemId = String(item._id || item.id);
    return {
      item,
      listing: item.listingId ? listingById.get(String(item.listingId)) || null : null,
      customization: customizationByItemId.get(itemId) || null,
      fulfillmentPlan: fulfillmentPlanByItemId.get(itemId) || null,
      production: productionByItemId.get(itemId) || null,
      tracking: shipmentByItemId.get(itemId) || null,
    };
  });

  warnIfExpandedOrderSlow(startedAt, { orderId, resultCount: items.length });
  return { order, items };
}

async function listOrderWorkbench(query = {}, authContext = {}) {
  const orderPage = await listWorkbenchOrders(query, authContext);
  const orders = orderPage.items || [];
  const allItems = orders.flatMap((order) => order.items || []);
  const itemsByOrderId = allItems.reduce((result, item) => {
    const orderId = String(item.orderId);
    if (!result.has(orderId)) result.set(orderId, []);
    result.get(orderId).push(item);
    return result;
  }, new Map());
  const orderIds = orders.map((order) => String(order._id || order.id));
  const orderItemIds = allItems.map((item) => String(item._id || item.id));
  const shopCache = new Map();
  const [
    sellerByEmployeeCode,
    productionByItemId,
    customizationByItemId,
    fulfillmentPlanByItemId,
    listingById,
    shipmentByItemId,
    caseByOrderId,
  ] = await Promise.all([
    listSellerProfiles(allItems),
    listItemProductionSummaries(orderItemIds, authContext),
    listItemCustomizations(orderItemIds, authContext),
    listItemFulfillmentPlans(orderItemIds, authContext),
    listItemListings(allItems),
    listItemShipmentSummaries(orderItemIds),
    listLatestOpenCases(orderIds),
  ]);
  const items = await Promise.all(orders.map(async (order) => ({
    order,
    shop: await getOrderShop(order, shopCache),
    case: caseByOrderId.get(String(order._id || order.id)) || null,
    items: await Promise.all((itemsByOrderId.get(String(order._id || order.id)) || []).map(async (item) => {
      const orderItemId = item._id || item.id;
      return {
        item,
        seller: getItemSeller(item, sellerByEmployeeCode),
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

  orderAccess.assertCanReadShop(item.shopId, authContext);
  return item;
}

async function listOrderTimeline(orderId, query = {}, authContext = {}) {
  await getOrder(orderId, authContext);
  return enrichTimelineActors(await orderTimelineService.listByOrder(orderId, query));
}

async function listOrderItemTimeline(orderItemId, query = {}, authContext = {}) {
  await getOrderItem(orderItemId, authContext);
  return enrichTimelineActors(await orderTimelineService.listByOrderItem(orderItemId, query));
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
