jest.mock('../../../modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  list: jest.fn(),
  listWorkbench: jest.fn(),
  countByTabs: jest.fn(),
}));

jest.mock('../../../modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
  listByOrder: jest.fn(),
  listAllByOrder: jest.fn(),
  listByOrderIds: jest.fn(),
}));

jest.mock('../../../modules/order/repositories/orderCase.repository', () => ({
  listLatestOpenByOrderIds: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
  getCurrentAccount: jest.fn(),
}));

jest.mock('../../../modules/hr/public', () => ({
  listEmployeeProfilesByAccountIds: jest.fn(),
  listEmployeeProfilesByEmployeeCodes: jest.fn(),
}));

jest.mock('../../../modules/order/services/orderTimeline.service', () => ({
  listByOrder: jest.fn(),
  listByOrderItem: jest.fn(),
}));

jest.mock('../../../modules/customization/public', () => ({
  getOrderItemCustomizationView: jest.fn(),
  listOrderItemCustomizationViews: jest.fn(),
}));

jest.mock('../../../modules/mapping/public', () => ({
  getFulfillmentPlanForOrderItem: jest.fn(),
  listFulfillmentPlansByOrderItemIds: jest.fn(),
}));

jest.mock('../../../modules/production/public', () => ({
  listTaskSummariesByOrderItemIds: jest.fn(),
  listWorkbenchTaskSummariesByOrderItemIds: jest.fn(),
}));

jest.mock('../../../modules/shipment/public', () => ({
  listSummariesByOrderItemIds: jest.fn(),
}));

jest.mock('../../../modules/catalog/public', () => ({
  getListingById: jest.fn(),
  getListingsByIds: jest.fn(),
  getListingSummariesByIds: jest.fn(),
}));

jest.mock('../../../modules/shop/public', () => ({
  findById: jest.fn(),
  findByIds: jest.fn(),
}));

const errorCodes = require('../../../shared/constants/errorCodes');
const authPublic = require('../../../modules/auth/public');
const hrPublic = require('../../../modules/hr/public');
const orderRepository = require('../../../modules/order/repositories/order.repository');
const orderItemRepository = require('../../../modules/order/repositories/orderItem.repository');
const orderCaseRepository = require('../../../modules/order/repositories/orderCase.repository');
const orderTimelineService = require('../../../modules/order/services/orderTimeline.service');
const customizationPublic = require('../../../modules/customization/public');
const mappingPublic = require('../../../modules/mapping/public');
const productionPublic = require('../../../modules/production/public');
const shipmentPublic = require('../../../modules/shipment/public');
const catalogPublic = require('../../../modules/catalog/public');
const shopPublic = require('../../../modules/shop/public');
const service = require('../../../modules/order/services/orderQuery.service');

