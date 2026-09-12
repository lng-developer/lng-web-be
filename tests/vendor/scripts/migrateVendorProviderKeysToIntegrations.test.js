jest.mock('../../../src/modules/vendor/models/vendor.model', () => ({
  find: jest.fn(),
}));

jest.mock('../../../src/modules/vendor/models/vendorIntegrationConfig.model', () => ({
  find: jest.fn(),
  updateOne: jest.fn(),
}));

const Vendor = require('../../../src/modules/vendor/models/vendor.model');
const VendorIntegrationConfig = require('../../../src/modules/vendor/models/vendorIntegrationConfig.model');
const {
  buildMigrationPlan,
  migrateVendorProviderKeysToIntegrations,
} = require('../../../src/modules/vendor/scripts/migrateVendorProviderKeysToIntegrations');

function query(value) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) };
}

describe('migrateVendorProviderKeysToIntegrations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('plans native integrations and skips vendors with an existing config', () => {
    expect(buildMigrationPlan(
      [{ _id: 'vendor-1', providerKey: 'printway' }, { _id: 'vendor-2', providerKey: 'MERCHIZE' }],
      [{ vendorId: 'vendor-2', providerKey: 'MERCHIZE', mode: 'NATIVE', adapterKey: 'MERCHIZE' }],
    )).toEqual({
      plans: [{ vendorId: 'vendor-1', providerKey: 'PRINTWAY', mode: 'NATIVE', adapterKey: 'PRINTWAY' }],
      normalizations: [],
      skipped: [{ vendorId: 'vendor-2', providerKey: 'MERCHIZE', reason: 'INTEGRATION_EXISTS' }],
    });
  });

  test('does not invent a native adapter for legacy CUSTOM providers', () => {
    expect(buildMigrationPlan([{ _id: 'vendor-custom', providerKey: 'CUSTOM' }], [])).toEqual({
      plans: [],
      normalizations: [],
      skipped: [{
        vendorId: 'vendor-custom',
        providerKey: 'CUSTOM',
        reason: 'GENERIC_PROVIDER_REQUIRES_CONFIGURATION',
      }],
    });
  });

  test('normalizes an existing legacy CUSTOM integration to Generic API', () => {
    expect(buildMigrationPlan(
      [{ _id: 'vendor-custom', providerKey: 'CUSTOM' }],
      [{ vendorId: 'vendor-custom', providerKey: 'CUSTOM' }],
    )).toEqual({
      plans: [],
      normalizations: [{ vendorId: 'vendor-custom', providerKey: 'CUSTOM', mode: 'GENERIC_API', adapterKey: null }],
      skipped: [],
    });
  });

  test('does not override an explicitly configured integration mode', () => {
    expect(buildMigrationPlan(
      [{ _id: 'vendor-generic', providerKey: 'PRINTWAY' }],
      [{ vendorId: 'vendor-generic', providerKey: 'CUSTOM', mode: 'GENERIC_API', adapterKey: null }],
    )).toEqual({
      plans: [],
      normalizations: [],
      skipped: [{ vendorId: 'vendor-generic', providerKey: 'PRINTWAY', reason: 'INTEGRATION_EXISTS' }],
    });
  });

  test('plans only mode fields for an existing legacy integration', () => {
    expect(buildMigrationPlan(
      [{ _id: 'vendor-legacy', providerKey: 'PRINTWAY' }],
      [{ vendorId: 'vendor-legacy', providerKey: 'PRINTWAY' }],
    )).toEqual({
      plans: [],
      normalizations: [{ vendorId: 'vendor-legacy', providerKey: 'PRINTWAY', mode: 'NATIVE', adapterKey: 'PRINTWAY' }],
      skipped: [],
    });
  });

  test('dry run never writes and reports the migration plan', async () => {
    Vendor.find.mockReturnValue(query([{ _id: 'vendor-1', providerKey: 'PRINTWAY' }]));
    VendorIntegrationConfig.find.mockReturnValue(query([]));

    const result = await migrateVendorProviderKeysToIntegrations();

    expect(result).toMatchObject({ dryRun: true, scanned: 1, planned: 1, normalizations: 0, created: 0 });
    expect(result.plans[0]).toMatchObject({ vendorId: 'vendor-1', adapterKey: 'PRINTWAY', mode: 'NATIVE' });
    expect(VendorIntegrationConfig.updateOne).not.toHaveBeenCalled();
  });

  test('apply blocks rows without an explicit endpoint/auth mapping', async () => {
    Vendor.find.mockReturnValue(query([{ _id: 'vendor-1', providerKey: 'PRINTWAY' }]));
    VendorIntegrationConfig.find.mockReturnValue(query([]));

    const result = await migrateVendorProviderKeysToIntegrations({ dryRun: false });

    expect(result).toMatchObject({ dryRun: false, planned: 1, normalizations: 0, created: 0, blocked: 1 });
    expect(VendorIntegrationConfig.updateOne).not.toHaveBeenCalled();
  });

  test('apply creates only missing configs when endpoint/auth defaults are supplied', async () => {
    Vendor.find.mockReturnValue(query([{ _id: 'vendor-1', providerKey: 'PRINTWAY' }]));
    VendorIntegrationConfig.find.mockReturnValue(query([]));
    VendorIntegrationConfig.updateOne.mockResolvedValue({ upsertedCount: 1 });

    const result = await migrateVendorProviderKeysToIntegrations({
      dryRun: false,
      defaultsByProvider: { PRINTWAY: { baseUrl: 'https://apis.printway.io', authType: 'API_KEY' } },
    });

    expect(result).toMatchObject({ created: 1, normalized: 0, blocked: 0 });
    expect(VendorIntegrationConfig.updateOne).toHaveBeenCalledWith(
      { vendorId: 'vendor-1' },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          mode: 'NATIVE',
          adapterKey: 'PRINTWAY',
          providerKey: 'PRINTWAY',
          baseUrl: 'https://apis.printway.io',
          authType: 'API_KEY',
        }),
      }),
      expect.objectContaining({ upsert: true, runValidators: true }),
    );
  });
});
