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
jest.mock('../../../modules/notification/public', () => ({ notify: jest.fn() }));

const authPublic = require('../../../modules/auth/public');
const orderRepository = require('../../../modules/order/repositories/order.repository');
const service = require('../../../modules/order/services/orderAssignment.service');
const auditPublic = require('../../../modules/audit/public');
const notificationPublic = require('../../../modules/notification/public');

describe('orderAssignment.service', () => {
  const orderId = '660000000000000000000301';
  const shopId = '660000000000000000000201';
  const assignedStaffId = '660000000000000000000901';
  const updatedAt = new Date('2026-07-29T00:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepository.findById.mockResolvedValue({ _id: orderId, shopId, assignedStaffId: null, updatedAt });
    orderRepository.updateAssignedStaff.mockResolvedValue({ _id: orderId, shopId, assignedStaffId, updatedAt });
    authPublic.canAccessScope.mockReturnValue(true);
    notificationPublic.notify.mockResolvedValue({ delivered: true, id: 'notification-1' });
  });

  test('assigns staff when caller has scoped order write access', async () => {
    const result = await service.assignStaff(orderId, assignedStaffId, { permissions: [], scopes: [] });

    expect(authPublic.canAccessScope).toHaveBeenCalledWith(expect.any(Object), 'ORDERS:WRITE', {
      scopeType: 'shop',
      scopeId: shopId,
    });
    expect(orderRepository.updateAssignedStaff).toHaveBeenCalledWith(orderId, assignedStaffId, {
      session: mockSession,
      expectedUpdatedAt: updatedAt,
    });
    expect(result.assignedStaffId).toBe(assignedStaffId);
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_ASSIGNED', entityType: 'ORDER', entityId: orderId,
    }), { session: mockSession });
    expect(notificationPublic.notify).toHaveBeenCalledWith(expect.objectContaining({
      recipientAccountId: assignedStaffId,
      type: 'ORDER_ASSIGNED',
      relatedResource: { type: 'order', id: orderId },
    }));
  });

  test('rejects out-of-scope assignment', async () => {
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.assignStaff(orderId, assignedStaffId, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(orderRepository.updateAssignedStaff).not.toHaveBeenCalled();
  });

  test('does not audit an assignment that loses a concurrent order update', async () => {
    orderRepository.updateAssignedStaff.mockResolvedValueOnce(null);

    await expect(service.assignStaff(orderId, assignedStaffId, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(auditPublic.record).not.toHaveBeenCalled();
  });
});
