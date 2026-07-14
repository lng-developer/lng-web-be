jest.mock('../../../modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../modules/order/services/orderItemStatusTransition.service', () => ({
  transitionItemStatus: jest.fn(),
}));

jest.mock('../../../modules/order/services/orderTimeline.service', () => ({
  appendTimeline: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

const orderItemRepository = require('../../../modules/order/repositories/orderItem.repository');
const transitionService = require('../../../modules/order/services/orderItemStatusTransition.service');
const orderTimelineService = require('../../../modules/order/services/orderTimeline.service');
const service = require('../../../modules/order/services/orderItemCancel.service');

describe('orderItemCancel.service', () => {
  const orderItemId = '660000000000000000000401';
  const orderId = '660000000000000000000301';
  const shopId = '660000000000000000000201';

  beforeEach(() => {
    jest.clearAllMocks();
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
    }));
  });
});
