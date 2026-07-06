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
}));

jest.mock('../../../modules/mapping/public', () => ({
  getFulfillmentPlanForOrderItem: jest.fn(),
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
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue({
      orderItemId: itemId,
      costEstimate: {
        currency: 'USD',
        totalAmount: 1894,
        lines: [{ code: 'BASE_COST', label: 'Base cost', amount: 1200 }],
        signals: { configCode: 'TS1S', twoSided: false, embroidery: false, priority: true },
      },
    });
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
});
