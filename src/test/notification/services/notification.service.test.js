const mockState = {
  items: [],
  nextId: 1,
};

jest.mock('../../../modules/notification/repositories/notification.repository', () => ({
  async create(payload) {
    const duplicate = mockState.items.find((item) => (
      item.recipientAccountId === payload.recipientAccountId
      && item.deduplicationKey === payload.deduplicationKey
    ));
    if (duplicate) throw Object.assign(new Error('duplicate'), { code: 11000 });

    const item = {
      _id: `n${mockState.nextId}`,
      ...payload,
      readAt: null,
      createdAt: new Date(`2026-07-27T00:00:0${mockState.nextId}.000Z`),
      updatedAt: new Date(`2026-07-27T00:00:0${mockState.nextId}.000Z`),
    };
    mockState.nextId += 1;
    mockState.items.push(item);
    return item;
  },
  async findByDeduplicationKey(recipientAccountId, deduplicationKey) {
    return mockState.items.find((item) => (
      item.recipientAccountId === recipientAccountId
      && item.deduplicationKey === deduplicationKey
    )) || null;
  },
  async listForRecipient({ recipientAccountId, unreadOnly, page = 1, limit = 20 }) {
    const filtered = mockState.items
      .filter((item) => item.recipientAccountId === recipientAccountId)
      .filter((item) => !unreadOnly || item.readAt === null)
      .sort((left, right) => {
        if ((left.readAt === null) !== (right.readAt === null)) return left.readAt === null ? -1 : 1;
        return right.createdAt - left.createdAt;
      });
    const offset = (page - 1) * limit;
    return {
      items: filtered.slice(offset, offset + limit),
      pagination: { page, limit, total: filtered.length },
    };
  },
  async countUnreadForRecipient(recipientAccountId) {
    return mockState.items.filter((item) => (
      item.recipientAccountId === recipientAccountId && item.readAt === null
    )).length;
  },
  async markReadForRecipient(id, recipientAccountId, readAt) {
    const item = mockState.items.find((candidate) => (
      candidate._id === id && candidate.recipientAccountId === recipientAccountId
    ));
    if (!item) return null;
    item.readAt = item.readAt || readAt;
    item.updatedAt = readAt;
    return item;
  },
  async markAllReadForRecipient(recipientAccountId, readAt) {
    let modifiedCount = 0;
    mockState.items.forEach((item) => {
      if (item.recipientAccountId === recipientAccountId && item.readAt === null) {
        item.readAt = readAt;
        item.updatedAt = readAt;
        modifiedCount += 1;
      }
    });
    return { modifiedCount };
  },
}), { virtual: true });

const service = require('../../../modules/notification/services/notification.service');

const message = {
  recipientAccountId: 'a1',
  type: 'LEAVE_APPROVED',
  title: 'Leave approved',
  message: 'Your leave was approved',
  relatedResource: { type: 'leaveRequest', id: 'l1' },
  deduplicationKey: 'leave:l1:approved:a1',
};

describe('notification service', () => {
  beforeEach(() => {
    mockState.items.length = 0;
    mockState.nextId = 1;
  });

  test('replaying a recipient deduplication key preserves exactly one inbox item', async () => {
    const created = await service.notify(message);
    const replayed = await service.notify(message);
    const inbox = await service.listInbox('a1', {});

    expect(replayed.id).toBe(created.id);
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({
      id: created.id,
      type: 'LEAVE_APPROVED',
      readAt: null,
      relatedResource: { type: 'leaveRequest', id: 'l1' },
    });
  });

  test('unread list, count, mark-read and read-all reflect final recipient state', async () => {
    const first = await service.notify(message);
    const second = await service.notify({
      ...message,
      type: 'PAYROLL_FINALIZED',
      title: 'Payroll finalized',
      deduplicationKey: 'payroll:p1:finalized:a1',
    });

    await service.markRead(first.id, 'a1');

    await expect(service.getUnreadCount('a1')).resolves.toEqual({ unreadCount: 1 });
    await expect(service.listInbox('a1', { unreadOnly: true })).resolves.toMatchObject({
      items: [{ id: second.id, readAt: null }],
      pagination: { page: 1, limit: 20, total: 1 },
    });
    await expect(service.listInbox('a1', {})).resolves.toMatchObject({
      items: [{ id: second.id }, { id: first.id }],
      pagination: { total: 2 },
    });

    await expect(service.markAllRead('a1')).resolves.toEqual({ updatedCount: 1 });
    await expect(service.getUnreadCount('a1')).resolves.toEqual({ unreadCount: 0 });
  });

  test('an account cannot mark another recipient notification as read', async () => {
    const item = await service.notify(message);

    await expect(service.markRead(item.id, 'a2')).rejects.toMatchObject({
      statusCode: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(service.getUnreadCount('a1')).resolves.toEqual({ unreadCount: 1 });
  });
});
