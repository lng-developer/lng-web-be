jest.mock('../../src/modules/notification/services/notification.service', () => ({
  notify: jest.fn(),
}));

jest.mock('../../src/shared/utils/logger', () => ({
  warn: jest.fn(),
}));

const service = require('../../src/modules/notification/services/notification.service');
const notificationPublic = require('../../src/modules/notification/public');

const message = {
  recipientAccountId: 'a1',
  type: 'LEAVE_APPROVED',
  title: 'Leave approved',
  message: 'Your leave was approved',
  relatedResource: { type: 'leaveRequest', id: 'l1' },
  deduplicationKey: 'leave:l1:approved:a1',
};

describe('notification public port', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns a delivery result for a created inbox item', async () => {
    service.notify.mockResolvedValue({ id: 'n1' });
    await expect(notificationPublic.notify(message)).resolves.toEqual({ delivered: true, id: 'n1' });
  });

  test('turns a normal persistence failure into a non-throwing correlated result', async () => {
    service.notify.mockRejectedValue(Object.assign(new Error('database unavailable'), { code: 'DB_UNAVAILABLE' }));

    await expect(notificationPublic.notify({
      ...message,
      correlationId: 'leave-l1',
    })).resolves.toEqual({
      delivered: false,
      errorCode: 'DB_UNAVAILABLE',
      correlationId: 'leave-l1',
    });
  });

  test('does not throw while reporting a failure for an absent payload', async () => {
    service.notify.mockRejectedValue(Object.assign(new Error('invalid payload'), { code: 'VALIDATION_ERROR' }));

    await expect(notificationPublic.notify()).resolves.toEqual({
      delivered: false,
      errorCode: 'VALIDATION_ERROR',
      correlationId: null,
    });
  });

  test('notifies unique recipients with stable recipient deduplication keys', async () => {
    service.notify.mockImplementation(async (payload) => ({ id: `notification-${payload.recipientAccountId}` }));

    await expect(notificationPublic.notifyMany({
      recipientAccountIds: ['a1', 'a2', 'a1'],
      type: 'ANNOUNCEMENT',
      title: 'Policy update',
      message: 'Please review the updated policy',
      relatedResource: { type: 'announcement', id: 'announcement-1' },
      deduplicationKeyPrefix: 'announcement:announcement-1',
    })).resolves.toEqual([
      { delivered: true, id: 'notification-a1' },
      { delivered: true, id: 'notification-a2' },
    ]);
  });

  test.each([
    undefined,
    { recipientAccountIds: 'a1', deduplicationKeyPrefix: 'announcement:a1' },
  ])('returns an empty best-effort batch for a non-array recipient input', async (payload) => {
    await expect(notificationPublic.notifyMany(payload)).resolves.toEqual([]);
  });
});
