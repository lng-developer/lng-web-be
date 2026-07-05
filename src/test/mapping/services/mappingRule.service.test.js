jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/vendor/public', () => ({
  getVendorById: jest.fn(),
}));

jest.mock('../../../modules/catalog/public', () => ({
  getInternalTemplateById: jest.fn(),
  getProductTypeGroupById: jest.fn(),
}));

jest.mock('../../../modules/mapping/repositories/mappingNormalizationRule.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  listActiveForContext: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/mapping/repositories/vendorRoutingRule.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  listActiveForContext: jest.fn(),
  update: jest.fn(),
  upsertForScope: jest.fn(),
}));

jest.mock('../../../modules/mapping/repositories/mappingSkuConfigRule.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findActiveForContext: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/mapping/repositories/mappingSkuNormalizeRule.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  listActiveForContext: jest.fn(),
  update: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const catalogPublic = require('../../../modules/catalog/public');
const vendorPublic = require('../../../modules/vendor/public');
const normalizationRepository = require('../../../modules/mapping/repositories/mappingNormalizationRule.repository');
const routingRepository = require('../../../modules/mapping/repositories/vendorRoutingRule.repository');
const skuConfigRepository = require('../../../modules/mapping/repositories/mappingSkuConfigRule.repository');
const skuNormalizeRepository = require('../../../modules/mapping/repositories/mappingSkuNormalizeRule.repository');
const service = require('../../../modules/mapping/services/mappingRule.service');

describe('mappingRule.service', () => {
  const shopId = '660000000000000000000201';
  const vendorId = '660000000000000000004999';
  const productTypeGroupId = '660000000000000000003001';

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    vendorPublic.getVendorById.mockResolvedValue({ _id: vendorId, status: 'ACTIVE' });
    catalogPublic.getProductTypeGroupById.mockResolvedValue({ _id: productTypeGroupId, status: 'ACTIVE' });
    catalogPublic.getInternalTemplateById.mockResolvedValue({ _id: '660000000000000000002002', status: 'ACTIVE' });
    normalizationRepository.create.mockImplementation(async (payload) => ({ _id: '660000000000000000010001', ...payload }));
    routingRepository.create.mockImplementation(async (payload) => ({ _id: '660000000000000000010002', ...payload }));
    skuConfigRepository.create.mockImplementation(async (payload) => ({ _id: '660000000000000000010003', ...payload }));
    skuNormalizeRepository.create.mockImplementation(async (payload) => ({ _id: '660000000000000000010004', ...payload }));
    normalizationRepository.list.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    routingRepository.list.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    skuConfigRepository.list.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    skuNormalizeRepository.list.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    routingRepository.upsertForScope.mockImplementation(async (scope, rank) => ({
      _id: rank.id || rank.vendorId,
      ...scope,
      ...rank,
      status: rank.status || 'ACTIVE',
    }));
  });

  test('scoped user cannot create global normalization rule', async () => {
    await expect(service.createNormalizationRule({
      semanticRole: 'SIZE',
      matchTarget: 'LABEL',
      matchType: 'CONTAINS',
      matchValue: 'size',
    }, {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['MAPPING:WRITE'] }],
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
  });

  test('shop-scoped normalization rule requires shop access', async () => {
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.createNormalizationRule({
      shopId,
      semanticRole: 'SIZE',
      matchTarget: 'LABEL',
      matchType: 'CONTAINS',
      matchValue: 'size',
    }, { permissions: [] })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
  });

  test('buildNormalizedInputs uses active rule and records evidence', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([{
      _id: '660000000000000000010001',
      semanticRole: 'SIZE',
      matchTarget: 'LABEL',
      matchType: 'CONTAINS',
      matchValue: 'size',
      normalizedValue: 'L',
      priority: 1,
      status: 'ACTIVE',
    }]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Select Size', value: 'Large' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual([expect.objectContaining({
      semanticRole: 'SIZE',
      value: 'L',
      originalLabel: 'Select Size',
      originalValue: 'Large',
      source: 'RULE',
      ruleId: '660000000000000000010001',
    })]);
  });

  test('buildNormalizedInputs blocks out-of-stock values with heuristic', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Color', value: 'Ash (Out of Stock)' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.blockingReasons).toContain('SELECTED_OPTION_OUT_OF_STOCK');
    expect(result.normalizedInputs[0]).toMatchObject({
      semanticRole: 'COLOR',
      value: 'ASH',
      flags: { outOfStock: true },
      source: 'HEURISTIC',
    });
  });

  test('buildNormalizedInputs strips seller annotations from product type values', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Product Type', value: 'Unisex T-Shirt (Sale of 25%)' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs[0]).toMatchObject({
      semanticRole: 'PRODUCT_TYPE',
      value: 'UNISEX T-SHIRT',
      annotations: ['Sale of 25%'],
      flags: { outOfStock: false },
    });
  });

  test('buildNormalizedInputs normalizes dimension size values', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Choose Your Size', value: '60"x80\'\' INCHES' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs[0]).toMatchObject({
      semanticRole: 'SIZE',
      value: '60X80',
      originalLabel: 'Choose Your Size',
      originalValue: '60"x80\'\' INCHES',
      confidence: 'HIGH',
      reason: 'DIMENSION_SIZE_HEURISTIC',
      source: 'HEURISTIC',
    });
  });

  test('buildNormalizedInputs normalizes dimension size from parenthetical product option', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Select Size', value: 'Beverage (4.8"x4.8")' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs[0]).toMatchObject({
      semanticRole: 'SIZE',
      value: '4.8X4.8',
      reason: 'DIMENSION_SIZE_HEURISTIC',
    });
  });

  test('buildNormalizedInputs treats select pack as color term for cost-center matching', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Select Pack', value: 'Pack 100pcs' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs[0]).toMatchObject({
      semanticRole: 'COLOR',
      value: 'PACK 100PCS',
      source: 'HEURISTIC',
    });
  });

  test('buildNormalizedInputs prefers pack color over text color for cost-center matching', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: {
        options: [
          { label: 'Text Color', value: 'Grey' },
          { label: 'Select Pack', value: 'Pack 100pcs' },
        ],
      },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs.find((input) => input.semanticRole === 'COLOR')).toMatchObject({
      value: 'PACK 100PCS',
      originalLabel: 'Select Pack',
    });
  });

  test('buildNormalizedInputs normalizes apparel size aliases through configured rule', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([{
      _id: '660000000000000000010031',
      semanticRole: 'SIZE',
      matchTarget: 'VALUE',
      matchType: 'EXACT',
      matchValue: 'XXL',
      normalizedValue: '2XL',
      priority: 1,
      status: 'ACTIVE',
    }]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Select Size', value: 'XXL' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs[0]).toMatchObject({
      semanticRole: 'SIZE',
      value: '2XL',
      originalLabel: 'Select Size',
      originalValue: 'XXL',
      confidence: 'HIGH',
      reason: 'NORMALIZATION_RULE',
      source: 'RULE',
      ruleId: '660000000000000000010031',
    });
  });

  test('buildNormalizedInputs splits combined product type and color values', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Product Type & Color', value: 'Unisex T-Shirt / Ash (Out of Stock)' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.blockingReasons).toContain('SELECTED_OPTION_OUT_OF_STOCK');
    expect(result.normalizedInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticRole: 'PRODUCT_TYPE', value: 'UNISEX T-SHIRT' }),
      expect.objectContaining({ semanticRole: 'COLOR', value: 'ASH' }),
    ]));
  });

  test('vendor routing rule validates active vendor', async () => {
    vendorPublic.getVendorById.mockResolvedValueOnce(null);

    await expect(service.createVendorRoutingRule({
      productTypeGroupId,
      vendorId,
    }, { permissions: ['MAPPING:WRITE'] })).rejects.toMatchObject({
      statusCode: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  test('listActiveVendorRoutingRulesForContext ignores inactive vendor rules and sorts by specificity', async () => {
    routingRepository.listActiveForContext.mockResolvedValue([
      { _id: '660000000000000000010011', vendorId, productTypeGroupId, priority: 1, status: 'ACTIVE' },
      { _id: '660000000000000000010012', shopId, vendorId: '660000000000000000004998', productTypeGroupId, priority: 10, status: 'ACTIVE' },
    ]);
    vendorPublic.getVendorById
      .mockResolvedValueOnce({ _id: vendorId, status: 'ACTIVE' })
      .mockResolvedValueOnce(null);

    const result = await service.listActiveVendorRoutingRulesForContext({
      shopId,
      productTypeGroupId,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ vendorId, specificity: 1 });
  });

  test('reorderVendorRoutingRules upserts vendor priorities for one scope', async () => {
    const result = await service.reorderVendorRoutingRules({
      shopId,
      productTypeGroupId,
      vendorRanks: [
        { vendorId, priority: 1 },
        { vendorId: '660000000000000000004998', priority: 2 },
      ],
    }, { permissions: ['MAPPING:WRITE'] });

    expect(routingRepository.upsertForScope).toHaveBeenCalledTimes(2);
    expect(routingRepository.upsertForScope).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      productTypeGroupId,
    }), expect.objectContaining({ vendorId, priority: 1, status: 'ACTIVE' }));
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ vendorId, priority: 1 });
  });

  test('createSkuConfigRule normalizes config code and validates catalog refs', async () => {
    const result = await service.createSkuConfigRule({
      shopId,
      configCode: ' wt ',
      productTypeAliases: [' Comfort Color T-Shirt ', 'comfort colors tee'],
      platformProductType: ' Etsy TS1S ',
      countryCode: ' us ',
      isSet: true,
      isPack: false,
      sizePosition: 1,
      colorPosition: 2,
      productTypeGroupId,
      internalTemplateId: '660000000000000000002002',
    }, { permissions: ['MAPPING:WRITE'] });

    expect(catalogPublic.getProductTypeGroupById).toHaveBeenCalledWith(productTypeGroupId);
    expect(catalogPublic.getInternalTemplateById).toHaveBeenCalledWith('660000000000000000002002');
    expect(skuConfigRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      configCode: 'WT',
      productTypeAliases: ['COMFORT COLOR T-SHIRT', 'COMFORT COLORS TEE'],
      platformProductType: 'ETSY TS1S',
      countryCode: 'US',
      isSet: true,
      isPack: false,
      sizePosition: 1,
      colorPosition: 2,
      productTypeGroupId,
      internalTemplateId: '660000000000000000002002',
      status: 'ACTIVE',
    }));
    expect(result).toMatchObject({ configCode: 'WT' });
  });

  test('scoped user cannot create global SKU config rule', async () => {
    await expect(service.createSkuConfigRule({
      configCode: 'WT',
      productTypeGroupId,
    }, {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['MAPPING:WRITE'] }],
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
  });

  test('createSkuNormalizeRule normalizes segment values', async () => {
    const result = await service.createSkuNormalizeRule({
      shopId,
      configCode: ' ts1s ',
      patternType: 'SEGMENT',
      segmentIndex: 2,
      segmentRole: 'COUNTRY',
      appliesWhenValues: [' us ', 'ca'],
      outputAction: 'REMOVE_SEGMENT',
    }, { permissions: ['MAPPING:WRITE'] });

    expect(skuNormalizeRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      configCode: 'TS1S',
      patternType: 'SEGMENT',
      segmentIndex: 2,
      segmentRole: 'COUNTRY',
      appliesWhenValues: ['US', 'CA'],
      outputAction: 'REMOVE_SEGMENT',
      status: 'ACTIVE',
    }));
    expect(result).toMatchObject({ patternType: 'SEGMENT', configCode: 'TS1S', appliesWhenValues: ['US', 'CA'] });
  });

  test('createSkuNormalizeRule accepts replacement value for replace segment action', async () => {
    const result = await service.createSkuNormalizeRule({
      shopId,
      patternType: 'SEGMENT',
      segmentIndex: 1,
      segmentRole: 'CONFIG',
      appliesWhenValues: [' ts1s '],
      outputAction: 'REPLACE_SEGMENT',
      replacementValue: ' ts2s ',
    }, { permissions: ['MAPPING:WRITE'] });

    expect(skuNormalizeRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      patternType: 'SEGMENT',
      segmentIndex: 1,
      segmentRole: 'CONFIG',
      appliesWhenValues: ['TS1S'],
      outputAction: 'REPLACE_SEGMENT',
      replacementValue: 'TS2S',
      status: 'ACTIVE',
    }));
    expect(result).toMatchObject({
      outputAction: 'REPLACE_SEGMENT',
      replacementValue: 'TS2S',
    });
  });

  test('scoped user cannot create global SKU normalize rule', async () => {
    await expect(service.createSkuNormalizeRule({
      patternType: 'SEGMENT',
      segmentIndex: 1,
      segmentRole: 'SIZE',
      appliesWhenValues: ['L'],
      outputAction: 'REMOVE_SEGMENT',
    }, {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['MAPPING:WRITE'] }],
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
  });
});
