jest.mock('../../../src/modules/catalog/models/internalTemplate.model', () => ({
  aggregate: jest.fn(),
}));

const InternalTemplate = require('../../../src/modules/catalog/models/internalTemplate.model');
const repository = require('../../../src/modules/catalog/repositories/internalTemplate.repository');

describe('internalTemplate.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('lists active option rows with template counts and compact product type groups', async () => {
    InternalTemplate.aggregate.mockResolvedValue([{ _id: 'template-id', code: 'TS-01' }]);

    await expect(repository.listActiveForOptions()).resolves.toEqual([{ _id: 'template-id', code: 'TS-01' }]);

    expect(InternalTemplate.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      { $match: { status: 'ACTIVE' } },
      expect.objectContaining({ $lookup: expect.objectContaining({ from: 'producttypegroups' }) }),
      expect.objectContaining({ $project: expect.objectContaining({
        requiredFieldsCount: expect.any(Object),
        artworkSlotsCount: expect.any(Object),
        designAssetsCount: expect.any(Object),
      }) }),
    ]));
  });
});
