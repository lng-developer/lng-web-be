jest.mock('../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(() => true),
}));

jest.mock('../../src/modules/order/repositories/order.repository', () => ({
  create: jest.fn(),
  findByExternalIdentity: jest.fn(),
  findById: jest.fn(),
}));

jest.mock('../../src/modules/order/repositories/orderItem.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
}));

jest.mock('../../src/modules/order/services/orderTimeline.service', () => ({
  appendTimeline: jest.fn(),
}));

jest.mock('../../src/modules/order/services/orderCostCenterStatus.service', () => ({
  updateCostCenterStatusForOrder: jest.fn(),
  updatePsdStatusForOrder: jest.fn(),
}));

jest.mock('../../src/modules/customization/public', () => ({
  cloneLatestPayloadForReplacement: jest.fn(),
}));

jest.mock('../../src/modules/mapping/public', () => ({
  recheckFulfillmentPlan: jest.fn(),
}));

jest.mock('../../src/modules/audit/public', () => ({ record: jest.fn() }));

const customizationPublic = require('../../src/modules/customization/public');
const mappingPublic = require('../../src/modules/mapping/public');
const orderRepository = require('../../src/modules/order/repositories/order.repository');
const orderItemRepository = require('../../src/modules/order/repositories/orderItem.repository');
const orderReadinessService = require('../../src/modules/order/services/orderCostCenterStatus.service');
const orderReplacementService = require('../../src/modules/order/services/orderReplacement.service');

describe('orderReplacementService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rechecks replacement order readiness after copying the original item', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: 'item-1',
      orderId: 'order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalItemId: 'item-ext-1',
      listingId: 'listing-1',
      price: { currency: 'USD' },
      quantity: 1,
    });
    orderRepository.findById.mockResolvedValue({
      _id: 'order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '113-1',
    });
    orderRepository.findByExternalIdentity.mockResolvedValue(null);
    orderRepository.create.mockResolvedValue({
      _id: 'replacement-order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '113-1-R1',
    });
    orderItemRepository.create.mockResolvedValue({
      _id: 'replacement-item-1',
      orderId: 'replacement-order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalItemId: 'item-ext-1-R1',
    });

    await orderReplacementService.createReplacementForItem('item-1', { reason: 'damaged' }, {
      permissions: ['ORDERS:WRITE'],
    });

    expect(orderReadinessService.updateCostCenterStatusForOrder).toHaveBeenCalledWith('replacement-order-1');
    expect(orderReadinessService.updatePsdStatusForOrder).toHaveBeenCalledWith('replacement-order-1');
  });

  test('carries original customization into replacement item and rematches cost center', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: 'item-1',
      orderId: 'order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalItemId: 'item-ext-1',
      listingId: 'listing-1',
      customizationRawSummary: { hasCustomization: true },
      price: { currency: 'USD' },
      quantity: 1,
    });
    orderRepository.findById.mockResolvedValue({
      _id: 'order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '113-1',
    });
    orderRepository.findByExternalIdentity.mockResolvedValue(null);
    orderRepository.create.mockResolvedValue({
      _id: 'replacement-order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '113-1-R1',
    });
    orderItemRepository.create.mockResolvedValue({
      _id: 'replacement-item-1',
      orderId: 'replacement-order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalItemId: 'item-ext-1-R1',
    });
    customizationPublic.cloneLatestPayloadForReplacement.mockResolvedValue({ id: 'payload-2' });
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({ status: 'READY' });

    await orderReplacementService.createReplacementForItem('item-1', { reason: 'damaged' }, {
      permissions: ['ORDERS:WRITE'],
    });

    expect(customizationPublic.cloneLatestPayloadForReplacement).toHaveBeenCalledWith({
      originalOrderItemId: 'item-1',
      replacementOrderId: 'replacement-order-1',
      replacementOrderItemId: 'replacement-item-1',
      replacementShopId: 'shop-1',
    });
    expect(mappingPublic.recheckFulfillmentPlan).toHaveBeenCalledWith(
      'replacement-item-1',
      {},
      expect.objectContaining({ source: 'ORDER_REPLACEMENT', system: true }),
    );
  });

  test('does not fail replacement creation when mapping recheck is blocked', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: 'item-1',
      orderId: 'order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalItemId: 'item-ext-1',
      price: { currency: 'USD' },
      quantity: 1,
    });
    orderRepository.findById.mockResolvedValue({
      _id: 'order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '113-1',
    });
    orderRepository.findByExternalIdentity.mockResolvedValue(null);
    orderRepository.create.mockResolvedValue({
      _id: 'replacement-order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '113-1-R1',
    });
    orderItemRepository.create.mockResolvedValue({
      _id: 'replacement-item-1',
      orderId: 'replacement-order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalItemId: 'item-ext-1-R1',
    });
    customizationPublic.cloneLatestPayloadForReplacement.mockResolvedValue(null);
    mappingPublic.recheckFulfillmentPlan.mockRejectedValue(new Error('mapping blocked'));

    await expect(orderReplacementService.createReplacementForItem('item-1', {}, {
      permissions: ['ORDERS:WRITE'],
    })).resolves.toMatchObject({ _id: 'replacement-item-1' });
  });
});
