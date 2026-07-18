const mockFind = jest.fn();
const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockAggregate = jest.fn();

jest.mock('../../../modules/design/models/designSubmissionScore.model', () => ({
  find: mockFind,
  findOne: mockFindOne,
  findOneAndUpdate: mockFindOneAndUpdate,
  aggregate: mockAggregate,
}));

const repository = require('../../../modules/design/repositories/designSubmissionScore.repository');
const { designScoreStatuses } = require('../../../modules/design/constants/design.constants');

const leanResult = (value) => ({ lean: jest.fn().mockResolvedValue(value) });

describe('designSubmissionScore.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('upsertAutoScore validates inserted scores and preserves the task/submission key', async () => {
    const payload = { taskId: 'task-id', submissionId: 'submission-id', finalPoints: 3 };
    mockFindOneAndUpdate.mockReturnValue(leanResult(payload));

    await repository.upsertAutoScore(payload);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { taskId: payload.taskId, submissionId: payload.submissionId },
      { $setOnInsert: payload },
      {
        returnDocument: 'after',
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      },
    );
  });

  test('returns the existing score when the first upsert loses a duplicate-key race', async () => {
    const payload = { taskId: 'task-id', submissionId: 'submission-id' };
    const existing = { taskId: payload.taskId, submissionId: payload.submissionId, finalPoints: 7 };
    const duplicateKey = Object.assign(new Error('duplicate key'), { code: 11000 });
    mockFindOneAndUpdate.mockReturnValue({ lean: jest.fn().mockRejectedValue(duplicateKey) });
    mockFindOne.mockReturnValue(leanResult(existing));

    await expect(repository.upsertAutoScore(payload)).resolves.toEqual(existing);
    expect(mockFindOne).toHaveBeenCalledWith(payload);
  });

  test('returns no rows without querying for empty submission ids', async () => {
    await expect(repository.findBySubmissionIds([])).resolves.toEqual([]);
    expect(mockFind).not.toHaveBeenCalled();
  });

  test('summarize always matches ACTIVE scores and includes the UTC end of dateTo', async () => {
    mockAggregate.mockResolvedValue([{}]);

    await repository.summarize({
      status: designScoreStatuses.VOIDED,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });

    const match = mockAggregate.mock.calls[0][0][0].$match;
    expect(match.status).toBe(designScoreStatuses.ACTIVE);
    expect(match.scoredAt).toEqual({
      $gte: new Date('2026-07-01'),
      $lte: new Date('2026-07-31T23:59:59.999Z'),
    });
  });

  test('overrideScore only updates an ACTIVE score with validators enabled', async () => {
    mockFindOneAndUpdate.mockReturnValue(leanResult({ _id: 'score-id' }));

    await repository.overrideScore('score-id', { finalPoints: 7 });

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'score-id', status: designScoreStatuses.ACTIVE },
      { $set: { finalPoints: 7 } },
      { returnDocument: 'after', runValidators: true },
    );
  });

  test('voidByTaskSubmission only targets ACTIVE scores', async () => {
    mockFindOneAndUpdate.mockReturnValue(leanResult(null));

    await repository.voidByTaskSubmission('task-id', 'submission-id', { voidReason: 'Removed' });

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { taskId: 'task-id', submissionId: 'submission-id', status: designScoreStatuses.ACTIVE },
      { $set: { voidReason: 'Removed', status: designScoreStatuses.VOIDED } },
      { returnDocument: 'after', runValidators: true },
    );
  });
});
