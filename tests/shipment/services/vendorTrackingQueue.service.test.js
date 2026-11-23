jest.mock('../../../src/config/queue', () => ({ createQueue: jest.fn() }));
jest.mock('../../../src/config/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../../src/modules/vendorSubmission/public', () => ({ listTrackingDiscoveryPage: jest.fn() }));
jest.mock('../../../src/modules/shipment/repositories/vendorTrackingPoll.repository', () => ({
  discover: jest.fn(), due: jest.fn(),
}));
const { getRedisClient } = require('../../../src/config/redis');
const { createQueue } = require('../../../src/config/queue');
const submissions = require('../../../src/modules/vendorSubmission/public');
const polls = require('../../../src/modules/shipment/repositories/vendorTrackingPoll.repository');
const queue = require('../../../src/modules/shipment/services/vendorTrackingQueue.service');

test('discovery persists candidates before queue delivery, lost notification is recoverable under the same job ID', async () => {
  const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() };
  getRedisClient.mockReturnValue(redis);
  submissions.listTrackingDiscoveryPage.mockResolvedValue({ ids: ['a'], afterId: 'a' });
  polls.due.mockResolvedValue([{ _id: 'a' }]);
  const add = jest.fn().mockRejectedValueOnce(new Error('redis unavailable')).mockResolvedValue({});
  createQueue.mockReturnValue({ add });
  await expect(queue.discoverAndEnqueue(1)).rejects.toThrow('redis unavailable');
  expect(polls.discover.mock.invocationCallOrder[0]).toBeLessThan(add.mock.invocationCallOrder[0]);
  await expect(queue.discoverAndEnqueue(1)).resolves.toMatchObject({ queued: 1, checked: 0 });
  expect(add.mock.calls[0]).toEqual(add.mock.calls[1]);
  expect(redis.set).toHaveBeenCalledWith(expect.any(String), 'a');
});
