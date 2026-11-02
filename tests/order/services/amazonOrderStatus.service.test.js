jest.mock('../../../src/modules/order/repositories/orderItem.repository', () => ({ listAllByOrder: jest.fn(), findById: jest.fn() }));
jest.mock('../../../src/modules/order/repositories/order.repository', () => ({ findById: jest.fn() }));
jest.mock('../../../src/modules/vendorSubmission/public', () => ({ getByOrderItemId: jest.fn() }));
jest.mock('../../../src/modules/order/services/orderItemCancel.service', () => ({ cancelOrderItem: jest.fn() }));
jest.mock('../../../src/modules/order/services/orderCase.service', () => ({ ensureOpenOrderCase: jest.fn() }));

const items = require('../../../src/modules/order/repositories/orderItem.repository');
const vendor = require('../../../src/modules/vendorSubmission/public');
const cancel = require('../../../src/modules/order/services/orderItemCancel.service');
const orderCase = require('../../../src/modules/order/services/orderCase.service');
const service = require('../../../src/modules/order/services/amazonOrderStatus.service');

const order = { _id: 'order', shopId: 'shop', salesChannelCode: 'AMAZON', externalStatus: 'CANCELLED' };

beforeEach(() => {
  jest.clearAllMocks();
  items.listAllByOrder.mockResolvedValue([{ _id: 'item', status: 'CUSTOMIZATION_PARSED' }]);
  vendor.getByOrderItemId.mockResolvedValue(null);
});

test('full cancellation on Amazon cancels active items using existing cancellation flow', async () => {
  expect(await service.reconcile(order)).toBe(true);
  expect(cancel.cancelOrderItem).toHaveBeenCalledWith('item', expect.any(Object), expect.objectContaining({ source: 'IMPORT' }));
});

test('opens order case if items already submitted to vendor', async () => {
  vendor.getByOrderItemId.mockResolvedValue({ status: 'SUBMITTED' });
  expect(await service.reconcile(order)).toBe(false);
  expect(cancel.cancelOrderItem).not.toHaveBeenCalled();
  expect(orderCase.ensureOpenOrderCase).toHaveBeenCalledWith(
    expect.objectContaining({
      orderId: 'order',
      caseType: 'OTHER',
      severity: 'HIGH',
    }),
    expect.any(Object),
  );
});

test('opens order case if item status is past cancellable', async () => {
  items.listAllByOrder.mockResolvedValue([{ _id: 'item', status: 'SHIPPED' }]);
  expect(await service.reconcile(order)).toBe(false);
  expect(cancel.cancelOrderItem).not.toHaveBeenCalled();
  expect(orderCase.ensureOpenOrderCase).toHaveBeenCalled();
});

test('cancelled items stay terminal even on subsequent reimport', async () => {
  items.listAllByOrder.mockResolvedValue([{ _id: 'item', status: 'CANCELLED' }]);
  expect(await service.reconcile({ ...order, externalStatus: 'SHIPPED' })).toBe(true);
  expect(cancel.cancelOrderItem).not.toHaveBeenCalled();
});

test('other channels are untouched', async () => {
  expect(await service.reconcile({ ...order, salesChannelCode: 'ETSY' })).toBe(false);
  expect(items.listAllByOrder).not.toHaveBeenCalled();
});

test.each(['CANCELLED', 'CANCELED', 'PARTIALLY_CANCELLED', 'CANCELLATION_PENDING'])('fulfillment guard blocks %s', async (externalStatus) => {
  require('../../../src/modules/order/repositories/order.repository').findById.mockResolvedValue({ ...order, externalStatus });
  await expect(service.assertCanFulfill('order')).rejects.toThrow(/Amazon cancellation requires manual review/i);
});

test('fulfillment guard blocks when paymentStatus is REFUNDED', async () => {
  require('../../../src/modules/order/repositories/order.repository').findById.mockResolvedValue({ ...order, externalStatus: 'SHIPPED', paymentStatus: 'REFUNDED' });
  await expect(service.assertCanFulfill('order')).rejects.toThrow(/Amazon cancellation requires manual review/i);
});

test('fulfillment guard blocks when order item status is CANCELLED', async () => {
  require('../../../src/modules/order/repositories/order.repository').findById.mockResolvedValue({ ...order, externalStatus: 'SHIPPED' });
  items.findById.mockResolvedValue({ _id: 'item', orderId: 'order', status: 'CANCELLED' });
  await expect(service.assertCanFulfill('order', 'item')).rejects.toThrow(/Amazon cancellation requires manual review/i);
});
