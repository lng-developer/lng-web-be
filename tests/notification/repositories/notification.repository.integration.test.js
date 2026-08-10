const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const Notification = require('../../../src/modules/notification/models/notification.model');
const repository = require('../../../src/modules/notification/repositories/notification.repository');
const service = require('../../../src/modules/notification/services/notification.service');

const describeIfDb = process.env.RUN_DB_NOTIFICATION_TESTS === 'true' ? describe : describe.skip;
const ownerAccountId = '66a000000000000000000001';
const otherAccountId = '66a000000000000000000002';
const deduplicationKey = 'codex:test:notification:duplicate-replay:task-3';

describeIfDb('notification Mongo persistence', () => {
  beforeAll(async () => {
    await connectDatabase();
    await Notification.init();
    await Notification.deleteMany({
      recipientAccountId: { $in: [ownerAccountId, otherAccountId] },
      deduplicationKey,
    });
  });

  afterAll(async () => {
    await Notification.deleteMany({
      recipientAccountId: { $in: [ownerAccountId, otherAccountId] },
      deduplicationKey,
    });
    await disconnectDatabase();
  });

  test('Mongo uniqueness is recipient-scoped and recipient ownership protects read state', async () => {
    const payload = {
      recipientAccountId: ownerAccountId,
      type: 'LEAVE_APPROVED',
      title: 'Leave approved',
      message: 'Your leave was approved',
      relatedResource: { type: 'leaveRequest', id: '66b000000000000000000001' },
      deduplicationKey,
    };

    const created = await service.notify(payload);
    const replayed = await service.notify(payload);
    const otherRecipient = await service.notify({ ...payload, recipientAccountId: otherAccountId });
    const ownerInbox = await repository.listForRecipient({ recipientAccountId: ownerAccountId });
    const otherInbox = await repository.listForRecipient({ recipientAccountId: otherAccountId });

    expect(replayed.id).toBe(created.id);
    expect(otherRecipient.id).not.toBe(created.id);
    expect(ownerInbox.pagination.total).toBe(1);
    expect(ownerInbox.items).toHaveLength(1);
    expect(otherInbox.pagination.total).toBe(1);
    expect(otherInbox.items).toHaveLength(1);

    await expect(service.markRead(created.id, otherAccountId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(service.getUnreadCount(ownerAccountId)).resolves.toEqual({ unreadCount: 1 });

    await expect(service.markRead(created.id, ownerAccountId)).resolves.toMatchObject({
      id: created.id,
      readAt: expect.any(Date),
    });
    await expect(service.getUnreadCount(ownerAccountId)).resolves.toEqual({ unreadCount: 0 });
  });
});
