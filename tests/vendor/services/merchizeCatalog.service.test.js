const { fetchMerchizeCatalog, getAdapter } = require('../../../src/modules/vendor/services/vendorIntegrationAdapterRegistry.service');

describe('Merchize Catalog Integration Adapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('fetches Merchize catalog successfully with search query and Bearer token', async () => {
    const mockResponse = {
      success: true,
      data: {
        page: 1,
        limit: 50,
        total: 1,
        products: [
          {
            _id: 'prod-123',
            sku: 'LSRLVN',
            title: 'Long Sleeve Pajamas',
            printing_methods: ['DTF', 'DTG'],
            variants: [
              {
                sku: 'LSRLVN-XS',
                attributes: [{ type: 'size', value_text: 'XS' }],
                tiers: [{ name: 'tier1', price: 15.75 }],
                shipping_prices: [{ to_zone: 'US', first_item: 4.99, additional_item: 1.99 }],
              },
            ],
          },
        ],
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await fetchMerchizeCatalog({
      credential: {
        baseUrl: 'https://seller.merchize.com',
        accessToken: 'test-token',
      },
      query: { q: 'LSRLVN', page: 1, limit: 10 },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sku).toBe('LSRLVN');
    expect(result.pagination).toEqual({ page: 1, limit: 10, total: 1 });

    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/product/catalog?page=1&limit=10&search=LSRLVN');
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });
  });

  test('uses x-api-key header when apiKey is configured instead of accessToken', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { products: [] } }),
    });

    await fetchMerchizeCatalog({
      credential: {
        baseUrl: 'https://seller.merchize.com',
        apiKey: 'my-api-key',
      },
      query: {},
    });

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers).toMatchObject({
      'x-api-key': 'my-api-key',
    });
    expect(options.headers.Authorization).toBeUndefined();
  });

  test('throws validation error when credentials are not configured', async () => {
    await expect(fetchMerchizeCatalog({ credential: {} }))
      .rejects.toThrow('MERCHIZE catalog credentials are not configured');
  });

  test('adapter registry routes MERCHIZE to fetchMerchizeCatalog', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { products: [{ sku: 'TEST' }] } }),
    });

    const adapter = getAdapter('MERCHIZE');
    expect(adapter).toBeDefined();
    expect(adapter.fetchCatalog).toBeInstanceOf(Function);

    const result = await adapter.fetchCatalog({
      credential: { baseUrl: 'https://seller.merchize.com', accessToken: 'token' },
      query: { q: 'TEST' },
    });
    expect(result.items).toHaveLength(1);
  });
});
