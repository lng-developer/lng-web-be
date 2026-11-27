jest.mock('../../src/modules/finance/repositories/financeSnapshot.repository', () => ({
  scanCanonicalScope: jest.fn(), compareAndSetCanonical: jest.fn(), findByOrderItem: jest.fn(),
}));
jest.mock('../../src/modules/vendorSubmission/public', () => ({ previewCostForOrderItem: jest.fn() }));
jest.mock('../../src/modules/finance/services/financeSnapshot.service', () => ({ buildSnapshotPayload: jest.fn(), withOrderGuard: jest.fn() }));
jest.mock('../../src/modules/audit/public', () => ({ record: jest.fn() }));
const repo = require('../../src/modules/finance/repositories/financeSnapshot.repository');
const vendor = require('../../src/modules/vendorSubmission/public');
const snapshots = require('../../src/modules/finance/services/financeSnapshot.service');
const audit = require('../../src/modules/audit/public');
const { runBackfill, rollbackBackfill } = require('../../src/modules/finance/services/financeCanonicalBackfill.service');
const options = { database: 'finance_test', expectDatabase: 'finance_test', seller: 'J2503', from: '2026-11-21', to: '2026-11-27' };
const source = { _id: 'snapshot', orderItemId: 'item', orderId: 'order', currency: 'USD', customerPaidAmount: 9240, feeAmount: 677, totalCostAmount: 3814, actualVendorTotalAmount: 10692, costStatus: 'PRESENT', updatedAt: new Date('2026-11-27T00:00:00Z') };
beforeEach(() => {
  jest.resetAllMocks();
  repo.scanCanonicalScope.mockReturnValue((async function* () { yield source; })());
  vendor.previewCostForOrderItem.mockResolvedValue({ submissionId: 'submission', vendorCost: { totalAmount: 3564, currency: 'USD', allocation: { vendorOrderId: 'remote', totalAmount: 3564 } } });
  repo.compareAndSetCanonical.mockResolvedValue({ modifiedCount: 1 });
  repo.findByOrderItem.mockResolvedValue(source);
  snapshots.buildSnapshotPayload.mockResolvedValue({ payload: source });
  snapshots.withOrderGuard.mockImplementation(async (_, work) => work(null));
});
test('defaults to dry-run, preserves before images and does not mutate', async () => {
  const result = await runBackfill(options);
  expect(result.entries[0]).toMatchObject({ status: 'READY', before: { actualVendorTotalAmount: 10692 }, after: { actualVendorTotalAmount: 3564, profitBeforeAdsAmount: 4999 } });
  expect(repo.compareAndSetCanonical).not.toHaveBeenCalled();
});
test('rejects an unexpected database before reading data', async () => {
  await expect(runBackfill({ ...options, expectDatabase: 'prod' })).rejects.toThrow('Database mismatch');
  expect(repo.scanCanonicalScope).not.toHaveBeenCalled();
});
test('records ambiguous vendor evidence as a skip', async () => {
  vendor.previewCostForOrderItem.mockRejectedValue(new Error('ambiguous bundle'));
  expect((await runBackfill(options)).entries[0]).toMatchObject({ status: 'SKIPPED', reason: 'ambiguous bundle' });
});
test('saves manifest before apply, guards concurrent updates and resumes applied entries', async () => {
  const save = jest.fn();
  const manifest = await runBackfill({ ...options, apply: true }, { save });
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(repo.compareAndSetCanonical.mock.invocationCallOrder[0]);
  expect(manifest.entries[0].status).toBe('APPLIED');
  repo.compareAndSetCanonical.mockClear();
  await runBackfill({ ...options, apply: true, resume: manifest }, { save });
  expect(repo.compareAndSetCanonical).not.toHaveBeenCalled();
});
test('does not overwrite a snapshot changed since the manifest was built', async () => {
  repo.compareAndSetCanonical.mockResolvedValue({ modifiedCount: 0 });
  const manifest = await runBackfill({ ...options, apply: true }, { save: jest.fn() });
  expect(manifest.entries[0].status).toBe('CONFLICT');
});

test('resumes an interrupted successful write and guards rollback by the applied revision', async () => {
  const manifest = await runBackfill({ ...options, apply: true }, { save: jest.fn() });
  manifest.entries[0].status = 'APPLYING';
  repo.findByOrderItem.mockResolvedValue({ ...source, updatedAt: new Date(manifest.entries[0].appliedAt) });
  repo.compareAndSetCanonical.mockClear();
  await runBackfill({ ...options, apply: true, resume: manifest }, { save: jest.fn() });
  expect(manifest.entries[0].status).toBe('APPLIED');
  expect(repo.compareAndSetCanonical).not.toHaveBeenCalled();
  await rollbackBackfill({ ...options, resume: manifest }, { save: jest.fn() });
  expect(repo.compareAndSetCanonical).toHaveBeenCalledWith('snapshot', manifest.entries[0].appliedAt, expect.objectContaining({ actualVendorTotalAmount: 10692 }), { session: null });
  expect(manifest.entries[0].status).toBe('ROLLED_BACK');
  expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'FINANCE_CANONICAL_BACKFILL_ROLLED_BACK' }), { session: null });
});

test('resumes a committed rollback without changing the snapshot again', async () => {
  const manifest = await runBackfill({ ...options, apply: true }, { save: jest.fn() });
  Object.assign(manifest.entries[0], { status: 'ROLLING_BACK', rolledBackAt: '2026-11-27T03:00:00.000Z' });
  repo.findByOrderItem.mockResolvedValue({ ...source, updatedAt: new Date(manifest.entries[0].rolledBackAt) });
  repo.compareAndSetCanonical.mockClear();
  await rollbackBackfill({ ...options, resume: manifest }, { save: jest.fn() });
  expect(manifest.entries[0].status).toBe('ROLLED_BACK');
  expect(repo.compareAndSetCanonical).not.toHaveBeenCalled();
});
