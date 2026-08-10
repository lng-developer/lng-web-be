const mockRepository = {
  adjust: jest.fn(),
  findById: jest.fn(),
  upsertSourceScore: jest.fn(),
};

jest.mock('../../../src/modules/workScore/repositories/workScore.repository', () => mockRepository);
jest.mock('../../../src/modules/hr/public', () => ({
  listEmployeeProfilesByAccountIds: jest.fn().mockResolvedValue([{ fullName: 'Worker' }]),
}));
jest.mock('../../../src/modules/organization/public', () => ({
  listAccountOrganizationSummaries: jest.fn().mockResolvedValue([{}]),
}));

const service = require('../../../src/modules/workScore/services/workScore.service');

const baseDesign = {
  designTaskId: '660000000000000000000001',
  submissionId: '660000000000000000000002',
  assetId: '660000000000000000000003',
  shopId: '660000000000000000000004',
  workerId: '660000000000000000000005',
  taskType: 'PSD_TEMPLATE',
  priority: 'HIGH',
};

describe('workScore.service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('records Design points using the existing task and priority rule', async () => {
    mockRepository.upsertSourceScore.mockImplementation(async (row) => row);

    const row = await service.recordDesignSubmissionScore(baseDesign);

    expect(row).toMatchObject({ basePoints: 3, finalPoints: 3.75, scoreLevel: 'HARD' });
  });

  test('records one independent point for each Scale output', async () => {
    mockRepository.upsertSourceScore.mockImplementation(async (row) => row);
    const result = await service.recordProductionScaleScores({
      productionTaskId: baseDesign.designTaskId,
      shopId: baseDesign.shopId,
      outputs: [1, 2, 3].map((value) => ({
        fileCheckId: `66000000000000000000001${value}`,
        assetId: `66000000000000000000002${value}`,
        workerId: baseDesign.workerId,
      })),
    });

    expect(result).toHaveLength(3);
    expect(result.every((row) => row.finalPoints === 1)).toBe(true);
    expect(mockRepository.upsertSourceScore).toHaveBeenCalledTimes(3);
  });

  test('override appends immutable history and rejects stale versions', async () => {
    const current = { _id: 'score-id', __v: 2, finalPoints: 1, scoreLevel: 'STANDARD', status: 'ACTIVE', adjustments: [] };
    mockRepository.findById.mockResolvedValue(current);
    mockRepository.adjust.mockResolvedValueOnce({ ...current, __v: 3 }).mockResolvedValueOnce(null);

    await service.overrideScore('score-id', {
      points: 2,
      scoreLevel: 'HARD',
      reason: 'Complex output',
      expectedVersion: 2,
    }, { system: true, accountId: '660000000000000000000009' });

    expect(mockRepository.adjust.mock.calls[0][2].adjustments).toHaveLength(1);
    await expect(service.overrideScore('score-id', {
      points: 3,
      reason: 'Second edit',
      expectedVersion: 2,
    }, { system: true })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('cannot override a voided score', async () => {
    mockRepository.findById.mockResolvedValue({ _id: 'score-id', status: 'VOIDED' });
    await expect(service.overrideScore('score-id', {
      points: 2,
      reason: 'No',
      expectedVersion: 1,
    }, { system: true })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('void appends history instead of replacing prior adjustments', async () => {
    const prior = { type: 'OVERRIDE' };
    const current = { _id: 'score-id', finalPoints: 2, scoreLevel: 'HARD', status: 'ACTIVE', adjustments: [prior] };
    mockRepository.findById.mockResolvedValue(current);
    mockRepository.adjust.mockImplementation(async (id, version, patch) => patch);

    const saved = await service.voidScore('score-id', { reason: 'Duplicate', expectedVersion: 4 }, { system: true });

    expect(saved.adjustments).toHaveLength(2);
    expect(saved.adjustments[1]).toMatchObject({ type: 'VOID', oldStatus: 'ACTIVE', newStatus: 'VOIDED' });
  });
});
