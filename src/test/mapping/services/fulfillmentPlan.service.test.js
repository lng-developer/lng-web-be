jest.mock('../../../modules/order/public', () => ({
  findItemById: jest.fn(),
  appendTimeline: jest.fn(),
}));

jest.mock('../../../modules/catalog/public', () => ({
  findListingBySku: jest.fn(),
  findProductTypeGroupByCode: jest.fn(),
  getInternalTemplateById: jest.fn(),
  getInternalTemplateForListing: jest.fn(),
}));

jest.mock('../../../modules/customization/public', () => ({
  assertCustomizationReady: jest.fn(),
  getOrderItemCustomizationView: jest.fn(),
}));

jest.mock('../../../modules/vendor/public', () => ({
  getVendorById: jest.fn(),
  getVendorProductById: jest.fn(),
  listActiveVendorProductsByProductTypeGroup: jest.fn(),
  listActiveVendorCostCenters: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/mapping/repositories/fulfillmentPlan.repository', () => ({
  findActiveByOrderItem: jest.fn(),
  findByOrderItem: jest.fn(),
  upsertActiveByOrderItem: jest.fn(),
  upsertByOrderItem: jest.fn(),
}));

jest.mock('../../../modules/mapping/services/mappingRule.service', () => ({
  buildNormalizedInputs: jest.fn(),
  listActiveSkuNormalizeRulesForContext: jest.fn(),
  listActiveSkuConfigRulesForContext: jest.fn(),
  listActiveVendorRoutingRulesForContext: jest.fn(),
}));

const orderPublic = require('../../../modules/order/public');
const catalogPublic = require('../../../modules/catalog/public');
const customizationPublic = require('../../../modules/customization/public');
const vendorPublic = require('../../../modules/vendor/public');
const authPublic = require('../../../modules/auth/public');
const repository = require('../../../modules/mapping/repositories/fulfillmentPlan.repository');
const mappingRuleService = require('../../../modules/mapping/services/mappingRule.service');
const service = require('../../../modules/mapping/services/fulfillmentPlan.service');

