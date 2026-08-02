jest.mock('../../../modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  updateStatus: jest.fn(),
}));

jest.mock('../../../modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
  findByIdWithOrder: jest.fn(),
  listAllByOrder: jest.fn(),
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

jest.mock('../../../modules/mapping/public', () => ({
  listFulfillmentPlansByOrderItemIds: jest.fn(),
}));
jest.mock('../../../modules/audit/public', () => ({ record: jest.fn() }));

const orderRepository = require('../../../modules/order/repositories/order.repository');
const orderItemRepository = require('../../../modules/order/repositories/orderItem.repository');
const orderTimelineService = require('../../../modules/order/services/orderTimeline.service');
const customizationPublic = require('../../../modules/customization/public');
const integrationPublic = require('../../../modules/integration/public');
const mappingPublic = require('../../../modules/mapping/public');
const auditPublic = require('../../../modules/audit/public');
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
    mockSession.withTransaction.mockImplementation(async (work) => work());
    orderItemRepository.findByIdWithOrder.mockResolvedValue({ order, item });
    orderRepository.updateStatus.mockResolvedValue({ ...order, status: 'PROCESSING' });
    orderItemRepository.findById.mockResolvedValue(item);
    orderItemRepository.listAllByOrder.mockResolvedValue([{ ...item, status: 'FULFILLMENT_READY' }]);
    orderItemRepository.updateStatus.mockResolvedValue({ ...item, status: 'FULFILLMENT_READY' });
    customizationPublic.assertCustomizationReady.mockResolvedValue({ status: 'PARSED' });
    integrationPublic.externalOrderImport.listOpenIssuesForExternalItem.mockResolvedValue([]);
    mappingPublic.listFulfillmentPlansByOrderItemIds.mockResolvedValue([{ status: 'READY' }]);
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
    expect(mappingPublic.listFulfillmentPlansByOrderItemIds).toHaveBeenCalledWith(
      [orderItemId],
      { system: true, source: 'ORDER_READINESS' },
    );
  });

  test('treats an overridden address as ready', async () => {
    orderItemRepository.findByIdWithOrder.mockResolvedValue({
      item, order: { ...order, addressValidationStatus: 'OVERRIDDEN' },
    });

    const result = await service.getOrderItemReadiness(orderItemId);

    expect(result.checks.address).toEqual({ ok: true, status: 'OVERRIDDEN' });
  });

  test('returns not ready when address is not valid', async () => {
    orderItemRepository.findByIdWithOrder.mockResolvedValue({
      item, order: { ...order, addressValidationStatus: 'WARNING' },
    });

    const result = await service.getOrderItemReadiness(orderItemId);

    expect(result.ready).toBe(false);
    expect(result.checks.address).toEqual({ ok: false, status: 'WARNING' });
    expect(result.blockingReasons).toContain('ADDRESS_NOT_VALID');
  });

  test('returns not ready when no fulfillment plan exists', async () => {
    mappingPublic.listFulfillmentPlansByOrderItemIds.mockResolvedValue([]);

    const result = await service.getOrderItemReadiness(orderItemId);

    expect(result.ready).toBe(false);
    expect(result.checks.mapping).toEqual({ ok: false, status: null });
    expect(result.blockingReasons).toContain('MAPPING_NOT_READY');
  });

  test('returns not ready when customization public port reports not ready', async () => {
    customizationPublic.assertCustomizationReady.mockRejectedValue(Object.assign(new Error('not ready'), {
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    }));

    const result = await service.getOrderItemReadiness(orderItemId);

    expect(result.ready).toBe(false);
    expect(result.checks.customization.ok).toBe(false);
    expect(result.blockingReasons).toContain('CUSTOMIZATION_NOT_READY');
  });

  test('propagates a missing customization payload error', async () => {
    const error = Object.assign(new Error('Customization payload not found'), {
      statusCode: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    customizationPublic.assertCustomizationReady.mockRejectedValue(error);

    await expect(service.getOrderItemReadiness(orderItemId)).rejects.toBe(error);
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

  test('starts customization, mapping, and integration checks concurrently', async () => {
    const deferred = () => {
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      return { promise, resolve };
    };
    const customization = deferred();
    const mapping = deferred();
    const issues = deferred();
    customizationPublic.assertCustomizationReady.mockReturnValueOnce(customization.promise);
    mappingPublic.listFulfillmentPlansByOrderItemIds.mockReturnValueOnce(mapping.promise);
    integrationPublic.externalOrderImport.listOpenIssuesForExternalItem.mockReturnValueOnce(issues.promise);

    const resultPromise = service.getOrderItemReadiness(orderItemId);
    await new Promise(setImmediate);

    expect(customizationPublic.assertCustomizationReady).toHaveBeenCalledTimes(1);
    expect(mappingPublic.listFulfillmentPlansByOrderItemIds).toHaveBeenCalledTimes(1);
    expect(integrationPublic.externalOrderImport.listOpenIssuesForExternalItem).toHaveBeenCalledTimes(1);

    customization.resolve({ status: 'PARSED' });
    mapping.resolve([{ status: 'READY' }]);
    issues.resolve([]);
    await expect(resultPromise).resolves.toMatchObject({ ready: true });
  });

  test('marks item fulfillment ready only when readiness passes', async () => {
    const result = await service.markFulfillmentReady(orderItemId);

    expect(orderItemRepository.updateStatus).toHaveBeenCalledWith(
      orderItemId, 'FULFILLMENT_READY', { session: mockSession },
    );
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      shopId: order.shopId,
      eventType: 'FULFILLMENT_PLAN_READY',
    }), { session: mockSession });
    expect(result.item.status).toBe('FULFILLMENT_READY');
    expect(result.readiness.ready).toBe(true);
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_ITEM_FULFILLMENT_READY', entityType: 'ORDER_ITEM', entityId: orderItemId,
    }), { session: mockSession });
  });

  test('same-status fulfillment-ready retry is a true no-op', async () => {
    orderItemRepository.findById.mockResolvedValue({ ...item, status: 'FULFILLMENT_READY' });

    const result = await service.markFulfillmentReady(orderItemId);

    expect(result.item.status).toBe('FULFILLMENT_READY');
    expect(orderItemRepository.updateStatus).not.toHaveBeenCalled();
    expect(orderTimelineService.appendTimeline).not.toHaveBeenCalled();
    expect(auditPublic.record).not.toHaveBeenCalled();
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
const mockSession = {
  withTransaction: jest.fn(async (work) => work()),
  endSession: jest.fn(),
};
jest.mock('mongoose', () => ({
  ...jest.requireActual('mongoose'),
  startSession: jest.fn(async () => mockSession),
}));
