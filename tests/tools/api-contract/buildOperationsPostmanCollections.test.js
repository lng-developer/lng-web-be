const { buildCollection } = require('../../../tools/api-contract/buildOperationsPostmanCollections');

const expectedCounts = { catalog: 24, mapping: 42, vendor: 21, media: 9 };

function requests(collection) {
  return collection.item.flatMap((folder) => folder.item);
}

describe('operations Postman collections', () => {
  test.each(Object.entries(expectedCounts))('%s covers its registered routes', (moduleName, count) => {
    const items = requests(buildCollection(moduleName));
    expect(items).toHaveLength(count);
    expect(new Set(items.map(({ name }) => name)).size).toBe(count);
  });

  test('new file endpoints use multipart bodies', () => {
    for (const moduleName of ['catalog', 'media']) {
      const upload = requests(buildCollection(moduleName)).find(({ name }) => name === `POST /api/${moduleName}/assets`);
      expect(upload.request.body).toMatchObject({ mode: 'formdata', formdata: [{ key: 'file', type: 'file', src: [] }] });
    }
  });
});
