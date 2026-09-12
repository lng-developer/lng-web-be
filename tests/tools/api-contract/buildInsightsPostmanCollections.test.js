const { buildCollection } = require('../../../tools/api-contract/buildInsightsPostmanCollections');

const expectedCounts = { finance: 21, report: 17, audit: 5, notification: 4, workScore: 7 };
const requests = (collection) => collection.item.flatMap((folder) => folder.item);

describe('insight Postman collections', () => {
  test.each(Object.entries(expectedCounts))('%s covers its registered routes', (moduleName, count) => {
    const items = requests(buildCollection(moduleName));
    expect(items).toHaveLength(count);
    expect(new Set(items.map(({ name }) => name)).size).toBe(count);
  });

  test.each(['transactions', 'settlements', 'ads'])('finance %s import uses multipart', (source) => {
    const upload = requests(buildCollection('finance'))
      .find(({ name }) => name === `POST /api/finance/imports/${source}`);
    expect(upload.request.body.mode).toBe('formdata');
    expect(upload.request.body.formdata).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'file', type: 'file' }),
      expect.objectContaining({ key: 'dryRun', value: 'true' }),
    ]));
  });
});
