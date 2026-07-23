const mockFind = jest.fn();

jest.mock('../../../modules/media/models/mediaAsset.model', () => ({
  find: mockFind,
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
});
