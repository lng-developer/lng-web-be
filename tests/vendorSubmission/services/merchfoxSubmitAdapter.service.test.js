const merchfox = require('../../../src/modules/vendorSubmission/services/submitAdapters/merchfox.adapter');

describe('merchfox submit adapter', () => {
  test('submits an accepted QC payload through Merchfox auto-submit', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { id: 'mf-order-1', status: 'PENDING', assets: 'PROCESSING' } }),
    });
    const submission = {
      id: 'submission-1',
      payloadSnapshot: {
        orderSnapshot: {
          shippingAddress: {
            name: 'Jane Buyer', addressLine1: '1 Main St', city: 'Austin', stateOrProvinceCode: 'TX', countryCode: 'US', postalCode: '78701',
          },
        },
        orderItemSnapshot: { externalOrderId: 'AMZ-1', quantity: 1 },
        vendorCostCenter: { sku: '55104' },
        fileChecks: [{ slotKey: 'FRONT', outputVendorUrl: 'https://cdn.example/front.png' }],
      },
    };

    await expect(merchfox.submitPayload(merchfox.buildPayload(submission, { idempotencyKey: 'vendor-submission:1' }), {
      credential: { baseUrl: 'https://api.merchfox.example', apiKey: 'app-key', apiSecret: 'app-secret' },
    })).resolves.toMatchObject({ provider: 'MERCHFOX', externalId: 'mf-order-1' });

    expect(String(global.fetch.mock.calls[0][0])).toBe('https://api.merchfox.example/api/v1/orders/quick/submit');
  });
});
