jest.mock('../../../modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
  updateStatus: jest.fn(),
}));

const orderItemRepository = require('../../../modules/order/repositories/orderItem.repository');
const service = require('../../../modules/order/services/orderItemStatusTransition.service');
const orderPublic = require('../../../modules/order/public');

describe('orderItemStatusTransition.service', () => {
  const orderItemId = '660000000000000000000401';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('allows valid transitions', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      status: 'CUSTOMIZATION_PENDING',
    });
    orderItemRepository.updateStatus.mockResolvedValue({
      _id: orderItemId,
      status: 'CUSTOMIZATION_PARSED',
    });

    const result = await service.transitionItemStatus(orderItemId, 'CUSTOMIZATION_PARSED', {
      source: 'TEST',
    });

    expect(orderItemRepository.updateStatus).toHaveBeenCalledWith(orderItemId, 'CUSTOMIZATION_PARSED');
    expect(result.status).toBe('CUSTOMIZATION_PARSED');
  });

  test('rejects invalid jumps', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      status: 'CUSTOMIZATION_PENDING',
    });

    await expect(service.transitionItemStatus(orderItemId, 'READY_TO_SEND_VENDOR', {
      source: 'TEST',
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
      details: {
        fromStatus: 'CUSTOMIZATION_PENDING',
        targetStatus: 'READY_TO_SEND_VENDOR',
      },
    });
    expect(orderItemRepository.updateStatus).not.toHaveBeenCalled();
  });

  test('rejects transitions from terminal statuses', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      status: 'SHIPPED',
    });

    await expect(service.transitionItemStatus(orderItemId, 'TRACKING_PENDING')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(orderItemRepository.updateStatus).not.toHaveBeenCalled();
  });

  test('same status transition is idempotent', async () => {
    const item = {
      _id: orderItemId,
      status: 'NEED_PRODUCTION',
    };
    orderItemRepository.findById.mockResolvedValue(item);

    const result = await service.transitionItemStatus(orderItemId, 'NEED_PRODUCTION');

    expect(result).toBe(item);
    expect(orderItemRepository.updateStatus).not.toHaveBeenCalled();
  });

  test('public updateItemStatus compatibility alias enforces transition rules', async () => {
    orderItemRepository.findById.mockResolvedValue({
      _id: orderItemId,
      status: 'CUSTOMIZATION_PENDING',
    });

    await expect(orderPublic.updateItemStatus(orderItemId, 'READY_TO_SEND_VENDOR')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(orderItemRepository.updateStatus).not.toHaveBeenCalled();
  });
});
