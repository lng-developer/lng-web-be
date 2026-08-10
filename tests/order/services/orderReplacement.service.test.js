jest.mock('../../../src/modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
  findByIds: jest.fn(),
  listAllByOrder: jest.fn(),
  create: jest.fn(),
}));

jest.mock('../../../src/modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  findByExternalIdentity: jest.fn(),
  create: jest.fn(),
}));

jest.mock('../../../src/modules/order/services/orderTimeline.service', () => ({
  appendTimeline: jest.fn(),
}));

jest.mock('../../../src/modules/order/services/orderCostCenterStatus.service', () => ({
  updateCostCenterStatusForOrder: jest.fn(),
  updatePsdStatusForOrder: jest.fn(),
}));

jest.mock('../../../src/modules/customization/public', () => ({
  cloneLatestPayloadForReplacement: jest.fn(),
}));

jest.mock('../../../src/modules/mapping/public', () => ({
  recheckFulfillmentPlan: jest.fn(),
}));

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));
jest.mock('../../../src/modules/audit/public', () => ({ record: jest.fn() }));

const orderItemRepository = require('../../../src/modules/order/repositories/orderItem.repository');
const orderRepository = require('../../../src/modules/order/repositories/order.repository');
const orderTimelineService = require('../../../src/modules/order/services/orderTimeline.service');
const service = require('../../../src/modules/order/services/orderReplacement.service');

describe('orderReplacement.service', () => {
  const orderId = '660000000000000000000301';
  const orderItemId = '660000000000000000000401';
  const replacementOrderId = '660000000000000000000302';
  const shopId = '660000000000000000000201';

  const originalOrder = {
    _id: orderId,
    shopId,
    shopConnectionId: null,
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'AMAZON_US',
    externalOrderId: '112-9013479-0033845',
    externalStatus: null,
    externalAccountId: 'SELLER-1',
    buyer: { name: 'Buyer' },
    shippingAddress: { countryCode: 'US' },
    shippingService: { level: 'Standard' },
    importSources: ['MANUAL_EXCEL'],
    externalData: { amazon: { original: true } },
  };

  const originalItem = {
    _id: orderItemId,
    orderId,
    shopId,
    shopConnectionId: null,
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'AMAZON_US',
    externalOrderId: '112-9013479-0033845',
    externalItemId: '163152591987020634',
    externalAccountId: 'SELLER-1',
    externalProductId: 'ASIN-PRODUCT',
    externalListingId: null,
    externalVariantId: null,
    asin: 'B000TEST',
    sku: 'J2508-TS1S-25022026-666',
    title: 'Original Shirt',
    quantity: 2,
    variantRaw: { color: 'Ash' },
    customizationRawSummary: { hasCustomization: true },
    price: {
      itemPriceAmount: 3000,
      itemTaxAmount: 200,
      shippingPriceAmount: 500,
      shippingTaxAmount: 50,
      giftWrapPriceAmount: 0,
      giftWrapTaxAmount: 0,
      itemPromotionDiscountAmount: 0,
      shipPromotionDiscountAmount: 0,
      currency: 'USD',
    },
    listingId: '660000000000000000000501',
    shipByDate: new Date('2026-07-20T00:00:00.000Z'),
    importSources: ['MANUAL_EXCEL'],
    externalData: { amazon: { original: true } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepository.findById.mockResolvedValue(originalOrder);
    orderRepository.findByExternalIdentity
      .mockResolvedValueOnce({ _id: 'existing-r1', externalOrderId: '112-9013479-0033845-R1' })
      .mockResolvedValueOnce(null);
    orderRepository.create.mockImplementation(async (payload) => ({
      _id: replacementOrderId,
      ...payload,
    }));
    orderItemRepository.findById.mockResolvedValue(originalItem);
    orderItemRepository.create.mockImplementation(async (payload) => ({
      _id: '660000000000000000000402',
      ...payload,
    }));
    orderTimelineService.appendTimeline.mockResolvedValue({});
  });

  test('creates zero-revenue replacement order and item linked to original item', async () => {
    const result = await service.createReplacementForItem(
      orderItemId,
      { reason: 'Wrong size', quantity: 1 },
      { permissions: ['ORDERS:WRITE'] },
    );

    expect(orderRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      externalOrderId: '112-9013479-0033845-R2',
      replacementOfOrderId: orderId,
      replacementOfOrderItemId: orderItemId,
      replacementSequence: 2,
      replacementReason: 'Wrong size',
    }));
    expect(orderItemRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      orderId: replacementOrderId,
      shopId,
      externalOrderId: '112-9013479-0033845-R2',
      externalItemId: '163152591987020634-R2',
      sku: originalItem.sku,
      quantity: 1,
      status: 'NEW',
      replacementOfOrderId: orderId,
      replacementOfOrderItemId: orderItemId,
      replacementSequence: 2,
      replacementReason: 'Wrong size',
      price: expect.objectContaining({
        itemPriceAmount: 0,
        shippingPriceAmount: 0,
        currency: 'USD',
      }),
    }));
    expect(result.externalItemId).toBe('163152591987020634-R2');
    expect(result.orderId).toBe(replacementOrderId);
    expect(result.price.itemPriceAmount).toBe(0);
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId: replacementOrderId,
      orderItemId: '660000000000000000000402',
      eventType: 'ORDER_ITEM_REPLACEMENT_CREATED',
      metadata: expect.objectContaining({
        replacementOfOrderItemId: orderItemId,
        replacementSequence: 2,
      }),
    }));
  });

  test('uses original quantity when replacement quantity is not provided', async () => {
    await service.createReplacementForItem(orderItemId, {}, { permissions: ['ORDERS:WRITE'] });

    expect(orderItemRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      quantity: 2,
    }));
  });

  test('creates one replacement order containing every selected item', async () => {
    const secondItem = {
      ...originalItem,
      _id: '660000000000000000000403',
      externalItemId: '163152591987020635',
      sku: 'J2508-TS1S-25022026-667',
      quantity: 3,
    };
    orderItemRepository.findByIds.mockResolvedValue([originalItem, secondItem]);
    orderItemRepository.create
      .mockResolvedValueOnce({ _id: 'replacement-item-1', orderId: replacementOrderId })
      .mockResolvedValueOnce({ _id: 'replacement-item-2', orderId: replacementOrderId });

    const result = await service.createReplacementForOrder(orderId, {
      reason: 'Package damaged',
      items: [
        { orderItemId, quantity: 1 },
        { orderItemId: secondItem._id, quantity: 2 },
      ],
    }, { permissions: ['ORDERS:WRITE'] });

    expect(orderRepository.create).toHaveBeenCalledTimes(1);
    expect(orderRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: '112-9013479-0033845-R2',
      replacementOfOrderId: orderId,
      replacementOfOrderItemId: null,
    }));
    expect(orderItemRepository.create).toHaveBeenCalledTimes(2);
    expect(orderItemRepository.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orderId: replacementOrderId,
      replacementOfOrderItemId: orderItemId,
      quantity: 1,
    }));
    expect(orderItemRepository.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      orderId: replacementOrderId,
      replacementOfOrderItemId: secondItem._id,
      quantity: 2,
    }));
    expect(result.items).toHaveLength(2);
  });
});
