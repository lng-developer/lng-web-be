jest.mock('../../../modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  list: jest.fn(),
  countByTabs: jest.fn(),
}));

jest.mock('../../../modules/order/repositories/orderItem.repository', () => ({
  listByOrder: jest.fn(),
  listByOrderIds: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
  findProfileByEmployeeCode: jest.fn(),
}));

jest.mock('../../../modules/customization/public', () => ({
  getOrderItemCustomizationView: jest.fn(),
  listOrderItemCustomizationViews: jest.fn(),
}));

jest.mock('../../../modules/mapping/public', () => ({
  getFulfillmentPlanForOrderItem: jest.fn(),
  listFulfillmentPlansForOrderItems: jest.fn(),
}));

jest.mock('../../../modules/production/public', () => ({
  listTaskSummariesByOrderItemIds: jest.fn(),
}));

jest.mock('../../../modules/catalog/public', () => ({
  getListingById: jest.fn(),
  getListingsByIds: jest.fn(),
}));

jest.mock('../../../modules/shop/public', () => ({
  findById: jest.fn(),
}));

const errorCodes = require('../../../shared/constants/errorCodes');
const authPublic = require('../../../modules/auth/public');
const orderRepository = require('../../../modules/order/repositories/order.repository');
const orderItemRepository = require('../../../modules/order/repositories/orderItem.repository');
const customizationPublic = require('../../../modules/customization/public');
const mappingPublic = require('../../../modules/mapping/public');
const productionPublic = require('../../../modules/production/public');
const catalogPublic = require('../../../modules/catalog/public');
const shopPublic = require('../../../modules/shop/public');
const service = require('../../../modules/order/services/orderQuery.service');

describe('orderQuery.service summary and expanded reads', () => {
  const orderId = '660000000000000000000301';
  const itemId = '660000000000000000000401';
  const shopId = '660000000000000000000201';

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    authPublic.findProfileByEmployeeCode.mockResolvedValue(null);
    shopPublic.findById.mockResolvedValue({ _id: shopId, name: 'Acc1', status: 'ACTIVE' });
    orderRepository.findById.mockResolvedValue({ _id: orderId, shopId, externalOrderId: '114-1' });
    orderRepository.list.mockResolvedValue({
      items: [{ _id: orderId, shopId, externalOrderId: '114-1', status: 'IMPORTED' }],
      total: 1,
      page: 1,
      limit: 20,
      tabCounts: { ALL: 1 },
    });
    orderRepository.countByTabs.mockResolvedValue({ ALL: 2, NEW_ORDER: 1 });
    orderItemRepository.listByOrder.mockResolvedValue({
      items: [{ _id: itemId, orderId, shopId, title: 'Custom Shirt' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    orderItemRepository.listByOrderIds.mockResolvedValue([{ _id: itemId, orderId, shopId, title: 'Custom Shirt' }]);
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
    mappingPublic.listFulfillmentPlansForOrderItems.mockResolvedValue([{
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
  });

  test('returns summary tab counts with scoped shop filter', async () => {
    const result = await service.getOrderSummary(
      { tab: 'NO_PSD', shopId },
      { permissions: [], scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:READ'] }] },
    );

    expect(orderRepository.countByTabs).toHaveBeenCalledWith({ tab: 'NO_PSD', shopId, shopIds: [shopId] });
    expect(result).toEqual({ tabCounts: { ALL: 2, NEW_ORDER: 1 } });
  });

  test('returns expanded order items with customization dto', async () => {
    const result = await service.getExpandedOrder(orderId, { permissions: ['ORDERS:READ'] });

    expect(orderItemRepository.listByOrder).toHaveBeenCalledWith(orderId, { page: 1, limit: 100 });
    expect(customizationPublic.getOrderItemCustomizationView).toHaveBeenCalledWith(itemId, { permissions: ['ORDERS:READ'] });
    expect(mappingPublic.getFulfillmentPlanForOrderItem).toHaveBeenCalledWith(itemId);
    expect(productionPublic.listTaskSummariesByOrderItemIds).toHaveBeenCalledWith([itemId]);
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
    customizationPublic.getOrderItemCustomizationView.mockRejectedValueOnce({
      code: errorCodes.RESOURCE_NOT_FOUND,
      statusCode: 404,
    });

    const result = await service.getExpandedOrder(orderId, { permissions: ['ORDERS:READ'] });

    expect(result.items[0].customization).toBeNull();
  });

  test('returns workbench rows with compact joined item context', async () => {
    authPublic.findProfileByEmployeeCode.mockResolvedValueOnce({
      employeeCode: 'J2508',
      fullName: 'Nguyen Duc Son',
      accountId: '660000000000000000000901',
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

    const result = await service.listOrderWorkbench({ page: 1, limit: 20 }, { permissions: ['ORDERS:READ'] });

    expect(orderRepository.list).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(orderItemRepository.listByOrderIds).toHaveBeenCalledWith([orderId], { limitPerOrder: 100 });
    expect(orderItemRepository.listByOrder).not.toHaveBeenCalled();
    expect(shopPublic.findById).toHaveBeenCalledWith(shopId);
    expect(authPublic.findProfileByEmployeeCode).toHaveBeenCalledWith('J2508');
    expect(catalogPublic.getListingsByIds).toHaveBeenCalledWith(['660000000000000000000801']);
    expect(customizationPublic.listOrderItemCustomizationViews).toHaveBeenCalledWith([itemId], { permissions: ['ORDERS:READ'] });
    expect(mappingPublic.listFulfillmentPlansForOrderItems).toHaveBeenCalledWith([itemId]);
    expect(result).toMatchObject({
      total: 1,
      page: 1,
      limit: 20,
      tabCounts: { ALL: 1 },
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
  });
});
