const { buildCollection } = require('../../../tools/api-contract/buildOrderPostmanCollections');

const expectedCounts = { order: 36, customization: 13, integration: 16 };
const requests = (collection) => collection.item.flatMap((folder) => folder.item);

describe('order pipeline Postman collections', () => {
  test('quantity edit includes the concurrency guard and reason', () => {
    const entry = requests(buildCollection('order'))
      .find(({ name }) => name === 'PATCH /api/orders/items/:orderItemId/quantity');
    expect(JSON.parse(entry.request.body.raw)).toEqual({ quantity: 2, expectedQuantity: 1, reason: 'Buyer selected pack 2' });
  });
  test.each(Object.entries(expectedCounts))('%s covers its registered routes', (moduleName, count) => {
    const items = requests(buildCollection(moduleName));
    expect(items).toHaveLength(count);
    expect(new Set(items.map(({ name }) => name)).size).toBe(count);
  });

  test.each(['manual-excel', 'etsy-sold-order-items'])('%s import uses multipart upload', (suffix) => {
    const upload = requests(buildCollection('integration'))
      .find(({ name }) => name.endsWith(`/external-order-imports/${suffix}`));
    expect(upload.request.body.mode).toBe('formdata');
    expect(upload.request.body.formdata).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'file', type: 'file' }),
    ]));
  });
});
