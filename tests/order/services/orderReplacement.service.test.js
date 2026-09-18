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

jest.mock('../../../src/modules/order/repositories/orderWorkbenchProjection.repository', () => ({
  findByOrderId: jest.fn(),
}));

jest.mock('../../../src/modules/order/repositories/orderCase.repository', () => ({
  listOpenByOrder: jest.fn(),
}));

jest.mock('../../../src/modules/order/services/orderCase.service', () => ({
  createOrderCase: jest.fn(),
}));

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));
jest.mock('../../../src/modules/order/services/orderNotification.service', () => ({
  notifyAssignedStaff: jest.fn(),
}));
jest.mock('../../../src/modules/audit/public', () => ({ record: jest.fn() }));
jest.mock('../../../src/modules/order/services/orderWorkbenchProjection.service', () => ({
  upsertOrderWorkbenchBase: jest.fn(),
  updateOrderWorkbenchOrder: jest.fn(),
  updateOrderWorkbenchItem: jest.fn(),
}));

const orderItemRepository = require('../../../src/modules/order/repositories/orderItem.repository');
const orderRepository = require('../../../src/modules/order/repositories/order.repository');
const projectionRepository = require('../../../src/modules/order/repositories/orderWorkbenchProjection.repository');
const orderCaseRepository = require('../../../src/modules/order/repositories/orderCase.repository');
const orderCaseService = require('../../../src/modules/order/services/orderCase.service');
const orderTimelineService = require('../../../src/modules/order/services/orderTimeline.service');
const orderNotificationService = require('../../../src/modules/order/services/orderNotification.service');
const projectionService = require('../../../src/modules/order/services/orderWorkbenchProjection.service');
const mappingPublic = require('../../../src/modules/mapping/public');
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
    assignedStaffIds: ['660000000000000000000902'],
    psdStatus: 'PRESENT',
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
    projectionRepository.findByOrderId.mockResolvedValue({
      psdStatus: 'PRESENT',
      items: [{
        orderItemId,
        seller: { employeeCode: 'J2508', name: 'Seller One' },
        listing: { id: originalItem.listingId, defaultPsdTemplateAssetId: 'psd-1', productImageUrl: 'https://example.com/main.jpg' },
        listingVariant: { psdReadiness: { status: 'PRESENT' } },
      }],
    });
    orderCaseRepository.listOpenByOrder.mockResolvedValue([]);
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
    expect(orderNotificationService.notifyAssignedStaff).toHaveBeenCalledWith(expect.objectContaining({
      order: originalOrder,
      type: 'ORDER_ITEM_REPLACEMENT_CREATED',
      deduplicationScope: '660000000000000000000402',
    }));
    expect(projectionService.upsertOrderWorkbenchBase).toHaveBeenCalledWith(
      expect.objectContaining({ _id: replacementOrderId }),
      [expect.objectContaining({ _id: '660000000000000000000402' })],
      { source: 'ORDER_REPLACEMENT' },
    );
  });

  test('uses original quantity when replacement quantity is not provided', async () => {
    await service.createReplacementForItem(orderItemId, {}, { permissions: ['ORDERS:WRITE'] });

    expect(orderItemRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      quantity: 2,
    }));
  });

  test('copies listing, PSD, and seller snapshots without mapping', async () => {
    await service.createReplacementForItem(orderItemId, {}, { permissions: ['ORDERS:WRITE'] });

    expect(projectionService.updateOrderWorkbenchItem).toHaveBeenCalledWith(
      replacementOrderId,
      '660000000000000000000402',
      expect.objectContaining({
        seller: { employeeCode: 'J2508', name: 'Seller One' },
        listing: expect.objectContaining({ defaultPsdTemplateAssetId: 'psd-1' }),
        listingVariant: { psdReadiness: { status: 'PRESENT' } },
      }),
      { source: 'ORDER_REPLACEMENT' },
    );
    expect(projectionService.updateOrderWorkbenchOrder).toHaveBeenCalledWith(
      replacementOrderId,
      { psdStatus: 'PRESENT', hasCurrentPsd: true },
      { source: 'ORDER_REPLACEMENT' },
    );
  });

  test('creates the next root replacement number when replacing an R1 order', async () => {
    const replacementR1 = {
      ...originalOrder,
      _id: '660000000000000000000311',
      externalOrderId: '112-9013479-0033845-R1',
      replacementOfOrderId: orderId,
    };
    orderItemRepository.findById.mockResolvedValue({
      ...originalItem,
      orderId: replacementR1._id,
      externalOrderId: replacementR1.externalOrderId,
    });
    orderRepository.findById
      .mockResolvedValueOnce(replacementR1)
      .mockResolvedValueOnce(originalOrder);
    orderRepository.findByExternalIdentity
      .mockReset()
      .mockResolvedValueOnce({ _id: 'existing-r1', externalOrderId: '112-9013479-0033845-R1' })
      .mockResolvedValueOnce(null);

    await service.createReplacementForItem(orderItemId, {}, { permissions: ['ORDERS:WRITE'] });

    expect(orderRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: '112-9013479-0033845-R2',
      replacementOfOrderId: replacementR1._id,
    }));
  });

  test('copies open cases and maps their order item to the replacement', async () => {
    orderRepository.findById.mockResolvedValueOnce({
      ...originalOrder,
      caseStatus: 'OPEN',
    });
    orderItemRepository.findById.mockResolvedValueOnce({
      ...originalItem,
      csNote: 'Use the corrected spelling from CS.',
    });
    orderCaseRepository.listOpenByOrder.mockResolvedValueOnce([{
      _id: '660000000000000000000701',
      orderId,
      orderItemId,
      caseType: 'CUSTOMIZATION',
      severity: 'HIGH',
      title: 'Confirm personalization',
      description: 'Source case details',
    }]);

    await service.createReplacementForItem(orderItemId, {}, { permissions: ['ORDERS:WRITE'] });

    expect(orderItemRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      csNote: 'Use the corrected spelling from CS.',
    }));
    expect(orderCaseService.createOrderCase).toHaveBeenCalledWith({
      orderId: replacementOrderId,
      orderItemId: '660000000000000000000402',
      caseType: 'CUSTOMIZATION',
      severity: 'HIGH',
      title: 'Confirm personalization',
      description: 'Source case details',
    }, { permissions: ['ORDERS:WRITE'] });
  });

  test('does not invoke mapping while creating a replacement', async () => {
    await expect(service.createReplacementForItem(orderItemId, {}, { permissions: ['ORDERS:WRITE'] }))
      .resolves.toMatchObject({ orderId: replacementOrderId });

    expect(projectionService.upsertOrderWorkbenchBase).toHaveBeenCalledWith(
      expect.objectContaining({ _id: replacementOrderId }),
      [expect.objectContaining({ orderId: replacementOrderId })],
      { source: 'ORDER_REPLACEMENT' },
    );
    expect(mappingPublic.recheckFulfillmentPlan).not.toHaveBeenCalled();
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
    expect(projectionService.upsertOrderWorkbenchBase).toHaveBeenCalledWith(
      expect.objectContaining({ _id: replacementOrderId }),
      expect.arrayContaining([
        expect.objectContaining({ _id: 'replacement-item-1' }),
        expect.objectContaining({ _id: 'replacement-item-2' }),
      ]),
      { source: 'ORDER_REPLACEMENT' },
    );
  });
});
