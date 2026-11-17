const {
  fetchMangoteeCatalog,
  fetchMangoteeVariations,
  getAdapter,
} = require('../../../src/modules/vendor/services/vendorIntegrationAdapterRegistry.service');

describe('Mangotee Catalog Integration Adapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('fetches Mangotee catalog successfully with query and X-API-Key', async () => {
    const mockResponse = {
      items: [
        {
          id: 'prod-101',
          name: 'Classic Unisex T-Shirt',
          sku: 'MGT-TEE-01',
          catalog_name: 'Apparel',
          base_price: 8.5,
          currency: 'USD',
          is_active: true,
          images: ['https://cdn.mangoteeprints.com/img1.jpg'],
          attributes: { material: '100% Cotton' },
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        pages: 1,
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await fetchMangoteeCatalog({
      credential: {
        apiKey: 'test-mangotee-key',
      },
      query: { q: 'Classic', page: 1, limit: 20 },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sku).toBe('MGT-TEE-01');
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, pages: 1 });

    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/products?page=1&limit=20&name=Classic');
    expect(options.headers).toMatchObject({
      'X-API-Key': 'test-mangotee-key',
      Accept: 'application/json',
    });
  });

  test('fetches Mangotee variations for a product successfully', async () => {
    const mockVariations = [
      {
        id: 'var-1',
        product_id: 'prod-101',
        name: 'Classic Unisex T-Shirt - Black / L',
        sku: 'MGT-TEE-01-BLK-L',
        color: 'Black',
        size: 'L',
        price: 8.5,
        is_available: true,
        attributes: { print_areas: ['front', 'back'] },
      },
      {
        id: 'var-2',
        product_id: 'prod-101',
        name: 'Classic Unisex T-Shirt - White / M',
        sku: 'MGT-TEE-01-WHT-M',
        color: 'White',
        size: 'M',
        price: 8.0,
        is_available: true,
      },
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockVariations,
    });

    const variations = await fetchMangoteeVariations({
      credential: {
        accessToken: 'bearer-or-api-key',
      },
      productId: 'prod-101',
    });

    expect(variations.items).toHaveLength(2);
    expect(variations.items[0].sku).toBe('MGT-TEE-01-BLK-L');

    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/products/prod-101/variations');
    expect(options.headers).toMatchObject({
      'X-API-Key': 'bearer-or-api-key',
    });
  });

  test('throws validation error when Mangotee credentials are not configured', async () => {
    await expect(fetchMangoteeCatalog({ credential: {} }))
      .rejects.toThrow('MANGOTEE catalog credentials are not configured');
  });

  test('adapter registry routes MANGOTEE to fetchMangoteeCatalog and fetchMangoteeVariations', async () => {
    const adapter = getAdapter('MANGOTEE');
    expect(adapter).toBeDefined();
    expect(adapter.fetchCatalog).toBeInstanceOf(Function);
    expect(adapter.fetchVariations).toBeInstanceOf(Function);
  });
});
