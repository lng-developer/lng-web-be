jest.mock('../../../src/modules/order/repositories/order.repository', () => ({ findById: jest.fn() }));
jest.mock('../../../src/modules/order/services/etsyOrderStatus.service', () => ({ assertCanFulfill: jest.fn() }));
jest.mock('../../../src/modules/order/services/amazonOrderStatus.service', () => ({ assertCanFulfill: jest.fn() }));

const orderRepo = require('../../../src/modules/order/repositories/order.repository');
const etsyStatus = require('../../../src/modules/order/services/etsyOrderStatus.service');
const amazonStatus = require('../../../src/modules/order/services/amazonOrderStatus.service');
const { assertMarketplaceAllowsFulfillment } = require('../../../src/modules/order/services/orderFulfillmentGuard.service');

beforeEach(() => {
  jest.clearAllMocks();
});

test('throws 404 if order is not found', async () => {
  orderRepo.findById.mockResolvedValue(null);
  await expect(assertMarketplaceAllowsFulfillment('unknown-order', 'item-1')).rejects.toThrow(/Order not found/i);
});

test('delegates to etsyOrderStatus.service when channel is ETSY', async () => {
  orderRepo.findById.mockResolvedValue({ _id: 'order-1', salesChannelCode: 'ETSY' });
  etsyStatus.assertCanFulfill.mockResolvedValue(undefined);

  await assertMarketplaceAllowsFulfillment('order-1', 'item-1');
  expect(etsyStatus.assertCanFulfill).toHaveBeenCalledWith('order-1', 'item-1');
  expect(amazonStatus.assertCanFulfill).not.toHaveBeenCalled();
});

test('delegates to amazonOrderStatus.service when channel is AMAZON', async () => {
  const order = { _id: 'order-2', salesChannelCode: 'AMAZON' };
  orderRepo.findById.mockResolvedValue(order);
  amazonStatus.assertCanFulfill.mockResolvedValue(undefined);

  await assertMarketplaceAllowsFulfillment('order-2', 'item-2');
  expect(amazonStatus.assertCanFulfill).toHaveBeenCalledWith('order-2', 'item-2', order);
  expect(etsyStatus.assertCanFulfill).not.toHaveBeenCalled();
});
