const {
  validate,
  updateVendorIntegrationConfigSchema,
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
});
