jest.mock('../../../src/modules/shipment/services/vendorTrackingAdapterRegistry.service', () => ({
  getTrackingAdapter: jest.fn(() => ({
    fetchTrackingByExternalOrderId: jest.fn().mockRejectedValue(
      Object.assign(new Error('Not found'), { vendorHttpStatus: 404 }),
    ),
  })),
}));

const { fetchLenfulOrder, getAdapter } = require('../../../src/modules/vendor/services/vendorIntegrationAdapterRegistry.service');
const { toLenfulOrderDto } = require('../../../src/modules/vendor/dtos/vendor.dto');

describe('vendorIntegrationAdapterRegistry.service', () => {
  test('tests Merchfox credentials with a one-order list request', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: [] }),
    });

    await expect(getAdapter('MERCHFOX').testConnection({
      credential: {
        apiKey: 'app-key',
        apiSecret: 'app-secret',
        baseUrl: 'https://api.merchfox.example',
      },
    })).resolves.toEqual({ provider: 'MERCHFOX' });

    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toBe('https://api.merchfox.example/api/v1/orders?limit=1');
    expect(options.headers).toMatchObject({
      'X-Mfx-App-Key': 'app-key',
      'X-Mfx-App-Secret': 'app-secret',
    });
  });

  test('treats a Merchize tracking 404 as an authenticated read-only connection probe', async () => {
    await expect(getAdapter('MERCHIZE').testConnection({ credential: { accessToken: 'token' } }))
      .resolves.toEqual({ provider: 'MERCHIZE' });
  });

  test('treats Merchize Order not found response as an authenticated connection probe', async () => {
    const tracking = require('../../../src/modules/shipment/services/vendorTrackingAdapterRegistry.service');
    tracking.getTrackingAdapter.mockReturnValueOnce({
      fetchTrackingByExternalOrderId: jest.fn().mockRejectedValue(
        Object.assign(new Error('MERCHIZE tracking request failed'), {
          vendorHttpStatus: 200,
          vendorMessage: 'Order not found.',
        }),
      ),
    });

    await expect(getAdapter('MERCHIZE').testConnection({ credential: { accessToken: 'token' } }))
      .resolves.toEqual({ provider: 'MERCHIZE' });
  });

  test('keeps Lenful customer addresses and client details out of the API DTO', () => {
    const result = toLenfulOrderDto({
      id: 'lenful-1',
      order_number: 'AMZ-1',
      shipping_address: { address_1: 'Private address' },
      client_details: { browser_ip: '127.0.0.1' },
    });

    expect(result).toMatchObject({ id: 'lenful-1', orderNumber: 'AMZ-1' });
    expect(result).not.toHaveProperty('shippingAddress');
    expect(result).not.toHaveProperty('clientDetails');
  });

  test('queries the Lenful order list by exact order number without exposing the credential', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: 'lenful-1',
          order_number: 'AMZ-1',
          status: 'Pending',
          currency: 'USD',
          total_price: 24.5,
          shipping_method: { name: 'Standard', price: 4.5 },
          shipping_address: { address_1: 'Private address' },
          client_details: { browser_ip: '127.0.0.1' },
          line_items: [{ id: 'line-1', product_name: 'Tee', quantity: 1, variant: { sku: 'LF-TEE-M' } }],
        }],
      }),
    });

    const order = await fetchLenfulOrder({
      credential: {
        accessToken: 'secret-token',
        baseUrl: 'https://s-lencam.lenful.com/api',
        orderEndpointUrl: 'https://lenful.example.test/api/order/list',
      },
      orderNumber: 'AMZ-1',
    });
    expect(order).toMatchObject({ id: 'lenful-1', order_number: 'AMZ-1', status: 'Pending' });

    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('https://lenful.example.test/api/order/list?page=1&limit=1');
    expect(options).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer secret-token' } });
    expect(JSON.parse(options.body)).toMatchObject({ keyword: 'AMZ-1', keywordType: 'order' });
  });
});
