const mongoose = require('mongoose');

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
  listScopes: jest.fn(),
}));

jest.mock('../../../src/modules/vendor/public', () => ({
  getVendorById: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/public', () => ({
  getInternalTemplateById: jest.fn(),
  getProductTypeGroupById: jest.fn(),
}));

jest.mock('../../../src/modules/mapping/repositories/mappingNormalizationRule.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  listGrouped: jest.fn(),
  listActiveForContext: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/mapping/repositories/vendorRoutingRule.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findForScopeVendor: jest.fn(),
  list: jest.fn(),
  listActiveForContext: jest.fn(),
  update: jest.fn(),
  upsertForScope: jest.fn(),
}));

jest.mock('../../../src/modules/mapping/repositories/mappingSkuConfigRule.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findActiveForContext: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/mapping/repositories/mappingSkuNormalizeRule.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  listActiveForContext: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/mapping/repositories/mappingRuleAudit.repository', () => ({
  create: jest.fn(),
  listByRule: jest.fn(),
}));

jest.mock('../../../src/modules/mapping/repositories/fulfillmentPlan.repository', () => ({
  listBlockedOrderItemIdsForRuleScope: jest.fn(),
}));

jest.mock('../../../src/modules/mapping/services/fulfillmentPlan.service', () => ({
  recheckFulfillmentPlan: jest.fn(),
}));

const authPublic = require('../../../src/modules/auth/public');
const catalogPublic = require('../../../src/modules/catalog/public');
const vendorPublic = require('../../../src/modules/vendor/public');
const normalizationRepository = require('../../../src/modules/mapping/repositories/mappingNormalizationRule.repository');
const routingRepository = require('../../../src/modules/mapping/repositories/vendorRoutingRule.repository');
const skuConfigRepository = require('../../../src/modules/mapping/repositories/mappingSkuConfigRule.repository');
const skuNormalizeRepository = require('../../../src/modules/mapping/repositories/mappingSkuNormalizeRule.repository');
const auditRepository = require('../../../src/modules/mapping/repositories/mappingRuleAudit.repository');
const fulfillmentPlanRepository = require('../../../src/modules/mapping/repositories/fulfillmentPlan.repository');
const fulfillmentPlanService = require('../../../src/modules/mapping/services/fulfillmentPlan.service');
const service = require('../../../src/modules/mapping/services/mappingRule.service');

