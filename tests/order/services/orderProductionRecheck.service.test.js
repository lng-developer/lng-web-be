jest.mock('../../../src/modules/production/public', () => ({
  createOrRecheckTaskForOrderItem: jest.fn(),
}));
jest.mock('../../../src/shared/utils/logger', () => ({
  warn: jest.fn(),
}));
jest.mock('../../../src/modules/order/repositories/orderItem.repository', () => ({
  listAllByOrder: jest.fn(),
}));

const productionPublic = require('../../../src/modules/production/public');
const logger = require('../../../src/shared/utils/logger');
const orderItemRepository = require('../../../src/modules/order/repositories/orderItem.repository');
const service = require('../../../src/modules/order/services/orderProductionRecheck.service');

describe('orderProductionRecheck.service', () => {
  const orderId = '660000000000000000000301';
  const firstItemId = '660000000000000000000401';
  const secondItemId = '660000000000000000000402';

  beforeEach(() => {
    jest.clearAllMocks();
    orderItemRepository.listAllByOrder.mockResolvedValue([
      { _id: firstItemId },
      { _id: secondItemId },
    ]);
    productionPublic.createOrRecheckTaskForOrderItem.mockResolvedValue({ id: 'task-1' });
  });

  test('rechecks production for every order item with unblock source', async () => {
    const result = await service.recheckProductionForOrder(orderId, { accountId: 'actor-1' }, 'ORDER_CASE_RESOLVED');

    expect(result).toEqual({ checked: 2, rechecked: 2, failed: 0 });
    expect(productionPublic.createOrRecheckTaskForOrderItem).toHaveBeenCalledWith(firstItemId, expect.objectContaining({
      accountId: 'actor-1',
      system: true,
      source: 'ORDER_CASE_RESOLVED',
    }));
    expect(productionPublic.createOrRecheckTaskForOrderItem).toHaveBeenCalledWith(secondItemId, expect.objectContaining({
      source: 'ORDER_CASE_RESOLVED',
    }));
  });

  test('keeps unblock action successful when one production recheck fails', async () => {
    productionPublic.createOrRecheckTaskForOrderItem
      .mockResolvedValueOnce({ id: 'task-1' })
      .mockRejectedValueOnce(new Error('Plan is not ready'));

    const result = await service.recheckProductionForOrder(orderId, {}, 'ADDRESS_OVERRIDDEN');

    expect(result).toEqual({ checked: 2, rechecked: 1, failed: 1 });
    expect(logger.warn).toHaveBeenCalledWith('Production recheck after order unblock skipped', expect.objectContaining({
      orderId,
      orderItemId: secondItemId,
      source: 'ADDRESS_OVERRIDDEN',
    }));
  });
});
