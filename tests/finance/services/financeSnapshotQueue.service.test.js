jest.mock('../../../src/config', () => ({ redis: { enabled: true } }));
jest.mock('../../../src/config/queue', () => ({ createQueue: jest.fn() }));

const { createQueue } = require('../../../src/config/queue');

describe('finance snapshot queue', () => {
  test('queues one deterministic recalculation job per order item', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    createQueue.mockReturnValue({ add });

    const service = require('../../../src/modules/finance/services/financeSnapshotQueue.service');
    await service.enqueueSnapshotRecalculation({
      orderItemId: '660000000000000000000001', reason: 'ORDER_IMPORTED', importBatchId: 'batch-1',
    });

    expect(add).toHaveBeenCalledWith('recalculate', {
      orderItemId: '660000000000000000000001', reason: 'ORDER_IMPORTED', importBatchId: 'batch-1',
    }, expect.objectContaining({ jobId: 'finance-snapshot-batch-1-660000000000000000000001' }));
  });
});
