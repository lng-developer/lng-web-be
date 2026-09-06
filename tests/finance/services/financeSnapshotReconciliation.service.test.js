jest.mock('../../../src/modules/order/public', () => ({ findItemIds: jest.fn() }));
jest.mock('../../../src/modules/finance/repositories/financeSnapshot.repository', () => ({ listByOrderItemIds: jest.fn() }));
jest.mock('../../../src/modules/finance/services/financeSnapshotQueue.service', () => ({ enqueueSnapshotRecalculation: jest.fn() }));

const orderPublic = require('../../../src/modules/order/public');
const repository = require('../../../src/modules/finance/repositories/financeSnapshot.repository');
const queue = require('../../../src/modules/finance/services/financeSnapshotQueue.service');
const service = require('../../../src/modules/finance/services/financeSnapshotReconciliation.service');

describe('finance snapshot reconciliation', () => {
  test('reports missing snapshots without enqueueing during a dry run', async () => {
    orderPublic.findItemIds.mockResolvedValue(['item-1', 'item-2']);
    repository.listByOrderItemIds.mockResolvedValue([{ orderItemId: 'item-1' }]);

    await expect(service.reconcileSnapshots({ limit: 10, dryRun: true })).resolves.toEqual({
      checked: 2, eligible: 1, queued: 0, failed: 0, dryRun: true,
    });
    expect(queue.enqueueSnapshotRecalculation).not.toHaveBeenCalled();
  });
});
