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

const mongoose = require('mongoose');
const repository = require('../../../modules/design/repositories/designSubmissionScore.repository');
const { designScoreStatuses } = require('../../../modules/design/constants/design.constants');

const leanResult = (value) => ({ lean: jest.fn().mockResolvedValue(value) });

describe('designSubmissionScore.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('upsertAutoScore validates inserted scores and preserves the task/submission/asset key', async () => {
    const payload = { taskId: 'task-id', submissionId: 'submission-id', assetId: 'asset-id', finalPoints: 3 };
    mockFindOneAndUpdate.mockReturnValue(leanResult(payload));

    await repository.upsertAutoScore(payload);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { taskId: payload.taskId, submissionId: payload.submissionId, assetId: payload.assetId },
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
    const payload = { taskId: 'task-id', submissionId: 'submission-id', assetId: 'asset-id' };
    const existing = { ...payload, finalPoints: 7 };
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

  test('listPsdScoreRows always restricts the score aggregation to PSD_TEMPLATE and applies score status', async () => {
    mockAggregate.mockResolvedValue([{ items: [], total: [{ count: 0 }] }]);

    await repository.listPsdScoreRows({ scoreStatus: 'VOIDED', page: 2, limit: 10 });

    const pipeline = mockAggregate.mock.calls[0][0];
    expect(pipeline[0].$match).toMatchObject({ taskType: 'PSD_TEMPLATE', status: 'VOIDED' });
    expect(JSON.stringify(pipeline)).toContain('designtasks');
    expect(JSON.stringify(pipeline)).toContain('$skip');
    expect(JSON.stringify(pipeline)).toContain('$limit');
  });

  test('listPsdScoreRows searches by normalized task reference without projecting it', async () => {
    const taskId = '660000000000000000510001';
    mockAggregate.mockResolvedValue([{ items: [], total: [{ count: 0 }] }]);

    await repository.listPsdScoreRows({ search: `  ${taskId}  ` });

    const pipeline = mockAggregate.mock.calls[0][0];
    const searchMatch = pipeline.find((stage) => stage.$match?.$or).$match;
    expect(searchMatch.$or).toEqual(expect.arrayContaining([
      { 'task._id': new mongoose.Types.ObjectId(taskId) },
    ]));
    expect(pipeline.some((stage) => stage.$set?.taskReference)).toBe(false);
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

  test('voidByTaskSubmissionAsset only targets the selected ACTIVE asset score', async () => {
    mockFindOneAndUpdate.mockReturnValue(leanResult(null));

    await repository.voidByTaskSubmissionAsset('task-id', 'submission-id', 'asset-id', { voidReason: 'Removed' });

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { taskId: 'task-id', submissionId: 'submission-id', assetId: 'asset-id', status: designScoreStatuses.ACTIVE },
      { $set: { voidReason: 'Removed', status: designScoreStatuses.VOIDED } },
      { returnDocument: 'after', runValidators: true },
    );
  });
});
