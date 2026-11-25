jest.mock('../../../src/modules/audit/public', () => ({ record: jest.fn() }));
jest.mock('../../../src/modules/shipment/repositories/trackingSyncConfig.repository', () => ({
  get: jest.fn(), upsert: jest.fn(),
}));
const repository = require('../../../src/modules/shipment/repositories/trackingSyncConfig.repository');
const audit = require('../../../src/modules/audit/public');
const service = require('../../../src/modules/shipment/services/trackingSyncConfig.service');

beforeEach(() => {
  jest.clearAllMocks();
  repository.get.mockResolvedValue({ enabled: true, intervalMinutes: 60, batchSize: 50 });
  repository.upsert.mockImplementation(async (patch) => patch);
});

test('persists run timing and audited duration while preserving the summary counts', async () => {
  const startedAt = new Date('2026-11-23T08:00:00Z');
  const finishedAt = new Date('2026-11-23T08:00:12Z');
  const result = await service.recordRun({ checked: 2, applied: 1, skipped: 1, failed: 0 }, {}, { startedAt, finishedAt });
  expect(result.lastRunAt).toEqual(startedAt);
  expect(result.lastRunFinishedAt).toEqual(finishedAt);
  expect(result.lastRunSummary).toEqual({ checked: 2, applied: 1, skipped: 1, failed: 0, durationMs: 12000 });
  expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
    metadata: expect.objectContaining({ durationMs: 12000 }),
  }), {});
});

test('legacy callers do not invent a zero duration', async () => {
  const result = await service.recordRun({ checked: 1 }, {});
  expect(result.lastRunSummary.durationMs).toBeNull();
  expect(result.lastRunAt).toBeInstanceOf(Date);
});
