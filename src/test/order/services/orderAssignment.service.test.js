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
  updateAssignedStaff: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));
jest.mock('../../../modules/audit/public', () => ({ record: jest.fn() }));

const authPublic = require('../../../modules/auth/public');
const orderRepository = require('../../../modules/order/repositories/order.repository');
const service = require('../../../modules/order/services/orderAssignment.service');
const auditPublic = require('../../../modules/audit/public');

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
    expect(orderRepository.updateAssignedStaff).toHaveBeenCalledWith(orderId, assignedStaffId, { session: mockSession });
    expect(result.assignedStaffId).toBe(assignedStaffId);
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_ASSIGNED', entityType: 'ORDER', entityId: orderId,
    }), { session: mockSession });
  });

  test('rejects out-of-scope assignment', async () => {
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.assignStaff(orderId, assignedStaffId, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(orderRepository.updateAssignedStaff).not.toHaveBeenCalled();
  });
});
