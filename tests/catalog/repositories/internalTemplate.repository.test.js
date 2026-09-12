jest.mock('../../../src/modules/catalog/models/internalTemplate.model', () => ({
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
  find: jest.fn(),
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

  test('finds templates when text occurs within their code or name', async () => {
    const query = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    InternalTemplate.find.mockReturnValue(query);
    InternalTemplate.countDocuments.mockResolvedValue(0);

    await repository.list({ page: 1, limit: 20, q: 'shirt' });

    const filter = InternalTemplate.find.mock.calls[0][0];
    expect(filter.$or).toEqual([{ code: /shirt/i }, { name: /shirt/i }]);
    expect(filter.$or[1].name.test('Bella Canvas T-Shirt')).toBe(true);
  });
});
