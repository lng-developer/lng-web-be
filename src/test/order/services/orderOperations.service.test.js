jest.mock('../../../modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  updateBuyer: jest.fn(),
  updateCaseStatus: jest.fn(),
  updateShippingService: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const orderRepository = require('../../../modules/order/repositories/order.repository');
const service = require('../../../modules/order/services/orderOperations.service');

describe('orderOperations.service', () => {
  const orderId = '660000000000000000000301';
  const shopId = '660000000000000000000201';

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
    orderRepository.updateCaseStatus.mockResolvedValue({ _id: orderId, shopId, caseStatus: 'OPEN' });
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

  test('updates case status', async () => {
    await service.updateCaseStatus(orderId, 'OPEN', { permissions: ['ORDERS:WRITE'] });

    expect(orderRepository.updateCaseStatus).toHaveBeenCalledWith(orderId, 'OPEN');
  });

  test('rejects out-of-scope update', async () => {
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.updateBuyer(orderId, { name: 'New Buyer' }, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(orderRepository.updateBuyer).not.toHaveBeenCalled();
  });
});
