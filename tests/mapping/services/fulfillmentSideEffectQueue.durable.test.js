jest.mock('../../../src/config', () => ({ redis: { enabled: true }, mapping: { durableSideEffectsEnabled: true } }));
jest.mock('../../../src/shared/utils/logger', () => ({ warn: jest.fn() }));
const mockQueue = { add: jest.fn(), addBulk: jest.fn() };
jest.mock('../../../src/config/queue', () => ({ createQueue: () => mockQueue }));
jest.mock('../../../src/modules/mapping/repositories/fulfillmentSideEffectRequest.repository', () => ({ request: jest.fn() }));
const repo = require('../../../src/modules/mapping/repositories/fulfillmentSideEffectRequest.repository');
const queue = require('../../../src/modules/mapping/services/fulfillmentSideEffectQueue.service');
beforeEach(() => jest.clearAllMocks());
test('saves durable work before queue notification and reports it during Redis outage', async () => {
  repo.request.mockResolvedValue({ orderId: 'order', requestedVersion: 1 });
  mockQueue.addBulk.mockRejectedValueOnce(new Error('redis down'));
  expect(await queue.enqueueFulfillmentSideEffects({ orderId: 'order', orderItemId: 'item' }))
    .toEqual({ queued: false, durable: true });
  expect(repo.request.mock.invocationCallOrder[0]).toBeLessThan(mockQueue.addBulk.mock.invocationCallOrder[0]);
});
test('bulk signals keep only order identity in Redis', async () => {
  await queue.signalOrders([{ orderId: 'order', requestedVersion: 1, secret: 'private' }]);
  expect(mockQueue.addBulk).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(mockQueue.addBulk.mock.calls)).not.toContain('private');
});
