jest.mock('../../../modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  updateAssignedStaff: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/notification/public', () => ({
  notify: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const notificationPublic = require('../../../modules/notification/public');
const orderRepository = require('../../../modules/order/repositories/order.repository');
const service = require('../../../modules/order/services/orderAssignment.service');

describe('orderAssignment.service', () => {
  const orderId = '660000000000000000000301';
  const shopId = '660000000000000000000201';
  const assignedStaffId = '660000000000000000000901';
  const updatedAt = new Date('2026-07-28T03:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepository.findById.mockResolvedValue({ _id: orderId, shopId });
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
    expect(orderRepository.updateAssignedStaff).toHaveBeenCalledWith(orderId, assignedStaffId);
    expect(notificationPublic.notify).toHaveBeenCalledWith({
      recipientAccountId: assignedStaffId,
      type: 'ORDER_ASSIGNED',
      title: 'Order assigned',
      message: 'You were assigned an order that needs processing.',
      relatedResource: { type: 'order', id: orderId },
      deduplicationKey: `ORDER_ASSIGNED:${orderId}:${assignedStaffId}:${updatedAt.toISOString()}`,
    });
    expect(result.assignedStaffId).toBe(assignedStaffId);
  });

  test('does not notify when an order is unassigned', async () => {
    orderRepository.updateAssignedStaff.mockResolvedValue({
      _id: orderId,
      shopId,
      assignedStaffId: null,
      updatedAt,
    });

    const result = await service.assignStaff(orderId, null, { permissions: [], scopes: [] });

    expect(notificationPublic.notify).not.toHaveBeenCalled();
    expect(result.assignedStaffId).toBeNull();
  });

  test('keeps a successful assignment when notification delivery fails', async () => {
    notificationPublic.notify.mockResolvedValue({ delivered: false, errorCode: 'INTERNAL_SERVER_ERROR' });

    await expect(service.assignStaff(orderId, assignedStaffId, { permissions: [], scopes: [] }))
      .resolves.toMatchObject({ assignedStaffId });
  });

  test('rejects out-of-scope assignment', async () => {
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.assignStaff(orderId, assignedStaffId, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(orderRepository.updateAssignedStaff).not.toHaveBeenCalled();
  });
});
