const mockSession = {
  withTransaction: jest.fn(async (work) => work()),
  endSession: jest.fn(),
};
jest.mock('mongoose', () => ({
  ...jest.requireActual('mongoose'),
  startSession: jest.fn(async () => mockSession),
}));

jest.mock('../../../src/modules/order/repositories/order.repository', () => ({
  findById: jest.fn(),
  updateAssignedStaffIds: jest.fn(),
}));

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));
jest.mock('../../../src/modules/organization/public', () => ({
  listRoleAssignmentSource: jest.fn(),
}));
jest.mock('../../../src/modules/audit/public', () => ({ record: jest.fn() }));
jest.mock('../../../src/modules/notification/public', () => ({ notify: jest.fn() }));
jest.mock('../../../src/modules/order/services/orderWorkbenchProjection.service', () => ({
  updateOrderWorkbenchOrder: jest.fn(),
}));

const authPublic = require('../../../src/modules/auth/public');
const organizationPublic = require('../../../src/modules/organization/public');
const orderRepository = require('../../../src/modules/order/repositories/order.repository');
const service = require('../../../src/modules/order/services/orderAssignment.service');
const auditPublic = require('../../../src/modules/audit/public');
const notificationPublic = require('../../../src/modules/notification/public');
const projectionService = require('../../../src/modules/order/services/orderWorkbenchProjection.service');

describe('orderAssignment.service', () => {
  const orderId = '660000000000000000000301';
  const shopId = '660000000000000000000201';
  const assignedStaffId = '660000000000000000000901';
  const assignedStaffIds = [assignedStaffId];
  const updatedAt = new Date('2026-07-29T00:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepository.findById.mockResolvedValue({ _id: orderId, shopId, assignedStaffIds: [], updatedAt });
    orderRepository.updateAssignedStaffIds.mockResolvedValue({ _id: orderId, shopId, assignedStaffIds, updatedAt });
    authPublic.canAccessScope.mockReturnValue(true);
    organizationPublic.listRoleAssignmentSource.mockResolvedValue({
      teams: [{ id: '660000000000000000000401', code: 'SALE1' }],
      memberships: [{ accountId: assignedStaffId, teamId: '660000000000000000000401', status: 'active' }],
    });
    notificationPublic.notify.mockResolvedValue({ delivered: true, id: 'notification-1' });
  });

  test('assigns active SALE1 staff when caller has global order-assignment access', async () => {
    const result = await service.assignStaff(orderId, assignedStaffIds, { permissions: [], scopes: [] });

    expect(authPublic.canAccessScope).toHaveBeenCalledWith(expect.any(Object), 'ORDERS:ASSIGN', {
      scopeType: 'global',
      scopeId: null,
    });
    expect(orderRepository.updateAssignedStaffIds).toHaveBeenCalledWith(orderId, assignedStaffIds, {
      session: mockSession,
      expectedUpdatedAt: updatedAt,
    });
    expect(result.assignedStaffIds).toEqual(assignedStaffIds);
    expect(projectionService.updateOrderWorkbenchOrder).toHaveBeenCalledWith(orderId, {
      assignedStaffIds,
      'order.assignedStaffIds': assignedStaffIds,
    }, { source: 'ORDER_ASSIGNMENT', session: mockSession });
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

    await expect(service.assignStaff(orderId, assignedStaffIds, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(orderRepository.updateAssignedStaffIds).not.toHaveBeenCalled();
  });

  test('rejects an assignee outside the active SALE1 team', async () => {
    organizationPublic.listRoleAssignmentSource.mockResolvedValue({
      teams: [{ id: '660000000000000000000401', code: 'SALE1' }],
      memberships: [],
    });

    await expect(service.assignStaff(orderId, assignedStaffIds, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(orderRepository.updateAssignedStaffIds).not.toHaveBeenCalled();
  });

  test('does not audit an assignment that loses a concurrent order update', async () => {
    orderRepository.updateAssignedStaffIds.mockResolvedValueOnce(null);

    await expect(service.assignStaff(orderId, assignedStaffIds, { permissions: [], scopes: [] }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(auditPublic.record).not.toHaveBeenCalled();
    expect(projectionService.updateOrderWorkbenchOrder).not.toHaveBeenCalled();
  });
});
