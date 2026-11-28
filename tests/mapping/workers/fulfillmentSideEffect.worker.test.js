jest.mock('../../../src/config/queue', () => ({ createWorker: jest.fn() }));
jest.mock('../../../src/modules/mapping/services/fulfillmentSideEffectQueue.service', () => ({ QUEUE_NAME: 'mapping-fulfillment-side-effects' }));
jest.mock('../../../src/modules/mapping/services/fulfillmentPlan.service', () => ({ applyFulfillmentSideEffects: jest.fn() }));
jest.mock('../../../src/modules/mapping/services/fulfillmentSideEffectRequest.service', () => ({ processOrder: jest.fn() }));
const { createWorker } = require('../../../src/config/queue');
const { applyFulfillmentSideEffects } = require('../../../src/modules/mapping/services/fulfillmentPlan.service');
const { processOrder } = require('../../../src/modules/mapping/services/fulfillmentSideEffectRequest.service');
const { startFulfillmentSideEffectWorker } = require('../../../src/modules/mapping/workers/fulfillmentSideEffect.worker');
beforeEach(() => jest.resetAllMocks());
test('legacy job propagates production failures so BullMQ retries', async () => {
  startFulfillmentSideEffectWorker();
  const processJob = createWorker.mock.calls[0][1];
  const error = new Error('production temporarily unavailable');
  applyFulfillmentSideEffects.mockRejectedValueOnce(error);
  await expect(processJob({ data: { orderItemId: 'item', triggerProduction: true } })).rejects.toBe(error);
  expect(applyFulfillmentSideEffects).toHaveBeenCalledWith({ orderItemId: 'item', triggerProduction: true, strict: true });
});
test('durable job keeps its persisted recovery path', async () => {
  startFulfillmentSideEffectWorker();
  await createWorker.mock.calls[0][1]({ data: { durable: true, orderId: 'order' } });
  expect(processOrder).toHaveBeenCalledWith('order');
  expect(applyFulfillmentSideEffects).not.toHaveBeenCalled();
});
