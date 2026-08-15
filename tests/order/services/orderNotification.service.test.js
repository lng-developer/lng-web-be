jest.mock('../../../src/modules/notification/public', () => ({
  notifyMany: jest.fn(),
}));

const notificationPublic = require('../../../src/modules/notification/public');
const service = require('../../../src/modules/order/services/orderNotification.service');

describe('orderNotification.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    notificationPublic.notifyMany.mockResolvedValue([{ delivered: true }]);
  });

  test('notifies assigned staff except the acting account', async () => {
    await service.notifyAssignedStaff({
      order: {
        _id: '660000000000000000000301',
        assignedStaffIds: ['660000000000000000000901', '660000000000000000000902', '660000000000000000000902'],
      },
      actorAccountId: '660000000000000000000901',
      type: 'ORDER_CASE_CREATED',
      title: 'Order case opened',
      message: 'A case was opened for an assigned order.',
      deduplicationScope: 'case-1',
    });

    expect(notificationPublic.notifyMany).toHaveBeenCalledWith(expect.objectContaining({
      recipientAccountIds: ['660000000000000000000902'],
      type: 'ORDER_CASE_CREATED',
      relatedResource: { type: 'order', id: '660000000000000000000301' },
      deduplicationKeyPrefix: 'ORDER_CASE_CREATED:660000000000000000000301:case-1',
    }));
  });

  test('skips notification when there is no recipient', async () => {
    await service.notifyAssignedStaff({
      order: { _id: '660000000000000000000301', assignedStaffIds: ['660000000000000000000901'] },
      actorAccountId: '660000000000000000000901',
      type: 'ORDER_CASE_CREATED',
      title: 'Order case opened',
      message: 'A case was opened for an assigned order.',
    });

    expect(notificationPublic.notifyMany).not.toHaveBeenCalled();
  });
});
