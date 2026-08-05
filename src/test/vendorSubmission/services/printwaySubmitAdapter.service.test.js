const adapter = require('../../../modules/vendorSubmission/services/submitAdapters/printway.adapter');

describe('printway submit adapter', () => {
  const submission = {
    id: '660000000000000000130001',
    payloadSnapshot: {
      orderSnapshot: {
        shippingAddress: {
          name: 'Jane Buyer',
          addressLine1: '581 Cherrywood Drive',
          addressLine2: '',
          city: 'Sunnyvale',
          stateOrProvince: 'California',
          stateOrProvinceCode: 'CA',
          postalCode: '94087',
          country: 'United States',
          countryCode: 'US',
          email: 'jane@example.com',
          phone: '1234567890',
        },
      },
      orderItemSnapshot: {
        externalOrderId: 'PRINTWAY-TEST-1',
        title: 'Printway Pot',
        productImageUrl: 'https://cdn.example/mockup.jpg',
      },
      vendorCostCenter: {
        sku: 'PW-CMPP-3.54X2.67 INCHES',
        standardSize: '3.54X2.67 INCHES',
      },
      fulfillQty: 1,
      fileChecks: [{
        slotKey: 'FRONT',
        outputAssetDownloadUrl: 'https://cdn.example/front.png',
      }],
    },
  };

  beforeEach(() => {
    global.fetch = jest.fn();
    process.env.PRINTWAY_API_BASE_URL = 'https://apis.printway.io/v3';
    process.env.PRINTWAY_ACCESS_TOKEN = 'token';
  });

  afterEach(() => {
    delete global.fetch;
    delete process.env.PRINTWAY_API_BASE_URL;
    delete process.env.PRINTWAY_ACCESS_TOKEN;
  });

  test('builds Printway create-new-order payload from submission snapshot', () => {
    expect(adapter.buildPayload(submission)).toMatchObject({
      order_id: 'PRINTWAY-TEST-1',
      firstName: 'Jane',
      lastName: 'Buyer',
      shipping_address1: '581 Cherrywood Drive',
      shipping_city: 'Sunnyvale',
      shipping_province_code: 'CA',
      shipping_zip: '94087',
      shipping_country_code: 'US',
      order_items: [{
        product_name: 'Printway Pot',
        item_sku: 'PW-CMPP-3.54X2.67 INCHES',
        quantity: 1,
        mockup_url: 'https://cdn.example/mockup.jpg',
        artwork_front: 'https://cdn.example/front.png',
      }],
    });
  });

  test('validates missing required Printway payload fields before POST', () => {
    const payload = adapter.buildPayload({
      payloadSnapshot: {
        orderItemSnapshot: { externalOrderId: 'PRINTWAY-TEST-1' },
        vendorCostCenter: {},
        fileChecks: [],
      },
    });

    expect(() => adapter.validatePayload(payload)).toThrow(/item_sku/);
  });

  test('does not invent recipient contact data', () => {
    const payload = adapter.buildPayload({
      ...submission,
      payloadSnapshot: {
        ...submission.payloadSnapshot,
        orderSnapshot: { shippingAddress: { ...submission.payloadSnapshot.orderSnapshot.shippingAddress, name: '', email: '', phone: '' } },
      },
    });

    expect(payload).toMatchObject({ firstName: '', lastName: '', shipping_email: '', shipping_phone: '' });
  });

  test('submits payload with pw-access-token and returns external id', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { pw_order_id: 'PW-1', order_name: 'PRINTWAY-TEST-1' } }),
      text: async () => '',
    });

    const result = await adapter.submitPayload(adapter.buildPayload(submission), {
      credential: { baseUrl: 'https://apis.printway.io/v3', accessToken: 'token' },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://apis.printway.io/v3/order/create-new-order',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'pw-access-token': 'token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(result).toMatchObject({
      provider: 'PRINTWAY',
      externalId: 'PW-1',
      response: { success: true },
    });
  });
});
