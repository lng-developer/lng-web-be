jest.mock('../../../src/modules/catalog/models/productTypeGroup.model', () => ({
  find: jest.fn(),
}));

const ProductTypeGroup = require('../../../src/modules/catalog/models/productTypeGroup.model');
const repository = require('../../../src/modules/catalog/repositories/productTypeGroup.repository');

describe('productTypeGroup.repository', () => {
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
