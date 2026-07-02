jest.mock('../../../modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  updateAssignedStaff: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const orderRepository = require('../../../modules/order/repositories/order.repository');
const service = require('../../../modules/order/services/orderAssignment.service');

describe('orderAssignment.service', () => {
  const orderId = '660000000000000000000301';
  const shopId = '660000000000000000000201';
  const assignedStaffId = '660000000000000000000901';

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepository.findById.mockResolvedValue({ _id: orderId, shopId });
    orderRepository.updateAssignedStaff.mockResolvedValue({ _id: orderId, shopId, assignedStaffId });
    authPublic.canAccessScope.mockReturnValue(true);
  });

  test('assigns staff when caller has scoped order write access', async () => {
    const result = await service.assignStaff(orderId, assignedStaffId, { permissions: [], scopes: [] });

    expect(authPublic.canAccessScope).toHaveBeenCalledWith(expect.any(Object), 'ORDERS:WRITE', {
      scopeType: 'shop',
      scopeId: shopId,
    });
    expect(orderRepository.updateAssignedStaff).toHaveBeenCalledWith(orderId, assignedStaffId);
    expect(result.assignedStaffId).toBe(assignedStaffId);
  });

  test('rejects out-of-scope assignment', async () => {
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.assignStaff(orderId, assignedStaffId, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(orderRepository.updateAssignedStaff).not.toHaveBeenCalled();
  });
});
