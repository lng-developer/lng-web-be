jest.mock('../../../src/modules/catalog/models/productTypeGroup.model', () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
}));

const ProductTypeGroup = require('../../../src/modules/catalog/models/productTypeGroup.model');
const repository = require('../../../src/modules/catalog/repositories/productTypeGroup.repository');

describe('productTypeGroup.repository', () => {
  beforeEach(() => jest.clearAllMocks());

  test('finds product types when search text occurs within the code or name', async () => {
    const query = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    ProductTypeGroup.find.mockReturnValue(query);
    ProductTypeGroup.countDocuments.mockResolvedValue(0);

    await repository.list({ page: 1, limit: 20, search: 'shirt' });

    const filter = ProductTypeGroup.find.mock.calls[0][0];
    expect(filter.$or).toEqual([{ code: /shirt/i }, { name: /shirt/i }]);
    expect(filter.$or[1].name.test('Bella Canvas T-Shirt')).toBe(true);
  });

  test('lists compact active option rows without counting', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: 'group-id', code: 'TSHIRT' }]),
    };
    ProductTypeGroup.find.mockReturnValue(query);

    await expect(repository.listActiveForOptions()).resolves.toEqual([{ _id: 'group-id', code: 'TSHIRT' }]);

    expect(ProductTypeGroup.find).toHaveBeenCalledWith({ status: 'ACTIVE' });
    expect(query.select).toHaveBeenCalledWith('code name sortOrder printMethod status createdAt updatedAt');
    expect(query.sort).toHaveBeenCalledWith({ sortOrder: 1, name: 1, code: 1, _id: 1 });
  });
});
