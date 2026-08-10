jest.mock('../../../src/modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../src/modules/order/services/orderItemStatusTransition.service', () => ({
  transitionItemStatus: jest.fn(),
}));

jest.mock('../../../src/modules/order/services/orderTimeline.service', () => ({
  appendTimeline: jest.fn(),
}));

jest.mock('../../../src/modules/vendorSubmission/public', () => ({
  getByOrderItemId: jest.fn(),
}));

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));
jest.mock('../../../src/modules/audit/public', () => ({ record: jest.fn() }));

const orderItemRepository = require('../../../src/modules/order/repositories/orderItem.repository');
const transitionService = require('../../../src/modules/order/services/orderItemStatusTransition.service');
const orderTimelineService = require('../../../src/modules/order/services/orderTimeline.service');
const vendorSubmissionPublic = require('../../../src/modules/vendorSubmission/public');
const auditPublic = require('../../../src/modules/audit/public');
const service = require('../../../src/modules/order/services/orderItemCancel.service');

describe('orderItemCancel.service', () => {
  const orderItemId = '660000000000000000000401';
  const orderId = '660000000000000000000301';
  const shopId = '660000000000000000000201';

  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.withTransaction.mockImplementation(async (work) => work());
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      orderId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      status: 'NEW',
    });
    transitionService.transitionItemStatus.mockResolvedValue({
      _id: orderItemId,
      status: 'CANCELLED',
    });
    orderTimelineService.appendTimeline.mockResolvedValue({});
    vendorSubmissionPublic.getByOrderItemId.mockResolvedValue(null);
  });

  test('cancels through order-owned transition service and appends CS audit timeline', async () => {
    const result = await service.cancelOrderItem(
      orderItemId,
      { reason: 'Buyer requested cancellation' },
      { permissions: ['ORDERS:WRITE'], accountId: '660000000000000000000901' },
    );

    expect(result.status).toBe('CANCELLED');
    expect(transitionService.transitionItemStatus).toHaveBeenCalledWith(
      orderItemId,
      'CANCELLED',
      expect.objectContaining({
        source: 'USER',
        accountId: '660000000000000000000901',
        session: mockSession,
      }),
    );
    expect(orderTimelineService.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      shopId,
      eventType: 'ORDER_ITEM_CANCELLED',
      metadata: expect.objectContaining({
        reason: 'Buyer requested cancellation',
        previousStatus: 'NEW',
      }),
    }), { session: mockSession });
    const [event] = auditPublic.record.mock.calls.at(-1);
    expect(event).toMatchObject({ action: 'ORDER_ITEM_CANCELLED', entityId: orderItemId });
    expect(JSON.stringify(event)).not.toContain('Buyer requested cancellation');
    expect(auditPublic.record).toHaveBeenCalledWith(expect.any(Object), { session: mockSession });
  });

  test('same-status cancellation retry is a true no-op', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      orderId,
      shopId,
      status: 'CANCELLED',
    });

    const result = await service.cancelOrderItem(orderItemId, {}, { permissions: ['ORDERS:WRITE'] });

    expect(result.status).toBe('CANCELLED');
    expect(vendorSubmissionPublic.getByOrderItemId).not.toHaveBeenCalled();
    expect(transitionService.transitionItemStatus).not.toHaveBeenCalled();
    expect(orderTimelineService.appendTimeline).not.toHaveBeenCalled();
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('rejects cancellation without state or timeline writes after vendor submission', async () => {
    const vendorSubmissionId = '660000000000000000000501';
    vendorSubmissionPublic.getByOrderItemId.mockResolvedValue({
      id: vendorSubmissionId,
      orderItemId,
      status: 'SUBMITTED',
    });

    await expect(service.cancelOrderItem(
      orderItemId,
      { reason: 'Buyer requested cancellation' },
      { permissions: ['ORDERS:WRITE'] },
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(transitionService.transitionItemStatus).not.toHaveBeenCalled();
    expect(orderTimelineService.appendTimeline).not.toHaveBeenCalled();
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
