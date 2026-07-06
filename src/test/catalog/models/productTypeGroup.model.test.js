const ProductTypeGroup = require('../../../modules/catalog/models/productTypeGroup.model');

describe('ProductTypeGroup model', () => {
  test('code is uppercase trim unique', () => {
    const codePath = ProductTypeGroup.schema.path('code');
    const uniqueIndexes = ProductTypeGroup.schema.indexes()
      .filter(([, options]) => options && options.unique)
      .map(([fields]) => fields);

    expect(codePath.options.uppercase).toBe(true);
    expect(codePath.options.trim).toBe(true);
    expect(uniqueIndexes).toContainEqual({ code: 1 });
  });

  test('sortOrder is indexed integer for manual display order', async () => {
    const sortOrderPath = ProductTypeGroup.schema.path('sortOrder');
    const indexes = ProductTypeGroup.schema.indexes().map(([fields]) => fields);

    expect(sortOrderPath.options.default).toBe(0);
    expect(indexes).toContainEqual({ sortOrder: 1, name: 1 });

    const group = new ProductTypeGroup({
      code: 'SHIRT',
      name: 'Shirt',
      sortOrder: 1.5,
    });

    await expect(group.validate()).rejects.toThrow('sortOrder must be an integer');
  });
});
