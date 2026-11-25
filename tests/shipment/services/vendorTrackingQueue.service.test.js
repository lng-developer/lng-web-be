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


beforeEach(() => {
  jest.clearAllMocks();
  getRedisClient.mockReturnValue({ get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() });
  submissions.listTrackingDiscoveryPage.mockResolvedValue({ ids: ['a'], afterId: 'a' });
  polls.due.mockImplementation(async (limit, now, provider) => provider ? [{ _id: provider }] : []);
});
afterEach(() => queue.closeVendorTrackingQueue());
test('each provider gets its own bounded queue after durable discovery', async () => {
  const add = jest.fn().mockResolvedValue({});
  createQueue.mockReturnValue({ add, close: jest.fn() });
  const result = await queue.discoverAndEnqueue(50);
  expect(result).toMatchObject({ queued: 6, failedProviders: [] });
  expect(createQueue).toHaveBeenCalledWith('vendor-tracking-lng_group');
  expect(createQueue).toHaveBeenCalledWith('vendor-tracking-mangotee');
  expect(polls.due).toHaveBeenCalledWith(50, expect.any(Date), 'MANGOTEE');
  expect(polls.discover.mock.invocationCallOrder[0]).toBeLessThan(add.mock.invocationCallOrder[0]);
});
test('one failed provider does not block the others; retry preserves job ID', async () => {
  const add = jest.fn().mockRejectedValueOnce(new Error('redis unavailable')).mockResolvedValue({});
  createQueue.mockReturnValue({ add, close: jest.fn() });
  expect(await queue.discoverAndEnqueue(1)).toMatchObject({ queued: 5, failedProviders: ['LNG_GROUP'] });
  await queue.discoverAndEnqueue(1);
  expect(add.mock.calls[0]).toEqual(add.mock.calls[6]);
});
