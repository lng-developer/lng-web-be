jest.mock('../../../src/modules/mapping/repositories/fulfillmentSideEffectRequest.repository', () => ({
  request: jest.fn(), claim: jest.fn(), renew: jest.fn(), complete: jest.fn(), fail: jest.fn(), listDue: jest.fn(),
}));
jest.mock('../../../src/modules/mapping/services/fulfillmentPlan.service', () => ({ applyFulfillmentSideEffects: jest.fn() }));
jest.mock('../../../src/modules/order/public', () => ({ refreshFulfillmentStatusesForOrder: jest.fn() }));
jest.mock('../../../src/modules/mapping/services/fulfillmentSideEffectQueue.service', () => ({ signalOrders: jest.fn() }));
const repo = require('../../../src/modules/mapping/repositories/fulfillmentSideEffectRequest.repository');
const plan = require('../../../src/modules/mapping/services/fulfillmentPlan.service');
const order = require('../../../src/modules/order/public');
const queue = require('../../../src/modules/mapping/services/fulfillmentSideEffectQueue.service');
const service = require('../../../src/modules/mapping/services/fulfillmentSideEffectRequest.service');
beforeEach(() => { jest.clearAllMocks(); repo.renew.mockResolvedValue(true); });
afterEach(() => service.stopFulfillmentSideEffectRecoveryScheduler());

test('processes two same-order items sequentially and refreshes shared projections once', async () => {
  repo.claim.mockResolvedValue({ requestedVersion: 2, items: { a: { orderItemId: 'a' }, b: { orderItemId: 'b' } } });
  await service.processOrder('order');
  expect(plan.applyFulfillmentSideEffects).toHaveBeenCalledTimes(2);
  expect(plan.applyFulfillmentSideEffects.mock.calls[0][0]).toMatchObject({ deferOrderRefresh: true, strict: true });
  expect(order.refreshFulfillmentStatusesForOrder).toHaveBeenCalledTimes(1);
  expect(repo.complete).toHaveBeenCalledWith('order', expect.any(String), 2);
});

test('expired owner does not apply effects or acknowledge work', async () => {
  repo.claim.mockResolvedValue({ requestedVersion: 1, items: { a: { orderItemId: 'a' } } });
  repo.renew.mockResolvedValue(false);
  await service.processOrder('order');
  expect(plan.applyFulfillmentSideEffects).not.toHaveBeenCalled();
  expect(repo.complete).not.toHaveBeenCalled();
});

test('finishing a worker waits for its in-flight lease heartbeat', async () => {
  jest.useFakeTimers();
  let finishEffect;
  let finishHeartbeat;
  repo.claim.mockResolvedValue({ requestedVersion: 1, items: { a: { orderItemId: 'a' } } });
  plan.applyFulfillmentSideEffects.mockImplementationOnce(() => new Promise((resolve) => { finishEffect = resolve; }));
  repo.renew.mockResolvedValueOnce(true).mockImplementationOnce(() => new Promise((resolve) => { finishHeartbeat = resolve; }));
  let done = false;
  const processing = service.processOrder('order').then(() => { done = true; });
  try {
    await jest.advanceTimersByTimeAsync(40000);
    finishEffect();
    await jest.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    finishHeartbeat(true);
    await processing;
    expect(done).toBe(true);
  } finally {
    finishHeartbeat?.(true);
    await processing;
    jest.useRealTimers();
  }
});

test('invalid item data is retained for bounded retries instead of acknowledged', async () => {
  repo.claim.mockResolvedValue({ requestedVersion: 1, items: { a: { orderItemId: 'a' } } });
  plan.applyFulfillmentSideEffects.mockRejectedValueOnce(Object.assign(new Error('bad data'), { code: 'VALIDATION_ERROR' }));
  await service.processOrder('order');
  expect(repo.fail).toHaveBeenCalledWith('order', expect.any(String), 1, 'VALIDATION_ERROR', expect.any(Date));
  expect(repo.complete).not.toHaveBeenCalled();
});

test('recovery signals saved work in bounded chunks', async () => {
  repo.listDue.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({ orderId: `order-${index}`, requestedVersion: 1 })));
  queue.signalOrders.mockResolvedValue({ queued: true });
  await service.recover();
  expect(repo.listDue).toHaveBeenCalledWith(100);
  expect(queue.signalOrders).toHaveBeenCalledTimes(10);
  expect(queue.signalOrders.mock.calls.every(([rows]) => rows.length === 10)).toBe(true);
});
