jest.mock('../../../src/modules/order/repositories/orderItem.repository', () => ({ listAllByOrder: jest.fn(), findById: jest.fn() }));
jest.mock('../../../src/modules/order/repositories/order.repository', () => ({ findById: jest.fn() }));
jest.mock('../../../src/modules/production/public', () => ({ listWorkbenchTaskSummariesByOrderItemIds: jest.fn() }));
jest.mock('../../../src/modules/vendorSubmission/public', () => ({ getByOrderItemId: jest.fn() }));
jest.mock('../../../src/modules/order/services/orderItemCancel.service', () => ({ cancelOrderItem: jest.fn() }));

const items = require('../../../src/modules/order/repositories/orderItem.repository');
const production = require('../../../src/modules/production/public');
const vendor = require('../../../src/modules/vendorSubmission/public');
const cancel = require('../../../src/modules/order/services/orderItemCancel.service');
const service = require('../../../src/modules/order/services/etsyOrderStatus.service');

const order = { _id: 'order', shopId: 'shop', salesChannelCode: 'ETSY', externalStatus: 'CANCELLED' };
beforeEach(() => {
  jest.clearAllMocks();
  items.listAllByOrder.mockResolvedValue([{ _id: 'item', status: 'CUSTOMIZATION_PARSED' }]);
  production.listWorkbenchTaskSummariesByOrderItemIds.mockResolvedValue([]);
  vendor.getByOrderItemId.mockResolvedValue(null);
});
test('full cancellation uses existing cancellation flow', async () => {
  expect(await service.reconcile(order)).toBe(true);
  expect(cancel.cancelOrderItem).toHaveBeenCalledWith('item', expect.any(Object), expect.objectContaining({ source: 'IMPORT' }));
});
test.each(['PARTIALLY_CANCELLED', 'CANCELLATION_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'])('%s requires review, not full cancellation', async (externalStatus) => {
  await expect(service.reconcile({ ...order, externalStatus })).rejects.toThrow(/review/i);
  expect(cancel.cancelOrderItem).not.toHaveBeenCalled();
});
test('preflights all items before cancelling any when vendor submission exists', async () => {
  items.listAllByOrder.mockResolvedValue([{ _id: 'one' }, { _id: 'two' }]);
  vendor.getByOrderItemId.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: 'SUBMITTED' });
  await expect(service.reconcile(order)).rejects.toThrow(/review/i);
  expect(cancel.cancelOrderItem).not.toHaveBeenCalled();
});
test('production task requires review', async () => {
  production.listWorkbenchTaskSummariesByOrderItemIds.mockResolvedValue([{ id: 'task' }]);
  await expect(service.reconcile(order)).rejects.toThrow(/review/i);
});
test('cancelled items stay terminal even on stale Completed reimport', async () => {
  items.listAllByOrder.mockResolvedValue([{ _id: 'item', status: 'CANCELLED' }]);
  expect(await service.reconcile({ ...order, externalStatus: 'Completed' })).toBe(true);
  expect(cancel.cancelOrderItem).not.toHaveBeenCalled();
});
test('other channels are untouched', async () => {
  expect(await service.reconcile({ ...order, salesChannelCode: 'AMAZON' })).toBe(false);
  expect(items.listAllByOrder).not.toHaveBeenCalled();
});
test.each(['CANCELLED', 'PARTIALLY_CANCELLED', 'CANCELLATION_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED'])('fulfillment guard blocks %s', async externalStatus => {
  require('../../../src/modules/order/repositories/order.repository').findById.mockResolvedValue({ ...order, externalStatus });
  await expect(service.assertCanFulfill('order')).rejects.toThrow(/review/i);
});
test('stale Completed source cannot make a cancelled item fulfillable', async () => {
  require('../../../src/modules/order/repositories/order.repository').findById.mockResolvedValue({ ...order, externalStatus: 'Completed' });
  items.findById.mockResolvedValue({ _id: 'item', orderId: 'order', status: 'CANCELLED' });
  await expect(service.assertCanFulfill('order', 'item')).rejects.toThrow(/review/i);
});
