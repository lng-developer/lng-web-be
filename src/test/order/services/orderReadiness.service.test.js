jest.mock('../../../modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
  updateStatus: jest.fn(),
}));

jest.mock('../../../modules/order/services/orderTimeline.service', () => ({
  appendTimeline: jest.fn(),
}));

jest.mock('../../../modules/customization/public', () => ({
  assertCustomizationReady: jest.fn(),
}));

jest.mock('../../../modules/integration/public', () => ({
  externalOrderImport: {
    listOpenIssuesForExternalItem: jest.fn(),
  },
}));

const orderRepository = require('../../../modules/order/repositories/order.repository');
const orderItemRepository = require('../../../modules/order/repositories/orderItem.repository');
const orderTimelineService = require('../../../modules/order/services/orderTimeline.service');
const customizationPublic = require('../../../modules/customization/public');
const integrationPublic = require('../../../modules/integration/public');
const service = require('../../../modules/order/services/orderReadiness.service');

describe('orderReadiness.service', () => {
  const orderId = '660000000000000000000301';
  const orderItemId = '660000000000000000000401';

  const order = {
    _id: orderId,
    shopId: '660000000000000000000201',
    addressValidationStatus: 'VALID',
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'AMAZON_US',
  };
  const item = {
    _id: orderItemId,
    orderId,
    shopId: order.shopId,
    externalOrderId: '114-1',
    externalItemId: 'ITEM-1',
    status: 'CUSTOMIZATION_PARSED',
    customizationRawSummary: { hasCustomization: true },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepository.findById.mockResolvedValue(order);
    orderItemRepository.findById.mockResolvedValue(item);
    orderItemRepository.updateStatus.mockResolvedValue({ ...item, status: 'FULFILLMENT_READY' });
    customizationPublic.assertCustomizationReady.mockResolvedValue({ status: 'PARSED' });
    integrationPublic.externalOrderImport.listOpenIssuesForExternalItem.mockResolvedValue([]);
    orderTimelineService.appendTimeline.mockResolvedValue({});
  });

  test('returns ready when address, customization, issues, and item status pass', async () => {
    const result = await service.getOrderItemReadiness(orderItemId);

    expect(result.ready).toBe(true);
    expect(result.targetStatus).toBe('FULFILLMENT_READY');
    expect(result.checks.address).toEqual({ ok: true, status: 'VALID' });
    expect(result.checks.customization.ok).toBe(true);
    expect(result.checks.blockingIssues).toEqual({ ok: true, count: 0 });
    expect(result.blockingReasons).toEqual([]);
  });

  test('returns not ready when address is not valid', async () => {
    orderRepository.findById.mockResolvedValue({ ...order, addressValidationStatus: 'WARNING' });

    const result = await service.getOrderItemReadiness(orderItemId);

    expect(result.ready).toBe(false);
    expect(result.checks.address).toEqual({ ok: false, status: 'WARNING' });
    expect(result.blockingReasons).toContain('ADDRESS_NOT_VALID');
  });

  test('returns not ready when customization public port reports not ready', async () => {
    customizationPublic.assertCustomizationReady.mockRejectedValue(new Error('not ready'));

    const result = await service.getOrderItemReadiness(orderItemId);

    expect(result.ready).toBe(false);
    expect(result.checks.customization.ok).toBe(false);
    expect(result.blockingReasons).toContain('CUSTOMIZATION_NOT_READY');
  });

  test('open external import issues block readiness', async () => {
    integrationPublic.externalOrderImport.listOpenIssuesForExternalItem.mockResolvedValue([
      { issueType: 'CUSTOMIZATION_MISMATCH' },
    ]);

    const result = await service.getOrderItemReadiness(orderItemId);

    expect(result.ready).toBe(false);
    expect(result.checks.blockingIssues).toEqual({ ok: false, count: 1 });
    expect(result.blockingReasons).toContain('CUSTOMIZATION_MISMATCH');
  });

  test('marks item fulfillment ready only when readiness passes', async () => {
    const result = await service.markFulfillmentReady(orderItemId);

    expect(orderItemRepository.updateStatus).toHaveBeenCalledWith(orderItemId, 'FULFILLMENT_READY');
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      shopId: order.shopId,
      eventType: 'FULFILLMENT_PLAN_READY',
    }));
    expect(result.item.status).toBe('FULFILLMENT_READY');
    expect(result.readiness.ready).toBe(true);
  });

  test('rejects fulfillment ready transition when readiness fails', async () => {
    integrationPublic.externalOrderImport.listOpenIssuesForExternalItem.mockResolvedValue([
      { issueType: 'CUSTOMIZATION_MISMATCH' },
    ]);

    await expect(service.markFulfillmentReady(orderItemId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(orderItemRepository.updateStatus).not.toHaveBeenCalled();
  });
});
