jest.mock('../../../src/config', () => ({ redis: { enabled: true } }));
jest.mock('../../../src/modules/auth/public', () => ({ canAccessScope: jest.fn(() => true) }));
jest.mock('../../../src/modules/order/services/orderAccess.service', () => ({ assertCanReadShop: jest.fn() }));
jest.mock('../../../src/modules/order/repositories/orderItem.repository', () => ({ findById: jest.fn() }));
jest.mock('../../../src/modules/order/repositories/orderRecheckJob.repository', () => ({
  create: jest.fn(), findById: jest.fn(), findActive: jest.fn(), claim: jest.fn(), requeueStale: jest.fn(), complete: jest.fn(), fail: jest.fn(),
}));
jest.mock('../../../src/modules/order/services/orderRecheckJobQueue.service', () => ({ enqueue: jest.fn() }));
jest.mock('../../../src/modules/mapping/public', () => ({ recheckFulfillmentPlan: jest.fn() }));
jest.mock('../../../src/modules/production/public', () => ({ createOrRecheckTaskForOrderItem: jest.fn() }));

const itemRepository = require('../../../src/modules/order/repositories/orderItem.repository');
const repository = require('../../../src/modules/order/repositories/orderRecheckJob.repository');
const queue = require('../../../src/modules/order/services/orderRecheckJobQueue.service');
const mappingPublic = require('../../../src/modules/mapping/public');
const productionPublic = require('../../../src/modules/production/public');
const service = require('../../../src/modules/order/services/orderRecheckJob.service');

describe('orderRecheckJob.service', () => {
  const orderItemId = '660000000000000000000101';
  const shopId = '660000000000000000000201';

  beforeEach(() => {
    jest.clearAllMocks();
    itemRepository.findById.mockResolvedValue({ _id: orderItemId, shopId });
    repository.findActive.mockResolvedValue(null);
    repository.create.mockResolvedValue({ _id: '660000000000000000000301', orderItemId, shopId, type: 'MAPPING', status: 'QUEUED' });
    queue.enqueue.mockResolvedValue();
  });

  test('queues a single active mapping recheck', async () => {
    const result = await service.requestRecheckJob(orderItemId, 'MAPPING', { permissions: ['MAPPING:WRITE'] });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ activeKey: `MAPPING:${orderItemId}`, type: 'MAPPING' }));
    expect(queue.enqueue).toHaveBeenCalledWith('660000000000000000000301');
    expect(result).toMatchObject({ status: 'QUEUED', type: 'MAPPING' });
  });

  test('requeues an orphaned queued job instead of polling it forever', async () => {
    repository.findActive.mockResolvedValue({
      _id: '660000000000000000000301', orderItemId, shopId, type: 'MAPPING', status: 'QUEUED',
    });

    const result = await service.requestRecheckJob(orderItemId, 'MAPPING', { permissions: ['MAPPING:WRITE'] });

    expect(repository.create).not.toHaveBeenCalled();
    expect(queue.enqueue).toHaveBeenCalledWith('660000000000000000000301');
    expect(result).toMatchObject({ status: 'QUEUED', reused: true });
  });

  test('recovers a processing job only after it is stale', async () => {
    const staleJob = {
      _id: '660000000000000000000301', orderItemId, shopId, type: 'MAPPING', status: 'PROCESSING',
      startedAt: new Date(Date.now() - (6 * 60 * 1000)),
    };
    repository.findActive.mockResolvedValue(staleJob);
    repository.requeueStale.mockResolvedValue({ ...staleJob, status: 'QUEUED', startedAt: null });

    await service.requestRecheckJob(orderItemId, 'MAPPING', { permissions: ['MAPPING:WRITE'] });

    expect(repository.requeueStale).toHaveBeenCalledWith(staleJob._id, expect.any(Date));
    expect(queue.enqueue).toHaveBeenCalledWith(staleJob._id);
  });

  test.each([
    ['MAPPING', 'recheckFulfillmentPlan'],
    ['PRODUCTION', 'createOrRecheckTaskForOrderItem'],
  ])('processes only the requested %s job', async (type, method) => {
    repository.claim.mockResolvedValue({ _id: '660000000000000000000301', orderItemId, shopId, type, requestedBy: null });
    repository.complete.mockImplementation(async (_id, result) => ({ _id, orderItemId, shopId, type, status: 'COMPLETED', result }));
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({ status: 'READY' });
    productionPublic.createOrRecheckTaskForOrderItem.mockResolvedValue({ status: 'NEED_SCALE' });

    await service.processRecheckJob('660000000000000000000301');

    expect(type === 'MAPPING' ? mappingPublic[method] : productionPublic[method]).toHaveBeenCalled();
    expect(type === 'MAPPING' ? productionPublic.createOrRecheckTaskForOrderItem : mappingPublic.recheckFulfillmentPlan).not.toHaveBeenCalled();
  });
});
