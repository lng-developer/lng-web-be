jest.mock('../../../src/modules/hr/models/attendanceImportBatch.model', () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

const AttendanceImportBatch = require('../../../src/modules/hr/models/attendanceImportBatch.model');
const repository = require('../../../src/modules/hr/repositories/attendanceImportBatch.repository');

describe('attendance import batch repository', () => {
  beforeEach(() => jest.clearAllMocks());

  test('claims a missing batch as processing', async () => {
    AttendanceImportBatch.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    AttendanceImportBatch.create.mockResolvedValue({
      toObject: () => ({ sourceBatchId: 'batch-1', status: 'PROCESSING', punchCount: 2 }),
    });

    await expect(repository.claim('batch-1', 2)).resolves.toEqual({
      acquired: true,
      batch: { sourceBatchId: 'batch-1', status: 'PROCESSING', punchCount: 2 },
    });
  });

  test('atomically reclaims only a failed batch', async () => {
    const batch = { sourceBatchId: 'batch-1', status: 'PROCESSING', punchCount: 3 };
    AttendanceImportBatch.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(batch) });

    await expect(repository.claim('batch-1', 3)).resolves.toEqual({ acquired: true, batch });
    expect(AttendanceImportBatch.findOneAndUpdate).toHaveBeenCalledWith(
      { sourceBatchId: 'batch-1', status: 'FAILED' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'PROCESSING', punchCount: 3 }) }),
      expect.objectContaining({ returnDocument: 'after', runValidators: true }),
    );
    expect(AttendanceImportBatch.create).not.toHaveBeenCalled();
  });

  test('returns the winning batch after a duplicate create race', async () => {
    const batch = { sourceBatchId: 'batch-1', status: 'PROCESSING', punchCount: 2 };
    AttendanceImportBatch.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    AttendanceImportBatch.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
    AttendanceImportBatch.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(batch) });

    await expect(repository.claim('batch-1', 2)).resolves.toEqual({ acquired: false, batch });
  });
});
