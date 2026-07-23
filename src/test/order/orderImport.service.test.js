jest.mock('../../modules/shop/public', () => ({
  assertShopIsActive: jest.fn(),
}));

jest.mock('../../modules/order/repositories/order.repository', () => ({
  create: jest.fn(),
  findByExternalIdentity: jest.fn(),
  updateFromExternalImport: jest.fn(),
}));

jest.mock('../../modules/order/repositories/orderItem.repository', () => ({
  create: jest.fn(),
  findByExternalIdentity: jest.fn(),
  updateFromExternalImport: jest.fn(),
}));

jest.mock('../../modules/order/services/orderTimeline.service', () => ({
  appendTimeline: jest.fn(),
}));

jest.mock('../../modules/order/services/orderCostCenterStatus.service', () => ({
  updateCostCenterStatusForOrder: jest.fn(),
  updatePsdStatusForOrder: jest.fn(),
}));

const shopPublic = require('../../modules/shop/public');
const orderRepository = require('../../modules/order/repositories/order.repository');
const orderItemRepository = require('../../modules/order/repositories/orderItem.repository');
const orderReadinessService = require('../../modules/order/services/orderCostCenterStatus.service');
const orderTimelineService = require('../../modules/order/services/orderTimeline.service');
const orderImportService = require('../../modules/order/services/orderImport.service');

const twoItemDto = {
  shopId: 'shop-1',
  source: 'AMAZON_EXTENSION_REPORT',
  salesChannelCode: 'AMAZON',
  marketplaceCode: 'AMAZON_US',
  externalOrderId: '113-2',
  items: [
    { externalItemId: 'line-1', quantity: 1, sku: 'SKU-1' },
    { externalItemId: 'line-2', quantity: 1, sku: 'SKU-2' },
  ],
};

const oneItemDto = {
  ...twoItemDto,
  externalOrderId: '113-3',
  items: [twoItemDto.items[0]],
};

describe('orderImportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shopPublic.assertShopIsActive.mockResolvedValue(true);
  });

  test('rechecks order readiness after importing order items', async () => {
    orderRepository.findByExternalIdentity.mockResolvedValue(null);
    orderRepository.create.mockResolvedValue({
      _id: 'order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '113-1',
    });
    orderItemRepository.findByExternalIdentity.mockResolvedValue(null);
    orderItemRepository.create.mockResolvedValue({
      _id: 'item-1',
      orderId: 'order-1',
      shopId: 'shop-1',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '113-1',
      externalItemId: 'item-ext-1',
      quantity: 1,
    });

    await orderImportService.importExternalOrder({
      shopId: 'shop-1',
      source: 'AMAZON_EXTENSION_REPORT',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '113-1',
      items: [{
        externalItemId: 'item-ext-1',
        quantity: 1,
        sku: 'SKU-1',
      }],
    });

    expect(orderReadinessService.updateCostCenterStatusForOrder).toHaveBeenCalledWith('order-1');
    expect(orderReadinessService.updatePsdStatusForOrder).toHaveBeenCalledWith('order-1');
  });

  test('retries a partial item import without recalculating readiness after the failed attempt', async () => {
    const existingOrder = { _id: 'order-1', shopId: 'shop-1' };
    const existingFirstItem = {
      _id: 'item-1', orderId: 'order-1', externalItemId: 'line-1',
    };
    const createdFirstItem = { ...existingFirstItem };
    const createdSecondItem = {
      _id: 'item-2', orderId: 'order-1', externalItemId: 'line-2',
    };

    orderRepository.findByExternalIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingOrder);
    orderRepository.create.mockResolvedValue(existingOrder);
    orderRepository.updateFromExternalImport.mockResolvedValue(existingOrder);
    orderItemRepository.findByExternalIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingFirstItem)
      .mockResolvedValueOnce(null);
    orderItemRepository.create
      .mockResolvedValueOnce(createdFirstItem)
      .mockRejectedValueOnce(new Error('second item write failed'));

    await expect(orderImportService.importExternalOrder(twoItemDto)).rejects.toThrow('second item write failed');
    expect(orderReadinessService.updateCostCenterStatusForOrder).not.toHaveBeenCalled();
    expect(orderReadinessService.updatePsdStatusForOrder).not.toHaveBeenCalled();

    orderItemRepository.create.mockResolvedValueOnce(createdSecondItem);

    const result = await orderImportService.importExternalOrder(twoItemDto);

    expect(result.itemResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalItemId: 'line-1', updated: true }),
      expect.objectContaining({ externalItemId: 'line-2', created: true }),
    ]));
  });

  test('does not overwrite an item status on re-import after production', async () => {
    const existingOrder = { _id: 'order-1', shopId: 'shop-1' };
    const existingItem = {
      _id: 'item-1', orderId: 'order-1', externalItemId: 'line-1', status: 'SENT_TO_VENDOR',
    };

    orderRepository.findByExternalIdentity.mockResolvedValue(existingOrder);
    orderRepository.updateFromExternalImport.mockResolvedValue(existingOrder);
    orderItemRepository.findByExternalIdentity.mockResolvedValue(existingItem);
    orderItemRepository.updateFromExternalImport.mockResolvedValue(existingItem);

    await orderImportService.importExternalOrder(oneItemDto);

    const [, updatePayload] = orderItemRepository.updateFromExternalImport.mock.calls[0];
    expect(updatePayload).not.toHaveProperty('set.status');
    expect(orderItemRepository.create).not.toHaveBeenCalled();
  });

  test('rejects a global order identity already owned by another shop', async () => {
    orderRepository.findByExternalIdentity.mockResolvedValue({
      _id: 'order-1',
      shopId: 'shop-1',
    });

    await expect(orderImportService.importExternalOrder({
      ...oneItemDto,
      shopId: 'shop-2',
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
      details: {
        requestedShopId: 'shop-2',
        identity: {
          salesChannelCode: 'AMAZON',
          marketplaceCode: 'AMAZON_US',
          externalOrderId: '113-3',
        },
      },
    });

    expect(orderRepository.updateFromExternalImport).not.toHaveBeenCalled();
    expect(orderItemRepository.create).not.toHaveBeenCalled();
    expect(orderTimelineService.appendTimeline).not.toHaveBeenCalled();
    expect(orderReadinessService.updateCostCenterStatusForOrder).not.toHaveBeenCalled();
  });

  test('rejects a different shop after duplicate-key race recovery', async () => {
    orderRepository.findByExternalIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'order-1', shopId: 'shop-1' });
    orderRepository.create.mockRejectedValue(Object.assign(
      new Error('E11000 duplicate key'),
      { code: 11000 },
    ));

    await expect(orderImportService.importExternalOrder({
      ...oneItemDto,
      shopId: 'shop-2',
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(orderRepository.updateFromExternalImport).not.toHaveBeenCalled();
    expect(orderItemRepository.create).not.toHaveBeenCalled();
    expect(orderTimelineService.appendTimeline).not.toHaveBeenCalled();
  });
});
