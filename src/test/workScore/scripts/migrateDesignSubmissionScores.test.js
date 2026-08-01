const mockLegacyScore = { find: jest.fn() };
const mockDesignTask = { find: jest.fn() };
const mockRepository = { findBySourceKey: jest.fn(), upsertSourceScore: jest.fn() };

jest.mock('../../../modules/design/models/designSubmissionScore.model', () => mockLegacyScore);
jest.mock('../../../modules/design/models/designTask.model', () => mockDesignTask);
jest.mock('../../../modules/workScore/repositories/workScore.repository', () => mockRepository);

const { migrateDesignSubmissionScores } = require('../../../modules/workScore/scripts/migrateDesignSubmissionScores');

const score = {
  _id: '660000000000000000000001', taskId: '660000000000000000000002',
  submissionId: '660000000000000000000003', assetId: '660000000000000000000004',
  designerId: '660000000000000000000005', taskType: 'PSD_TEMPLATE', basePoints: 3,
  finalPoints: 4, scoreLevel: 'HARD', status: 'VOIDED', scoredAt: new Date('2026-07-01'),
  override: { points: 4, reason: 'Hard', overriddenBy: '660000000000000000000006', overriddenAt: new Date('2026-07-02') },
  voidReason: 'Duplicate', voidedBy: '660000000000000000000006', voidedAt: new Date('2026-07-03'),
};
const task = { _id: score.taskId, shopId: '660000000000000000000007', priority: 'HIGH', listingSnapshot: { sku: 'SKU-1' } };

function chain(rows) {
  return { limit: () => ({ lean: async () => rows }), select: () => ({ lean: async () => rows }) };
}

describe('migrateDesignSubmissionScores', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLegacyScore.find.mockReturnValue(chain([score]));
    mockDesignTask.find.mockReturnValue(chain([task]));
    mockRepository.findBySourceKey.mockResolvedValue(null);
    mockRepository.upsertSourceScore.mockImplementation(async (row) => row);
  });

  test('dry-run reports eligibility without writes', async () => {
    await expect(migrateDesignSubmissionScores({ dryRun: true, limit: 100 })).resolves.toMatchObject({ eligible: 1, migrated: 0, failed: 0 });
    expect(mockRepository.upsertSourceScore).not.toHaveBeenCalled();
  });

  test('maps legacy override and void metadata to immutable history', async () => {
    await migrateDesignSubmissionScores({ limit: 100 });
    const row = mockRepository.upsertSourceScore.mock.calls[0][0];
    expect(row).toMatchObject({ sourceType: 'DESIGN_SUBMISSION', shopId: task.shopId, status: 'VOIDED' });
    expect(row.adjustments.map((item) => item.type)).toEqual(['OVERRIDE', 'VOID']);
  });

  test('rerun skips existing rows and reports missing source tasks', async () => {
    mockRepository.findBySourceKey.mockResolvedValueOnce({ _id: 'existing' });
    await expect(migrateDesignSubmissionScores({ limit: 100 })).resolves.toMatchObject({ skipped: 1 });
    mockRepository.findBySourceKey.mockResolvedValue(null);
    mockDesignTask.find.mockReturnValue(chain([]));
    await expect(migrateDesignSubmissionScores({ limit: 100 })).resolves.toMatchObject({ failed: 1 });
  });
});
