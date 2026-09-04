const InternalTemplate = require('../../../src/modules/catalog/models/internalTemplate.model');

describe('InternalTemplate model', () => {
  test('code is uppercase trim unique and immutable', () => {
    const codePath = InternalTemplate.schema.path('code');
    const uniqueIndexes = InternalTemplate.schema.indexes()
      .filter(([, options]) => options && options.unique)
      .map(([fields]) => fields);

    expect(codePath.options.uppercase).toBe(true);
    expect(codePath.options.trim).toBe(true);
    expect(codePath.options.immutable).toBe(true);
    expect(uniqueIndexes).toContainEqual({ code: 1 });
  });

  test('indexes active templates by code for listing options', () => {
    const indexes = InternalTemplate.schema.indexes().map(([fields]) => fields);

    expect(indexes).toContainEqual({ status: 1, code: 1 });
  });

  test('rejects invalid field, slot, and design asset types', async () => {
    const template = new InternalTemplate({
      code: 'NAPKIN',
      name: 'Napkin Template',
      productTypeGroupId: '660000000000000000000301',
      requiredFields: [{ key: 'customName', type: 'BAD_TYPE' }],
      artworkSlots: [{ key: 'front', type: 'BAD_TYPE' }],
      designAssets: [{
        type: 'BAD_TYPE',
        mediaAssetId: '660000000000000000000901',
      }],
    });

    await expect(template.validate()).rejects.toThrow();
  });
});
