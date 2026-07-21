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

jest.mock('../../../modules/production/public', () => ({
  syncCsNoteFromOrderItem: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const orderRepository = require('../../../modules/order/repositories/order.repository');
const orderItemRepository = require('../../../modules/order/repositories/orderItem.repository');
const productionPublic = require('../../../modules/production/public');
const service = require('../../../modules/order/services/orderOperations.service');

describe('orderOperations.service', () => {
  const orderId = '660000000000000000000301';
  const shopId = '660000000000000000000201';
  const orderItemId = '660000000000000000000401';

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
    });
    expect(result.buyer.name).toBe('New Buyer');
  });

  test('updates shipping service', async () => {
    await service.updateShippingService(orderId, { level: 'Express' }, { permissions: ['ORDERS:WRITE'] });

    expect(orderRepository.updateShippingService).toHaveBeenCalledWith(orderId, { level: 'Express', name: 'Std US' });
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
