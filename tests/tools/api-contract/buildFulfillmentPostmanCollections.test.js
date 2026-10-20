const { buildCollection } = require('../../../tools/api-contract/buildFulfillmentPostmanCollections');

const expectedCounts = { design: 26, production: 27, vendorSubmission: 15, shipment: 18 };
const requests = (collection) => collection.item.flatMap((folder) => folder.item);

describe('fulfillment Postman collections', () => {
  test.each(Object.entries(expectedCounts))('%s covers its registered routes', (moduleName, count) => {
    const items = requests(buildCollection(moduleName));
    expect(items).toHaveLength(count);
    expect(new Set(items.map(({ name }) => name)).size).toBe(count);
  });

  test.each([
    ['design', 'POST /api/design/assets'],
    ['production', 'POST /api/production/tasks/:taskId/file-checks/:fileCheckId/scaled-output-file'],
  ])('%s file endpoint uses multipart', (moduleName, routeName) => {
    const upload = requests(buildCollection(moduleName)).find(({ name }) => name === routeName);
    expect(upload.request.body).toMatchObject({ mode: 'formdata' });
    expect(upload.request.body.formdata).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'file', type: 'file' }),
    ]));
  });

  test('public shipment webhook uses its shared-secret header without bearer auth', () => {
    const webhook = requests(buildCollection('shipment'))
      .find(({ name }) => name === 'POST /api/shipments/vendor-webhooks/:provider');
    expect(webhook.request.auth).toBeUndefined();
    expect(webhook.request.header).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'x-vendor-webhook-secret' }),
    ]));
  });
});
