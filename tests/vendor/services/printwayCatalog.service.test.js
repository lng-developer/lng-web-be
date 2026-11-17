const {
  fetchPrintwayCatalog,
  fetchPrintwayShippingMethods,
  getAdapter,
} = require('../../../src/modules/vendor/services/vendorIntegrationAdapterRegistry.service');

describe('Printway Catalog Integration Adapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('fetches Printway catalog successfully with query and headers', async () => {
    const mockResponse = {
      success: true,
      message: 'Get products list successfully.',
      page: 1,
      limit: 10,
      length: 100,
      totalPage: 10,
      data: [
        {
          _id: 'pw-prod-1',
          product_name: 'DTG | Unisex Jersey Tee - Bella Canvas 3001',
          code: 'USJT',
          mockup_url: 'https://cdn.printway.io/mockup.jpg',
          categories: [{ name: 'T-Shirts' }],
          variants: [
            {
              variant_id: 'USJT-236505',
              variant_title: 'ORANGE/2XL/BACK',
              item_sku: 'PW-USJT-ORANGE-2XL-BACK',
              attributes: [
                { name: 'Color', value: 'ORANGE' },
                { name: 'Size', value: '2XL' },
              ],
              locations: [
                {
                  made_in_location: 'US',
                  base_cost: 11.6,
                  tier_cost: 11.4,
                },
              ],
            },
          ],
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await fetchPrintwayCatalog({
      credential: {
        baseUrl: 'https://apis.printway.io',
        accessToken: 'test-printway-token',
      },
      query: { q: 'Jersey', page: 1, limit: 10 },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].code).toBe('USJT');
    expect(result.pagination).toEqual({ page: 1, limit: 10, total: 100, pages: 10 });

    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toBe('https://apis.printway.io/v3/products/list');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ page: 1, limit: 10, search: 'Jersey' });
    expect(options.headers).toMatchObject({
      'pw-access-token': 'test-printway-token',
      Authorization: 'Bearer test-printway-token',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  });

  test('normalizes baseUrl that already ends with /v3', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    });

    await fetchPrintwayCatalog({
      credential: {
        baseUrl: 'https://apis.printway.io/v3',
        accessToken: 'test-token',
      },
    });

    const [url] = global.fetch.mock.calls[0];
    expect(String(url)).toBe('https://apis.printway.io/v3/products/list');
  });

  test('fetches Printway shipping methods for variant IDs', async () => {
    const mockShippingResponse = {
      success: true,
      data: {
        product_data: [
          {
            variant_id: 'USJT-236505',
            locations: [
              {
                made_in_location: 'US',
                product_location: [
                  {
                    code: 'PW-4',
                    shipping_services: [
                      {
                        shipping_name: 'US Standard',
                        shipping_code: 'US',
                        shipping_fee: 4.99,
                        shipping_extra_fee: 1.99,
                      },
                      {
                        shipping_name: 'International',
                        shipping_code: 'ITN',
                        shipping_fee: 9.99,
                        shipping_extra_fee: 3.99,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockShippingResponse,
    });

    const shipping = await fetchPrintwayShippingMethods({
      credential: {
        baseUrl: 'https://apis.printway.io',
        accessToken: 'test-token',
      },
      variantIds: ['USJT-236505'],
    });

    expect(shipping).toHaveLength(1);
    expect(shipping[0].variant_id).toBe('USJT-236505');

    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toBe('https://apis.printway.io/v3/products/retrieved-shipping-methods');
    expect(JSON.parse(options.body)).toEqual({ variant_id: ['USJT-236505'], sku: [] });
  });

  test('throws validation error when Printway credentials are not configured', async () => {
    await expect(fetchPrintwayCatalog({ credential: {} }))
      .rejects.toThrow('PRINTWAY catalog credentials are not configured');
  });

  test('adapter registry routes PRINTWAY to fetchPrintwayCatalog and fetchPrintwayShippingMethods', () => {
    const adapter = getAdapter('PRINTWAY');
    expect(adapter).toBeDefined();
    expect(adapter.fetchCatalog).toBeInstanceOf(Function);
    expect(adapter.fetchShippingMethods).toBeInstanceOf(Function);
  });
});
