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

jest.mock('../../src/modules/order/repositories/orderWorkbenchProjection.repository', () => ({
  findByOrderId: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../src/modules/order/repositories/orderCase.repository', () => ({
  listOpenByOrder: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/modules/order/services/orderCase.service', () => ({
  createOrderCase: jest.fn(),
}));

jest.mock('../../src/modules/audit/public', () => ({ record: jest.fn() }));
jest.mock('../../src/modules/order/services/orderWorkbenchProjection.service', () => ({
  upsertOrderWorkbenchBase: jest.fn(),
  updateOrderWorkbenchOrder: jest.fn(),
  updateOrderWorkbenchItem: jest.fn(),
}));

const customizationPublic = require('../../src/modules/customization/public');
const mappingPublic = require('../../src/modules/mapping/public');
const orderRepository = require('../../src/modules/order/repositories/order.repository');
const orderItemRepository = require('../../src/modules/order/repositories/orderItem.repository');
const orderReadinessService = require('../../src/modules/order/services/orderCostCenterStatus.service');
const orderWorkbenchProjectionService = require('../../src/modules/order/services/orderWorkbenchProjection.service');
const orderReplacementService = require('../../src/modules/order/services/orderReplacement.service');

describe('orderReplacementService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates a replacement without rechecking mapping or readiness', async () => {
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

    expect(mappingPublic.recheckFulfillmentPlan).not.toHaveBeenCalled();
    expect(orderReadinessService.updateCostCenterStatusForOrder).not.toHaveBeenCalled();
    expect(orderReadinessService.updatePsdStatusForOrder).not.toHaveBeenCalled();
  });

  test('carries original customization into replacement item without rematching cost center', async () => {
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
    await orderReplacementService.createReplacementForItem('item-1', { reason: 'damaged' }, {
      permissions: ['ORDERS:WRITE'],
    });

    expect(customizationPublic.cloneLatestPayloadForReplacement).toHaveBeenCalledWith({
      originalOrderItemId: 'item-1',
      replacementOrderId: 'replacement-order-1',
      replacementOrderItemId: 'replacement-item-1',
      replacementShopId: 'shop-1',
    });
    expect(mappingPublic.recheckFulfillmentPlan).not.toHaveBeenCalled();
    expect(orderWorkbenchProjectionService.updateOrderWorkbenchItem).not.toHaveBeenCalled();
  });

  test('does not depend on mapping availability to create a replacement', async () => {
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
    await expect(orderReplacementService.createReplacementForItem('item-1', {}, {
      permissions: ['ORDERS:WRITE'],
    })).resolves.toMatchObject({ _id: 'replacement-item-1' });
    expect(mappingPublic.recheckFulfillmentPlan).not.toHaveBeenCalled();
  });
});
