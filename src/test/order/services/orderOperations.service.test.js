const mockSession = {
  withTransaction: jest.fn(async (work) => work()),
  endSession: jest.fn(),
};
jest.mock('mongoose', () => ({
  ...jest.requireActual('mongoose'),
  startSession: jest.fn(async () => mockSession),
}));

jest.mock('../../../modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  updateBuyer: jest.fn(),
  updateShippingService: jest.fn(),
}));

jest.mock('../../../modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
  updateCsNote: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));
jest.mock('../../../modules/audit/public', () => ({ record: jest.fn() }));

jest.mock('../../../modules/production/public', () => ({
  syncCsNoteFromOrderItem: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const orderRepository = require('../../../modules/order/repositories/order.repository');
const orderItemRepository = require('../../../modules/order/repositories/orderItem.repository');
const productionPublic = require('../../../modules/production/public');
const service = require('../../../modules/order/services/orderOperations.service');
const auditPublic = require('../../../modules/audit/public');

describe('orderOperations.service', () => {
  const orderId = '660000000000000000000301';
  const shopId = '660000000000000000000201';
  const orderItemId = '660000000000000000000401';
  const updatedAt = new Date('2026-07-29T00:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    orderRepository.findById.mockResolvedValue({
      _id: orderId,
      shopId,
      status: 'IMPORTED',
      caseStatus: 'NONE',
      buyer: { name: 'Old Buyer', emailMasked: 'old@example.test' },
      shippingService: { level: 'Standard', name: 'Std US' },
      updatedAt,
    });
    orderRepository.updateBuyer.mockResolvedValue({ _id: orderId, shopId, buyer: { name: 'New Buyer' } });
    orderRepository.updateShippingService.mockResolvedValue({ _id: orderId, shopId, shippingService: { level: 'Express' } });
    orderItemRepository.findById.mockResolvedValue({ _id: orderItemId, orderId, shopId });
    orderItemRepository.updateCsNote.mockResolvedValue({
      _id: orderItemId,
      orderId,
      shopId,
      csNote: 'Ask customer to confirm the photo',
    });
    productionPublic.syncCsNoteFromOrderItem.mockResolvedValue(null);
  });

  test('updates buyer when caller has scoped write access', async () => {
    const result = await service.updateBuyer(orderId, { name: 'New Buyer' }, { permissions: [], scopes: [] });

    expect(authPublic.canAccessScope).toHaveBeenCalledWith(expect.any(Object), 'ORDERS:WRITE', {
      scopeType: 'shop',
      scopeId: shopId,
    });
    expect(orderRepository.updateBuyer).toHaveBeenCalledWith(orderId, {
      name: 'New Buyer',
      emailMasked: 'old@example.test',
    }, { session: mockSession, expectedUpdatedAt: updatedAt });
    expect(result.buyer.name).toBe('New Buyer');
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_CUSTOMER_UPDATED', changes: { fields: ['name'] },
    }), { session: mockSession });
  });

  test('updates shipping service', async () => {
    await service.updateShippingService(orderId, { level: 'Express' }, { permissions: ['ORDERS:WRITE'] });

    expect(orderRepository.updateShippingService).toHaveBeenCalledWith(
      orderId, { level: 'Express', name: 'Std US' }, { session: mockSession, expectedUpdatedAt: updatedAt },
    );
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_SHIPPING_SERVICE_UPDATED', changes: { fields: ['level'] },
    }), { session: mockSession });
  });

  test('does not expose a direct case status writer', () => {
    expect(service.updateCaseStatus).toBeUndefined();
  });

  test('rejects out-of-scope update', async () => {
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.updateBuyer(orderId, { name: 'New Buyer' }, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(orderRepository.updateBuyer).not.toHaveBeenCalled();
  });

  test.each([
    ['buyer', () => service.updateBuyer(orderId, { name: 'New Buyer' }, { permissions: ['ORDERS:WRITE'] })],
    ['shipping service', () => service.updateShippingService(orderId, { level: 'Express' }, { permissions: ['ORDERS:WRITE'] })],
  ])('does not audit a %s update that loses a concurrent order update', async (_field, execute) => {
    orderRepository.updateBuyer.mockResolvedValueOnce(null);
    orderRepository.updateShippingService.mockResolvedValueOnce(null);

    await expect(execute()).rejects.toMatchObject({ statusCode: 409 });
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('updates CS note on an order item within the caller shop scope', async () => {
    const result = await service.updateOrderItemCsNote(
      orderItemId,
      'Ask customer to confirm the photo',
      { permissions: [], scopes: [] },
    );

    expect(authPublic.canAccessScope).toHaveBeenCalledWith(expect.any(Object), 'ORDERS:WRITE', {
      scopeType: 'shop',
      scopeId: shopId,
    });
    expect(orderItemRepository.updateCsNote).toHaveBeenCalledWith(
      orderItemId,
      'Ask customer to confirm the photo',
    );
    expect(result.csNote).toBe('Ask customer to confirm the photo');
    expect(productionPublic.syncCsNoteFromOrderItem).toHaveBeenCalledWith(
      orderItemId,
      'Ask customer to confirm the photo',
      expect.any(Object),
    );
  });
});
