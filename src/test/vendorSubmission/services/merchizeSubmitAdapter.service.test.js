const adapter = require('../../../modules/vendorSubmission/services/submitAdapters/merchize.adapter');

describe('merchize submit adapter', () => {
  const submission = {
    id: '660000000000000000120001',
    orderItemId: '660000000000000000120004',
    payloadSnapshot: {
      orderSnapshot: {
        shippingAddress: {
          name: 'Jane Buyer',
          addressLine1: '123 Main St',
          addressLine2: 'Apt 2',
          city: 'Boise',
          stateOrProvinceCode: 'ID',
          postalCode: '83701',
          countryCode: 'US',
          email: 'jane@example.com',
          phone: '1234567890',
        },
      },
      orderItemSnapshot: {
        externalOrderId: '113-TEST-ORDER',
        title: 'Senior Mom Shirt',
        productImageUrl: 'https://cdn.example/mockup.jpg',
      },
      vendorCostCenter: {
        sku: 'MZ-SKU-M-BLACK',
        standardSize: 'M',
        standardColor: 'Black',
      },
      fulfillQty: 2,
      fileChecks: [{
        slotKey: 'FRONT',
        outputAssetId: '660000000000000000120013',
      }],
    },
  };

  beforeEach(() => {
    global.fetch = jest.fn();
    process.env.MERCHIZE_API_BASE_URL = 'https://merchize.example/bo-api';
    process.env.MERCHIZE_ACCESS_TOKEN = 'token';
    process.env.API_PUBLIC_BASE_URL = 'https://api.example.com';
  });

  afterEach(() => {
    delete global.fetch;
    delete process.env.MERCHIZE_API_BASE_URL;
    delete process.env.MERCHIZE_ACCESS_TOKEN;
    delete process.env.API_PUBLIC_BASE_URL;
  });

  test('builds Merchize external order payload from submission snapshot', () => {
    const payload = adapter.buildPayload(submission);

    expect(payload).toMatchObject({
      order_id: '113-TEST-ORDER',
      shipping_info: {
        full_name: 'Jane Buyer',
        address_1: '123 Main St',
        address_2: 'Apt 2',
        city: 'Boise',
        state: 'ID',
        postcode: '83701',
        country: 'US',
        email: 'jane@example.com',
        phone: '1234567890',
      },
      items: [{
        name: 'Senior Mom Shirt',
        product_id: 'MZ-SKU-M-BLACK',
        sku: 'MZ-SKU-M-BLACK',
        merchize_sku: 'MZ-SKU-M-BLACK',
        quantity: 2,
        image: 'https://cdn.example/mockup.jpg',
        design_front: 'https://api.example.com/api/media/assets/660000000000000000120013/download',
        attributes: [
          { name: 'product', option: 'Senior Mom Shirt' },
          { name: 'Color', option: 'Black' },
          { name: 'Size', option: 'M' },
        ],
      }],
    });
  });

  test('validates missing required Merchize payload fields before POST', () => {
    const payload = adapter.buildPayload({
      ...submission,
      payloadSnapshot: {
        ...submission.payloadSnapshot,
        orderItemSnapshot: { externalOrderId: '113-TEST-ORDER' },
        vendorCostCenter: {},
        fileChecks: [],
      },
    });

    expect(() => adapter.validatePayload(payload)).toThrow(/image/);
  });

  test.each([
    ['shipping address', (payload) => { payload.shipping_info.address_1 = ''; }, /shipping_info\.address_1/],
    ['vendor SKU', (payload) => {
      payload.items[0].merchize_sku = null;
      payload.items[0].product_id = null;
      payload.items[0].sku = null;
    }, /merchize_sku/],
    ['product image', (payload) => { payload.items[0].image = null; }, /items\[0\]\.image/],
    ['scaled design', (payload) => { payload.items[0].design_front = null; }, /items\[0\]\.design_front/],
  ])('rejects a missing %s before POST', (_name, mutate, expected) => {
    const payload = adapter.buildPayload(submission);
    mutate(payload);

    expect(() => adapter.validatePayload(payload)).toThrow(expected);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('reports missing shipping address as a validation error', () => {
    const payload = adapter.buildPayload(submission);
    payload.shipping_info.address_1 = '';
    let thrown;

    try {
      adapter.validatePayload(payload);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  test('submits payload with bearer token and returns external id', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { _id: 'MZ-ID-1', data: { order_id: '113-TEST-ORDER' } } }),
      text: async () => '',
    });

    const payload = adapter.buildPayload(submission);
    const result = await adapter.submitPayload(payload);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://merchize.example/bo-api/order/external/orders',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(result).toMatchObject({
      provider: 'MERCHIZE',
      externalId: 'MZ-ID-1',
      response: { success: true },
    });
  });
});
