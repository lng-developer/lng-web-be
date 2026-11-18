const {
  validate,
  updateVendorIntegrationConfigSchema,
  importPrintwayCatalogProductsSchema,
} = require('../../../src/modules/vendor/validators/vendor.validator');

describe('vendor integration contract', () => {
  test('accepts Native mode with adapterKey', () => {
    const result = validate(updateVendorIntegrationConfigSchema, {
      mode: 'NATIVE',
      adapterKey: 'PRINTWAY',
      baseUrl: 'https://vendor.example',
      authType: 'API_KEY',
      accessToken: 'token',
    });

    expect(result.details).toBeUndefined();
    expect(result.value).toMatchObject({ mode: 'NATIVE', adapterKey: 'PRINTWAY' });
  });

  test('accepts Manual mode without connection fields', () => {
    const result = validate(updateVendorIntegrationConfigSchema, { mode: 'MANUAL' });

    expect(result.details).toBeUndefined();
    expect(result.value).toMatchObject({ mode: 'MANUAL' });
  });

  test('rejects Native mode without a native adapterKey', () => {
    const result = validate(updateVendorIntegrationConfigSchema, {
      mode: 'NATIVE',
      baseUrl: 'https://vendor.example',
      authType: 'API_KEY',
      accessToken: 'token',
    });

    expect(result.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['adapterKey'] }),
    ]));
  });

  test('accepts Generic API mode without a native adapterKey', () => {
    const result = validate(updateVendorIntegrationConfigSchema, {
      mode: 'GENERIC_API',
      baseUrl: 'https://vendor.example',
      authType: 'API_KEY',
      accessToken: 'token',
    });

    expect(result.details).toBeUndefined();
    expect(result.value).toMatchObject({ mode: 'GENERIC_API' });
  });

  test('keeps the legacy providerKey payload valid during migration', () => {
    const result = validate(updateVendorIntegrationConfigSchema, {
      providerKey: 'PRINTWAY',
      baseUrl: 'https://vendor.example',
      authType: 'API_KEY',
      accessToken: 'token',
    });

    expect(result.details).toBeUndefined();
  });

  test('accepts an empty expiry sent by the integration form', () => {
    const result = validate(updateVendorIntegrationConfigSchema, {
      mode: 'NATIVE',
      adapterKey: 'LNG_GROUP',
      providerKey: 'LNG_GROUP',
      baseUrl: 'https://fulfillment.lngmerch.co',
      authType: 'API_KEY',
      accessToken: 'token',
      expiresAt: '',
    });

    expect(result.details).toBeUndefined();
  });

  test('accepts printway catalog products with non-standard or unencoded mockup and template urls', () => {
    const result = validate(importPrintwayCatalogProductsSchema, {
      products: [
        {
          code: 'PW-PROD-1',
          product_name: 'Custom Product 1',
          mockup_url: 'https://cdn.printway.io/templates/My Mockup (1).png',
          template_mockup_url: 'https://cdn.printway.io/templates/Custom Template (2).psd',
        },
        {
          code: 'PW-PROD-2',
          product_name: 'Custom Product 2',
          mockup_url: '/relative/path/mockup.jpg',
          template_mockup_url: 'N/A',
        },
        {
          code: 'PW-PROD-3',
          product_name: 'Custom Product 3',
          mockup_url: null,
          template_mockup_url: '',
        },
      ],
    });

    expect(result.details).toBeUndefined();
    expect(result.value.products).toHaveLength(3);
    expect(result.value.products[0].template_mockup_url).toBe('https://cdn.printway.io/templates/Custom Template (2).psd');
    expect(result.value.products[1].template_mockup_url).toBe('N/A');
  });
});