describe('fulfillmentPlan.service', () => {
  const orderItemId = '660000000000000000001001';
  const orderId = '660000000000000000001000';
  const shopId = '660000000000000000000201';
  const listingId = '660000000000000000002001';
  const templateId = '660000000000000000002002';
  const groupId = '660000000000000000003001';
  const selectedGroupId = '660000000000000000003002';
  const vendorProductId = '660000000000000000004001';
  const costCenterId = '660000000000000000005001';

  const item = {
    _id: orderItemId,
    orderId,
    shopId,
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'AMAZON_US',
    sku: 'SHIRT-L',
    title: 'Shirt',
    quantity: 1,
    customizationRawSummary: { hasCustomization: true },
  };

  const listing = {
    _id: listingId,
    sku: 'SHIRT-L',
    title: 'Listing Shirt',
    productTypeGroupId: groupId,
    internalTemplateId: templateId,
  };

  const template = {
    _id: templateId,
    code: 'SHIRT_TEMPLATE',
    name: 'Shirt Template',
    status: 'ACTIVE',
  };

  const vendorProduct = {
    _id: vendorProductId,
    code: 'VP_SHIRT',
    name: 'Vendor Shirt',
    status: 'ACTIVE',
    productTypeGroupId: groupId,
    vendorId: { _id: '660000000000000000004999', code: 'PRINTWAY', name: 'Printway', status: 'ACTIVE' },
  };
  const vendorId = '660000000000000000004999';

  const costCenter = {
    _id: costCenterId,
    vendorProductId,
    vendorId,
    code: 'SHIRT_L',
    sku: 'SHIRT-L',
    standardSize: 'L',
    standardColor: 'BLACK',
    baseCostAmount: 1200,
    currency: 'USD',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    orderPublic.findItemById.mockResolvedValue(item);
    catalogPublic.findListingBySku.mockResolvedValue(listing);
    catalogPublic.getInternalTemplateForListing.mockResolvedValue(template);
    catalogPublic.getInternalTemplateById.mockResolvedValue(template);
    catalogPublic.findProductTypeGroupByCode.mockResolvedValue(null);
    customizationPublic.assertCustomizationReady.mockResolvedValue({ status: 'PARSED' });
    customizationPublic.getOrderItemCustomizationView.mockResolvedValue({
      customerInputs: {
        options: [{ label: 'Select Size', value: 'L' }, { label: 'Text Color', value: 'Black' }],
        texts: [],
        images: [],
      },
    });
    vendorPublic.listActiveVendorProductsByProductTypeGroup.mockResolvedValue([vendorProduct]);
    vendorPublic.listActiveVendorCostCenters.mockResolvedValue([costCenter]);
    vendorPublic.getVendorById.mockResolvedValue(vendorProduct.vendorId);
    vendorPublic.getVendorProductById.mockResolvedValue(vendorProduct);
    repository.findByOrderItem.mockResolvedValue(null);
    repository.upsertByOrderItem.mockImplementation(async (_orderItemId, payload) => ({
      _id: '660000000000000000006001',
      orderItemId,
      ...payload,
    }));
    mappingRuleService.buildNormalizedInputs.mockResolvedValue({
      normalizedInputs: [
        {
          semanticRole: 'SIZE',
          value: 'L',
          originalLabel: 'Select Size',
          originalValue: 'L',
          confidence: 'HIGH',
          reason: 'LABEL_HEURISTIC',
          source: 'HEURISTIC',
          ruleId: null,
        },
        {
          semanticRole: 'COLOR',
          value: 'BLACK',
          originalLabel: 'Text Color',
          originalValue: 'Black',
          confidence: 'HIGH',
          reason: 'LABEL_HEURISTIC',
          source: 'HEURISTIC',
          ruleId: null,
        },
      ],
      blockingReasons: [],
    });
    mappingRuleService.listActiveSkuNormalizeRulesForContext.mockResolvedValue([]);
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValue([]);
    mappingRuleService.listActiveVendorRoutingRulesForContext.mockResolvedValue([]);
  });

  test('preview returns candidates and autoMatch suggestion without persisting plan', async () => {
    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.ready).toBe(true);
    expect(result.selectedVendorProductId).toBeNull();
    expect(result.selectedVendorCostCenterId).toBeNull();
    expect(result.autoMatch).toMatchObject({
      vendorProductId,
      vendorCostCenterId: costCenterId,
      confidence: 'HIGH',
    });
    expect(result.normalizedInputs[0]).toMatchObject({
      semanticRole: 'SIZE',
      source: 'HEURISTIC',
    });
    expect(result.vendorProductCandidates).toHaveLength(1);
    expect(result.costCenterCandidates[0]).toMatchObject({
      id: costCenterId,
      vendorProductId,
      confidence: 'HIGH',
    });
    expect(customizationPublic.getOrderItemCustomizationView.mock.calls[0]).toEqual([orderItemId]);
    expect(repository.upsertByOrderItem).not.toHaveBeenCalled();
  });

  test('preview returns blocked when order item is missing', async () => {
    orderPublic.findItemById.mockResolvedValueOnce(null);

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.ready).toBe(false);
    expect(result.blockingReasons).toContain('ORDER_ITEM_NOT_FOUND');
    expect(catalogPublic.findListingBySku).not.toHaveBeenCalled();
  });

  test('preview blocks when listing is missing', async () => {
    catalogPublic.findListingBySku.mockResolvedValueOnce(null);

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.ready).toBe(false);
    expect(result.blockingReasons).toContain('LISTING_NOT_FOUND');
    expect(vendorPublic.listActiveVendorProductsByProductTypeGroup).not.toHaveBeenCalled();
  });

  test('preview can resolve vendor candidates from SKU config when listing is missing', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2520-NK-280226-2206',
    });
    catalogPublic.findListingBySku.mockResolvedValueOnce(null);
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValueOnce([{
      _id: '660000000000000000010101',
      configCode: 'NK',
      productTypeAliases: ['NAPKINS'],
      productTypeGroupId: groupId,
      internalTemplateId: null,
    }]);

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.blockingReasons).not.toContain('LISTING_NOT_FOUND');
    expect(vendorPublic.listActiveVendorProductsByProductTypeGroup).toHaveBeenCalledWith(groupId);
    expect(result.productTypeGroupId).toBe(groupId);
    expect(result.skuMapping).toMatchObject({
      employeeCode: 'J2520',
      configCode: 'NK',
      ruleId: '660000000000000000010101',
      productTypeGroupId: groupId,
    });
  });

  test('preview blocks when customization is not ready', async () => {
    customizationPublic.assertCustomizationReady.mockRejectedValueOnce(new Error('not ready'));

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.ready).toBe(false);
    expect(result.blockingReasons).toContain('CUSTOMIZATION_NOT_READY');
  });

  test('select requires explicit selected vendor product and cost center', async () => {
    await expect(service.selectFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });

  test('select rejects selected cost center that does not belong to selected product', async () => {
    await expect(service.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId: '660000000000000000005999',
    }, { permissions: ['MAPPING:WRITE'] })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
  });

  test('manual select upserts READY plan and appends order timeline through public port', async () => {
    const result = await service.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }, { permissions: ['MAPPING:WRITE'], accountId: '660000000000000000009001' });

    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      status: 'READY',
      selectionMode: 'MANUAL',
      orderId,
      listingId,
      internalTemplateId: templateId,
      productTypeGroupId: groupId,
      vendorProductId,
      vendorCostCenterId: costCenterId,
      resolvedBy: '660000000000000000009001',
    }));
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      eventType: 'FULFILLMENT_PLAN_READY',
      source: 'MAPPING',
    }));
    expect(result.status).toBe('READY');
    expect(result.selectionMode).toBe('MANUAL');
  });

  test('manual select returns existing READY plan when same selection is repeated', async () => {
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: '660000000000000000006001',
      orderItemId,
      status: 'READY',
      selectionMode: 'MANUAL',
      vendorProductId,
      vendorCostCenterId: costCenterId,
      snapshot: {},
      blockingReasons: [],
    });

    const result = await service.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }, { permissions: ['MAPPING:WRITE'] });

    expect(repository.upsertByOrderItem).not.toHaveBeenCalled();
    expect(result.status).toBe('READY');
  });

  test('manual select rejects when existing READY plan has different selection', async () => {
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: '660000000000000000006001',
      orderItemId,
      status: 'READY',
      selectionMode: 'MANUAL',
      vendorProductId,
      vendorCostCenterId: '660000000000000000005999',
      snapshot: {},
      blockingReasons: [],
    });

    await expect(service.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }, { permissions: ['MAPPING:WRITE'] })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
  });

  test('out-of-stock normalized input blocks preview and confirm', async () => {
    mappingRuleService.buildNormalizedInputs.mockResolvedValueOnce({
      normalizedInputs: [{
        semanticRole: 'COLOR',
        value: 'ASH',
        originalLabel: 'Product Type & Color',
        originalValue: 'Unisex T-Shirt / Ash (Out of Stock)',
        confidence: 'HIGH',
        reason: 'OUT_OF_STOCK_HEURISTIC',
        source: 'HEURISTIC',
        ruleId: null,
        flags: { outOfStock: true },
      }],
      blockingReasons: ['SELECTED_OPTION_OUT_OF_STOCK'],
    });

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.ready).toBe(false);
    expect(result.blockingReasons).toContain('SELECTED_OPTION_OUT_OF_STOCK');

    mappingRuleService.buildNormalizedInputs.mockResolvedValueOnce({
      normalizedInputs: [{
        semanticRole: 'COLOR',
        value: 'ASH',
        originalLabel: 'Product Type & Color',
        originalValue: 'Unisex T-Shirt / Ash (Out of Stock)',
        confidence: 'HIGH',
        reason: 'OUT_OF_STOCK_HEURISTIC',
        source: 'HEURISTIC',
        ruleId: null,
        flags: { outOfStock: true },
      }],
      blockingReasons: ['SELECTED_OPTION_OUT_OF_STOCK'],
    });

    await expect(service.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }, { permissions: ['MAPPING:WRITE'] })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('resolve auto-saves READY plan when preview has one high-confidence autoMatch', async () => {
    const result = await service.resolveFulfillmentPlan(orderItemId, {}, {
      permissions: ['MAPPING:WRITE'],
      accountId: '660000000000000000009001',
    });

    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      status: 'READY',
      selectionMode: 'AUTO',
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }));
    expect(result.status).toBe('READY');
    expect(result.selectionMode).toBe('AUTO');
  });

  test('preview resolves vendor candidates from normalized product type selection', async () => {
    mappingRuleService.buildNormalizedInputs.mockResolvedValueOnce({
      normalizedInputs: [{
        semanticRole: 'PRODUCT_TYPE',
        value: 'UNISEX T-SHIRT',
        originalLabel: 'Select Product Type & Color',
        originalValue: 'Unisex T-Shirt/Dark Heather',
        confidence: 'HIGH',
        reason: 'COMBINED_PRODUCT_COLOR',
        source: 'HEURISTIC',
        ruleId: null,
        flags: { outOfStock: false },
      }],
      blockingReasons: [],
    });
    catalogPublic.findProductTypeGroupByCode.mockResolvedValueOnce({
      _id: selectedGroupId,
      code: 'UNISEX_T_SHIRT',
      name: 'Unisex T-shirt',
      status: 'ACTIVE',
    });

    await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(catalogPublic.findProductTypeGroupByCode).toHaveBeenCalledWith('UNISEX_T_SHIRT');
    expect(vendorPublic.listActiveVendorProductsByProductTypeGroup).toHaveBeenCalledWith(selectedGroupId);
    expect(mappingRuleService.listActiveVendorRoutingRulesForContext).toHaveBeenCalledWith(expect.objectContaining({
      productTypeGroupId: selectedGroupId,
    }));
  });

  test('preview canonicalizes SKU before listing lookup and config parsing', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2508-L-DM-260526-3979',
    });
    mappingRuleService.listActiveSkuNormalizeRulesForContext.mockResolvedValueOnce([{
      _id: '660000000000000000010004',
      patternType: 'SEGMENT',
      segmentIndex: 1,
      segmentRole: 'SIZE',
      appliesWhenValues: ['S', 'M', 'L', 'XL'],
      outputAction: 'REMOVE_SEGMENT',
      priority: 1,
      status: 'ACTIVE',
    }]);
    catalogPublic.findListingBySku.mockImplementationOnce(async ({ sku }) => (
      sku === 'J2508-DM-260526-3979' ? { ...listing, sku } : null
    ));

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(catalogPublic.findListingBySku).toHaveBeenCalledWith(expect.objectContaining({
      sku: 'J2508-DM-260526-3979',
    }));
    expect(mappingRuleService.listActiveSkuConfigRulesForContext).toHaveBeenCalledWith(expect.objectContaining({
      configCode: 'DM',
    }));
    expect(result.skuNormalization).toMatchObject({
      originalSku: 'J2508-L-DM-260526-3979',
      canonicalSku: 'J2508-DM-260526-3979',
      removedSegments: [{ index: 1, value: 'L', role: 'SIZE' }],
    });
    expect(result.skuMapping).toMatchObject({
      employeeCode: 'J2508',
      configCode: 'DM',
      dateCode: '260526',
      sequence: '3979',
    });
  });

  test('preview removes country segment with config-scoped SKU normalize rule', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2504-TS1S-US-050226-1',
    });
    mappingRuleService.listActiveSkuNormalizeRulesForContext.mockResolvedValueOnce([{
      _id: '660000000000000000010014',
      configCode: 'TS1S',
      patternType: 'SEGMENT',
      segmentIndex: 2,
      segmentRole: 'COUNTRY',
      appliesWhenValues: ['US'],
      outputAction: 'REMOVE_SEGMENT',
      priority: 1,
      status: 'ACTIVE',
    }]);
    catalogPublic.findListingBySku.mockImplementationOnce(async ({ sku }) => (
      sku === 'J2504-TS1S-050226-1' ? { ...listing, sku } : null
    ));

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(mappingRuleService.listActiveSkuNormalizeRulesForContext).toHaveBeenCalledWith(expect.objectContaining({
      configCode: 'TS1S',
    }));
    expect(catalogPublic.findListingBySku).toHaveBeenCalledWith(expect.objectContaining({
      sku: 'J2504-TS1S-050226-1',
    }));
    expect(result.skuNormalization).toMatchObject({
      originalSku: 'J2504-TS1S-US-050226-1',
      canonicalSku: 'J2504-TS1S-050226-1',
      removedSegments: [{ index: 2, value: 'US', role: 'COUNTRY' }],
    });
    expect(result.skuMapping).toMatchObject({
      employeeCode: 'J2504',
      configCode: 'TS1S',
      dateCode: '050226',
      sequence: '1',
    });
  });

  test('preview replaces SKU config segment before listing lookup and config parsing', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2508-TS1S-25022026-666',
    });
    mappingRuleService.listActiveSkuNormalizeRulesForContext.mockResolvedValueOnce([{
      _id: '660000000000000000010024',
      patternType: 'SEGMENT',
      segmentIndex: 1,
      segmentRole: 'CONFIG',
      appliesWhenValues: ['TS1S'],
      outputAction: 'REPLACE_SEGMENT',
      replacementValue: 'TS2S',
      priority: 1,
      status: 'ACTIVE',
    }]);
    catalogPublic.findListingBySku.mockImplementationOnce(async ({ sku }) => (
      sku === 'J2508-TS2S-25022026-666' ? { ...listing, sku } : null
    ));

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(catalogPublic.findListingBySku).toHaveBeenCalledWith(expect.objectContaining({
      sku: 'J2508-TS2S-25022026-666',
    }));
    expect(mappingRuleService.listActiveSkuConfigRulesForContext).toHaveBeenCalledWith(expect.objectContaining({
      configCode: 'TS2S',
    }));
    expect(result.skuNormalization).toMatchObject({
      originalSku: 'J2508-TS1S-25022026-666',
      canonicalSku: 'J2508-TS2S-25022026-666',
      replacedSegments: [{ index: 1, from: 'TS1S', to: 'TS2S', role: 'CONFIG' }],
    });
    expect(result.skuMapping).toMatchObject({
      employeeCode: 'J2508',
      configCode: 'TS2S',
      dateCode: '25022026',
      sequence: '666',
    });
  });

  test('preview replaces SKU employee segment', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2508-TS1S-25022026-666',
    });
    mappingRuleService.listActiveSkuNormalizeRulesForContext.mockResolvedValueOnce([{
      _id: '660000000000000000010025',
      patternType: 'SEGMENT',
      segmentIndex: 0,
      segmentRole: 'EMPLOYEE',
      appliesWhenValues: ['J2508'],
      outputAction: 'REPLACE_SEGMENT',
      replacementValue: 'J2512',
      priority: 1,
      status: 'ACTIVE',
    }]);
    catalogPublic.findListingBySku.mockImplementationOnce(async ({ sku }) => (
      sku === 'J2512-TS1S-25022026-666' ? { ...listing, sku } : null
    ));

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(catalogPublic.findListingBySku).toHaveBeenCalledWith(expect.objectContaining({
      sku: 'J2512-TS1S-25022026-666',
    }));
    expect(result.skuNormalization).toMatchObject({
      canonicalSku: 'J2512-TS1S-25022026-666',
      replacedSegments: [{ index: 0, from: 'J2508', to: 'J2512', role: 'EMPLOYEE' }],
    });
  });

  test('preview resolves product type from SKU config rule before listing fallback', async () => {
    const skuItem = {
      ...item,
      sku: 'J2522-TS1S-070326-109',
    };
    orderPublic.findItemById.mockResolvedValueOnce(skuItem);
    mappingRuleService.buildNormalizedInputs.mockResolvedValueOnce({
      normalizedInputs: [{
        semanticRole: 'PRODUCT_TYPE',
        value: 'COMFORT COLOR T-SHIRT',
        originalLabel: 'Select Product Type',
        originalValue: 'Comfort Color T-Shirt',
        confidence: 'HIGH',
        reason: 'LABEL_HEURISTIC',
        source: 'HEURISTIC',
        ruleId: null,
      }],
      blockingReasons: [],
    });
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValueOnce([
      {
        _id: '660000000000000000010003',
        configCode: 'TS1S',
        productTypeAliases: ['UNISEX T-SHIRT'],
        productTypeGroupId: groupId,
        internalTemplateId: null,
      },
      {
        _id: '660000000000000000010004',
        configCode: 'TS1S',
        productTypeAliases: ['COMFORT COLOR T-SHIRT'],
        productTypeGroupId: selectedGroupId,
        internalTemplateId: '660000000000000000002099',
      },
    ]);
    catalogPublic.getInternalTemplateById.mockResolvedValueOnce({
      _id: '660000000000000000002099',
      code: 'TS1S_COMFORT_COLOR',
      name: 'Comfort Color Template',
      status: 'ACTIVE',
    });

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(mappingRuleService.listActiveSkuConfigRulesForContext).toHaveBeenCalledWith(expect.objectContaining({
      configCode: 'TS1S',
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
    }));
    expect(vendorPublic.listActiveVendorProductsByProductTypeGroup).toHaveBeenCalledWith(selectedGroupId);
    expect(result.skuMapping).toMatchObject({
      employeeCode: 'J2522',
      configCode: 'TS1S',
      ruleId: '660000000000000000010004',
      productTypeGroupId: selectedGroupId,
      internalTemplateId: '660000000000000000002099',
      matchedAlias: 'COMFORT COLOR T-SHIRT',
      ambiguous: false,
    });
    expect(result.productTypeGroupId).toBe(selectedGroupId);
  });

  test('preview blocks ambiguous SKU config when product type signal is missing', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2522-TS1S-070326-109',
    });
    mappingRuleService.buildNormalizedInputs.mockResolvedValueOnce({
      normalizedInputs: [],
      blockingReasons: [],
    });
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValueOnce([
      { _id: '660000000000000000010003', configCode: 'TS1S', productTypeAliases: ['UNISEX T-SHIRT'], productTypeGroupId: groupId },
      { _id: '660000000000000000010004', configCode: 'TS1S', productTypeAliases: ['COMFORT COLOR T-SHIRT'], productTypeGroupId: selectedGroupId },
    ]);

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.ready).toBe(false);
    expect(result.blockingReasons).toContain('SKU_CONFIG_AMBIGUOUS');
    expect(result.skuMapping).toMatchObject({
      configCode: 'TS1S',
      ambiguous: true,
    });
  });

  test('preview resolves product type by exact candidate codes before regex', async () => {
    mappingRuleService.buildNormalizedInputs.mockResolvedValueOnce({
      normalizedInputs: [{
        semanticRole: 'PRODUCT_TYPE',
        value: 'COMFORT COLORS T-SHIRT',
        originalLabel: 'Select Product Type',
        originalValue: 'Comfort Colors T-Shirt',
        confidence: 'HIGH',
        reason: 'LABEL_HEURISTIC',
        source: 'HEURISTIC',
        ruleId: null,
        flags: { outOfStock: false },
      }],
      blockingReasons: [],
    });
    catalogPublic.findProductTypeGroupByCode
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: selectedGroupId, code: 'COMFORT_COLOR_T_SHIRT', status: 'ACTIVE' });

    await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(catalogPublic.findProductTypeGroupByCode).toHaveBeenNthCalledWith(1, 'COMFORT_COLORS_T_SHIRT');
    expect(catalogPublic.findProductTypeGroupByCode).toHaveBeenNthCalledWith(2, 'COMFORT_COLOR_T_SHIRT');
    expect(vendorPublic.listActiveVendorProductsByProductTypeGroup).toHaveBeenCalledWith(selectedGroupId);
  });

  test('preview prefers matching cost center before vendor routing priority', async () => {
    const beefulProduct = {
      _id: '660000000000000000004101',
      code: 'BEEFUL_5000',
      name: 'Beeful Tee',
      status: 'ACTIVE',
      productTypeGroupId: groupId,
      vendorId: '660000000000000000004111',
    };
    const mangoteeProduct = {
      _id: '660000000000000000004201',
      code: 'MANGOTEE_5000',
      name: 'Mangotee Tee',
      status: 'ACTIVE',
      productTypeGroupId: groupId,
      vendorId: '660000000000000000004222',
    };
    const beefulNoMatch = {
      _id: '660000000000000000005101',
      vendorProductId: beefulProduct._id,
      vendorId: beefulProduct.vendorId,
      code: 'BEEFUL_RED_S',
      standardSize: 'S',
      standardColor: 'RED',
      baseCostAmount: 100,
      status: 'ACTIVE',
    };
    const mangoteeMatch = {
      _id: '660000000000000000005201',
      vendorProductId: mangoteeProduct._id,
      vendorId: mangoteeProduct.vendorId,
      code: 'MANGOTEE_BLACK_L',
      standardSize: 'L',
      standardColor: 'BLACK',
      baseCostAmount: 999,
      status: 'ACTIVE',
    };
    vendorPublic.listActiveVendorProductsByProductTypeGroup.mockResolvedValueOnce([beefulProduct, mangoteeProduct]);
    vendorPublic.listActiveVendorCostCenters
      .mockResolvedValueOnce([beefulNoMatch])
      .mockResolvedValueOnce([mangoteeMatch]);
    mappingRuleService.listActiveVendorRoutingRulesForContext.mockResolvedValueOnce([
      { vendorId: beefulProduct.vendorId, priority: 1, specificity: 1 },
      { vendorId: mangoteeProduct.vendorId, priority: 2, specificity: 1 },
    ]);

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.costCenterCandidates[0]).toMatchObject({
      id: mangoteeMatch._id,
      vendorProductId: mangoteeProduct._id,
      confidence: 'HIGH',
    });
    expect(result.autoMatch).toMatchObject({
      vendorProductId: mangoteeProduct._id,
      vendorCostCenterId: mangoteeMatch._id,
    });
  });

  test('preview matches dimension size and pack color after normalization', async () => {
    mappingRuleService.buildNormalizedInputs.mockResolvedValueOnce({
      normalizedInputs: [
        {
          semanticRole: 'SIZE',
          value: '4.8X4.8',
          originalLabel: 'Sizes',
          originalValue: '4.8x4.8 INCHES',
          confidence: 'HIGH',
          reason: 'DIMENSION_SIZE_HEURISTIC',
          source: 'HEURISTIC',
          ruleId: null,
        },
        {
          semanticRole: 'COLOR',
          value: '50 PCS',
          originalLabel: 'Quantity',
          originalValue: 'Pack 50pcs',
          confidence: 'HIGH',
          reason: 'NORMALIZATION_RULE',
          source: 'RULE',
          ruleId: '660000000000000000010031',
        },
      ],
      blockingReasons: [],
    });
    vendorPublic.listActiveVendorCostCenters.mockResolvedValueOnce([{
      ...costCenter,
      _id: '660000000000000000005301',
      code: 'NAPKIN_50',
      sku: 'LNGNKL50',
      standardSize: '4.8" x 4.8"',
      standardColor: '50 pcs',
      baseCostAmount: 744,
    }]);

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.costCenterCandidates[0]).toMatchObject({
      id: '660000000000000000005301',
      confidence: 'HIGH',
      matchReasons: expect.arrayContaining(['STANDARD_SIZE', 'STANDARD_COLOR']),
    });
    expect(result.autoMatch).toMatchObject({
      vendorCostCenterId: '660000000000000000005301',
      confidence: 'HIGH',
    });
  });

  test('scoped user cannot access another shop item', async () => {
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.previewFulfillmentPlan(orderItemId, {}, {
      permissions: [],
      scopes: [],
    })).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });
  });
});