describe('mappingRule.service', () => {
  const shopId = '660000000000000000000201';
  const vendorId = '660000000000000000004999';
  const productTypeGroupId = '660000000000000000003001';
  const adminAuth = { permissions: ['MAPPING:READ'] };
  let transactionSession;

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
    normalizationRepository.listGrouped.mockResolvedValue({
      semanticRules: { items: [], pagination: { total: 2, page: 1, limit: 20 } },
      valueAliases: { items: [], pagination: { total: 3, page: 1, limit: 20 } },
    });
    routingRepository.list.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    skuConfigRepository.list.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    skuNormalizeRepository.list.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    auditRepository.create.mockResolvedValue(undefined);
    auditRepository.listByRule.mockResolvedValue([]);
    fulfillmentPlanRepository.listBlockedOrderItemIdsForRuleScope.mockResolvedValue([]);
    fulfillmentPlanService.recheckFulfillmentPlan.mockResolvedValue({ status: 'READY' });
    routingRepository.upsertForScope.mockImplementation(async (scope, rank) => ({
      _id: rank.id || rank.vendorId,
      ...scope,
      ...rank,
      status: rank.status || 'ACTIVE',
    }));
    transactionSession = {
      withTransaction: jest.fn(async (work) => work()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(transactionSession);
  });

  test('lists semantic and value-alias groups with one scoped repository call', async () => {
    const result = await service.listNormalizationRuleGroups({ shopId, page: 1, limit: 20 }, adminAuth);

    expect(result.semanticRules.pagination.total).toBe(2);
    expect(result.valueAliases.pagination.total).toBe(3);
    expect(normalizationRepository.listGrouped).toHaveBeenCalledTimes(1);
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

  test('authorable shops include only scoped MAPPING:WRITE shops and no global option', async () => {
    const otherShopId = '660000000000000000000202';
    authPublic.listScopes
      .mockResolvedValueOnce({
        items: [{
          scopeId: shopId,
          name: 'Alpha Shop',
          resource: { id: shopId, name: 'Alpha Shop', code: 'ALPHA', status: 'ACTIVE' },
        }],
        total: 1,
        page: 1,
        limit: 1,
      });

    const result = await service.listAuthorableShops({
      permissions: [],
      scopes: [
        { scopeType: 'shop', scopeId: shopId, permissions: ['MAPPING:WRITE'] },
        { scopeType: 'shop', scopeId: otherShopId, permissions: ['MAPPING:READ'] },
      ],
    });

    expect(authPublic.listScopes).toHaveBeenCalledTimes(1);
    expect(authPublic.listScopes).toHaveBeenCalledWith({
      scopeType: 'shop',
      scopeId: shopId,
      status: 'active',
      page: 1,
      limit: 1,
    });
    expect(result).toEqual({
      canCreateGlobal: false,
      items: [{
        id: shopId,
        name: 'Alpha Shop',
        code: 'ALPHA',
        status: 'ACTIVE',
      }],
    });
  });

  test('global MAPPING:WRITE lists every registered shop and keeps global authoring', async () => {
    const otherShopId = '660000000000000000000202';
    authPublic.listScopes
      .mockResolvedValueOnce({
        items: [{
          scopeId: shopId,
          name: 'Alpha Shop',
          resource: { id: shopId, name: 'Alpha Shop', code: 'ALPHA', status: 'ACTIVE' },
        }],
        total: 101,
        page: 1,
        limit: 100,
      })
      .mockResolvedValueOnce({
        items: [{
          scopeId: otherShopId,
          name: 'Beta Shop',
          resource: { id: otherShopId, name: 'Beta Shop', code: 'BETA', status: 'ACTIVE' },
        }],
        total: 101,
        page: 2,
        limit: 100,
      });

    const result = await service.listAuthorableShops({ permissions: ['MAPPING:WRITE'] });

    expect(authPublic.listScopes).toHaveBeenNthCalledWith(1, {
      scopeType: 'shop',
      status: 'active',
      page: 1,
      limit: 100,
    });
    expect(authPublic.listScopes).toHaveBeenNthCalledWith(2, {
      scopeType: 'shop',
      status: 'active',
      page: 2,
      limit: 100,
    });
    expect(result).toEqual({
      canCreateGlobal: true,
      items: [
        { id: shopId, name: 'Alpha Shop', code: 'ALPHA', status: 'ACTIVE' },
        { id: otherShopId, name: 'Beta Shop', code: 'BETA', status: 'ACTIVE' },
      ],
    });
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

  test('buildNormalizedInputs matches any configured input alias', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([{
      _id: '660000000000000000010001',
      semanticRole: 'SIZE',
      matchTarget: 'LABEL',
      matchType: 'CONTAINS',
      matchValue: 'size',
      matchValues: ['size', 'select size', 'dimension'],
      normalizedValue: 'L',
      priority: 1,
      status: 'ACTIVE',
    }]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Dimension', value: 'Large' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual([expect.objectContaining({
      semanticRole: 'SIZE',
      value: 'L',
      originalLabel: 'Dimension',
    })]);
  });

  test('buildNormalizedInputs ignores unconfigured customization labels', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: {
        options: [
          { label: 'Select Color', value: 'Sand' },
          { label: 'Select Thread Color', value: 'Old Gold' },
        ],
      },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual([]);
  });

  test('buildNormalizedInputs ignores unconfigured out-of-stock values', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Color', value: 'Ash (Out of Stock)' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.blockingReasons).toEqual([]);
    expect(result.normalizedInputs).toEqual([]);
  });

  test('buildNormalizedInputs ignores unconfigured product type labels', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Product Type', value: 'Unisex T-Shirt (Sale of 25%)' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual([]);
  });

  test('buildNormalizedInputs ignores unconfigured dimension size labels', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Choose Your Size', value: '60"x80\'\' INCHES' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual([]);
  });

  test('buildNormalizedInputs ignores unconfigured size and color labels', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: {
        options: [
          { label: 'Select Your Choose Size', value: 'XL' },
          { label: 'Choose Text and Design Color', value: 'Bay' },
        ],
      },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual([]);
  });

  test('buildNormalizedInputs uses SKU config key buckets before generic heuristics', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      parsingConfig: {
        sizeKeys: ['Garment Fit'],
        colorKeys: ['Shade Option'],
        productTypeColorKeys: ['Product / Shade'],
      },
      customerInputs: {
        options: [
          { label: 'Garment Fit', value: '60"x80\'\' INCHES' },
          { label: 'Shade Option', value: 'Bay' },
          { label: 'Product / Shade', value: 'Quarter Zip / Forest' },
        ],
      },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        semanticRole: 'SIZE',
        value: '60X80',
        originalLabel: 'Garment Fit',
        source: 'SKU_CONFIG',
        reason: 'SKU_CONFIG_KEY_BUCKET',
      }),
      expect.objectContaining({
        semanticRole: 'COLOR',
        value: 'BAY',
        originalLabel: 'Shade Option',
        source: 'SKU_CONFIG',
      }),
      expect.objectContaining({
        semanticRole: 'PRODUCT_TYPE',
        value: 'QUARTER ZIP',
        originalLabel: 'Product / Shade',
        source: 'SKU_CONFIG',
      }),
    ]));
  });

  test('buildNormalizedInputs prefers a combined SKU config product type over a generic semantic rule', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([{
      _id: '660000000000000000010099',
      semanticRole: 'PRODUCT_TYPE',
      matchTarget: 'LABEL',
      matchType: 'EXACT',
      matchValue: 'Select Product Type & Color',
      priority: 35,
      status: 'ACTIVE',
    }]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      parsingConfig: { productTypeColorKeys: ['Select Product Type & Color'] },
      customerInputs: {
        options: [{ label: 'Select Product Type & Color', value: 'Unisex T-Shirt/Black' }],
      },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        semanticRole: 'PRODUCT_TYPE',
        value: 'UNISEX T-SHIRT',
        source: 'SKU_CONFIG',
      }),
      expect.objectContaining({
        semanticRole: 'COLOR',
        value: 'BLACK',
        source: 'SKU_CONFIG',
      }),
    ]));
  });

  test('buildNormalizedInputs splits a combined product type and color input through input semantics', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([{
      _id: '660000000000000000010100',
      semanticRole: 'PRODUCT_TYPE_COLOR',
      matchTarget: 'LABEL',
      matchType: 'EXACT',
      matchValue: 'Select Product Type & Color',
      priority: 35,
      status: 'ACTIVE',
    }]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: {
        options: [{ label: 'Select Product Type & Color', value: 'Unisex T-Shirt/Black' }],
      },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        semanticRole: 'PRODUCT_TYPE',
        value: 'UNISEX T-SHIRT',
        source: 'RULE',
        ruleId: '660000000000000000010100',
      }),
      expect.objectContaining({
        semanticRole: 'COLOR',
        value: 'BLACK',
        source: 'RULE',
        ruleId: '660000000000000000010100',
      }),
    ]));
  });

  test('buildNormalizedInputs prefers composite input semantics over a legacy SKU config parser', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([{
      _id: '660000000000000000010101',
      semanticRole: 'PRODUCT_TYPE_COLOR',
      matchTarget: 'LABEL',
      matchType: 'EXACT',
      matchValue: 'Select Product Type & Color',
      priority: 35,
      status: 'ACTIVE',
    }]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      parsingConfig: { productTypeColorKeys: ['Select Product Type & Color'] },
      customerInputs: {
        options: [{ label: 'Select Product Type & Color', value: 'Unisex T-Shirt/Black' }],
      },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticRole: 'PRODUCT_TYPE', source: 'RULE' }),
      expect.objectContaining({ semanticRole: 'COLOR', source: 'RULE' }),
    ]));
  });

  test('buildNormalizedInputs prefers composite input semantics over a generic semantic rule with the same label', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([
      {
        _id: '660000000000000000010102',
        semanticRole: 'PRODUCT_TYPE',
        matchTarget: 'LABEL',
        matchType: 'EXACT',
        matchValue: 'Select Product Type & Color',
        priority: 35,
        status: 'ACTIVE',
      },
      {
        _id: '660000000000000000010103',
        semanticRole: 'PRODUCT_TYPE_COLOR',
        matchTarget: 'LABEL',
        matchType: 'CONTAINS',
        matchValue: 'Select Product Type & Color',
        priority: 100,
        status: 'ACTIVE',
      },
    ]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: {
        options: [{ label: 'Select Product Type & Color', value: 'Unisex T-Shirt/Black' }],
      },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticRole: 'PRODUCT_TYPE', value: 'UNISEX T-SHIRT', ruleId: '660000000000000000010103' }),
      expect.objectContaining({ semanticRole: 'COLOR', value: 'BLACK', ruleId: '660000000000000000010103' }),
    ]));
  });

  test('buildNormalizedInputs maps seller-specific size and color labels through rules', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([
      {
        _id: '660000000000000000010041',
        semanticRole: 'SIZE',
        matchTarget: 'LABEL',
        matchType: 'CONTAINS',
        matchValue: 'garment fit',
        priority: 1,
        status: 'ACTIVE',
      },
      {
        _id: '660000000000000000010042',
        semanticRole: 'COLOR',
        matchTarget: 'LABEL',
        matchType: 'CONTAINS',
        matchValue: 'shade option',
        priority: 1,
        status: 'ACTIVE',
      },
    ]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: {
        options: [
          { label: 'Garment Fit', value: 'M' },
          { label: 'Shade Option', value: 'Dark Heather' },
        ],
      },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        semanticRole: 'SIZE',
        value: 'M',
        originalLabel: 'Garment Fit',
        source: 'RULE',
        ruleId: '660000000000000000010041',
      }),
      expect.objectContaining({
        semanticRole: 'COLOR',
        value: 'DARK HEATHER',
        originalLabel: 'Shade Option',
        source: 'RULE',
        ruleId: '660000000000000000010042',
      }),
    ]));
  });

  test('buildNormalizedInputs uses template semantic roles for size and color labels', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: {
        options: [
          { label: 'Blanket Option', value: '60"x80\'\' INCHES' },
          { label: 'Background Choice', value: 'White' },
        ],
      },
      internalTemplate: {
        requiredFields: [
          { key: 'blanketSize', label: 'Blanket Option', validation: { semanticRole: 'SIZE' } },
          { key: 'backgroundColor', label: 'Background Choice', validation: { semanticRole: 'COLOR' } },
        ],
      },
    });

    expect(result.normalizedInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        semanticRole: 'SIZE',
        value: '60X80',
        originalLabel: 'Blanket Option',
        reason: 'DIMENSION_SIZE_HEURISTIC',
        source: 'TEMPLATE_METADATA',
      }),
      expect.objectContaining({
        semanticRole: 'COLOR',
        value: 'WHITE',
        originalLabel: 'Background Choice',
        reason: 'INTERNAL_TEMPLATE_SEMANTIC_ROLE',
        source: 'TEMPLATE_METADATA',
      }),
    ]));
  });

  test('buildNormalizedInputs ignores unconfigured parenthetical size options', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Select Size', value: 'Beverage (4.8"x4.8")' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual([]);
  });

  test('buildNormalizedInputs ignores unconfigured pack options', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Select Pack', value: 'Pack 100pcs' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual([]);
  });

  test('buildNormalizedInputs ignores unconfigured text and pack colors', async () => {
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

    expect(result.normalizedInputs).toEqual([]);
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

  test('buildNormalizedInputs matches value aliases after stripping parenthetical annotations', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([{
      _id: '660000000000000000010032',
      semanticRole: 'PRODUCT_TYPE',
      matchTarget: 'VALUE',
      matchType: 'EXACT',
      matchValue: 'Comfort Color T-Shirt (50% OFF)',
      normalizedValue: 'Comfort Color T-Shirt',
      priority: 1,
      status: 'ACTIVE',
    }]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: {
        options: [{
          label: 'Product Type',
          value: 'Comfort Color T-Shirt (OFF BESTELLING)',
        }],
      },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual([expect.objectContaining({
      semanticRole: 'PRODUCT_TYPE',
      value: 'COMFORT COLOR T-SHIRT',
      originalValue: 'Comfort Color T-Shirt (OFF BESTELLING)',
    })]);
  });

  test('does not infer product type from priority production label', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: {
        options: [{ label: 'Priority Production', value: "I don't think I need to." }],
      },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticRole: 'PRODUCT_TYPE' }),
    ]));
  });

  test('buildNormalizedInputs ignores unconfigured combined product and color values', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Product Type & Color', value: 'Unisex T-Shirt / Ash (Out of Stock)' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.blockingReasons).toEqual([]);
    expect(result.normalizedInputs).toEqual([]);
  });

  test('buildNormalizedInputs ignores unconfigured combined option labels', async () => {
    normalizationRepository.listActiveForContext.mockResolvedValue([]);

    const result = await service.buildNormalizedInputs({
      context: { shopId, productTypeGroupId },
      customerInputs: { options: [{ label: 'Select Product Type / Color', value: 'Unisex T-Shirt/Ash' }] },
      internalTemplate: { requiredFields: [] },
    });

    expect(result.normalizedInputs).toEqual([]);
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

  test('createVendorRoutingRule normalizes optional preference conditions', async () => {
    const result = await service.createVendorRoutingRule({
      shopId,
      productTypeGroupId,
      vendorId,
      asin: ' b0test123 ',
      configCode: ' ts1s ',
      normalizedSize: ' m ',
      normalizedColor: ' ash ',
      priority: 5,
    }, { permissions: ['MAPPING:WRITE'] });

    expect(routingRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      productTypeGroupId,
      vendorId,
      asin: 'B0TEST123',
      configCode: 'TS1S',
      normalizedSize: 'M',
      normalizedColor: 'ASH',
      priority: 5,
      status: 'ACTIVE',
    }), expect.any(Object));
    expect(result).toMatchObject({
      asin: 'B0TEST123',
      configCode: 'TS1S',
      normalizedSize: 'M',
      normalizedColor: 'ASH',
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
    }), expect.objectContaining({ vendorId, priority: 1, status: 'ACTIVE' }), expect.any(Object));
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
      sizeKeys: [' Select Size ', '', 'Choose Your Size'],
      colorKeys: [' Color '],
      productTypeKeys: [' Select Product Type '],
      productTypeColorKeys: [' Select Product Type / Color '],
      productTypeSizeKeys: [' Product Type / Size '],
      combinationKeys: [' Product Type & Color '],
      attributeKeyMap: { sellerLabel: 'PRODUCT_TYPE' },
      defaultColor: ' White ',
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
      sizeKeys: ['Select Size', 'Choose Your Size'],
      colorKeys: ['Color'],
      productTypeKeys: ['Select Product Type'],
      productTypeColorKeys: ['Select Product Type / Color'],
      productTypeSizeKeys: ['Product Type / Size'],
      combinationKeys: ['Product Type & Color'],
      attributeKeyMap: { sellerLabel: 'PRODUCT_TYPE' },
      defaultColor: 'WHITE',
      isSet: true,
      isPack: false,
      sizePosition: 1,
      colorPosition: 2,
      productTypeGroupId,
      internalTemplateId: '660000000000000000002002',
      status: 'ACTIVE',
    }), expect.any(Object));
    expect(result).toMatchObject({
      configCode: 'WT',
      sizeKeys: ['Select Size', 'Choose Your Size'],
      defaultColor: 'WHITE',
    });
  });

  test('createSkuConfigRule persists without rechecking blocked fulfillment plans', async () => {
    fulfillmentPlanRepository.listBlockedOrderItemIdsForRuleScope.mockResolvedValue([
      { orderItemId: '660000000000000000009001' },
      { orderItemId: '660000000000000000009002' },
    ]);
    const result = await service.createSkuConfigRule({
      shopId,
      configCode: 'TS2S',
      productTypeGroupId,
    }, { permissions: ['MAPPING:WRITE'] });

    expect(fulfillmentPlanRepository.listBlockedOrderItemIdsForRuleScope).not.toHaveBeenCalled();
    expect(fulfillmentPlanService.recheckFulfillmentPlan).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('autoRecheck');
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
    }), expect.any(Object));
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
    }), expect.any(Object));
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

  test('status-only normalization rule update preserves required fields', async () => {
    const ruleId = '660000000000000000010021';
    normalizationRepository.findById.mockResolvedValue({
      _id: ruleId,
      semanticRole: 'PRODUCT_TYPE',
      matchTarget: 'VALUE',
      matchType: 'CONTAINS',
      matchValue: 'QUATER ZIP',
      normalizedValue: 'QUARTER ZIP SWEATSHIRT',
      status: 'ACTIVE',
    });
    normalizationRepository.update.mockResolvedValue({
      _id: ruleId,
      semanticRole: 'PRODUCT_TYPE',
      matchTarget: 'VALUE',
      matchType: 'CONTAINS',
      matchValue: 'QUATER ZIP',
      normalizedValue: 'QUARTER ZIP SWEATSHIRT',
      status: 'INACTIVE',
    });

    await service.updateNormalizationRule(ruleId, { status: 'INACTIVE' }, {
      permissions: ['MAPPING:WRITE'],
    });

    expect(normalizationRepository.update).toHaveBeenCalledWith(ruleId, {
      status: 'INACTIVE',
    }, expect.any(Object));
  });

  test('falls back to a non-transactional mapping write only when standalone Mongo rejects transactions', async () => {
    transactionSession.withTransaction.mockRejectedValue(Object.assign(
      new Error('Transaction numbers are only allowed on a replica set member or mongos'),
      { code: 20 },
    ));

    await service.createNormalizationRule({
      shopId,
      semanticRole: 'SIZE',
      matchTarget: 'LABEL',
      matchType: 'CONTAINS',
      matchValue: 'size',
    }, { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['MAPPING:WRITE'] }] });

    expect(normalizationRepository.create).toHaveBeenCalledWith(expect.any(Object), { session: undefined });
    expect(auditRepository.create).toHaveBeenCalledWith(expect.any(Object), { session: undefined });
  });

  test('does not fall back when a transaction fails for another reason', async () => {
    transactionSession.withTransaction.mockRejectedValue(new Error('database unavailable'));

    await expect(service.createNormalizationRule({
      shopId,
      semanticRole: 'SIZE',
      matchTarget: 'LABEL',
      matchType: 'CONTAINS',
      matchValue: 'size',
    }, { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['MAPPING:WRITE'] }] }))
      .rejects.toThrow('database unavailable');

    expect(normalizationRepository.create).not.toHaveBeenCalled();
  });

  test('records a safe create snapshot with the acting account', async () => {
    const auth = { permissions: ['MAPPING:WRITE'], accountId: '660000000000000000009901' };

    await service.createSkuNormalizeRule({
      patternType: 'SEGMENT',
      segmentIndex: 0,
      segmentRole: 'CONFIG',
      appliesWhenValues: ['J2501'],
      outputAction: 'REPLACE_SEGMENT',
      replacementValue: 'J2503',
      untrustedExtra: 'do-not-persist',
    }, auth);

    expect(auditRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      ruleType: 'skuNormalize',
      event: 'CREATED',
      actorAccountId: auth.accountId,
      before: null,
      after: expect.objectContaining({ patternType: 'SEGMENT', replacementValue: 'J2503' }),
    }), expect.any(Object));
    expect(auditRepository.create.mock.calls[0][0].after).not.toHaveProperty('untrustedExtra');
  });

  test('records an actor-attributed status change and returns newest-first history', async () => {
    const ruleId = '660000000000000000010022';
    const auth = { permissions: ['MAPPING:WRITE'], accountId: '660000000000000000009902' };
    const existing = {
      _id: ruleId,
      shopId,
      patternType: 'SEGMENT',
      segmentIndex: 0,
      segmentRole: 'CONFIG',
      appliesWhenValues: ['J2501'],
      outputAction: 'REPLACE_SEGMENT',
      replacementValue: 'J2503',
      status: 'ACTIVE',
      privateValue: 'do-not-persist',
    };
    normalizationRepository.findById.mockResolvedValue(existing);
    skuNormalizeRepository.findById.mockResolvedValue(existing);
    skuNormalizeRepository.update.mockResolvedValue({ ...existing, status: 'INACTIVE' });
    auditRepository.listByRule.mockResolvedValue([{ event: 'STATUS_CHANGED', actorAccountId: auth.accountId }]);

    await service.updateSkuNormalizeRule(ruleId, { status: 'INACTIVE' }, auth);
    const history = await service.listRuleHistory('skuNormalize', ruleId, auth);

    expect(auditRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      ruleType: 'skuNormalize',
      ruleId,
      event: 'STATUS_CHANGED',
      actorAccountId: auth.accountId,
      before: expect.not.objectContaining({ privateValue: expect.anything() }),
      after: expect.objectContaining({ status: 'INACTIVE' }),
    }), expect.any(Object));
    expect(history.items[0]).toMatchObject({ event: 'STATUS_CHANGED', actorAccountId: auth.accountId });
  });

  test('records a non-status update as UPDATED', async () => {
    const ruleId = '660000000000000000010023';
    const existing = {
      _id: ruleId,
      patternType: 'SEGMENT',
      segmentIndex: 0,
      segmentRole: 'CONFIG',
      appliesWhenValues: ['J2501'],
      outputAction: 'REPLACE_SEGMENT',
      replacementValue: 'J2503',
      priority: 100,
      status: 'ACTIVE',
    };
    skuNormalizeRepository.findById.mockResolvedValue(existing);
    skuNormalizeRepository.update.mockResolvedValue({ ...existing, priority: 10 });

    await service.updateSkuNormalizeRule(ruleId, { priority: 10 }, { permissions: ['MAPPING:WRITE'] });

    expect(auditRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      event: 'UPDATED',
      before: expect.objectContaining({ priority: 100 }),
      after: expect.objectContaining({ priority: 10 }),
    }), expect.any(Object));
  });

  test('does not expose history outside the rule shop scope', async () => {
    const ruleId = '660000000000000000010024';
    skuNormalizeRepository.findById.mockResolvedValue({ _id: ruleId, shopId });
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.listRuleHistory('skuNormalize', ruleId, {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['MAPPING:READ'] }],
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });

    expect(auditRepository.listByRule).not.toHaveBeenCalled();
  });

  test('rejects a shop change and keeps the original rule history scope-protected', async () => {
    const ruleId = '660000000000000000010025';
    const originalShopId = shopId;
    const otherShopId = '660000000000000000000202';
    normalizationRepository.findById.mockResolvedValue({
      _id: ruleId,
      shopId: originalShopId,
      semanticRole: 'SIZE',
      matchTarget: 'LABEL',
      matchType: 'CONTAINS',
      matchValue: 'size',
      status: 'ACTIVE',
    });

    await expect(service.updateNormalizationRule(ruleId, { shopId: otherShopId }, {
      permissions: ['MAPPING:WRITE'],
    })).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    authPublic.canAccessScope.mockReturnValue(false);
    await expect(service.listRuleHistory('normalization', ruleId, {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: otherShopId, permissions: ['MAPPING:READ'] }],
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
    expect(auditRepository.listByRule).not.toHaveBeenCalled();
  });

  test('aborts the rule write transaction when audit insertion fails', async () => {
    auditRepository.create.mockRejectedValue(new Error('audit write failed'));

    await expect(service.createSkuNormalizeRule({
      patternType: 'SEGMENT',
      segmentIndex: 0,
      segmentRole: 'CONFIG',
      appliesWhenValues: ['J2501'],
      outputAction: 'REPLACE_SEGMENT',
      replacementValue: 'J2503',
    }, { permissions: ['MAPPING:WRITE'] })).rejects.toThrow('audit write failed');

    expect(mongoose.startSession).toHaveBeenCalled();
    expect(transactionSession.withTransaction).toHaveBeenCalled();
    expect(transactionSession.endSession).toHaveBeenCalled();
    expect(skuNormalizeRepository.create).toHaveBeenCalledWith(expect.any(Object), {
      session: transactionSession,
    });
  });

  test('audits every vendor-rank upsert with created, updated, and status events', async () => {
    const auth = { permissions: ['MAPPING:WRITE'], accountId: '660000000000000000009903' };
    routingRepository.findForScopeVendor
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        _id: '660000000000000000010031',
        productTypeGroupId,
        vendorId: '660000000000000000004002',
        priority: 2,
        status: 'INACTIVE',
      })
      .mockResolvedValueOnce({
        _id: '660000000000000000010032',
        productTypeGroupId,
        vendorId: '660000000000000000004003',
        priority: 50,
        status: 'ACTIVE',
      });

    await service.reorderVendorRoutingRules({
      productTypeGroupId,
      vendorRanks: [
        { vendorId: '660000000000000000004001', priority: 1 },
        { vendorId: '660000000000000000004002', priority: 2 },
        { vendorId: '660000000000000000004003', priority: 3 },
      ],
    }, auth);

    expect(auditRepository.create.mock.calls.map(([event]) => event.event)).toEqual([
      'CREATED',
      'STATUS_CHANGED',
      'UPDATED',
    ]);
    expect(auditRepository.create.mock.calls.map(([event]) => event.actorAccountId)).toEqual([
      auth.accountId,
      auth.accountId,
      auth.accountId,
    ]);
    expect(auditRepository.create.mock.calls[2][0]).toMatchObject({
      before: expect.objectContaining({ priority: 50 }),
      after: expect.objectContaining({ priority: 3 }),
    });
  });

  test('returns multiple history events newest-first', async () => {
    const ruleId = '660000000000000000010026';
    skuNormalizeRepository.findById.mockResolvedValue({ _id: ruleId, shopId: null });
    auditRepository.listByRule.mockResolvedValue([
      { event: 'CREATED', createdAt: new Date('2026-07-01T00:00:00.000Z') },
      { event: 'UPDATED', createdAt: new Date('2026-07-03T00:00:00.000Z') },
      { event: 'STATUS_CHANGED', createdAt: new Date('2026-07-02T00:00:00.000Z') },
    ]);

    const history = await service.listRuleHistory('skuNormalize', ruleId, { permissions: ['MAPPING:READ'] });

    expect(history.items.map((item) => item.event)).toEqual(['UPDATED', 'STATUS_CHANGED', 'CREATED']);
  });

  test('allows a shop-scoped reader to view history for a visible global rule', async () => {
    const ruleId = '660000000000000000010027';
    skuNormalizeRepository.findById.mockResolvedValue({ _id: ruleId, shopId: null });
    auditRepository.listByRule.mockResolvedValue([{ event: 'CREATED' }]);

    const history = await service.listRuleHistory('skuNormalize', ruleId, {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['MAPPING:READ'] }],
    });

    expect(history.items).toEqual([{ event: 'CREATED' }]);
    expect(auditRepository.listByRule).toHaveBeenCalledWith('skuNormalize', ruleId);
  });

  test('previews a replacement segment without persisting a rule', async () => {
    const result = await service.previewRule({
      ruleType: 'skuNormalize',
      rule: {
        patternType: 'SEGMENT',
        segmentIndex: 0,
        segmentRole: 'CONFIG',
        appliesWhenValues: ['J2501'],
        outputAction: 'REPLACE_SEGMENT',
        replacementValue: 'J2503',
      },
      samples: ['J2501-TS1S-US-123'],
    }, adminAuth);

    expect(result.samples[0]).toMatchObject({
      input: 'J2501-TS1S-US-123',
      output: 'J2503-TS1S-US-123',
      matched: true,
    });
    expect(skuNormalizeRepository.create).not.toHaveBeenCalled();
    expect(skuNormalizeRepository.update).not.toHaveBeenCalled();
  });

  test('previews SKU rules with production canonicalization and config guards', async () => {
    const result = await service.previewRule({
      ruleType: 'skuNormalize',
      rule: {
        configCode: ' ts1s ',
        patternType: 'SEGMENT',
        segmentIndex: 1,
        segmentRole: 'CONFIG',
        appliesWhenValues: ['ts1s'],
        outputAction: 'REPLACE_SEGMENT',
        replacementValue: 'ts2s',
      },
      samples: [' j2508--ts1s--25022026-666 ', 'j2508--ts9s'],
    }, adminAuth);

    expect(result.samples).toEqual([
      { input: ' j2508--ts1s--25022026-666 ', output: 'J2508-TS2S-25022026-666', matched: true },
      { input: 'j2508--ts9s', output: 'J2508-TS9S', matched: false },
    ]);

    const noOp = await service.previewRule({
      ruleType: 'skuNormalize',
      rule: {
        patternType: 'SEGMENT',
        segmentIndex: 1,
        segmentRole: 'CONFIG',
        appliesWhenValues: ['TS1S'],
        outputAction: 'REPLACE_SEGMENT',
        replacementValue: 'TS1S',
      },
      samples: ['j2508--ts1s'],
    }, adminAuth);
    expect(noOp.samples).toEqual([{ input: 'j2508--ts1s', output: 'J2508-TS1S', matched: false }]);
  });

  test('previews product mapping with target metadata instead of echoing the input', async () => {
    const result = await service.previewRule({
      ruleType: 'skuConfig',
      rule: {
        configCode: 'TS1S',
        productTypeGroupId,
        internalTemplateId: '660000000000000000002002',
        platformProductType: 'UNISEX HOODIE',
      },
      samples: ['TS1S'],
    }, adminAuth);

    expect(result.samples).toEqual([
      expect.objectContaining({
        input: 'TS1S',
        output: productTypeGroupId,
        matched: true,
        configCode: 'TS1S',
        productTypeGroupId,
        internalTemplateId: '660000000000000000002002',
        platformProductType: 'UNISEX HOODIE',
      }),
    ]);
  });

  test('previews the semantic role from a composite input label', async () => {
    const result = await service.previewRule({
      ruleType: 'semanticRules',
      rule: {
        semanticRole: 'PRODUCT_TYPE_COLOR',
        matchValues: ['Select Product Type & Color'],
        matchType: 'CONTAINS',
      },
      samples: ['Select Product Type & Color'],
    }, adminAuth);

    expect(result.samples).toEqual([expect.objectContaining({
      input: 'Select Product Type & Color',
      output: 'PRODUCT_TYPE_COLOR',
      matched: true,
      matchTarget: 'LABEL',
      parsedInputs: [],
    })]);
  });

  test('does not invent vendor routing samples', async () => {
    const result = await service.previewRule({
      ruleType: 'vendorRouting',
      rule: {
        productTypeGroupId,
        vendorId,
        configCode: 'ts2s',
        normalizedSize: 's',
        normalizedColor: 'charcoal',
      },
    }, adminAuth);

    expect(result.samples).toEqual([]);
  });

  test('returns only visible conflicts and ranks exact-scope overlaps first', async () => {
    const inaccessibleShopId = '660000000000000000000202';
    authPublic.canAccessScope.mockImplementation((_auth, _permission, scope) => scope.scopeId === shopId);
    skuNormalizeRepository.list.mockResolvedValue({
      items: [
        {
          _id: '660000000000000000010051',
          shopId: inaccessibleShopId,
          patternType: 'SEGMENT',
          segmentIndex: 0,
          segmentRole: 'CONFIG',
          appliesWhenValues: ['J2501'],
          outputAction: 'REPLACE_SEGMENT',
          replacementValue: 'J2503',
          priority: 1,
          status: 'ACTIVE',
        },
        {
          _id: '660000000000000000010052',
          shopId: null,
          patternType: 'SEGMENT',
          segmentIndex: 0,
          segmentRole: 'CONFIG',
          appliesWhenValues: ['J2501'],
          outputAction: 'REPLACE_SEGMENT',
          replacementValue: 'J2503',
          priority: 20,
          status: 'ACTIVE',
        },
        {
          _id: '660000000000000000010053',
          shopId,
          patternType: 'SEGMENT',
          segmentIndex: 0,
          segmentRole: 'CONFIG',
          appliesWhenValues: ['J2501'],
          outputAction: 'REPLACE_SEGMENT',
          replacementValue: 'J2503',
          priority: 10,
          status: 'ACTIVE',
        },
      ],
      pagination: { total: 3, page: 1, limit: 20 },
    });

    const result = await service.findRuleConflicts({
      ruleType: 'skuNormalize',
      rule: {
        shopId,
        patternType: 'SEGMENT',
        segmentIndex: 0,
        segmentRole: 'CONFIG',
        appliesWhenValues: ['J2501'],
        outputAction: 'REPLACE_SEGMENT',
        replacementValue: 'J2503',
      },
    }, {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['MAPPING:READ'] }],
    });

    expect(result.conflicts).toEqual([
      expect.objectContaining({ id: '660000000000000000010053', severity: 'ERROR', priority: 10, status: 'ACTIVE' }),
      expect.objectContaining({ id: '660000000000000000010052', severity: 'WARNING', priority: 20, status: 'ACTIVE' }),
    ]);
    expect(result.conflicts).toHaveLength(2);
  });

  test('finds vendor routing conflicts through routing repository', async () => {
    routingRepository.list.mockResolvedValue({
      items: [
        {
          _id: '660000000000000000010061',
          productTypeGroupId,
          vendorId,
          configCode: 'TS2S',
          normalizedSize: 'S',
          priority: 8,
          status: 'ACTIVE',
        },
        {
          _id: '660000000000000000010062',
          productTypeGroupId,
          vendorId: '660000000000000000004998',
          configCode: 'TS2S',
          normalizedSize: 'S',
          priority: 9,
          status: 'ACTIVE',
        },
      ],
      pagination: { total: 2, page: 1, limit: 100 },
    });

    const result = await service.findRuleConflicts({
      ruleType: 'vendorRouting',
      rule: {
        productTypeGroupId,
        vendorId,
        configCode: 'ts2s',
        normalizedSize: 's',
      },
    }, adminAuth);

    expect(result.conflicts.map((item) => item.id)).toEqual(['660000000000000000010061']);
    expect(routingRepository.list).toHaveBeenCalled();
  });

  test('excludes the edited rule itself and matches SKU conflicts by production segment keys', async () => {
    const ruleId = '660000000000000000010056';
    skuNormalizeRepository.list.mockResolvedValue({
      items: [
        {
          _id: ruleId,
          patternType: 'SEGMENT',
          segmentIndex: 1,
          segmentRole: 'CONFIG',
          appliesWhenValues: ['TS1S'],
          outputAction: 'REPLACE_SEGMENT',
          replacementValue: 'TS2S',
          priority: 10,
          status: 'ACTIVE',
        },
        {
          _id: '660000000000000000010057',
          patternType: 'SEGMENT',
          segmentIndex: 1,
          segmentRole: 'OTHER',
          appliesWhenValues: ['TS1S'],
          outputAction: 'REMOVE_SEGMENT',
          priority: 20,
          status: 'ACTIVE',
        },
      ],
      pagination: { total: 2, page: 1, limit: 100 },
    });

    const result = await service.findRuleConflicts({
      ruleId,
      ruleType: 'skuNormalize',
      rule: {
        patternType: 'SEGMENT',
        segmentIndex: 1,
        segmentRole: 'COUNTRY',
        appliesWhenValues: ['TS1S'],
        outputAction: 'REPLACE_SEGMENT',
        replacementValue: 'TS2S',
      },
    }, adminAuth);

    expect(result.conflicts.map((item) => item.id)).toEqual(['660000000000000000010057']);
  });

  test('audits a full-form status-only update as STATUS_CHANGED from the persisted snapshots', async () => {
    const ruleId = '660000000000000000010058';
    const existing = {
      _id: ruleId,
      shopId,
      semanticRole: 'SIZE',
      matchTarget: 'VALUE',
      matchType: 'EXACT',
      matchValue: 'XL',
      normalizedValue: 'XL',
      priority: 100,
      status: 'ACTIVE',
    };
    normalizationRepository.findById.mockResolvedValue(existing);
    normalizationRepository.update.mockResolvedValue({ ...existing, status: 'INACTIVE' });

    const { shopId: _shopId, ...fullFormPatch } = existing;
    await service.updateNormalizationRule(ruleId, { ...fullFormPatch, status: 'INACTIVE' }, {
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['MAPPING:WRITE'] }],
    });

    expect(auditRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      event: 'STATUS_CHANGED',
      before: expect.objectContaining({ status: 'ACTIVE' }),
      after: expect.objectContaining({ status: 'INACTIVE' }),
    }), expect.any(Object));
  });

  test('does not report visible rules with disjoint scopes as conflicts', async () => {
    skuNormalizeRepository.list.mockResolvedValue({
      items: [{
        _id: '660000000000000000010054',
        shopId,
        salesChannelCode: 'EBAY',
        patternType: 'SEGMENT',
        segmentIndex: 0,
        segmentRole: 'CONFIG',
        appliesWhenValues: ['J2501'],
        outputAction: 'REPLACE_SEGMENT',
        replacementValue: 'J2503',
        priority: 10,
        status: 'ACTIVE',
      }],
      pagination: { total: 1, page: 1, limit: 100 },
    });

    const result = await service.findRuleConflicts({
      ruleType: 'skuNormalize',
      rule: {
        shopId,
        salesChannelCode: 'AMAZON',
        patternType: 'SEGMENT',
        segmentIndex: 0,
        segmentRole: 'CONFIG',
        appliesWhenValues: ['J2501'],
        outputAction: 'REPLACE_SEGMENT',
        replacementValue: 'J2503',
      },
    }, adminAuth);

    expect(result.conflicts).toEqual([]);
  });

  test('finds conflicts beyond the first repository page', async () => {
    const conflict = {
      _id: '660000000000000000010055',
      patternType: 'SEGMENT',
      segmentIndex: 0,
      segmentRole: 'CONFIG',
      appliesWhenValues: ['J2501'],
      outputAction: 'REPLACE_SEGMENT',
      replacementValue: 'J2503',
      priority: 10,
      status: 'ACTIVE',
    };
    skuNormalizeRepository.list.mockImplementation(async ({ page }) => ({
      items: page === 2 ? [conflict] : [],
      pagination: { total: 101, page, limit: 100 },
    }));

    const result = await service.findRuleConflicts({
      ruleType: 'skuNormalize',
      rule: {
        patternType: 'SEGMENT',
        segmentIndex: 0,
        segmentRole: 'CONFIG',
        appliesWhenValues: ['J2501'],
        outputAction: 'REPLACE_SEGMENT',
        replacementValue: 'J2503',
      },
    }, adminAuth);

    expect(skuNormalizeRepository.list).toHaveBeenCalledWith(expect.objectContaining({ page: 2, limit: 100 }));
    expect(result.conflicts).toEqual([expect.objectContaining({ id: '660000000000000000010055' })]);
  });
});
