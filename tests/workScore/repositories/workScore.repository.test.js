const mockFind = jest.fn();
const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockCountDocuments = jest.fn();
const mockAggregate = jest.fn();

jest.mock('../../../src/modules/workScore/models/workScore.model', () => ({
  aggregate: mockAggregate,
  countDocuments: mockCountDocuments,
  find: mockFind,
  findOne: mockFindOne,
  findOneAndUpdate: mockFindOneAndUpdate,
}));

const mongoose = require('mongoose');
const repository = require('../../../src/modules/workScore/repositories/workScore.repository');

const leanResult = (value) => ({ lean: jest.fn().mockResolvedValue(value) });

describe('workScore.repository', () => {
  beforeEach(() => jest.clearAllMocks());

  test('upserts by the immutable source key', async () => {
    const payload = {
      sourceType: 'PRODUCTION_SCALE',
      sourceTaskId: 'task-id',
      sourceUnitId: 'file-check-id',
      assetId: 'asset-id',
    };
    mockFindOneAndUpdate.mockReturnValue(leanResult(payload));

    await repository.upsertSourceScore(payload);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      payload,
      { $setOnInsert: payload },
      expect.objectContaining({ upsert: true, setDefaultsOnInsert: true, runValidators: true }),
    );
  });

  test('returns the existing row after a duplicate-key race', async () => {
    const payload = {
      sourceType: 'DESIGN_SUBMISSION',
      sourceTaskId: 'task-id',
      sourceUnitId: 'submission-id',
      assetId: 'asset-id',
    };
    const duplicateKey = Object.assign(new Error('duplicate key'), { code: 11000 });
    mockFindOneAndUpdate.mockReturnValue({ lean: jest.fn().mockRejectedValue(duplicateKey) });
    mockFindOne.mockReturnValue(leanResult(payload));

    await expect(repository.upsertSourceScore(payload)).resolves.toEqual(payload);
    expect(mockFindOne).toHaveBeenCalledWith(payload);
  });

  test('list honors exact shop and worker scope', async () => {
    const sort = jest.fn().mockReturnThis();
    const skip = jest.fn().mockReturnThis();
    const limit = jest.fn().mockReturnThis();
    const lean = jest.fn().mockResolvedValue([]);
    mockFind.mockReturnValue({ sort, skip, limit, lean });
    mockCountDocuments.mockResolvedValue(0);
    const shopId = '660000000000000000000001';
    const workerId = '660000000000000000000002';

    await repository.list({ shopId, workerId, page: 1, limit: 20 });

    expect(mockFind).toHaveBeenCalledWith(expect.objectContaining({
      shopId: new mongoose.Types.ObjectId(shopId),
      workerId: new mongoose.Types.ObjectId(workerId),
    }));
    expect(mockCountDocuments).toHaveBeenCalledWith(mockFind.mock.calls[0][0]);
  });

  test('list applies task type and escaped case-insensitive context search', async () => {
    const sort = jest.fn().mockReturnThis();
    const skip = jest.fn().mockReturnThis();
    const limit = jest.fn().mockReturnThis();
    const lean = jest.fn().mockResolvedValue([]);
    mockFind.mockReturnValue({ sort, skip, limit, lean });
    mockCountDocuments.mockResolvedValue(0);

    await repository.list({ taskType: 'PSD_TEMPLATE', search: 'SKU.01' });

    expect(mockFind).toHaveBeenCalledWith(expect.objectContaining({
      'contextSnapshot.taskType': 'PSD_TEMPLATE',
      $or: expect.arrayContaining([
        { 'contextSnapshot.sku': /SKU\.01/i },
        { workerName: /SKU\.01/i },
      ]),
    }));
  });

  test('summary honors the allowed shop set and worker scope', async () => {
    mockAggregate.mockResolvedValue([]);
    const shopIds = ['660000000000000000000001', '660000000000000000000003'];
    const workerId = '660000000000000000000002';

    await repository.summarize({ shopIds, workerId });

    expect(mockAggregate.mock.calls[0][0][0].$match).toEqual(expect.objectContaining({
      shopId: { $in: shopIds.map((id) => new mongoose.Types.ObjectId(id)) },
      workerId: new mongoose.Types.ObjectId(workerId),
    }));
  });

  test('summary returns workers sorted by points for leaderboard use', async () => {
    mockAggregate.mockResolvedValue([]);

    await repository.summarize({});

    const byWorker = mockAggregate.mock.calls[0][0][1].$facet.byWorker;
    expect(byWorker).toEqual(expect.arrayContaining([
      { $sort: { totalPoints: -1, totalFiles: -1, workerName: 1 } },
      { $limit: 20 },
    ]));
  });

  test('adjust includes expected version and increments it atomically', async () => {
    mockFindOneAndUpdate.mockReturnValue(leanResult(null));

    await expect(repository.adjust('score-id', 4, { finalPoints: 3 })).resolves.toBeNull();

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'score-id', __v: 4 },
      { $set: { finalPoints: 3 }, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true },
    );
  });
});
