const adapter = require('../../../modules/vendorSubmission/services/submitAdapters/lenful.adapter');

describe('lenful submit adapter', () => {
  const submission = {
    id: '660000000000000000140001',
    payloadSnapshot: {
      orderSnapshot: {
        shippingAddress: {
          name: 'Jane Buyer',
          addressLine1: '859 Brownwood Ave SE',
          addressLine2: 'Atlanta',
          city: 'New York',
          stateOrProvince: 'New York',
          postalCode: '30316',
          countryCode: 'US',
          email: 'jane@example.com',
          phone: '1234567890',
        },
      },
      orderItemSnapshot: {
        externalOrderId: 'LENFUL-TEST-1',
        title: 'Lenful Mouse Pad',
        productImageUrl: 'https://cdn.example/mockup.jpg',
      },
      vendorCostCenter: {
        sku: 'LFCG75449',
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
    process.env.LENFUL_API_BASE_URL = 'https://s-lencam.lenful.com/api';
    process.env.LENFUL_ACCESS_TOKEN = 'token';
    process.env.LENFUL_STORE_ID = 'store-1';
  });

  afterEach(() => {
    delete global.fetch;
    delete process.env.LENFUL_API_BASE_URL;
    delete process.env.LENFUL_ACCESS_TOKEN;
    delete process.env.LENFUL_STORE_ID;
  });

  test('builds Lenful create order payload from submission snapshot', () => {
    expect(adapter.buildPayload(submission)).toMatchObject({
      order_number: 'LENFUL-TEST-1',
      first_name: 'Jane',
      last_name: 'Buyer',
      email: 'jane@example.com',
      country_code: 'US',
      province: 'New York',
      city: 'New York',
      zip: '30316',
      address_1: '859 Brownwood Ave SE',
      items: [{
        design_sku: 'LENFUL-TEST-1',
        product_sku: 'LFCG75449',
        quantity: 1,
        mockups: ['https://cdn.example/mockup.jpg'],
        designs: [{ position: 1, link: 'https://cdn.example/front.png' }],
        request_clone: false,
        shipping_method: 0,
      }],
    });
  });

  test('validates missing required Lenful payload fields before POST', () => {
    const payload = adapter.buildPayload({
      payloadSnapshot: {
        orderItemSnapshot: { externalOrderId: 'LENFUL-TEST-1' },
        vendorCostCenter: {},
        fileChecks: [],
      },
    });

    expect(() => adapter.validatePayload(payload)).toThrow(/product_sku/);
  });

  test('submits payload with bearer token and store id', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { _id: 'LF-1', order_number: 'LENFUL-TEST-1' } }),
      text: async () => '',
    });

    const result = await adapter.submitPayload(adapter.buildPayload(submission));

    expect(global.fetch).toHaveBeenCalledWith(
      'https://s-lencam.lenful.com/api/order/store-1/create?isCheckOrderNumber=false',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(result).toMatchObject({
      provider: 'LENFUL',
      externalId: 'LF-1',
      response: { success: true },
    });
  });
});
