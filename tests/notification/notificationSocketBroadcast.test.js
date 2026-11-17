const notificationEvents = require('../../src/modules/notification/events');
const notificationService = require('../../src/modules/notification/services/notification.service');
const repository = require('../../src/modules/notification/repositories/notification.repository');

jest.mock('../../src/modules/notification/repositories/notification.repository');

describe('Notification Realtime Socket Broadcast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    notificationEvents.removeAllListeners();
  });

  it('emits notification.created event when a new notification is successfully created', async () => {
    const rawNoti = {
      _id: '507f1f77bcf86cd799439011',
      recipientAccountId: '507f1f77bcf86cd799439012',
      type: 'ORDER_TRACKING_OVERDUE',
      title: 'Order tracking overdue',
      message: 'Order 111-222-333 is past shipByDate',
      relatedResource: { type: 'order', id: 'order-1' },
      deduplicationKey: 'ORDER_TRACKING_OVERDUE:order-1:staff-1:2026-11-17',
      readAt: null,
      createdAt: new Date('2026-11-17T10:00:00Z'),
      updatedAt: new Date('2026-11-17T10:00:00Z'),
    };

    repository.create.mockResolvedValue(rawNoti);

    const emittedEvents = [];
    notificationEvents.on('notification.created', (event) => {
      emittedEvents.push(event);
    });

    const result = await notificationService.notify({
      recipientAccountId: '507f1f77bcf86cd799439012',
      type: 'ORDER_TRACKING_OVERDUE',
      title: 'Order tracking overdue',
      message: 'Order 111-222-333 is past shipByDate',
    });

    expect(result.id).toBe('507f1f77bcf86cd799439011');
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0].id).toBe('507f1f77bcf86cd799439011');
    expect(emittedEvents[0].recipientAccountId).toBe('507f1f77bcf86cd799439012');
    expect(emittedEvents[0].type).toBe('ORDER_TRACKING_OVERDUE');
  });

  it('does NOT emit notification.created when notification is deduplicated (duplicate key 11000)', async () => {
    const duplicateError = new Error('Duplicate key');
    duplicateError.code = 11000;
    repository.create.mockRejectedValue(duplicateError);

    const existingNoti = {
      _id: '507f1f77bcf86cd799439011',
      recipientAccountId: '507f1f77bcf86cd799439012',
      type: 'ORDER_TRACKING_OVERDUE',
      title: 'Order tracking overdue',
      message: 'Order 111-222-333 is past shipByDate',
      relatedResource: { type: 'order', id: 'order-1' },
      deduplicationKey: 'ORDER_TRACKING_OVERDUE:order-1:staff-1:2026-11-17',
      readAt: null,
      createdAt: new Date('2026-11-17T10:00:00Z'),
      updatedAt: new Date('2026-11-17T10:00:00Z'),
    };
    repository.findByDeduplicationKey.mockResolvedValue(existingNoti);

    const emittedEvents = [];
    notificationEvents.on('notification.created', (event) => {
      emittedEvents.push(event);
    });

    const result = await notificationService.notify({
      recipientAccountId: '507f1f77bcf86cd799439012',
      type: 'ORDER_TRACKING_OVERDUE',
      title: 'Order tracking overdue',
      message: 'Order 111-222-333 is past shipByDate',
      deduplicationKey: 'ORDER_TRACKING_OVERDUE:order-1:staff-1:2026-11-17',
    });

    expect(result.id).toBe('507f1f77bcf86cd799439011');
    expect(emittedEvents.length).toBe(0);
  });
});
