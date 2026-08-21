jest.mock('../../../src/modules/vendor/repositories/vendor.repository', () => ({
  create: jest.fn(),
  findByCode: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  listActive: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/vendor/repositories/vendorProduct.repository', () => ({
  create: jest.fn(),
  findByCode: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  listActiveByIds: jest.fn(),
  listActiveByProductTypeGroup: jest.fn(),
  listActiveByVendor: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/vendor/repositories/vendorCostCenter.repository', () => ({
  countByProduct: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  listActiveByProduct: jest.fn(),
  listActiveByProducts: jest.fn(),
  listOptionsByProduct: jest.fn(),
  search: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/vendor/repositories/vendorIntegrationConfig.repository', () => ({
  findByProviderKey: jest.fn(),
  findByVendorId: jest.fn(),
  upsertByVendorAndProvider: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/vendor/repositories/vendorMigrationReview.repository', () => ({
  list: jest.fn(),
  countPending: jest.fn(),
  assignProductTypeGroup: jest.fn(),
  upsert: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/public', () => ({
  getProductTypeGroupById: jest.fn(),
}));

jest.mock('../../../src/modules/audit/public', () => ({
  record: jest.fn(),
}));

const errorCodes = require('../../../src/shared/constants/errorCodes');
const catalogPublic = require('../../../src/modules/catalog/public');
const vendorRepository = require('../../../src/modules/vendor/repositories/vendor.repository');
const productRepository = require('../../../src/modules/vendor/repositories/vendorProduct.repository');
const costCenterRepository = require('../../../src/modules/vendor/repositories/vendorCostCenter.repository');
const integrationRepository = require('../../../src/modules/vendor/repositories/vendorIntegrationConfig.repository');
const migrationReviewRepository = require('../../../src/modules/vendor/repositories/vendorMigrationReview.repository');
const auditPublic = require('../../../src/modules/audit/public');
const service = require('../../../src/modules/vendor/services/vendor.service');

