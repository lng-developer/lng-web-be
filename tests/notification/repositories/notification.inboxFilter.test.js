jest.mock('../../../src/modules/notification/models/notification.model', () => ({
  find: jest.fn(), countDocuments: jest.fn().mockResolvedValue(0), updateMany: jest.fn().mockResolvedValue({}),
}));
const Notification = require('../../../src/modules/notification/models/notification.model');
const repository = require('../../../src/modules/notification/repositories/notification.repository');

test('excludes chat history consistently from inbox, totals and mark-all-read', async () => {
  const query = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) };
  Notification.find.mockReturnValue(query);
  await repository.listForRecipient({ recipientAccountId: 'owner' });
  await repository.countUnreadForRecipient('owner');
  await repository.markAllReadForRecipient('owner', new Date());
  const filter = expect.objectContaining({ recipientAccountId: 'owner', type: { $nin: ['CHAT_MESSAGE', 'CHAT_MENTION'] } });
  expect(Notification.find).toHaveBeenCalledWith(filter);
  expect(Notification.countDocuments).toHaveBeenNthCalledWith(1, filter);
  expect(Notification.countDocuments).toHaveBeenNthCalledWith(2, filter);
  expect(Notification.updateMany).toHaveBeenCalledWith(filter, expect.any(Object));
});
