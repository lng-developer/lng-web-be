jest.mock('../../../src/modules/finance/models/financeSnapshot.model', () => ({
  find: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../../../src/modules/order/models/order.model', () => ({ findById: jest.fn() }));

const FinanceSnapshot = require('../../../src/modules/finance/models/financeSnapshot.model');
const Order = require('../../../src/modules/order/models/order.model');
const { backfillOrderedAt } = require('../../../tools/scripts/maintenance/backfillFinanceSnapshotOrderedAt');

function cursor(rows) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* rows;
    },
  };
}

test('backfill previews eligible snapshots without writes and applies guarded updates', async () => {
  const rows = [
    { _id: 'snapshot-1', orderId: 'order-1' },
    { _id: 'snapshot-2', orderId: 'order-2' },
    { _id: 'snapshot-3', orderId: 'order-3' },
  ];
  FinanceSnapshot.find.mockReturnValue({
    select: () => ({ lean: () => ({ cursor: () => cursor(rows) }) }),
  });
  Order.findById
    .mockReturnValueOnce({ select: () => ({ lean: async () => ({ orderedAt: new Date('2026-07-01') }) }) })
    .mockReturnValueOnce({ select: () => ({ lean: async () => null }) })
    .mockReturnValueOnce({ select: () => ({ lean: async () => ({ orderedAt: null }) }) });

  await expect(backfillOrderedAt()).resolves.toEqual(expect.objectContaining({
    apply: false, scanned: 3, eligible: 1, wouldUpdate: 1, updated: 0, missingOrder: 1, missingOrderDate: 1,
  }));
  expect(FinanceSnapshot.updateOne).not.toHaveBeenCalled();

  Order.findById.mockReset();
  Order.findById.mockReturnValue({ select: () => ({ lean: async () => ({ orderedAt: new Date('2026-07-01') }) }) });
  FinanceSnapshot.updateOne.mockResolvedValue({ modifiedCount: 1 });

  await expect(backfillOrderedAt({ apply: true })).resolves.toEqual(expect.objectContaining({
    apply: true, scanned: 3, eligible: 3, wouldUpdate: 3, updated: 3,
  }));
  expect(FinanceSnapshot.updateOne).toHaveBeenCalledWith(
    { _id: 'snapshot-1', orderedAt: null },
    { $set: { orderedAt: new Date('2026-07-01') } },
  );
});