describe('vendor.service', () => {
  const vendorId = '660000000000000000000501';
  const productId = '660000000000000000000601';
  const costCenterId = '660000000000000000000701';
  const groupId = '660000000000000000000301';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VENDOR_CREDENTIAL_SECRET = 'test-vendor-credential-secret';
    vendorRepository.findById.mockResolvedValue({
      _id: vendorId,
      code: 'PRINTWAY',
      name: 'Printway',
      providerKey: 'PRINTWAY',
      fulfillmentType: 'POD',
      status: 'ACTIVE',
    });
    catalogPublic.getProductTypeGroupById.mockResolvedValue({
      _id: groupId,
      code: 'SHIRT',
      name: 'Shirt',
      status: 'ACTIVE',
    });
    productRepository.findById.mockResolvedValue({
      _id: productId,
      vendorId: {
        _id: vendorId,
        code: 'PRINTWAY',
        name: 'Printway',
        status: 'ACTIVE',
      },
      productTypeGroupId: groupId,
      code: 'PREMIUM_SHIRT',
      name: 'Premium Shirt',
      imageUrl: 'https://cdn.example.test/shirt.jpg',
      status: 'ACTIVE',
      baseCostAmount: 1200,
      currency: 'USD',
    });
    costCenterRepository.countByProduct.mockResolvedValue(0);
  });

  test('searchActiveVendors returns compact active vendors without an exact count', async () => {
    vendorRepository.listActive.mockResolvedValue([
      { _id: vendorId, code: 'MANGOTEE', name: 'MangoTee' },
    ]);

    await expect(service.searchActiveVendors({ q: 'mango tee', limit: 20 })).resolves.toEqual({
      items: [{ id: vendorId, code: 'MANGOTEE', name: 'MangoTee' }],
      hasMore: false,
    });
    expect(vendorRepository.listActive).toHaveBeenCalledWith({ q: 'mango tee', limit: 21 });
  });

  test('assignVendorMigrationProductTypeGroup requires an active group and audits the assignment', async () => {
    migrationReviewRepository.assignProductTypeGroup.mockResolvedValue(2);

    await expect(service.assignVendorMigrationProductTypeGroup(
      ['legacy-product-1', 'legacy-product-2'], groupId, { accountId: '660000000000000000000901' },
    )).resolves.toEqual({ updated: 2 });

    expect(catalogPublic.getProductTypeGroupById).toHaveBeenCalledWith(groupId);
    expect(migrationReviewRepository.assignProductTypeGroup).toHaveBeenCalledWith(
      ['legacy-product-1', 'legacy-product-2'], groupId,
    );
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'VENDOR_MIGRATION_PRODUCT_TYPE_GROUP_ASSIGNED',
      entityType: 'VENDOR_MIGRATION_REVIEW',
      actorAccountId: '660000000000000000000901',
    }), {});
  });

  test('listActiveVendorProductsByVendor skips per-product cost-center counts', async () => {
    const productTypeGroupId = '660000000000000000003001';
    productRepository.listActiveByVendor.mockResolvedValue([
      { _id: productId, code: '1717', name: 'Unisex T-shirt Comfort Color 1717' },
    ]);

    await expect(service.listActiveVendorProductsByVendor(vendorId, { productTypeGroupId })).resolves.toEqual([
      { id: productId, code: '1717', name: 'Unisex T-shirt Comfort Color 1717' },
    ]);
    expect(productRepository.listActiveByVendor).toHaveBeenCalledWith(vendorId, { productTypeGroupId });
    expect(costCenterRepository.countByProduct).not.toHaveBeenCalled();
  });

  test('getVendorProductOptions derives optional size and color dimensions from cost centers', async () => {
    costCenterRepository.listOptionsByProduct.mockResolvedValue([
      {
        _id: costCenterId,
        code: '1717-S-BLACK',
        sku: '1717-S-BLACK',
        standardSize: 'S',
        standardColor: 'Black',
        baseCostAmount: 1299,
        currency: 'USD',
      },
    ]);

    await expect(service.getVendorProductOptions(productId, { size: 'S', color: 'Black' })).resolves.toEqual({
      dimensions: { hasSize: true, hasColor: true },
      options: { sizes: ['S'], colors: ['Black'] },
      candidates: [{
        id: costCenterId,
        code: '1717-S-BLACK',
        sku: '1717-S-BLACK',
        size: 'S',
        color: 'Black',
        baseCostAmount: 1299,
        currency: 'USD',
      }],
    });
  });

  test('updateVendorIntegrationConfig stores encrypted secrets and returns masked DTO', async () => {
    let storedConfig;
    integrationRepository.upsertByVendorAndProvider.mockImplementation(async (payload) => {
      storedConfig = { _id: '660000000000000000000801', ...payload };
      return storedConfig;
    });

    const result = await service.updateVendorIntegrationConfig(vendorId, {
      providerKey: 'printway',
      baseUrl: 'https://apis.printway.io',
      authType: 'access_refresh',
      accessToken: 'plain-access-token',
      refreshToken: 'plain-refresh-token',
    });

    expect(integrationRepository.upsertByVendorAndProvider).toHaveBeenCalledWith(expect.objectContaining({
      vendorId,
      providerKey: 'PRINTWAY',
      baseUrl: 'https://apis.printway.io',
      authType: 'ACCESS_REFRESH',
      status: 'DISCONNECTED',
    }));
    expect(storedConfig.accessTokenEncrypted).toBeTruthy();
    expect(storedConfig.accessTokenEncrypted).not.toContain('plain-access-token');
    expect(storedConfig.refreshTokenEncrypted).not.toContain('plain-refresh-token');
    expect(result).toMatchObject({
      id: '660000000000000000000801',
      providerKey: 'PRINTWAY',
      accessTokenConfigured: true,
      refreshTokenConfigured: true,
    });
    expect(JSON.stringify(result)).not.toContain('plain-access-token');
  });

  test('rejects a new integration without the credentials required by its auth type', async () => {
    await expect(service.updateVendorIntegrationConfig(vendorId, {
      providerKey: 'PRINTWAY',
      baseUrl: 'https://apis.printway.io',
      authType: 'ACCESS_REFRESH',
      accessToken: 'plain-access-token',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(integrationRepository.upsertByVendorAndProvider).not.toHaveBeenCalled();
  });

  test('records a sanitized vendor integration configuration change for an account', async () => {
    integrationRepository.upsertByVendorAndProvider.mockResolvedValue({
      _id: '660000000000000000000801',
      vendorId,
      providerKey: 'PRINTWAY',
      baseUrl: 'https://apis.printway.io',
      authType: 'ACCESS_REFRESH',
      status: 'CONNECTED',
      accessTokenEncrypted: 'encrypted',
    });

    await service.updateVendorIntegrationConfig(vendorId, {
      providerKey: 'printway',
      baseUrl: 'https://apis.printway.io',
      authType: 'access_refresh',
      accessToken: 'plain-access-token',
      refreshToken: 'plain-refresh-token',
    }, { accountId: '660000000000000000000901' });

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'ACCOUNT',
      actorAccountId: '660000000000000000000901',
      action: 'VENDOR_INTEGRATION_CONFIG_UPDATED',
      entityType: 'VENDOR_INTEGRATION_CONFIG',
      entityId: '660000000000000000000801',
      source: 'HTTP',
    }), {});
    expect(JSON.stringify(auditPublic.record.mock.calls[0][0])).not.toContain('plain-access-token');
  });

  test('records each successful integration-config read without credential material', async () => {
    integrationRepository.findByVendorId.mockResolvedValue({
      _id: '660000000000000000000801',
      vendorId,
      providerKey: 'PRINTWAY',
      baseUrl: 'https://apis.printway.io',
      authType: 'ACCESS_REFRESH',
      status: 'CONNECTED',
      accessTokenEncrypted: 'encrypted-access-token',
      refreshTokenEncrypted: 'encrypted-refresh-token',
    });

    await service.getVendorIntegrationConfig(vendorId, {
      accountId: '660000000000000000000901',
      auditContext: { requestId: 'request-vendor-read', ipAddress: '127.0.0.1' },
    });

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'ACCOUNT',
      actorAccountId: '660000000000000000000901',
      action: 'VENDOR_INTEGRATION_CONFIG_READ',
      entityType: 'VENDOR_INTEGRATION_CONFIG',
      entityId: '660000000000000000000801',
      source: 'HTTP',
      requestId: 'request-vendor-read',
      metadata: { vendorId, providerKey: 'PRINTWAY' },
    }), {});
    expect(JSON.stringify(auditPublic.record.mock.calls[0][0])).not.toMatch(/encrypted-access-token|encrypted-refresh-token/);
  });

  test('getVendorIntegrationCredential decrypts configured access token for adapters', async () => {
    let storedConfig;
    integrationRepository.upsertByVendorAndProvider.mockImplementation(async (payload) => {
      storedConfig = { _id: '660000000000000000000801', ...payload };
      return storedConfig;
    });

    await service.updateVendorIntegrationConfig(vendorId, {
      providerKey: 'printway',
      baseUrl: 'https://apis.printway.io',
      authType: 'ACCESS_REFRESH',
      accessToken: 'runtime-token',
      refreshToken: 'runtime-refresh',
    });
    integrationRepository.findByVendorId.mockResolvedValue(storedConfig);

    const credential = await service.getVendorIntegrationCredential(vendorId, 'printway');

    expect(credential).toMatchObject({
      providerKey: 'PRINTWAY',
      baseUrl: 'https://apis.printway.io',
      accessToken: 'runtime-token',
      authType: 'ACCESS_REFRESH',
    });
    expect(credential.refreshToken).toBeUndefined();
    expect(integrationRepository.findByVendorId).toHaveBeenCalledWith(vendorId);
  });

  test('getVendorIntegrationCredential rejects a provider mismatch for the vendor', async () => {
    integrationRepository.findByVendorId.mockResolvedValue({
      vendorId,
      providerKey: 'PRINTWAY',
      status: 'CONNECTED',
    });

    await expect(service.getVendorIntegrationCredential(vendorId, 'MERCHIZE')).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  test('refreshVendorIntegrationCredential posts Lenful login with user_name field', async () => {
    let storedConfig;
    integrationRepository.upsertByVendorAndProvider.mockImplementation(async (payload) => {
      storedConfig = { _id: '660000000000000000000802', ...payload };
      return storedConfig;
    });
    integrationRepository.findByProviderKey.mockImplementation(async () => storedConfig);
    integrationRepository.update.mockImplementation(async (configId, patch) => ({
      ...storedConfig,
      _id: configId,
      ...patch,
    }));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'lenful-token', expires: 1722222994 }),
    });

    await service.updateVendorIntegrationConfig(vendorId, {
      providerKey: 'LENFUL',
      baseUrl: 'https://s-lencam.lenful.com/api',
      authType: 'LOGIN_PASSWORD',
      username: 'seller@example.test',
      password: 'seller-password',
    });

    await service.refreshVendorIntegrationCredential('LENFUL');

    const [, requestOptions] = global.fetch.mock.calls[0];
    expect(String(requestOptions.body)).toContain('user_name=seller%40example.test');
    expect(String(requestOptions.body)).not.toContain('username=');
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'SYSTEM',
      actorAccountId: null,
      action: 'VENDOR_INTEGRATION_CREDENTIAL_ROTATED',
      source: 'SYSTEM',
    }), {});
    expect(JSON.stringify(auditPublic.record.mock.calls.at(-1)[0])).not.toContain('lenful-token');
  });

  test('classifies import product and cost-center changes as system import events', async () => {
    productRepository.create.mockResolvedValue({
      _id: productId,
      vendorId,
      productTypeGroupId: groupId,
      code: 'PREMIUM_SHIRT',
      status: 'ACTIVE',
    });
    costCenterRepository.create.mockResolvedValue({
      _id: costCenterId,
      vendorProductId: productId,
      vendorId,
      code: 'BLACK_L',
      status: 'ACTIVE',
    });
    const importContext = { import: true, accountId: '660000000000000000000901', source: 'HTTP' };

    await service.createVendorProduct({
      vendorId,
      productTypeGroupId: groupId,
      code: 'PREMIUM_SHIRT',
      name: 'Premium Shirt',
    }, importContext);
    await service.createVendorCostCenter(productId, { code: 'BLACK_L', name: 'Black L' }, importContext);

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'SYSTEM',
      actorAccountId: null,
      action: 'VENDOR_PRODUCT_CREATED',
      source: 'IMPORT',
    }), {});
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'SYSTEM',
      actorAccountId: null,
      action: 'VENDOR_COST_CENTER_CREATED',
      source: 'IMPORT',
    }), {});
  });

  test('distinguishes same-millisecond vendor writes and reuses the key for exact persisted replay', async () => {
    const updatedAt = new Date('2026-07-29T01:00:00.000Z');
    vendorRepository.update
      .mockResolvedValueOnce({
        _id: vendorId,
        code: 'PRINTWAY',
        status: 'ACTIVE',
        updatedAt,
        __v: 8,
      })
      .mockResolvedValueOnce({
        _id: vendorId,
        code: 'PRINTWAY',
        status: 'ACTIVE',
        updatedAt,
        __v: 9,
      })
      .mockResolvedValueOnce({
        _id: vendorId,
        code: 'PRINTWAY',
        status: 'ACTIVE',
        updatedAt,
        __v: 9,
      });
    const authContext = {
      accountId: '660000000000000000000901',
      auditContext: { requestId: 'client-reused-request-id' },
    };

    await service.updateVendor(vendorId, { name: 'First' }, authContext);
    await service.updateVendor(vendorId, { name: 'Second' }, authContext);
    await service.updateVendor(vendorId, { name: 'Second replay' }, authContext);

    const keys = auditPublic.record.mock.calls.map(([event]) => event.deduplicationKey);
    expect(keys).toHaveLength(3);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[1]).toBe(keys[2]);
    expect(keys.every((key) => !key.includes('client-reused-request-id'))).toBe(true);
  });

  test('createVendor normalizes code and maps duplicate code to conflict', async () => {
    vendorRepository.create.mockResolvedValue({
      _id: vendorId,
      code: 'PRINTWAY',
      name: 'Printway',
      fulfillmentType: 'POD',
      status: 'ACTIVE',
    });

    const result = await service.createVendor({ code: ' printway ', name: 'Printway', fulfillmentType: 'pod' });

    expect(vendorRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PRINTWAY',
      fulfillmentType: 'POD',
    }));
    expect(result).toMatchObject({ id: vendorId, code: 'PRINTWAY', fulfillmentType: 'POD' });

    vendorRepository.create.mockRejectedValueOnce({ code: 11000 });
    await expect(service.createVendor({ code: 'PRINTWAY', name: 'Printway', fulfillmentType: 'POD' }))
      .rejects.toMatchObject({ code: errorCodes.CONFLICT_ERROR, statusCode: 409 });
  });

  test('updateVendor strips code changes', async () => {
    vendorRepository.update.mockResolvedValue({
      _id: vendorId,
      code: 'PRINTWAY',
      name: 'Updated',
      fulfillmentType: 'FBM',
      status: 'ACTIVE',
    });

    await service.updateVendor(vendorId, { code: 'OTHER', name: 'Updated', fulfillmentType: 'fbm' });

    expect(vendorRepository.update).toHaveBeenCalledWith(vendorId, { name: 'Updated', fulfillmentType: 'FBM' });
  });

  test('findVendorByCode returns active only by default', async () => {
    vendorRepository.findByCode.mockResolvedValueOnce({ _id: vendorId, code: 'PRINTWAY', status: 'INACTIVE' });
    vendorRepository.findByCode.mockResolvedValueOnce({ _id: vendorId, code: 'PRINTWAY', status: 'INACTIVE' });

    await expect(service.findVendorByCode(' printway ')).resolves.toBeNull();
    await expect(service.findVendorByCode(' printway ', { includeInactive: true }))
      .resolves.toMatchObject({ code: 'PRINTWAY' });
    expect(vendorRepository.findByCode).toHaveBeenCalledWith('PRINTWAY');
  });

  test('createVendorProduct validates active vendor and product type group', async () => {
    productRepository.create.mockResolvedValue({
      _id: productId,
      vendorId: { _id: vendorId, code: 'PRINTWAY', name: 'Printway', status: 'ACTIVE' },
      productTypeGroupId: groupId,
      code: 'PREMIUM_SHIRT',
      name: 'Premium Shirt',
      imageUrl: 'https://cdn.example.test/shirt.jpg',
      status: 'ACTIVE',
      baseCostAmount: 1200,
      currency: 'USD',
    });

    const result = await service.createVendorProduct({
      vendorId,
      productTypeGroupId: groupId,
      code: ' premium_shirt ',
      name: 'Premium Shirt',
      imageUrl: 'https://cdn.example.test/shirt.jpg',
      baseCostAmount: 1200,
    });

    expect(vendorRepository.findById).toHaveBeenCalledWith(vendorId);
    expect(catalogPublic.getProductTypeGroupById).toHaveBeenCalledWith(groupId);
    expect(productRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PREMIUM_SHIRT',
      imageUrl: 'https://cdn.example.test/shirt.jpg',
    }));
    expect(result).toMatchObject({
      id: productId,
      code: 'PREMIUM_SHIRT',
      imageUrl: 'https://cdn.example.test/shirt.jpg',
      costCenterCount: 0,
    });
  });

  test('createVendorProduct rejects inactive vendor or inactive product type group', async () => {
    vendorRepository.findById.mockResolvedValueOnce({ _id: vendorId, status: 'INACTIVE' });
    await expect(service.createVendorProduct({
      vendorId,
      productTypeGroupId: groupId,
      code: 'SHIRT',
      name: 'Shirt',
    })).rejects.toMatchObject({ code: errorCodes.CONFLICT_ERROR, statusCode: 409 });

    vendorRepository.findById.mockResolvedValueOnce({ _id: vendorId, status: 'ACTIVE' });
    catalogPublic.getProductTypeGroupById.mockResolvedValueOnce({ _id: groupId, status: 'INACTIVE' });
    await expect(service.createVendorProduct({
      vendorId,
      productTypeGroupId: groupId,
      code: 'SHIRT',
      name: 'Shirt',
    })).rejects.toMatchObject({ code: errorCodes.CONFLICT_ERROR, statusCode: 409 });
  });

  test('create/update vendor product reject invalid production day range', async () => {
    await expect(service.createVendorProduct({
      vendorId,
      productTypeGroupId: groupId,
      code: 'SHIRT',
      name: 'Shirt',
      minProductionDays: 5,
      maxProductionDays: 3,
    })).rejects.toMatchObject({ code: errorCodes.VALIDATION_ERROR, statusCode: 400 });

    productRepository.findById.mockResolvedValueOnce({
      _id: productId,
      vendorId: { _id: vendorId, status: 'ACTIVE' },
      minProductionDays: 2,
      maxProductionDays: 4,
      status: 'ACTIVE',
    });
    await expect(service.updateVendorProduct(productId, {
      maxProductionDays: 0,
    })).rejects.toMatchObject({ code: errorCodes.VALIDATION_ERROR, statusCode: 400 });
    expect(productRepository.create).not.toHaveBeenCalled();
    expect(productRepository.update).not.toHaveBeenCalled();
  });

  test('updateVendorProduct strips vendorId/code and validates productTypeGroupId', async () => {
    productRepository.update.mockResolvedValue({
      _id: productId,
      vendorId: { _id: vendorId, code: 'PRINTWAY', name: 'Printway', status: 'ACTIVE' },
      productTypeGroupId: groupId,
      code: 'PREMIUM_SHIRT',
      name: 'Updated',
      imageUrl: 'https://cdn.example.test/updated.jpg',
      status: 'ACTIVE',
      baseCostAmount: 1300,
      currency: 'USD',
    });

    await service.updateVendorProduct(productId, {
      vendorId: '660000000000000000000999',
      code: 'OTHER',
      name: 'Updated',
      imageUrl: 'https://cdn.example.test/updated.jpg',
      productTypeGroupId: groupId,
    });

    expect(catalogPublic.getProductTypeGroupById).toHaveBeenCalledWith(groupId);
    expect(productRepository.update).toHaveBeenCalledWith(productId, {
      productTypeGroupId: groupId,
      name: 'Updated',
      imageUrl: 'https://cdn.example.test/updated.jpg',
    });
  });

  test('audits a committed vendor product update before DTO enrichment can fail', async () => {
    productRepository.update.mockResolvedValue({
      _id: productId,
      vendorId,
      productTypeGroupId: groupId,
      code: 'PREMIUM_SHIRT',
      name: 'Updated',
      status: 'ACTIVE',
      updatedAt: new Date('2026-07-29T02:00:00.000Z'),
    });
    costCenterRepository.countByProduct.mockRejectedValueOnce(new Error('count unavailable'));

    await expect(service.updateVendorProduct(productId, { name: 'Updated' }, {
      accountId: '660000000000000000000901',
    })).rejects.toThrow('count unavailable');

    expect(productRepository.update).toHaveBeenCalled();
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'VENDOR_PRODUCT_UPDATED',
      entityId: productId,
    }), {});
  });

  test('public listActiveVendorProductsByProductTypeGroup filters inactive vendors', async () => {
    productRepository.listActiveByProductTypeGroup.mockResolvedValue([
      { _id: productId, status: 'ACTIVE', vendorId: { _id: vendorId, status: 'ACTIVE' } },
      { _id: '660000000000000000000602', status: 'ACTIVE', vendorId: { _id: vendorId, status: 'INACTIVE' } },
    ]);

    await expect(service.listActiveVendorProductsByProductTypeGroup(groupId))
      .resolves.toHaveLength(1);
  });

  test('public listActiveVendorCostCentersByProductIds filters inactive vendor products', async () => {
    productRepository.listActiveByIds.mockResolvedValue([
      { _id: productId, status: 'ACTIVE', vendorId: { _id: vendorId, status: 'ACTIVE' } },
      { _id: '660000000000000000000602', status: 'ACTIVE', vendorId: { _id: vendorId, status: 'INACTIVE' } },
    ]);
    costCenterRepository.listActiveByProducts.mockResolvedValue([
      { _id: costCenterId, vendorProductId: productId, vendorId },
      {
        _id: '660000000000000000000702',
        vendorProductId: productId,
        vendorId: '660000000000000000000999',
      },
    ]);

    const result = await service.listActiveVendorCostCentersByProductIds([
      productId,
      '660000000000000000000602',
    ]);

    expect(costCenterRepository.listActiveByProducts).toHaveBeenCalledWith([productId]);
    expect(result).toEqual([{ _id: costCenterId, vendorProductId: productId, vendorId }]);
  });

  test('public listActiveVendorCostCenters filters cost centers that point to another vendor', async () => {
    costCenterRepository.listActiveByProduct.mockResolvedValue([
      { _id: costCenterId, vendorProductId: productId, vendorId },
      {
        _id: '660000000000000000000702',
        vendorProductId: productId,
        vendorId: '660000000000000000000999',
      },
    ]);

    await expect(service.listActiveVendorCostCenters(productId)).resolves.toEqual([
      { _id: costCenterId, vendorProductId: productId, vendorId },
    ]);
  });

  test('searchVendorCostCenters returns active enriched vendor cost center candidates', async () => {
    costCenterRepository.search.mockResolvedValue({
      items: [{
        vendor: { _id: vendorId, code: 'BEEFUL', name: 'Beeful', status: 'ACTIVE' },
        vendorProduct: { _id: productId, code: 'PRODUCT_1717', name: 'Heavyweight T-Shirt', status: 'ACTIVE' },
        vendorCostCenter: {
          _id: costCenterId,
          vendorProductId: productId,
          vendorId,
          code: 'PRODUCT_1717_M_PEPPER',
          name: 'M / PEPPER',
          sku: 'UT-1717-PER-M',
          standardSize: 'M',
          standardColor: 'PEPPER',
          baseCostAmount: 894,
          currency: 'USD',
          status: 'ACTIVE',
        },
      }],
      total: 1,
      page: 1,
      limit: 20,
    });

    const result = await service.searchVendorCostCenters({
      q: 'beeful',
      vendorId,
      size: 'M',
      color: 'PEPPER',
      page: 1,
      limit: 20,
    });

    expect(costCenterRepository.search).toHaveBeenCalledWith(expect.objectContaining({
      q: 'beeful',
      vendorId,
      size: 'M',
      color: 'PEPPER',
      status: 'ACTIVE',
    }));
    expect(result).toMatchObject({
      items: [{
        vendor: { id: vendorId, code: 'BEEFUL', name: 'Beeful' },
        vendorProduct: { id: productId, code: 'PRODUCT_1717', name: 'Heavyweight T-Shirt' },
        vendorCostCenter: {
          id: costCenterId,
          sku: 'UT-1717-PER-M',
          standardSize: 'M',
          standardColor: 'PEPPER',
          baseCostAmount: 894,
        },
      }],
      pagination: { total: 1, page: 1, limit: 20 },
    });
  });

  test('create/update cost centers validate parent and strip identity fields', async () => {
    costCenterRepository.create.mockResolvedValue({
      _id: costCenterId,
      vendorProductId: productId,
      vendorId,
      code: 'BLACK_L',
      name: 'Black L',
      vendorSize: 'L',
      vendorColor: 'Black',
      standardSize: 'L',
      standardColor: 'Black',
      status: 'ACTIVE',
      baseCostAmount: 1200,
      currency: 'USD',
    });
    costCenterRepository.findById.mockResolvedValue({
      _id: costCenterId,
      vendorProductId: productId,
      code: 'BLACK_L',
      name: 'Black L',
      status: 'ACTIVE',
    });
    costCenterRepository.update.mockResolvedValue({
      _id: costCenterId,
      vendorProductId: productId,
      code: 'BLACK_L',
      name: 'Updated',
      status: 'ACTIVE',
      baseCostAmount: 1300,
      currency: 'USD',
    });

    const created = await service.createVendorCostCenter(productId, {
      code: ' black_l ',
      name: 'Black L',
      vendorSize: 'L',
      vendorColor: 'Black',
      standardSize: 'L',
      standardColor: 'Black',
      domesticShipping: { economyAmount: 499 },
    });
    expect(costCenterRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      vendorProductId: productId,
      vendorId,
      code: 'BLACK_L',
      domesticShipping: { economyAmount: 499 },
    }));
    expect(created).toMatchObject({ code: 'BLACK_L', vendorSize: 'L', standardColor: 'Black' });

    await service.updateVendorCostCenter(productId, costCenterId, {
      vendorProductId: '660000000000000000000999',
      code: 'OTHER',
      name: 'Updated',
      standardSize: 'XL',
    });
    expect(costCenterRepository.update).toHaveBeenCalledWith(costCenterId, { name: 'Updated', standardSize: 'XL' });
  });
});
