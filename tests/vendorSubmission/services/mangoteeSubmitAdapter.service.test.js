const adapter = require('../../../src/modules/vendorSubmission/services/submitAdapters/mangotee.adapter');

describe('MangoTee submit adapter', () => {
  const submission = {
    id: 'submission-1',
    orderItemId: 'item-1',
    payloadSnapshot: {
      externalOrderId: '111-7258289-0765048',
      orderSnapshot: {
        shippingAddress: {
          name: 'John Doe',
          addressLine1: '1 Main St',
          city: 'Austin',
          stateOrProvince: 'TX',
          postalCode: '78701',
          countryCode: 'US',
        },
      },
      orderItemSnapshot: { quantity: 1 },
      vendorCostCenter: { sku: 'G05000AIG000M' },
      fileChecks: [{ slotKey: 'FRONT', outputVendorUrl: 'https://cdn.example/front.png' }],
    },
  };

  test('builds the MangoV3 create-order shape', () => {
    const payload = adapter.buildPayload(submission, { idempotencyKey: 'vendor-submission:very-long-internal-key' });

    expect(payload).toMatchObject({
      order_id: '111-7258289-0765048',
      first_name: 'John',
      last_name: 'Doe',
      country: 'US',
      shipping_method: 'standard',
      items: [{
        sku: 'G05000AIG000M',
        quantity: 1,
        print_files: [{ key: 'front', url: 'https://cdn.example/front.png' }],
      }],
    });
    expect(() => adapter.validatePayload(payload)).not.toThrow();
  });

  test('submits with the configured vendor API key', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: true, data: { order_id: 'mango-1' } }),
    });

    const result = await adapter.submitPayload(adapter.buildPayload(submission), {
      credential: { baseUrl: 'https://v3.mangoteeprints.com/api/public/v1', accessToken: 'secret' },
    });

    expect(result).toMatchObject({ provider: 'MANGOTEE', externalId: 'mango-1' });
    expect(fetch).toHaveBeenCalledWith(
      'https://v3.mangoteeprints.com/api/public/v1/orders',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-API-Key': 'secret' }) }),
    );
  });
});
