const mockFind = jest.fn();
const mockFindOneAndUpdate = jest.fn();

jest.mock('../../../modules/media/models/mediaAsset.model', () => ({
  find: mockFind,
  findOneAndUpdate: mockFindOneAndUpdate,
}));

const repository = require('../../../modules/media/repositories/mediaAsset.repository');

describe('mediaAsset.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('findIdsByOriginalFilename returns only IDs for a normalized filename prefix', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: '660000000000000000510007' }]),
    };
    mockFind.mockReturnValue(query);

    await expect(repository.findIdsByOriginalFilename('  master ')).resolves.toEqual([
      '660000000000000000510007',
    ]);

    expect(mockFind).toHaveBeenCalledWith({
      originalFilename: expect.objectContaining({ source: '^master', flags: 'i' }),
    });
    expect(query.select).toHaveBeenCalledWith('_id');
    expect(query.limit).toHaveBeenCalledWith(5000);
  });

  test('markDiscardedIfMetadataMatches atomically guards the upload identity', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: '660000000000000000000901', discardedAt: new Date() });
    mockFindOneAndUpdate.mockReturnValue({ lean });

    await repository.markDiscardedIfMetadataMatches(
      '660000000000000000000901',
      { source: 'PRODUCTION_SCALED_OUTPUT', taskId: 'task-1', fileCheckId: 'check-1', uploadedBy: 'user-1' },
      'QC_PASS_CAS_LOST',
    );

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: '660000000000000000000901',
        discardedAt: null,
        'metadata.source': 'PRODUCTION_SCALED_OUTPUT',
        'metadata.taskId': 'task-1',
        'metadata.fileCheckId': 'check-1',
        'metadata.uploadedBy': 'user-1',
      },
      { $set: { discardedAt: expect.any(Date), discardReason: 'QC_PASS_CAS_LOST' } },
      { returnDocument: 'after', runValidators: true },
    );
  });
});
