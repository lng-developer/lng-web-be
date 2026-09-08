jest.mock('../../../src/config/queue', () => ({
  createWorker: jest.fn(),
}));

jest.mock('../../../src/modules/finance/services/financeSnapshotQueue.service', () => ({
  QUEUE_NAME: 'finance-snapshot-recalculation',
}));

jest.mock('../../../src/modules/finance/services/financeSnapshot.service', () => ({
  recalculateOrderItem: jest.fn().mockResolvedValue({ snapshotStatus: 'ESTIMATED' }),
}));

jest.mock('../../../src/modules/finance/repositories/financeImport.repository', () => ({
  markImportBatchRecalculationCompleted: jest.fn().mockResolvedValue({}),
  markImportBatchRecalculationFailed: jest.fn().mockResolvedValue({}),
}));

const { createWorker } = require('../../../src/config/queue');
const financeSnapshotService = require('../../../src/modules/finance/services/financeSnapshot.service');
const financeImportRepository = require('../../../src/modules/finance/repositories/financeImport.repository');
const { startFinanceSnapshotWorker } = require('../../../src/modules/finance/workers/financeSnapshot.worker');

describe('financeSnapshot.worker', () => {
  test('marks the import batch recalculation complete after snapshot calculation', async () => {
    startFinanceSnapshotWorker();
    const processor = createWorker.mock.calls[0][1];

    await processor({
      data: { orderItemId: 'item-1', importBatchId: 'batch-1' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    expect(financeSnapshotService.recalculateOrderItem).toHaveBeenCalledWith(
      'item-1', { system: true, worker: true },
    );
    expect(financeImportRepository.markImportBatchRecalculationCompleted)
      .toHaveBeenCalledWith('batch-1', 'item-1');
  });
});
