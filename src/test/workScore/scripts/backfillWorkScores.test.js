const mockDesignPublic = { listWorkScoreCandidates: jest.fn() };
const mockProductionPublic = { listWorkScoreCandidates: jest.fn() };
const mockRepository = { findBySourceKey: jest.fn(), list: jest.fn() };
const mockWorkScorePublic = {
  recordDesignSubmissionScore: jest.fn(),
  recordProductionScaleScores: jest.fn(),
  voidObsoleteSourceScore: jest.fn(),
};

jest.mock('../../../modules/design/public', () => mockDesignPublic);
jest.mock('../../../modules/production/public', () => mockProductionPublic);
jest.mock('../../../modules/workScore/repositories/workScore.repository', () => mockRepository);
jest.mock('../../../modules/workScore/public', () => mockWorkScorePublic);

const { backfillWorkScores } = require('../../../modules/workScore/scripts/backfillWorkScores');

const design = {
  designTaskId: '660000000000000000000001', submissionId: '660000000000000000000002',
  assetId: '660000000000000000000003', shopId: '660000000000000000000004',
  workerId: '660000000000000000000005', taskType: 'PSD_TEMPLATE',
};
const production = {
  productionTaskId: '660000000000000000000011', shopId: design.shopId,
  outputs: [1, 2, 3].map((n) => ({
    fileCheckId: `66000000000000000000002${n}`,
    assetId: `66000000000000000000003${n}`,
    workerId: design.workerId,
  })),
};

describe('backfillWorkScores', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDesignPublic.listWorkScoreCandidates.mockResolvedValue([design]);
    mockProductionPublic.listWorkScoreCandidates.mockResolvedValue([production]);
    mockRepository.findBySourceKey.mockResolvedValue(null);
    mockRepository.list.mockResolvedValue({ items: [] });
    mockWorkScorePublic.recordDesignSubmissionScore.mockResolvedValue({});
    mockWorkScorePublic.recordProductionScaleScores.mockResolvedValue([]);
  });

  test('dry-run reports four missing files without writing', async () => {
    await expect(backfillWorkScores({ dryRun: true, limit: 100 })).resolves.toMatchObject({ eligible: 4, created: 0 });
    expect(mockWorkScorePublic.recordDesignSubmissionScore).not.toHaveBeenCalled();
  });

  test('creates one Design and three Scale scores and rerun skips existing keys', async () => {
    await expect(backfillWorkScores({ limit: 100 })).resolves.toMatchObject({ created: 4, failed: 0 });
    expect(mockWorkScorePublic.recordProductionScaleScores.mock.calls[0][0].outputs).toHaveLength(3);
    mockRepository.findBySourceKey.mockResolvedValue({ _id: 'existing' });
    await expect(backfillWorkScores({ limit: 100 })).resolves.toMatchObject({ created: 0, skipped: 4 });
  });

  test('system-voids replaced Scale assets and reports partial failures', async () => {
    mockRepository.list.mockResolvedValue({ items: [{
      _id: 'old-score', __v: 2, sourceUnitId: production.outputs[0].fileCheckId,
      assetId: '660000000000000000000099',
    }] });
    mockWorkScorePublic.recordDesignSubmissionScore.mockRejectedValueOnce(new Error('failed'));

    await expect(backfillWorkScores({ limit: 100 })).resolves.toMatchObject({ failed: 1, voided: 1 });
    expect(mockWorkScorePublic.voidObsoleteSourceScore).toHaveBeenCalledWith('old-score', 2);
  });
});