describe('orderQuery.service summary and expanded reads', () => {
  const orderId = '660000000000000000000301';
  const itemId = '660000000000000000000401';
  const secondItemId = '660000000000000000000402';
  const thirdItemId = '660000000000000000000403';
  const shopId = '660000000000000000000201';
  const otherShopId = '660000000000000000000202';

  function scopedShopAuth(permissions, scopedShopId = shopId) {
    return {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: scopedShopId, permissions }],
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockImplementation((authContext = {}, permission, scope = {}) => (
      (authContext.scopes || []).some((grantedScope) => (
        grantedScope.scopeType === scope.scopeType
        && String(grantedScope.scopeId) === String(scope.scopeId)
        && (grantedScope.permissions || []).includes(permission)
      ))
    ));
    hrPublic.listEmployeeProfilesByAccountIds.mockResolvedValue([]);
    hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValue([]);
    shopPublic.findById.mockResolvedValue({ _id: shopId, name: 'Acc1', status: 'ACTIVE' });
    shopPublic.findByIds.mockResolvedValue([{ _id: shopId, name: 'Acc1', status: 'ACTIVE' }]);
    orderRepository.findById.mockResolvedValue({ _id: orderId, shopId, externalOrderId: '114-1' });
    orderRepository.list.mockResolvedValue({
      items: [{ _id: orderId, shopId, externalOrderId: '114-1', status: 'IMPORTED' }],
      total: 1,
      page: 1,
      limit: 20,
      tabCounts: { ALL: 1 },
    });
    orderRepository.listWorkbench.mockResolvedValue({
      items: [{ _id: orderId, shopId, externalOrderId: '114-1', status: 'IMPORTED', items: [] }],
      total: 1,
      page: 1,
      limit: 20,
    });
    orderRepository.countByTabs.mockResolvedValue({ ALL: 2, NEW_ORDER: 1 });
    orderItemRepository.listAllByOrder.mockResolvedValue([{ _id: itemId, orderId, shopId, title: 'Custom Shirt' }]);
    orderItemRepository.findById.mockResolvedValue({ _id: itemId, orderId, shopId, title: 'Custom Shirt' });
    orderItemRepository.listByOrderIds.mockResolvedValue([{ _id: itemId, orderId, shopId, title: 'Custom Shirt' }]);
    orderTimelineService.listByOrder.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    orderTimelineService.listByOrderItem.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    customizationPublic.getOrderItemCustomizationView.mockResolvedValue({
      payloadId: '660000000000000000000501',
      orderItemId: itemId,
      customerInputs: { texts: [{ label: 'Custom Name', value: 'NURSE' }] },
      imageAssets: [{ secureUrl: 'https://res.cloudinary.com/demo/image/upload/a.png' }],
    });
    customizationPublic.listOrderItemCustomizationViews.mockResolvedValue([{
      payloadId: '660000000000000000000501',
      orderItemId: itemId,
      customerInputs: { texts: [{ label: 'Custom Name', value: 'NURSE' }] },
      imageAssets: [{ secureUrl: 'https://res.cloudinary.com/demo/image/upload/a.png' }],
    }]);
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue({
      orderItemId: itemId,
      costEstimate: {
        currency: 'USD',
        totalAmount: 1894,
        lines: [{ code: 'BASE_COST', label: 'Base cost', amount: 1200 }],
        signals: { configCode: 'TS1S', twoSided: false, embroidery: false, priority: true },
      },
    });
    mappingPublic.listFulfillmentPlansByOrderItemIds.mockResolvedValue([{
      orderItemId: itemId,
      costEstimate: {
        currency: 'USD',
        totalAmount: 1894,
        lines: [{ code: 'BASE_COST', label: 'Base cost', amount: 1200 }],
        signals: { configCode: 'TS1S', twoSided: false, embroidery: false, priority: true },
      },
    }]);
    productionPublic.listTaskSummariesByOrderItemIds.mockResolvedValue([{
      id: '660000000000000000000601',
      orderItemId: itemId,
      productionStatus: 'BLOCKED',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
      assignedDesignUserId: '660000000000000000000701',
      qcBy: '660000000000000000000702',
      blockers: ['PSD_MISSING'],
      readyAt: null,
      sentToVendorAt: null,
    }]);
    productionPublic.listWorkbenchTaskSummariesByOrderItemIds.mockResolvedValue([{
      id: '660000000000000000000601',
      orderItemId: itemId,
      productionStatus: 'BLOCKED',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
      assignedDesignUserId: '660000000000000000000701',
      qcBy: '660000000000000000000702',
    }]);
    shipmentPublic.listSummariesByOrderItemIds.mockResolvedValue([]);
    orderCaseRepository.listLatestOpenByOrderIds.mockResolvedValue([]);
    catalogPublic.getListingById.mockResolvedValue({
      _id: '660000000000000000000801',
      sku: 'J2520-NK',
      asin: 'B000TEST01',
      title: 'Napkin listing',
      psdStatus: 'PRESENT',
      psdTemplateAssetId: '660000000000000000000802',
    });
    catalogPublic.getListingsByIds.mockResolvedValue([{
      _id: '660000000000000000000801',
      sku: 'J2520-NK',
      asin: 'B000TEST01',
      title: 'Napkin listing',
      psdStatus: 'PRESENT',
      psdTemplateAssetId: '660000000000000000000802',
    }]);
    catalogPublic.getListingSummariesByIds.mockResolvedValue([{
      _id: '660000000000000000000801',
      sku: 'J2520-NK',
      asin: 'B000TEST01',
      title: 'Napkin listing',
      psdStatus: 'PRESENT',
      psdTemplateAssetId: '660000000000000000000802',
    }]);
  });

  test('shop-scoped ORDERS:WRITE can read orders in its shop', async () => {
    const result = await service.listOrders({}, scopedShopAuth(['ORDERS:WRITE']));

    expect(orderRepository.list).toHaveBeenCalledWith(expect.objectContaining({
      shopIds: [shopId],
    }));
    expect(result.items).toHaveLength(1);

    const order = await service.getOrder(orderId, scopedShopAuth(['ORDERS:WRITE']));
    expect(order).toMatchObject({ _id: orderId, shopId });
  });

  test('shop-scoped ORDERS:WRITE cannot read another shop', async () => {
    const result = await service.listOrders({ shopId: otherShopId }, scopedShopAuth(['ORDERS:WRITE']));

    expect(orderRepository.list).not.toHaveBeenCalled();
    expect(result).toMatchObject({ items: [], total: 0 });
  });

  test('returns summary tab counts with scoped shop filter', async () => {
    const result = await service.getOrderSummary(
      { tab: 'NO_PSD', shopId },
      { permissions: [], scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:READ'] }] },
    );

    expect(orderRepository.countByTabs).toHaveBeenCalledWith({ tab: 'NO_PSD', shopId, shopIds: [shopId] });
    expect(result).toEqual({ tabCounts: { ALL: 2, NEW_ORDER: 1 } });
  });

  test('forces a non-shop scoped reader to their own assigned orders', async () => {
    const authContext = {
      accountId: '660000000000000000000901',
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: '660000000000000000000801', permissions: ['ORDERS:READ'] }],
    };

    await service.listOrders({}, authContext);

    expect(orderRepository.list).toHaveBeenCalledWith({
      assignedStaffIds: ['660000000000000000000901'],
    });
  });

  test('returns expanded order items with customization dto', async () => {
    const authContext = { permissions: ['ORDERS:READ'] };
    const result = await service.getExpandedOrder(orderId, authContext);

    expect(orderItemRepository.listAllByOrder).toHaveBeenCalledWith(orderId);
    expect(customizationPublic.listOrderItemCustomizationViews).toHaveBeenCalledWith([itemId], expect.objectContaining({ system: true }));
    expect(mappingPublic.listFulfillmentPlansByOrderItemIds).toHaveBeenCalledWith([itemId], expect.objectContaining({ system: true }));
    expect(productionPublic.listTaskSummariesByOrderItemIds).toHaveBeenCalledWith([itemId], expect.objectContaining({ system: true }));
    expect(customizationPublic.getOrderItemCustomizationView).not.toHaveBeenCalled();
    expect(mappingPublic.getFulfillmentPlanForOrderItem).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      order: { _id: orderId },
      items: [{
        item: { _id: itemId },
        fulfillmentPlan: {
          costEstimate: {
            totalAmount: 1894,
          },
        },
        production: {
          productionStatus: 'BLOCKED',
          blockers: ['PSD_MISSING'],
        },
        customization: {
          payloadId: '660000000000000000000501',
          customerInputs: { texts: [{ label: 'Custom Name', value: 'NURSE' }] },
          imageAssets: [{ secureUrl: 'https://res.cloudinary.com/demo/image/upload/a.png' }],
        },
      }],
    });
    expect(result.items[0].customization.assets).toBeUndefined();
    expect(result.items[0].customization.parsedData).toBeUndefined();
  });

  test('keeps expanded order available when item has no customization payload', async () => {
    customizationPublic.listOrderItemCustomizationViews.mockResolvedValueOnce([]);

    const result = await service.getExpandedOrder(orderId, { permissions: ['ORDERS:READ'] });

    expect(result.items[0].customization).toBeNull();
  });

  test('returns workbench rows with compact joined item context', async () => {
    const authContext = { permissions: ['ORDERS:READ'] };
    hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValueOnce([{
      employeeCode: 'J2508',
      fullName: 'Nguyen Duc Son',
      accountId: '660000000000000000000901',
    }]);
    orderRepository.listWorkbench.mockResolvedValueOnce({
      items: [{
        _id: orderId,
        shopId,
        externalOrderId: '114-1',
        status: 'IMPORTED',
        items: [{
          _id: itemId,
          orderId,
          shopId,
          listingId: '660000000000000000000801',
          sku: 'J2508-TS1S-05032026-335',
          title: 'Custom Napkin',
          quantity: 1,
        }],
      }],
      total: 1,
      page: 1,
      limit: 20,
      tabCounts: { ALL: 1 },
    });
    orderItemRepository.listByOrderIds.mockResolvedValueOnce([{
        _id: itemId,
        orderId,
        shopId,
        listingId: '660000000000000000000801',
        sku: 'J2508-TS1S-05032026-335',
        title: 'Custom Napkin',
        quantity: 1,
      }]);

    const result = await service.listOrderWorkbench({ page: 1, limit: 20 }, authContext);

    expect(orderRepository.listWorkbench).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
    });
    expect(orderRepository.list).not.toHaveBeenCalled();
    expect(orderItemRepository.listByOrderIds).not.toHaveBeenCalled();
    expect(orderItemRepository.listByOrder).not.toHaveBeenCalled();
    expect(shopPublic.findByIds).toHaveBeenCalledWith([shopId]);
    expect(shopPublic.findById).not.toHaveBeenCalled();
    expect(hrPublic.listEmployeeProfilesByEmployeeCodes).toHaveBeenCalledWith(['J2508']);
    expect(catalogPublic.getListingSummariesByIds).toHaveBeenCalledWith(['660000000000000000000801']);
    expect(catalogPublic.getListingsByIds).not.toHaveBeenCalled();
    expect(customizationPublic.listOrderItemCustomizationViews).toHaveBeenCalledWith([itemId], expect.objectContaining({ system: true }));
    expect(mappingPublic.listFulfillmentPlansByOrderItemIds).toHaveBeenCalledWith([itemId], expect.objectContaining({ system: true }));
    expect(productionPublic.listWorkbenchTaskSummariesByOrderItemIds).toHaveBeenCalledWith([itemId], expect.objectContaining({ system: true }));
    expect(shipmentPublic.listSummariesByOrderItemIds).toHaveBeenCalledWith([itemId]);
    expect(orderCaseRepository.listLatestOpenByOrderIds).toHaveBeenCalledWith([orderId]);
    expect(result).toMatchObject({
      total: 1,
      page: 1,
      limit: 20,
      items: [{
        order: { _id: orderId, externalOrderId: '114-1' },
        shop: { _id: shopId, name: 'Acc1' },
        items: [{
          item: { _id: itemId, sku: 'J2508-TS1S-05032026-335', quantity: 1 },
          seller: {
            employeeCode: 'J2508',
            name: 'Nguyen Duc Son',
          },
          listing: {
            _id: '660000000000000000000801',
            asin: 'B000TEST01',
            psdStatus: 'PRESENT',
          },
          customization: {
            customerInputs: { texts: [{ label: 'Custom Name', value: 'NURSE' }] },
          },
          fulfillmentPlan: {
            costEstimate: { totalAmount: 1894 },
          },
          production: {
            qcBy: '660000000000000000000702',
          },
          tracking: null,
        }],
      }],
    });
    expect(result).not.toHaveProperty('tabCounts');
  });

  test('returns customer exception candidates with only customization and shipment enrichment', async () => {
    const authContext = { permissions: ['ORDERS:READ'] };
    orderRepository.listWorkbench.mockResolvedValueOnce({
      items: [{
        _id: orderId,
        shopId,
        externalOrderId: '114-1',
        items: [{ _id: itemId, orderId, shopId, sku: 'J2508-TS1S' }],
      }],
      total: 1,
      page: 1,
      limit: 20,
    });
    shipmentPublic.listSummariesByOrderItemIds.mockResolvedValueOnce([{
      orderItemId: itemId,
      status: 'EXCEPTION',
    }]);

    const result = await service.listCustomerExceptionCandidates({ page: 1, limit: 20 }, authContext);

    expect(result).toMatchObject({
      total: 1,
      page: 1,
      limit: 20,
      items: [{
        order: { _id: orderId },
        items: [{
          item: { _id: itemId },
          customization: { orderItemId: itemId },
          tracking: { orderItemId: itemId, status: 'EXCEPTION' },
        }],
      }],
    });
    expect(customizationPublic.listOrderItemCustomizationViews).toHaveBeenCalledWith([itemId], expect.objectContaining({ system: true }));
    expect(shipmentPublic.listSummariesByOrderItemIds).toHaveBeenCalledWith([itemId]);
    expect(hrPublic.listEmployeeProfilesByEmployeeCodes).not.toHaveBeenCalled();
    expect(productionPublic.listTaskSummariesByOrderItemIds).not.toHaveBeenCalled();
    expect(mappingPublic.listFulfillmentPlansByOrderItemIds).not.toHaveBeenCalled();
    expect(catalogPublic.getListingSummariesByIds).not.toHaveBeenCalled();
    expect(orderCaseRepository.listLatestOpenByOrderIds).not.toHaveBeenCalled();
    expect(shopPublic.findByIds).not.toHaveBeenCalled();
  });

  test('returns latest open case with workbench rows', async () => {
    orderRepository.listWorkbench.mockResolvedValueOnce({
      items: [{
        _id: orderId,
        shopId,
        externalOrderId: '114-1',
        items: [{ _id: itemId, orderId, shopId, sku: 'SKU-1' }],
      }],
      total: 1,
      page: 1,
      limit: 20,
    });
    orderCaseRepository.listLatestOpenByOrderIds.mockResolvedValueOnce([{
      _id: '660000000000000000000901',
      orderId,
      title: 'Need buyer photo',
      status: 'OPEN',
    }]);

    const result = await service.listOrderWorkbench({}, { permissions: ['ORDERS:READ'] });

    expect(result.items[0].case).toMatchObject({
      orderId,
      title: 'Need buyer photo',
      status: 'OPEN',
    });
  });

  test('returns workbench tracking summary when shipment exists', async () => {
    orderRepository.listWorkbench.mockResolvedValueOnce({
      items: [{
        _id: orderId,
        shopId,
        externalOrderId: '114-1',
        items: [{
          _id: itemId,
          orderId,
          shopId,
          sku: 'J2508-TS1S-05032026-335',
          quantity: 1,
        }],
      }],
      total: 1,
      page: 1,
      limit: 20,
      tabCounts: { ALL: 1 },
    });
    shipmentPublic.listSummariesByOrderItemIds.mockResolvedValueOnce([{
      orderItemId: itemId,
      shipmentId: '660000000000000000000901',
      carrier: 'USPS',
      trackingNumber: '940011189922385',
      trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=940011189922385',
      status: 'SHIPPED',
    }]);

    const result = await service.listOrderWorkbench({}, { permissions: ['ORDERS:READ'] });

    expect(result.items[0].items[0].tracking).toMatchObject({
      shipmentId: '660000000000000000000901',
      carrier: 'USPS',
      trackingNumber: '940011189922385',
      status: 'SHIPPED',
    });
  });

  test('enriches order item timeline actor profiles', async () => {
    const actorId = '660000000000000000000901';
    orderTimelineService.listByOrderItem.mockResolvedValueOnce({
      items: [{
        _id: '660000000000000000000801',
        orderId,
        orderItemId: itemId,
        shopId,
        eventType: 'ORDER_ITEM_STATUS_CHANGED',
        source: 'USER',
        actorId,
      }],
      total: 1,
      page: 1,
      limit: 20,
    });
    hrPublic.listEmployeeProfilesByAccountIds.mockResolvedValueOnce([{
      accountId: actorId,
      fullName: 'Nguyen Mai Phuong',
      employeeCode: 'J2508',
    }]);

    const result = await service.listOrderItemTimeline(itemId, {}, { permissions: ['ORDERS:READ'] });

    expect(hrPublic.listEmployeeProfilesByAccountIds).toHaveBeenCalledWith([actorId]);
    expect(result.items[0].actor).toMatchObject({
      accountId: actorId,
      fullName: 'Nguyen Mai Phuong',
      employeeCode: 'J2508',
      displayName: 'Nguyen Mai Phuong',
    });
  });

  test('includes shipment facts in expanded order rows for shared workflow projection', async () => {
    shipmentPublic.listSummariesByOrderItemIds.mockResolvedValueOnce([{
      orderItemId: itemId,
      status: 'SHIPPED',
      trackingNumber: '940011189922385',
    }]);

    const result = await service.getExpandedOrder(orderId, { permissions: ['ORDERS:READ'] });

    expect(result.items[0].tracking).toMatchObject({
      status: 'SHIPPED',
      trackingNumber: '940011189922385',
    });
  });

  test('falls back to auth account profile when timeline profile lookup misses actor', async () => {
    const actorId = '660000000000000000000902';
    orderTimelineService.listByOrderItem.mockResolvedValueOnce({
      items: [{
        _id: '660000000000000000000802',
        orderId,
        orderItemId: itemId,
        shopId,
        eventType: 'MANUAL_VENDOR_MATCHED',
        source: 'MAPPING',
        actorId,
      }],
      total: 1,
      page: 1,
      limit: 20,
    });
    hrPublic.listEmployeeProfilesByAccountIds.mockResolvedValueOnce([]);
    authPublic.getCurrentAccount.mockResolvedValueOnce({
      account: { _id: actorId, email: 'actor@example.com' },
      profile: {
        accountId: actorId,
        fullName: 'Nguyen Van Hieu',
        employeeCode: 'J2501',
      },
    });

    const result = await service.listOrderItemTimeline(itemId, {}, { permissions: ['ORDERS:READ'] });

    expect(authPublic.getCurrentAccount).toHaveBeenCalledWith(actorId);
    expect(result.items[0].actor).toMatchObject({
      accountId: actorId,
      fullName: 'Nguyen Van Hieu',
      employeeCode: 'J2501',
      displayName: 'Nguyen Van Hieu',
    });
  });

  test('expanded order batches customization, mapping, and production for multiple items', async () => {
    const authContext = { permissions: ['ORDERS:READ'] };
    orderItemRepository.listAllByOrder.mockResolvedValueOnce([
      { _id: itemId, orderId, shopId, title: 'Custom Shirt' },
      { _id: secondItemId, orderId, shopId, title: 'Custom Mug' },
      { _id: thirdItemId, orderId, shopId, title: 'Custom Pillow' },
    ]);
    customizationPublic.listOrderItemCustomizationViews.mockResolvedValueOnce([
      { orderItemId: itemId, payloadId: '660000000000000000000501' },
      { orderItemId: secondItemId, payloadId: '660000000000000000000502' },
      { orderItemId: thirdItemId, payloadId: '660000000000000000000503' },
    ]);
    mappingPublic.listFulfillmentPlansByOrderItemIds.mockResolvedValueOnce([
      { orderItemId: itemId, status: 'READY' },
      { orderItemId: secondItemId, status: 'READY' },
      { orderItemId: thirdItemId, status: 'READY' },
    ]);
    productionPublic.listTaskSummariesByOrderItemIds.mockResolvedValueOnce([
      { orderItemId: itemId, productionStatus: 'NEED_SCALE' },
      { orderItemId: secondItemId, productionStatus: 'QC_PENDING' },
      { orderItemId: thirdItemId, productionStatus: 'READY_TO_SEND_VENDOR' },
    ]);

    const result = await service.getExpandedOrder(orderId, authContext);

    expect(customizationPublic.listOrderItemCustomizationViews).toHaveBeenCalledTimes(1);
    expect(mappingPublic.listFulfillmentPlansByOrderItemIds).toHaveBeenCalledTimes(1);
    expect(productionPublic.listTaskSummariesByOrderItemIds).toHaveBeenCalledTimes(1);
    expect(customizationPublic.listOrderItemCustomizationViews).toHaveBeenCalledWith(
      [itemId, secondItemId, thirdItemId],
      expect.objectContaining({ system: true }),
    );
    expect(mappingPublic.listFulfillmentPlansByOrderItemIds).toHaveBeenCalledWith(
      [itemId, secondItemId, thirdItemId],
      expect.objectContaining({ system: true }),
    );
    expect(productionPublic.listTaskSummariesByOrderItemIds).toHaveBeenCalledWith(
      [itemId, secondItemId, thirdItemId],
      expect.objectContaining({ system: true }),
    );
    expect(result.items).toHaveLength(3);
    expect(result.items[2]).toMatchObject({
      fulfillmentPlan: { status: 'READY' },
      production: { productionStatus: 'READY_TO_SEND_VENDOR' },
      customization: { payloadId: '660000000000000000000503' },
    });
  });

  test('returns all 101 items in the expanded order projection', async () => {
    const items = Array.from({ length: 101 }, (_, index) => ({
      _id: `item-${index + 1}`,
      orderId,
      shopId,
      title: `Custom item ${index + 1}`,
    }));
    orderItemRepository.listAllByOrder.mockResolvedValueOnce(items);

    const result = await service.getExpandedOrder(orderId, { permissions: ['ORDERS:READ'] });

    expect(orderItemRepository.listAllByOrder).toHaveBeenCalledWith(orderId);
    expect(customizationPublic.listOrderItemCustomizationViews).toHaveBeenCalledWith(
      items.map((item) => item._id),
      expect.objectContaining({ system: true }),
    );
    expect(result.items).toHaveLength(101);
    expect(result.items[100].item).toMatchObject({ _id: 'item-101' });
  });
});
