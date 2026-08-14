const MediaAsset = require('../../../src/modules/media/models/mediaAsset.model');
const repository = require('../../../src/modules/media/repositories/mediaAsset.repository');

jest.mock('../../../src/modules/media/models/mediaAsset.model', () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

describe('mediaAsset repository list', () => {
  test('filters assets and applies pagination', async () => {
    const lean = jest.fn().mockResolvedValue([{ originalFilename: 'design.psd' }]);
    const limit = jest.fn(() => ({ lean }));
    const skip = jest.fn(() => ({ limit }));
    const sort = jest.fn(() => ({ skip }));
    MediaAsset.find.mockReturnValue({ sort });
    MediaAsset.countDocuments.mockResolvedValue(21);

    const result = await repository.list({
      q: ' design ',
      mimeGroup: 'IMAGE',
      provider: 'local',
      ownerType: 'ORDER_ITEM',
      status: 'ACTIVE',
      dateFrom: '2026-08-01T00:00:00.000Z',
      page: 2,
      limit: 20,
    });

    expect(MediaAsset.find).toHaveBeenCalledWith(expect.objectContaining({
      originalFilename: expect.any(RegExp),
      mimeType: /^image\//,
      provider: 'local',
      ownerType: 'ORDER_ITEM',
      discardedAt: null,
      createdAt: { $gte: new Date('2026-08-01T00:00:00.000Z') },
    }));
    expect(skip).toHaveBeenCalledWith(20);
    expect(limit).toHaveBeenCalledWith(20);
    expect(result.pagination).toEqual({ total: 21, page: 2, limit: 20 });
  });

  test('filters discarded and other MIME assets', async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    MediaAsset.find.mockReturnValue(chain);
    MediaAsset.countDocuments.mockResolvedValue(0);

    await repository.list({ mimeGroup: 'OTHER', status: 'DISCARDED' });

    expect(MediaAsset.find).toHaveBeenCalledWith(expect.objectContaining({
      mimeType: { $not: expect.any(RegExp) },
      discardedAt: { $ne: null },
    }));
  });

  test('defaults to active assets', async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    MediaAsset.find.mockReturnValue(chain);
    MediaAsset.countDocuments.mockResolvedValue(0);

    await repository.list({});

    expect(MediaAsset.find).toHaveBeenCalledWith(expect.objectContaining({
      discardedAt: null,
    }));
  });

  test('matches only caller-provided metadata when discarding an unattached asset', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'asset-1' });
    MediaAsset.findOneAndUpdate.mockReturnValue({ lean });

    await repository.markDiscardedIfMetadataMatches(
      'asset-1', { source: 'HR_AVATAR', profileId: 'profile-1' }, 'HR_AVATAR_REPLACED',
    );

    expect(MediaAsset.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'asset-1',
        discardedAt: null,
        'metadata.source': 'HR_AVATAR',
        'metadata.profileId': 'profile-1',
      },
      { $set: { discardedAt: expect.any(Date), discardReason: 'HR_AVATAR_REPLACED' } },
      { returnDocument: 'after', runValidators: true },
    );
  });
});
