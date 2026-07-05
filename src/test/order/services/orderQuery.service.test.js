jest.mock('../../../modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  countByTabs: jest.fn(),
}));

jest.mock('../../../modules/order/repositories/orderItem.repository', () => ({
  listByOrder: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
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
}));

const errorCodes = require('../../../shared/constants/errorCodes');
const authPublic = require('../../../modules/auth/public');
const orderRepository = require('../../../modules/order/repositories/order.repository');
const orderItemRepository = require('../../../modules/order/repositories/orderItem.repository');
const customizationPublic = require('../../../modules/customization/public');
const mappingPublic = require('../../../modules/mapping/public');
const productionPublic = require('../../../modules/production/public');
const service = require('../../../modules/order/services/orderQuery.service');

describe('orderQuery.service summary and expanded reads', () => {
  const orderId = '660000000000000000000301';
  const itemId = '660000000000000000000401';
  const secondItemId = '660000000000000000000402';
  const thirdItemId = '660000000000000000000403';
  const shopId = '660000000000000000000201';

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    orderRepository.findById.mockResolvedValue({ _id: orderId, shopId, externalOrderId: '114-1' });
    orderRepository.countByTabs.mockResolvedValue({ ALL: 2, NEW_ORDER: 1 });
    orderItemRepository.listByOrder.mockResolvedValue({
      items: [{ _id: itemId, orderId, shopId, title: 'Custom Shirt' }],
      total: 1,
      page: 1,
      limit: 100,
    });
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
      blockers: ['PSD_MISSING'],
      readyAt: null,
      sentToVendorAt: null,
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
    const authContext = { permissions: ['ORDERS:READ'] };
    const result = await service.getExpandedOrder(orderId, authContext);

    expect(orderItemRepository.listByOrder).toHaveBeenCalledWith(orderId, { page: 1, limit: 100 });
    expect(customizationPublic.listOrderItemCustomizationViews).toHaveBeenCalledWith([itemId], authContext);
    expect(mappingPublic.listFulfillmentPlansByOrderItemIds).toHaveBeenCalledWith([itemId], authContext);
    expect(productionPublic.listTaskSummariesByOrderItemIds).toHaveBeenCalledWith([itemId], authContext);
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

  test('expanded order batches customization, mapping, and production for multiple items', async () => {
    const authContext = { permissions: ['ORDERS:READ'] };
    orderItemRepository.listByOrder.mockResolvedValueOnce({
      items: [
        { _id: itemId, orderId, shopId, title: 'Custom Shirt' },
        { _id: secondItemId, orderId, shopId, title: 'Custom Mug' },
        { _id: thirdItemId, orderId, shopId, title: 'Custom Pillow' },
      ],
      total: 3,
      page: 1,
      limit: 100,
    });
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
      authContext,
    );
    expect(mappingPublic.listFulfillmentPlansByOrderItemIds).toHaveBeenCalledWith(
      [itemId, secondItemId, thirdItemId],
      authContext,
    );
    expect(productionPublic.listTaskSummariesByOrderItemIds).toHaveBeenCalledWith(
      [itemId, secondItemId, thirdItemId],
      authContext,
    );
    expect(result.items).toHaveLength(3);
    expect(result.items[2]).toMatchObject({
      fulfillmentPlan: { status: 'READY' },
      production: { productionStatus: 'READY_TO_SEND_VENDOR' },
      customization: { payloadId: '660000000000000000000503' },
    });
  });
});
