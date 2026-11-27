jest.mock('../../../src/modules/order/repositories/order.repository', () => ({ findById: jest.fn() }));
jest.mock('../../../src/modules/order/repositories/orderItem.repository', () => ({ findById: jest.fn(), updateQuantity: jest.fn() }));
jest.mock('../../../src/modules/order/services/orderAccess.service', () => ({ assertCanWriteOrder: jest.fn(), personalSellerCode: jest.fn() }));
jest.mock('../../../src/modules/order/services/orderOperationAudit.service', () => ({
  withOrderOperation: jest.fn((work) => work({ transaction: true })), recordOrderOperation: jest.fn(),
}));
jest.mock('../../../src/modules/order/services/orderWorkbenchProjection.service', () => ({ updateOrderWorkbenchItem: jest.fn() }));
jest.mock('../../../src/modules/order/services/orderTimeline.service', () => ({ appendTimeline: jest.fn() }));
jest.mock('../../../src/modules/production/public', () => ({ syncOrderItemQuantity: jest.fn() }));
jest.mock('../../../src/modules/mapping/public', () => ({ syncOrderItemQuantity: jest.fn() }));
jest.mock('../../../src/modules/finance/public', () => ({ recalculateOrder: jest.fn() }));
jest.mock('../../../src/modules/vendorSubmission/public', () => ({ getByOrderItemId: jest.fn() }));

const repository = require('../../../src/modules/order/repositories/orderItem.repository');
const orders = require('../../../src/modules/order/repositories/order.repository');
const access = require('../../../src/modules/order/services/orderAccess.service');
const production = require('../../../src/modules/production/public');
const mapping = require('../../../src/modules/mapping/public');
const vendor = require('../../../src/modules/vendorSubmission/public');
const audit = require('../../../src/modules/order/services/orderOperationAudit.service');
const projection = require('../../../src/modules/order/services/orderWorkbenchProjection.service');
const timeline = require('../../../src/modules/order/services/orderTimeline.service');
const finance = require('../../../src/modules/finance/public');
const service = require('../../../src/modules/order/services/orderItemQuantity.service');

describe('manual order item quantity', () => {
  const itemId = '660000000000000000000401';
  const item = { _id: itemId, orderId: '660000000000000000000301', shopId: '660000000000000000000201',
    status: 'NEED_PRODUCTION', quantity: 1, updatedAt: new Date(), price: { itemPriceAmount: 2500 } };
  const payload = { quantity: 2, expectedQuantity: 1, reason: 'Buyer selected pack 2' };
  const auth = { accountId: '660000000000000000000101' };
  beforeEach(() => {
    jest.resetAllMocks();
    audit.withOrderOperation.mockImplementation((work) => work({ transaction: true }));
    repository.findById.mockResolvedValue(item);
    repository.updateQuantity.mockResolvedValue({ ...item, quantity: 2, quantityOverride: 2 });
    orders.findById.mockResolvedValue({ _id: item.orderId, status: 'PROCESSING', shopId: item.shopId });
    vendor.getByOrderItemId.mockResolvedValue(null);
  });
  test('updates order, production, costs, projection and history without changing paid price', async () => {
    const result = await service.updateQuantity(itemId, payload, auth);
    expect(result.price).toEqual(item.price);
    expect(access.assertCanWriteOrder).toHaveBeenCalledWith(expect.objectContaining({ _id: item.orderId }), auth);
    expect(repository.updateQuantity).toHaveBeenCalledWith(itemId, 2, expect.objectContaining({ expectedQuantity: 1, expectedUpdatedAt: item.updatedAt, session: { transaction: true } }));
    expect(production.syncOrderItemQuantity).toHaveBeenCalledWith(itemId, 2, { session: { transaction: true } });
    expect(mapping.syncOrderItemQuantity).toHaveBeenCalledWith(itemId, 2, { session: { transaction: true } });
    expect(projection.updateOrderWorkbenchItem).toHaveBeenCalledWith(item.orderId, itemId, { 'item.quantity': 2 }, expect.objectContaining({ session: { transaction: true } }));
    expect(timeline.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({ metadata: { previousQuantity: 1, quantity: 2, reason: payload.reason } }), { session: { transaction: true } });
    expect(audit.recordOrderOperation).toHaveBeenCalledWith(expect.objectContaining({ action: 'ORDER_ITEM_QUANTITY_UPDATED', session: { transaction: true } }));
  });
  test('denies inaccessible orders before any mutation', async () => {
    access.assertCanWriteOrder.mockRejectedValue(new Error('Forbidden'));
    await expect(service.updateQuantity(itemId, payload, auth)).rejects.toThrow('Forbidden');
    expect(repository.updateQuantity).not.toHaveBeenCalled();
  });
  test('denies another seller item even when the parent order is writable', async () => {
    access.personalSellerCode.mockResolvedValue('J2503');
    repository.findById.mockResolvedValue({ ...item, sku: 'J9999-ACO-091126-234' });
    await expect(service.updateQuantity(itemId, payload, auth)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.updateQuantity).not.toHaveBeenCalled();
  });
  test.each(['READY_TO_SEND_VENDOR', 'SENT_TO_VENDOR', 'TRACKING_PENDING', 'SHIPPED', 'CANCELLED', 'REFUNDED', 'FAILED'])('blocks %s items', async (status) => {
    repository.findById.mockResolvedValue({ ...item, status });
    await expect(service.updateQuantity(itemId, payload, auth)).rejects.toMatchObject({ statusCode: 409 });
    expect(repository.updateQuantity).not.toHaveBeenCalled();
  });
  test.each(['PENDING', 'SUBMITTING', 'SUBMITTED', 'FAILED', 'NEEDS_REVIEW'])('blocks existing %s vendor payloads', async (status) => {
    vendor.getByOrderItemId.mockResolvedValue({ status });
    await expect(service.updateQuantity(itemId, payload, auth)).rejects.toMatchObject({ statusCode: 409 });
    expect(repository.updateQuantity).not.toHaveBeenCalled();
  });
  test('rejects stale browser quantity', async () => {
    await expect(service.updateQuantity(itemId, { ...payload, expectedQuantity: 3 }, auth)).rejects.toMatchObject({ statusCode: 409 });
    expect(repository.updateQuantity).not.toHaveBeenCalled();
  });
  test('rejects concurrent database changes', async () => {
    repository.updateQuantity.mockResolvedValue(null);
    await expect(service.updateQuantity(itemId, payload, auth)).rejects.toMatchObject({ statusCode: 409 });
    expect(production.syncOrderItemQuantity).not.toHaveBeenCalled();
  });
  test('does not swallow production synchronization failures', async () => {
    production.syncOrderItemQuantity.mockRejectedValue(new Error('Concurrent vendor dispatch'));
    await expect(service.updateQuantity(itemId, payload, auth)).rejects.toThrow('Concurrent vendor dispatch');
    expect(audit.recordOrderOperation).not.toHaveBeenCalled();
  });
  test('reports committed quantity explicitly when finance recalculation fails', async () => {
    finance.recalculateOrder.mockRejectedValue(new Error('Finance unavailable'));
    await expect(service.updateQuantity(itemId, payload, auth)).rejects.toMatchObject({
      statusCode: 503, details: { quantitySaved: true },
    });
    expect(audit.recordOrderOperation).toHaveBeenCalled();
  });
});
