jest.mock('../../../modules/order/public', () => ({
  findById: jest.fn(),
  findItemById: jest.fn(),
  listItems: jest.fn(),
  appendTimeline: jest.fn(),
  markFulfillmentReady: jest.fn(),
  updateItemListingId: jest.fn(),
  updateCostCenterStatusForOrder: jest.fn(),
  updatePsdStatusForOrder: jest.fn(),
}));

jest.mock('../../../modules/catalog/public', () => ({
  findListingForOrderItem: jest.fn(),
  findOrCreateListingForOrderItem: jest.fn(),
  findOrCreateDraftListingForOrderItem: jest.fn(),
  findListingBySku: jest.fn(),
  findProductTypeGroupByCode: jest.fn(),
  getInternalTemplateById: jest.fn(),
  getInternalTemplateForListing: jest.fn(),
  getListingPsdReadiness: jest.fn(),
  setListingPreviewFromSourceUrl: jest.fn(),
}));

jest.mock('../../../modules/design/public', () => ({
  createPsdTemplateTaskFromListing: jest.fn(),
}));

jest.mock('../../../modules/customization/public', () => ({
  assertCustomizationReady: jest.fn(),
  getOrderItemCustomizationView: jest.fn(),
}));

jest.mock('../../../modules/vendor/public', () => ({
  getVendorById: jest.fn(),
  getVendorProductById: jest.fn(),
  listActiveVendorProductsByProductTypeGroup: jest.fn(),
  listVendorProducts: jest.fn(),
  listActiveVendorCostCenters: jest.fn(),
  listActiveVendorCostCentersByProductIds: jest.fn(),
  searchVendorCostCenters: jest.fn(),
}));

jest.mock('../../../modules/production/public', () => ({
  createOrRecheckTaskForOrderItem: jest.fn(),
  prepareForMappingOverride: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/mapping/repositories/fulfillmentPlan.repository', () => ({
  findActiveByOrderItem: jest.fn(),
  findByOrderItem: jest.fn(),
  listByOrderItemIds: jest.fn(),
  listUnmatched: jest.fn(),
  summarize: jest.fn(),
  upsertActiveByOrderItem: jest.fn(),
  upsertByOrderItem: jest.fn(),
}));

jest.mock('../../../modules/mapping/services/mappingRule.service', () => ({
  buildNormalizedInputs: jest.fn(),
  listNormalizationRules: jest.fn(),
  listNormalizationRuleGroups: jest.fn(),
  listSkuConfigRules: jest.fn(),
  listSkuNormalizeRules: jest.fn(),
  listActiveSkuNormalizeRulesForContext: jest.fn(),
  listActiveSkuConfigRulesForContext: jest.fn(),
  listVendorRoutingRules: jest.fn(),
  listActiveVendorRoutingRulesForContext: jest.fn(),
}));

jest.mock('../../../shared/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
}));

const orderPublic = require('../../../modules/order/public');
const catalogPublic = require('../../../modules/catalog/public');
const designPublic = require('../../../modules/design/public');
const customizationPublic = require('../../../modules/customization/public');
const vendorPublic = require('../../../modules/vendor/public');
const productionPublic = require('../../../modules/production/public');
const authPublic = require('../../../modules/auth/public');
const repository = require('../../../modules/mapping/repositories/fulfillmentPlan.repository');
const mappingRuleService = require('../../../modules/mapping/services/mappingRule.service');
const logger = require('../../../shared/utils/logger');
const service = require('../../../modules/mapping/services/fulfillmentPlan.service');

describe('buildCostEstimate', () => {
  const costCenter = {
    baseCostAmount: 1200,
    currency: 'USD',
    domesticShipping: { economyAmount: 599, additionalAmount: 299 },
    internationalShipping: { economyAmount: 899, additionalAmount: 399 },
    priorityShipping: { economyAmount: 1299, additionalAmount: 699 },
    importTaxAmount: 28,
    additionalCosts: { twoSidedPrintAmount: 250, twoPositionPrintAmount: 250 },
  };

  test('calculates US cost for all units with domestic shipping', () => {
    const result = service.buildCostEstimate({
      costCenter,
      item: { quantity: 3 },
      order: { shippingAddress: { countryCode: 'US' }, shippingService: { level: 'STANDARD' } },
      skuMapping: { configCode: 'TS2S' },
    });

    expect(result.totalAmount).toBe(5931);
    expect(result.lines).toEqual(expect.arrayContaining([
      { code: 'BASE_COST', label: 'Base cost', amount: 3600 },
      { code: 'UNIT_SURCHARGE', label: 'Unit surcharge', amount: 300 },
      { code: 'TWO_POSITION_PRINT', label: 'Two-position print', amount: 750 },
      { code: 'SHIPPING_ECONOMY', label: 'Shipping economy', amount: 599 },
      { code: 'SHIPPING_ADDITIONAL', label: 'Additional-unit shipping', amount: 598 },
      { code: 'IMPORT_TAX', label: 'Import tax', amount: 84 },
    ]));
  });

  test('uses priority shipping for expedited orders', () => {
    const result = service.buildCostEstimate({
      costCenter,
      item: { quantity: 1 },
      order: { shippingAddress: { countryCode: 'US' }, shippingService: { name: 'Expedited' } },
    });

    expect(result.totalAmount).toBe(2627);
    expect(result.signals.shippingProfile).toBe('priority');
  });

  test('falls back to international shipping when the selected profile is missing', () => {
    const result = service.buildCostEstimate({
      costCenter: { ...costCenter, domesticShipping: {} },
      item: { quantity: 1 },
      order: { shippingAddress: { countryCode: 'US' }, shippingService: { level: 'STANDARD' } },
    });

    expect(result.totalAmount).toBe(2227);
    expect(result.signals.shippingProfile).toBe('international');
  });
});

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
    asin: 'B0TESTASIN',
    title: 'Shirt',
    quantity: 1,
    customizationRawSummary: { hasCustomization: true },
  };

  const listing = {
    _id: listingId,
    sku: 'SHIRT-L',
    asin: 'B0TESTASIN',
    title: 'Listing Shirt',
    productTypeGroupId: groupId,
    internalTemplateId: templateId,
    psdStatus: 'PRESENT',
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
    domesticShipping: { economyAmount: 599, additionalAmount: 299 },
    priorityShipping: { economyAmount: 1299, additionalAmount: 699 },
    importTaxAmount: 28,
    additionalCosts: {
      embroideryAmount: 300,
      twoSidedPrintAmount: 250,
      twoPositionPrintAmount: 200,
    },
    status: 'ACTIVE',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    orderPublic.findItemById.mockResolvedValue(item);
    orderPublic.listItems.mockResolvedValue({
      items: [item],
      pagination: { total: 1, page: 1, limit: 50 },
    });
    orderPublic.updateItemListingId.mockResolvedValue({ _id: orderItemId, listingId });
    catalogPublic.findListingForOrderItem.mockImplementation((params) => catalogPublic.findListingBySku(params));
    catalogPublic.findOrCreateListingForOrderItem.mockResolvedValue(listing);
    catalogPublic.findOrCreateDraftListingForOrderItem.mockResolvedValue(listing);
    catalogPublic.findListingBySku.mockResolvedValue(listing);
    designPublic.createPsdTemplateTaskFromListing.mockResolvedValue({ id: '660000000000000000008001' });
    catalogPublic.getInternalTemplateForListing.mockResolvedValue(template);
    catalogPublic.getInternalTemplateById.mockResolvedValue(template);
    catalogPublic.getListingPsdReadiness.mockResolvedValue({ status: 'PRESENT' });
    catalogPublic.findProductTypeGroupByCode.mockResolvedValue(null);
    catalogPublic.setListingPreviewFromSourceUrl.mockResolvedValue(listing);
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
    vendorPublic.listActiveVendorCostCentersByProductIds.mockResolvedValue([costCenter]);
    vendorPublic.getVendorById.mockResolvedValue(vendorProduct.vendorId);
    vendorPublic.getVendorProductById.mockResolvedValue(vendorProduct);
    vendorPublic.searchVendorCostCenters.mockResolvedValue({
      items: [{
        vendor: vendorProduct.vendorId,
        vendorProduct,
        vendorCostCenter: costCenter,
      }],
      pagination: { total: 1, page: 1, limit: 20 },
    });
    productionPublic.createOrRecheckTaskForOrderItem.mockResolvedValue({ id: '660000000000000000007001' });
    productionPublic.prepareForMappingOverride.mockResolvedValue({ allowed: true });
    repository.findByOrderItem.mockResolvedValue(null);
    repository.listByOrderItemIds.mockResolvedValue([]);
    repository.listUnmatched.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 20 } });
    repository.summarize.mockResolvedValue({ total: 0, byStatus: {}, bySelectionMode: {}, byBlockingReason: {} });
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
    mappingRuleService.listSkuConfigRules.mockResolvedValue({ items: [], pagination: { total: 2, page: 1, limit: 20 } });
    mappingRuleService.listSkuNormalizeRules.mockResolvedValue({ items: [], pagination: { total: 1, page: 1, limit: 20 } });
    mappingRuleService.listNormalizationRules.mockResolvedValue({ items: [], pagination: { total: 3, page: 1, limit: 20 } });
    mappingRuleService.listNormalizationRuleGroups.mockResolvedValue({
      semanticRules: { items: [], pagination: { total: 3, page: 1, limit: 20 } },
      valueAliases: { items: [], pagination: { total: 3, page: 1, limit: 20 } },
    });
    mappingRuleService.listVendorRoutingRules.mockResolvedValue({ items: [], pagination: { total: 4, page: 1, limit: 20 } });
  });

  test('unmatched queue reads the persisted paginated read model without scanning order items', async () => {
    repository.listUnmatched.mockResolvedValueOnce({
      items: [{
        orderItemId,
        snapshot: { orderItem: { id: orderItemId, externalOrderId: 'AMZ-1001', sku: item.sku, title: item.title } },
        blockingReasons: ['LISTING_NOT_FOUND'],
      }],
      pagination: { total: 1, page: 2, limit: 10 },
    });

    const result = await service.listUnmatchedOrderItems({
      blocker: 'LISTING_NOT_FOUND', page: 2, limit: 10,
    }, { permissions: ['MAPPING:READ'] });

    expect(result).toMatchObject({
      items: [{ orderItemId, sku: item.sku, blockedStage: 'PRODUCT_MAPPING' }],
      total: 1,
      page: 2,
      limit: 10,
      pagination: { total: 1, page: 2, limit: 10 },
    });
    expect(orderPublic.listItems).not.toHaveBeenCalled();
  });

  test('summary maps exact persisted blocker counts without scanning order items', async () => {
    repository.summarize.mockResolvedValueOnce({
      total: 9,
      byStatus: { READY: 5, CONFIRMED: 1, BLOCKED: 3 },
      bySelectionMode: { AUTO: 4, MANUAL: 2 },
      byBlockingReason: {
        LISTING_NOT_FOUND: 2,
        CUSTOMIZATION_NOT_READY: 1,
        NO_VENDOR_PRODUCT_CANDIDATE: 1,
        NO_VENDOR_COST_CENTER_CANDIDATE: 2,
        SKU_CONFIG_AMBIGUOUS: 1,
      },
    });

    const result = await service.summarizeMapping({ shopId }, { permissions: ['MAPPING:READ'] });

    expect(result).toEqual({
      readyPlanCount: 5,
      confirmedPlanCount: 1,
      totalPlanCount: 9,
      blockedSampleCount: 3,
      missingSkuConfigCount: 2,
      missingSemanticRuleCount: 1,
      missingVendorProductCount: 1,
      missingVendorCostCenterCount: 2,
      ambiguousSkuConfigCount: 1,
      byStatus: { READY: 5, CONFIRMED: 1, BLOCKED: 3 },
      bySelectionMode: { AUTO: 4, MANUAL: 2 },
    });
    expect(orderPublic.listItems).not.toHaveBeenCalled();
  });

  test('recheck returns READY plan when auto match exists', async () => {
    const result = await service.recheckFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:WRITE'] });

    expect(result).toMatchObject({
      status: 'READY',
      selectionMode: 'AUTO',
    });
    expect(repository.upsertByOrderItem).toHaveBeenCalled();
    expect(orderPublic.markFulfillmentReady).toHaveBeenCalledWith(orderItemId);
  });

  test('recheck persists a BLOCKED plan without triggering production', async () => {
    vendorPublic.listActiveVendorCostCentersByProductIds.mockResolvedValueOnce([]);

    const result = await service.recheckFulfillmentPlan(orderItemId, {}, {
      permissions: ['MAPPING:WRITE'],
    });

    expect(result).toMatchObject({
      status: 'BLOCKED',
      orderItemId,
      blockingReasons: ['NO_VENDOR_COST_CENTER_CANDIDATE'],
    });
    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      orderId,
      orderItemId,
      shopId,
      status: 'BLOCKED',
      selectionMode: null,
      vendorProductId: null,
      vendorCostCenterId: null,
      blockingReasons: ['NO_VENDOR_COST_CENTER_CANDIDATE'],
      checks: expect.any(Object),
      snapshot: expect.objectContaining({
        orderItem: expect.objectContaining({ id: orderItemId, sku: item.sku }),
      }),
      resolvedBy: null,
      resolvedAt: null,
    }));
    expect(orderPublic.markFulfillmentReady).not.toHaveBeenCalled();
    expect(productionPublic.createOrRecheckTaskForOrderItem).not.toHaveBeenCalled();
  });

  test('preview resolves listing by ASIN without creating listing or design task', async () => {
    catalogPublic.findListingForOrderItem.mockResolvedValueOnce(listing);

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.ready).toBe(true);
    expect(catalogPublic.findListingForOrderItem).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: 'B0TESTASIN',
      sku: 'SHIRT-L',
    }));
    expect(catalogPublic.findOrCreateListingForOrderItem).not.toHaveBeenCalled();
    expect(orderPublic.updateItemListingId).not.toHaveBeenCalled();
    expect(designPublic.createPsdTemplateTaskFromListing).not.toHaveBeenCalled();
  });

  test('recheck auto-creates missing ASIN listing from SKU config and creates PSD design task', async () => {
    const createdListing = {
      ...listing,
      _id: '660000000000000000002099',
      asin: 'B0NEWASIN',
      sku: 'J2520-NK-280226-2206',
      productTypeGroupId: groupId,
      internalTemplateId: null,
      psdStatus: 'MISSING',
    };
    orderPublic.findItemById.mockResolvedValue({
      ...item,
      asin: 'B0NEWASIN',
      sku: 'J2520-NK-280226-2206',
    });
    catalogPublic.findListingBySku.mockResolvedValue(null);
    catalogPublic.findOrCreateListingForOrderItem.mockResolvedValue(createdListing);
    catalogPublic.getListingPsdReadiness.mockResolvedValueOnce({ status: 'MISSING' });
    customizationPublic.getOrderItemCustomizationView.mockResolvedValue({
      listingPreviewImageUrl: 'https://m.media-amazon.com/images/S/preview.png',
      customerInputs: {
        options: [{ label: 'Select Size', value: 'L' }, { label: 'Text Color', value: 'Black' }],
        texts: [],
        images: [],
      },
    });
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValue([{
      _id: '660000000000000000010101',
      configCode: 'NK',
      productTypeAliases: ['NAPKINS'],
      productTypeGroupId: groupId,
      internalTemplateId: null,
    }]);

    const result = await service.recheckFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:WRITE'] });

    expect(catalogPublic.findOrCreateListingForOrderItem).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: 'B0NEWASIN',
      sku: 'J2520-NK-280226-2206',
      title: 'Shirt',
      productTypeGroupId: groupId,
      internalTemplateId: null,
    }), expect.objectContaining({ permissions: ['MAPPING:WRITE'] }));
    expect(catalogPublic.setListingPreviewFromSourceUrl).toHaveBeenCalledWith(
      createdListing._id,
      'https://m.media-amazon.com/images/S/preview.png',
      expect.objectContaining({ system: true, source: 'MAPPING' }),
    );
    expect(orderPublic.updateItemListingId).toHaveBeenCalledWith(orderItemId, createdListing._id);
    expect(designPublic.createPsdTemplateTaskFromListing).toHaveBeenCalledWith(createdListing._id, expect.objectContaining({
      note: expect.stringContaining('Auto-created from mapping'),
    }), expect.objectContaining({ system: true, source: 'MAPPING' }));
    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      listingId: createdListing._id,
      productTypeGroupId: groupId,
    }));
    expect(result).toMatchObject({ status: 'READY', selectionMode: 'AUTO' });
  });

  test('recheck creates missing listing before vendor cost center auto-match is ready', async () => {
    const createdListing = {
      ...listing,
      _id: '660000000000000000002098',
      asin: 'B0EARLYASIN',
      sku: 'J2520-NK-280226-2206',
      productTypeGroupId: groupId,
      internalTemplateId: null,
      psdStatus: 'MISSING',
    };
    orderPublic.findItemById.mockResolvedValue({
      ...item,
      asin: 'B0EARLYASIN',
      sku: 'J2520-NK-280226-2206',
    });
    catalogPublic.findListingBySku.mockResolvedValue(null);
    catalogPublic.findOrCreateListingForOrderItem.mockResolvedValue(createdListing);
    catalogPublic.getInternalTemplateForListing.mockResolvedValue(null);
    catalogPublic.getListingPsdReadiness.mockResolvedValueOnce({ status: 'MISSING' });
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValue([{
      _id: '660000000000000000010102',
      configCode: 'NK',
      productTypeAliases: ['NAPKINS'],
      productTypeGroupId: groupId,
      internalTemplateId: null,
    }]);
    vendorPublic.listActiveVendorCostCentersByProductIds.mockResolvedValue([]);

    const result = await service.recheckFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:WRITE'] });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockingReasons).toContain('NO_VENDOR_COST_CENTER_CANDIDATE');
    expect(catalogPublic.findOrCreateListingForOrderItem).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: 'B0EARLYASIN',
      sku: 'J2520-NK-280226-2206',
      title: 'Shirt',
      productTypeGroupId: groupId,
      internalTemplateId: null,
    }), expect.objectContaining({ permissions: ['MAPPING:WRITE'] }));
    expect(orderPublic.updateItemListingId).toHaveBeenCalledWith(orderItemId, createdListing._id);
    expect(orderPublic.updateCostCenterStatusForOrder).toHaveBeenCalledWith(orderId);
    expect(orderPublic.updatePsdStatusForOrder).toHaveBeenCalledWith(orderId);
    expect(designPublic.createPsdTemplateTaskFromListing).toHaveBeenCalledWith(createdListing._id, expect.any(Object), expect.objectContaining({
      system: true,
      source: 'MAPPING',
    }));
    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      status: 'BLOCKED',
      listingId: createdListing._id,
    }));
  });

  test('recheck keeps listing blocked when SKU config is ambiguous', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2522-TS1S-070326-109',
    });
    catalogPublic.findListingBySku.mockResolvedValue(null);
    mappingRuleService.buildNormalizedInputs.mockResolvedValueOnce({
      normalizedInputs: [],
      blockingReasons: [],
    });
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValueOnce([
      { _id: '660000000000000000010003', configCode: 'TS1S', productTypeAliases: ['UNISEX T-SHIRT'], productTypeGroupId: groupId },
      { _id: '660000000000000000010004', configCode: 'TS1S', productTypeAliases: ['COMFORT COLOR T-SHIRT'], productTypeGroupId: selectedGroupId },
    ]);

    const result = await service.recheckFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:WRITE'] });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockingReasons).toContain('SKU_CONFIG_AMBIGUOUS');
    expect(catalogPublic.findOrCreateListingForOrderItem).not.toHaveBeenCalled();
    expect(designPublic.createPsdTemplateTaskFromListing).not.toHaveBeenCalled();
    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      status: 'BLOCKED',
      blockingReasons: expect.arrayContaining(['SKU_CONFIG_AMBIGUOUS']),
    }));
  });

  test('post-import recheck creates a draft listing when its SKU has no configuration rule', async () => {
    const draftListing = {
      ...listing,
      _id: '660000000000000000002097',
      productTypeGroupId: null,
      internalTemplateId: null,
      qcStatus: 'DRAFT',
    };
    catalogPublic.findListingForOrderItem.mockResolvedValue(null);
    catalogPublic.findOrCreateDraftListingForOrderItem.mockResolvedValue(draftListing);
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValue([]);
    customizationPublic.getOrderItemCustomizationView.mockResolvedValue({
      listingPreviewImageUrl: 'https://m.media-amazon.com/images/S/preview.png',
      customerInputs: { texts: [], options: [], images: [] },
    });

    const result = await service.recheckFulfillmentPlan(orderItemId, { createDraftListing: true }, { permissions: ['MAPPING:WRITE'] });

    expect(catalogPublic.findOrCreateDraftListingForOrderItem).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      asin: item.asin,
      sku: item.sku,
      title: item.title,
    }), expect.objectContaining({ permissions: ['MAPPING:WRITE'] }));
    expect(orderPublic.updateItemListingId).toHaveBeenCalledWith(orderItemId, draftListing._id);
    expect(catalogPublic.setListingPreviewFromSourceUrl).toHaveBeenCalledWith(
      draftListing._id,
      'https://m.media-amazon.com/images/S/preview.png',
      expect.objectContaining({ system: true, source: 'MAPPING' }),
    );
    expect(result).toMatchObject({
      status: 'BLOCKED',
      blockingReasons: ['LISTING_CONFIGURATION_REQUIRED'],
    });
    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      listingId: draftListing._id,
      blockingReasons: ['LISTING_CONFIGURATION_REQUIRED'],
    }));
  });

  test('post-import recheck creates a draft listing even when SKU configuration is ambiguous', async () => {
    const draftListing = {
      ...listing,
      _id: '660000000000000000002096',
      productTypeGroupId: null,
      internalTemplateId: null,
      qcStatus: 'DRAFT',
    };
    orderPublic.findItemById.mockResolvedValue({ ...item, sku: 'J2536-RDT-180426-1001' });
    catalogPublic.findListingForOrderItem.mockResolvedValue(null);
    catalogPublic.findOrCreateDraftListingForOrderItem.mockResolvedValue(draftListing);
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValue([
      { _id: '660000000000000000010005', configCode: 'RDT', productTypeGroupId: groupId },
      { _id: '660000000000000000010006', configCode: 'RDT', productTypeGroupId: selectedGroupId },
    ]);

    const result = await service.recheckFulfillmentPlan(orderItemId, { createDraftListing: true }, { permissions: ['MAPPING:WRITE'] });

    expect(catalogPublic.findOrCreateDraftListingForOrderItem).toHaveBeenCalled();
    expect(result.blockingReasons).toEqual(expect.arrayContaining([
      'SKU_CONFIG_AMBIGUOUS',
      'LISTING_CONFIGURATION_REQUIRED',
    ]));
  });

  test('batch recheck caps limit and skips existing READY plan', async () => {
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: '660000000000000000006001',
      orderItemId,
      status: 'READY',
      vendorProductId,
      vendorCostCenterId: costCenterId,
      snapshot: {},
      blockingReasons: [],
    });

    const result = await service.recheckUnmatchedFulfillmentPlans({
      shopId,
      limit: 500,
    }, { permissions: ['MAPPING:WRITE'] });

    expect(orderPublic.listItems).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      limit: 100,
    }));
    expect(result).toMatchObject({
      checked: 1,
      resolved: 0,
      blocked: 0,
      skippedExisting: 1,
    });
    expect(result.items[0]).toMatchObject({
      orderItemId,
      status: 'SKIPPED_EXISTING',
    });
  });

  test('batch recheck defaults to ten items', async () => {
    await service.recheckUnmatchedFulfillmentPlans({ shopId }, { permissions: ['MAPPING:WRITE'] });

    expect(orderPublic.listItems).toHaveBeenCalledWith(expect.objectContaining({ shopId, limit: 10 }));
  });

  test('compact preview returns counts and autoMatch without candidate lists', async () => {
    const result = await service.previewFulfillmentPlan(orderItemId, { includeCandidates: false }, { permissions: ['MAPPING:READ'] });

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
    expect(result.checks).toMatchObject({
      vendorProducts: { count: 1 },
      costCenters: { count: 1 },
    });
    expect(result.candidateSummary).toMatchObject({
      vendorProductCount: 1,
      costCenterCount: 1,
      topCandidate: { id: costCenterId, confidence: 'HIGH' },
    });
    expect(result.vendorProductCandidates).toBeUndefined();
    expect(result.costCenterCandidates).toBeUndefined();
    expect(result.autoMatch.costEstimate.totalAmount).toBe(1328);
    expect(customizationPublic.getOrderItemCustomizationView.mock.calls[0]).toEqual([orderItemId]);
    expect(repository.upsertByOrderItem).not.toHaveBeenCalled();
  });

  test('search vendor candidates uses partial filters and does not persist fulfillment plan', async () => {
    const result = await service.searchVendorCandidatesForOrderItem(orderItemId, {
      q: 'beeful',
      size: 'L',
      color: 'Black',
      page: 1,
      limit: 20,
    }, { permissions: ['MAPPING:READ'] });

    expect(vendorPublic.searchVendorCostCenters).toHaveBeenCalledWith(expect.objectContaining({
      q: 'beeful',
      size: 'L',
      color: 'Black',
      page: 1,
      limit: 20,
    }));
    expect(vendorPublic.searchVendorCostCenters.mock.calls[0][0]).not.toHaveProperty('sku', item.sku);
    expect(result).toMatchObject({
      orderItemId,
      signals: {
        sku: item.sku,
        normalizedSize: 'L',
        normalizedColor: 'BLACK',
      },
      items: [{
        vendor: { id: vendorId, code: 'PRINTWAY', name: 'Printway' },
        vendorProduct: { id: vendorProductId, code: 'VP_SHIRT' },
        vendorCostCenter: { id: costCenterId, standardSize: 'L', standardColor: 'BLACK' },
        match: {
          confidence: 'HIGH',
          reasons: expect.arrayContaining(['SKU_EXACT']),
        },
      }],
      pagination: { total: 1, page: 1, limit: 20 },
    });
    expect(repository.upsertByOrderItem).not.toHaveBeenCalled();
  });

  test('manual candidate browsing does not inherit normalized size or color', async () => {
    vendorPublic.listVendorProducts.mockResolvedValue({
      items: [vendorProduct, { ...vendorProduct, id: 'product-2', name: 'Product Two' }],
      pagination: { total: 2, page: 1, limit: 100 },
    });

    const result = await service.searchVendorCandidatesForOrderItem(orderItemId, {
      vendorId,
      manualBrowse: true,
      page: 1,
      limit: 100,
    }, { permissions: ['MAPPING:READ'] });

    expect(vendorPublic.searchVendorCostCenters).toHaveBeenCalledWith(expect.objectContaining({
      vendorId,
      page: 1,
      limit: 100,
    }));
    expect(result.products).toHaveLength(2);
    expect(vendorPublic.searchVendorCostCenters.mock.calls[0][0].size).toBeUndefined();
    expect(vendorPublic.searchVendorCostCenters.mock.calls[0][0].color).toBeUndefined();
    expect(customizationPublic.getOrderItemCustomizationView).not.toHaveBeenCalled();
    expect(mappingRuleService.buildNormalizedInputs).not.toHaveBeenCalled();
  });

  test('preview adds two-position print cost for TS2S config', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2508-TS2S-25022026-666',
    });
    catalogPublic.findListingBySku.mockResolvedValueOnce({
      ...listing,
      sku: 'J2508-TS2S-25022026-666',
    });

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.skuMapping.configCode).toBe('TS2S');
    expect(result.costCenterCandidates[0].costEstimate).toMatchObject({
      totalAmount: 1528,
      signals: {
        configCode: 'TS2S',
        twoPosition: true,
      },
    });
    expect(result.costCenterCandidates[0].costEstimate.lines).toEqual(expect.arrayContaining([
      { code: 'TWO_POSITION_PRINT', label: 'Two-position print', amount: 200 },
    ]));
  });

  test('preview does not add priority shipping when priority production is declined', async () => {
    customizationPublic.getOrderItemCustomizationView.mockResolvedValueOnce({
      customerInputs: {
        options: [
          { label: 'Select Size', value: 'L' },
          { label: 'Text Color', value: 'Black' },
          { label: 'Priority Production', value: 'No, Thanks.' },
        ],
        texts: [],
        images: [],
      },
    });

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.costCenterCandidates[0].costEstimate).toMatchObject({
      totalAmount: 1328,
      signals: {
        priority: false,
      },
    });
    expect(result.costCenterCandidates[0].costEstimate.lines).not.toEqual(expect.arrayContaining([
      { code: 'SHIPPING_DOMESTIC_ECONOMY', label: 'Domestic economy shipping', amount: 599 },
      { code: 'SHIPPING_PRIORITY_ECONOMY', label: 'Priority economy shipping', amount: 1299 },
      { code: 'PRIORITY_COST', label: 'Priority production', amount: 0 },
    ]));
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

  test('manual select upserts READY plan and appends manual vendor timeline through public port', async () => {
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
      snapshot: expect.objectContaining({
        vendorProduct: expect.objectContaining({
          vendor: expect.objectContaining({
            id: vendorId,
            code: 'PRINTWAY',
            name: 'Printway',
          }),
        }),
        costEstimate: expect.objectContaining({
          totalAmount: 1328,
          lines: expect.arrayContaining([
            { code: 'BASE_COST', label: 'Base cost', amount: 1200 },
            { code: 'IMPORT_TAX', label: 'Import tax', amount: 28 },
          ]),
        }),
      }),
    }));
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      orderItemId,
      eventType: 'MANUAL_VENDOR_MATCHED',
      source: 'MAPPING',
      actorId: '660000000000000000009001',
      message: 'Manual vendor matched',
      metadata: expect.objectContaining({
        selectionMode: 'MANUAL',
        vendorProductId,
        vendorCostCenterId: costCenterId,
        vendorId,
        vendorName: 'Printway',
      }),
    }));
    expect(orderPublic.updateCostCenterStatusForOrder).toHaveBeenCalledWith(orderId);
    expect(orderPublic.updatePsdStatusForOrder).toHaveBeenCalledWith(orderId);
    expect(result.status).toBe('READY');
    expect(result.selectionMode).toBe('MANUAL');
    expect(result.costEstimate.totalAmount).toBe(1328);
  });

  test('manual select persists a vendor choice when SKU config is ambiguous and listing is missing', async () => {
    orderPublic.findItemById.mockResolvedValue({
      ...item,
      sku: 'J2520-TS2S-110326-1113',
    });
    catalogPublic.findListingBySku.mockResolvedValue(null);
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValue([
      { _id: '660000000000000000010003', configCode: 'TS2S', productTypeAliases: ['UNISEX T-SHIRT'], productTypeGroupId: groupId },
      { _id: '660000000000000000010004', configCode: 'TS2S', productTypeAliases: ['CREWNECK SWEATSHIRT'], productTypeGroupId: selectedGroupId },
    ]);

    const result = await service.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }, { permissions: ['MAPPING:WRITE'], accountId: '660000000000000000009001' });

    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      status: 'READY',
      selectionMode: 'MANUAL',
      listingId: null,
      internalTemplateId: null,
      productTypeGroupId: groupId,
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }));
    expect(catalogPublic.findOrCreateListingForOrderItem).not.toHaveBeenCalled();
    expect(catalogPublic.findOrCreateDraftListingForOrderItem).not.toHaveBeenCalled();
    expect(orderPublic.updateItemListingId).not.toHaveBeenCalled();
    expect(orderPublic.markFulfillmentReady).toHaveBeenCalledWith(orderItemId);
    expect(result.status).toBe('READY');
    expect(result.selectionMode).toBe('MANUAL');
  });

  test('manual select auto-creates production task with system handoff context after READY plan is saved', async () => {
    const authContext = { permissions: ['MAPPING:WRITE'], accountId: '660000000000000000009001' };

    await service.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }, authContext);

    expect(productionPublic.createOrRecheckTaskForOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      ...authContext,
      system: true,
      source: 'MAPPING',
    }));
    expect(logger.info).toHaveBeenCalledWith('Auto production task trigger completed', expect.objectContaining({
      orderItemId,
      durationMs: expect.any(Number),
    }));
  });

  test('manual select still returns READY when production auto-trigger fails', async () => {
    productionPublic.createOrRecheckTaskForOrderItem.mockRejectedValueOnce(new Error('production unavailable'));

    const result = await service.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }, { permissions: ['MAPPING:WRITE'], accountId: '660000000000000000009001' });

    expect(result.status).toBe('READY');
    expect(logger.warn).toHaveBeenCalledWith('Auto production task trigger skipped', expect.objectContaining({
      orderItemId,
      error: expect.any(Error),
    }));
  });

  test('manual select refreshes existing READY plan when same selection is repeated', async () => {
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: '660000000000000000006001',
      orderItemId,
      status: 'READY',
      selectionMode: 'MANUAL',
      vendorProductId,
      vendorCostCenterId: costCenterId,
      snapshot: {
        costEstimate: {
          currency: 'USD',
          totalAmount: 999,
          lines: [{ code: 'BASE_COST', label: 'Base cost', amount: 999 }],
          signals: { configCode: 'OLD', twoSided: false, embroidery: false, priority: false },
        },
      },
      blockingReasons: [],
    });

    const result = await service.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }, { permissions: ['MAPPING:WRITE'], accountId: '660000000000000000009001' });

    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      status: 'READY',
      selectionMode: 'MANUAL',
      vendorProductId,
      vendorCostCenterId: costCenterId,
      resolvedBy: '660000000000000000009001',
      snapshot: expect.objectContaining({
        costEstimate: expect.objectContaining({
          totalAmount: 1328,
          lines: expect.arrayContaining([
            { code: 'BASE_COST', label: 'Base cost', amount: 1200 },
          ]),
        }),
      }),
    }));
    expect(orderPublic.updateCostCenterStatusForOrder).toHaveBeenCalledWith(orderId);
    expect(result.status).toBe('READY');
    expect(result.selectionMode).toBe('MANUAL');
    expect(result.costEstimate.totalAmount).toBe(1328);
  });

  test('manual select returns existing CONFIRMED plan when same selection is repeated', async () => {
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: '660000000000000000006001',
      orderItemId,
      status: 'CONFIRMED',
      selectionMode: 'MANUAL',
      vendorProductId,
      vendorCostCenterId: costCenterId,
      snapshot: {
        costEstimate: {
          currency: 'USD',
          totalAmount: 999,
          lines: [{ code: 'BASE_COST', label: 'Base cost', amount: 999 }],
          signals: { configCode: 'OLD', twoSided: false, embroidery: false, priority: false },
        },
      },
      blockingReasons: [],
    });

    const result = await service.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }, { permissions: ['MAPPING:WRITE'] });

    expect(repository.upsertByOrderItem).not.toHaveBeenCalled();
    expect(result.status).toBe('CONFIRMED');
    expect(result.costEstimate.totalAmount).toBe(999);
  });

  test('manual select overrides existing AUTO READY plan with a different vendor selection', async () => {
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: '660000000000000000006001',
      orderItemId,
      status: 'READY',
      selectionMode: 'AUTO',
      vendorProductId: '660000000000000000004777',
      vendorCostCenterId: '660000000000000000005777',
      snapshot: {},
      blockingReasons: [],
    });

    const result = await service.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }, { permissions: ['MAPPING:WRITE'], accountId: '660000000000000000009001' });

    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      status: 'READY',
      selectionMode: 'MANUAL',
      vendorProductId,
      vendorCostCenterId: costCenterId,
      resolvedBy: '660000000000000000009001',
    }));
    expect(result.status).toBe('READY');
    expect(result.selectionMode).toBe('MANUAL');
  });

  test('manual select overrides existing MANUAL READY plan before vendor send', async () => {
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

    const result = await service.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }, { permissions: ['MAPPING:WRITE'], accountId: '660000000000000000009001' });

    expect(productionPublic.prepareForMappingOverride).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      system: true,
      source: 'MAPPING_OVERRIDE',
    }));
    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      status: 'READY',
      selectionMode: 'MANUAL',
      vendorProductId,
      vendorCostCenterId: costCenterId,
    }));
    expect(result.status).toBe('READY');
  });

  test('manual select rejects existing MANUAL READY plan when production guard blocks override', async () => {
    productionPublic.prepareForMappingOverride.mockRejectedValueOnce(Object.assign(new Error('sent'), {
      statusCode: 409,
      code: 'CONFLICT_ERROR',
      details: { status: 'SENT_TO_VENDOR' },
    }));
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
    expect(repository.upsertByOrderItem).not.toHaveBeenCalled();
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
      snapshot: expect.objectContaining({
        costEstimate: expect.objectContaining({ totalAmount: 1328 }),
      }),
    }));
    expect(result.status).toBe('READY');
    expect(result.selectionMode).toBe('AUTO');
  });

  test('resolve auto-saves vendor match without releasing fulfillment when customization is not ready', async () => {
    customizationPublic.assertCustomizationReady.mockRejectedValueOnce(new Error('missing photo asset'));

    const result = await service.resolveFulfillmentPlan(orderItemId, {}, {
      permissions: ['MAPPING:WRITE'],
      accountId: '660000000000000000009001',
    });

    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      status: 'READY',
      selectionMode: 'AUTO',
      vendorProductId,
      vendorCostCenterId: costCenterId,
      blockingReasons: ['CUSTOMIZATION_NOT_READY'],
      checks: expect.objectContaining({
        customization: { ok: false, status: 'NOT_READY' },
      }),
    }));
    expect(orderPublic.updateCostCenterStatusForOrder).toHaveBeenCalledWith(orderId);
    expect(orderPublic.markFulfillmentReady).not.toHaveBeenCalled();
    expect(productionPublic.createOrRecheckTaskForOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      system: true,
      source: 'MAPPING',
    }));
    expect(result.status).toBe('READY');
    expect(result.blockingReasons).toContain('CUSTOMIZATION_NOT_READY');
  });

  test('resolve auto-creates production task after AUTO READY plan is saved', async () => {
    const authContext = {
      permissions: ['MAPPING:WRITE'],
      accountId: '660000000000000000009001',
    };

    await service.resolveFulfillmentPlan(orderItemId, {}, authContext);

    expect(productionPublic.createOrRecheckTaskForOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      ...authContext,
      system: true,
      source: 'MAPPING',
    }));
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

  test('preview auto-matches vendor from combined product type slash color customization', async () => {
    const ashCostCenterId = '660000000000000000005401';
    mappingRuleService.buildNormalizedInputs.mockResolvedValueOnce({
      normalizedInputs: [
        {
          semanticRole: 'PRODUCT_TYPE',
          value: 'UNISEX T-SHIRT',
          originalLabel: 'Select Product Type / Color',
          originalValue: 'Unisex T-Shirt/Ash',
          confidence: 'HIGH',
          reason: 'COMBINED_PRODUCT_COLOR',
          source: 'HEURISTIC',
          ruleId: null,
        },
        {
          semanticRole: 'COLOR',
          value: 'ASH',
          originalLabel: 'Select Product Type / Color',
          originalValue: 'Unisex T-Shirt/Ash',
          confidence: 'HIGH',
          reason: 'COMBINED_PRODUCT_COLOR',
          source: 'HEURISTIC',
          ruleId: null,
        },
        {
          semanticRole: 'SIZE',
          value: 'M',
          originalLabel: 'Select Size',
          originalValue: 'M',
          confidence: 'HIGH',
          reason: 'LABEL_HEURISTIC',
          source: 'HEURISTIC',
          ruleId: null,
        },
      ],
      blockingReasons: [],
    });
    catalogPublic.findProductTypeGroupByCode.mockResolvedValueOnce({
      _id: selectedGroupId,
      code: 'UNISEX_T_SHIRT',
      name: 'Unisex T-Shirt',
      status: 'ACTIVE',
    });
    vendorPublic.listActiveVendorProductsByProductTypeGroup.mockResolvedValueOnce([{
      ...vendorProduct,
      productTypeGroupId: selectedGroupId,
    }]);
    vendorPublic.listActiveVendorCostCentersByProductIds.mockResolvedValueOnce([{
      ...costCenter,
      _id: ashCostCenterId,
      standardSize: 'M',
      standardColor: 'ASH',
      baseCostAmount: 777,
    }]);

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.ready).toBe(true);
    expect(result.autoMatch).toMatchObject({
      vendorProductId,
      vendorCostCenterId: ashCostCenterId,
      confidence: 'HIGH',
    });
    expect(result.costCenterCandidates[0]).toMatchObject({
      id: ashCostCenterId,
      matchReasons: expect.arrayContaining(['STANDARD_SIZE', 'STANDARD_COLOR']),
      confidence: 'HIGH',
    });
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

  test('preview removes stray segment before config code and parses real config', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2501-Z-TS1S-32132-33',
    });
    mappingRuleService.listActiveSkuNormalizeRulesForContext.mockResolvedValueOnce([{
      _id: '660000000000000000010033',
      patternType: 'SEGMENT',
      segmentIndex: 1,
      segmentRole: 'OTHER',
      appliesWhenValues: ['Z'],
      outputAction: 'REPLACE_SEGMENT',
      replacementValue: 'X',
      priority: 1,
      status: 'ACTIVE',
    }, {
      _id: '660000000000000000010034',
      configCode: 'TS1S',
      patternType: 'SEGMENT',
      segmentIndex: 1,
      segmentRole: 'OTHER',
      appliesWhenValues: ['Z'],
      outputAction: 'REMOVE_SEGMENT',
      priority: 100,
      status: 'ACTIVE',
    }]);
    catalogPublic.findListingBySku.mockImplementationOnce(async ({ sku }) => (
      sku === 'J2501-TS1S-32132-33' ? { ...listing, sku } : null
    ));

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(catalogPublic.findListingBySku).toHaveBeenCalledWith(expect.objectContaining({
      sku: 'J2501-TS1S-32132-33',
    }));
    expect(mappingRuleService.listActiveSkuConfigRulesForContext).toHaveBeenCalledWith(expect.objectContaining({
      configCode: 'TS1S',
    }));
    expect(mappingRuleService.listActiveSkuNormalizeRulesForContext).toHaveBeenCalledWith(expect.not.objectContaining({
      configCode: expect.anything(),
    }));
    expect(result.skuNormalization).toMatchObject({
      originalSku: 'J2501-Z-TS1S-32132-33',
      canonicalSku: 'J2501-TS1S-32132-33',
      removedSegments: [{ index: 1, value: 'Z', role: 'OTHER' }],
    });
    expect(result.skuMapping).toMatchObject({
      employeeCode: 'J2501',
      configCode: 'TS1S',
      dateCode: '32132',
      sequence: '33',
    });
  });

  test('preview removes country segment with config-scoped SKU normalize rule', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2504-L-TS1S-US-050226-1',
    });
    mappingRuleService.listActiveSkuNormalizeRulesForContext.mockResolvedValueOnce([{
      _id: '660000000000000000010012',
      patternType: 'SEGMENT',
      segmentIndex: 1,
      segmentRole: 'SIZE',
      appliesWhenValues: ['L'],
      outputAction: 'REMOVE_SEGMENT',
      priority: 0,
      status: 'ACTIVE',
    }, {
      _id: '660000000000000000010013',
      configCode: 'TS1S',
      patternType: 'SEGMENT',
      segmentIndex: 2,
      segmentRole: 'CONFIG',
      appliesWhenValues: ['TS1S'],
      outputAction: 'REPLACE_SEGMENT',
      replacementValue: 'TS2S',
      priority: 1,
      status: 'ACTIVE',
    }, {
      _id: '660000000000000000010014',
      configCode: 'TS1S',
      patternType: 'SEGMENT',
      segmentIndex: 3,
      segmentRole: 'COUNTRY',
      appliesWhenValues: ['US'],
      outputAction: 'REMOVE_SEGMENT',
      priority: 2,
      status: 'ACTIVE',
    }]);
    catalogPublic.findListingBySku.mockImplementationOnce(async ({ sku }) => (
      sku === 'J2504-TS2S-050226-1' ? { ...listing, sku } : null
    ));

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(mappingRuleService.listActiveSkuNormalizeRulesForContext).toHaveBeenCalledWith(expect.not.objectContaining({
      configCode: expect.anything(),
    }));
    expect(catalogPublic.findListingBySku).toHaveBeenCalledWith(expect.objectContaining({
      sku: 'J2504-TS2S-050226-1',
    }));
    expect(result.skuNormalization).toMatchObject({
      originalSku: 'J2504-L-TS1S-US-050226-1',
      canonicalSku: 'J2504-TS2S-050226-1',
      removedSegments: [
        { index: 3, value: 'US', role: 'COUNTRY' },
        { index: 1, value: 'L', role: 'SIZE' },
      ],
    });
    expect(result.skuMapping).toMatchObject({
      employeeCode: 'J2504',
      configCode: 'TS2S',
      dateCode: '050226',
      sequence: '1',
    });
  });

  test('preview preserves raw segment indices across multiple generic removals', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2504-L-TS1S-US-050226-1',
    });
    mappingRuleService.listActiveSkuNormalizeRulesForContext.mockResolvedValueOnce([{
      _id: '660000000000000000010015',
      patternType: 'SEGMENT',
      segmentIndex: 1,
      segmentRole: 'SIZE',
      appliesWhenValues: ['L'],
      outputAction: 'REMOVE_SEGMENT',
      priority: 1,
      status: 'ACTIVE',
    }, {
      _id: '660000000000000000010016',
      patternType: 'SEGMENT',
      segmentIndex: 3,
      segmentRole: 'COUNTRY',
      appliesWhenValues: ['US'],
      outputAction: 'REMOVE_SEGMENT',
      priority: 2,
      status: 'ACTIVE',
    }]);
    catalogPublic.findListingBySku.mockImplementationOnce(async ({ sku }) => (
      sku === 'J2504-TS1S-050226-1' ? { ...listing, sku } : null
    ));

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.skuNormalization).toMatchObject({
      canonicalSku: 'J2504-TS1S-050226-1',
      removedSegments: [
        { index: 1, value: 'L', role: 'SIZE' },
        { index: 3, value: 'US', role: 'COUNTRY' },
      ],
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

  test('preview prefers listing template over SKU rule template and normalizes with final template', async () => {
    const listingTemplateId = '660000000000000000002011';
    const skuRuleTemplateId = '660000000000000000002099';
    const listingTemplate = {
      _id: listingTemplateId,
      code: 'LISTING_TEMPLATE',
      requiredFields: [{ key: 'customName', label: 'Custom Name', required: true }],
    };
    const skuRuleTemplate = {
      _id: skuRuleTemplateId,
      code: 'SKU_RULE_TEMPLATE',
      requiredFields: [{ key: 'wrongName', label: 'Wrong Name', required: true }],
    };
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2522-TS1S-070326-109',
    });
    catalogPublic.findListingBySku.mockResolvedValueOnce({
      ...listing,
      sku: 'J2522-TS1S-070326-109',
      internalTemplateId: listingTemplateId,
    });
    catalogPublic.getInternalTemplateForListing.mockResolvedValueOnce(listingTemplate);
    catalogPublic.getInternalTemplateById.mockResolvedValueOnce(skuRuleTemplate);
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValueOnce([{
      _id: '660000000000000000010099',
      configCode: 'TS1S',
      productTypeAliases: [],
      productTypeGroupId: groupId,
      internalTemplateId: skuRuleTemplateId,
    }]);
    mappingRuleService.buildNormalizedInputs
      .mockResolvedValueOnce({
        normalizedInputs: [{
          semanticRole: 'SIZE',
          value: 'L',
          originalLabel: 'Select Size',
          originalValue: 'L',
          confidence: 'HIGH',
          reason: 'LABEL_HEURISTIC',
          source: 'HEURISTIC',
          ruleId: null,
        }],
        blockingReasons: [],
      });

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.internalTemplate).toMatchObject({ id: listingTemplateId, code: 'LISTING_TEMPLATE' });
    expect(result.skuMapping.internalTemplateId).toBe(skuRuleTemplateId);
    expect(mappingRuleService.buildNormalizedInputs).toHaveBeenCalledTimes(1);
    expect(mappingRuleService.buildNormalizedInputs.mock.calls[0][0]).toMatchObject({
      internalTemplate: listingTemplate,
    });
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

  test('preview selects platform SKU config over global when product type signal is missing', async () => {
    const globalRule = {
      _id: '660000000000000000010103',
      configCode: 'NK',
      productTypeGroupId: groupId,
      internalTemplateId: null,
      priority: 100,
    };
    const platformRule = {
      _id: '660000000000000000010104',
      salesChannelCode: 'AMAZON',
      configCode: 'NK',
      productTypeGroupId: selectedGroupId,
      internalTemplateId: null,
      priority: 100,
    };
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2520-NK-280226-2206',
    });
    mappingRuleService.buildNormalizedInputs.mockResolvedValueOnce({
      normalizedInputs: [],
      blockingReasons: [],
    });
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValueOnce([globalRule, platformRule]);

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.blockingReasons).not.toContain('SKU_CONFIG_AMBIGUOUS');
    expect(result.skuMapping).toMatchObject({
      ruleId: platformRule._id,
      productTypeGroupId: selectedGroupId,
      ambiguous: false,
    });
  });

  test('preview selects shop SKU config over platform and global rules', async () => {
    const shopRule = {
      _id: '660000000000000000010105',
      shopId,
      salesChannelCode: 'AMAZON',
      configCode: 'NK',
      productTypeGroupId: selectedGroupId,
      internalTemplateId: null,
      priority: 100,
    };
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2520-NK-280226-2206',
    });
    mappingRuleService.buildNormalizedInputs.mockResolvedValueOnce({
      normalizedInputs: [],
      blockingReasons: [],
    });
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValueOnce([
      {
        _id: '660000000000000000010106',
        configCode: 'NK',
        productTypeGroupId: groupId,
        internalTemplateId: null,
        priority: 100,
      },
      {
        _id: '660000000000000000010107',
        salesChannelCode: 'AMAZON',
        configCode: 'NK',
        productTypeGroupId: groupId,
        internalTemplateId: null,
        priority: 100,
      },
      shopRule,
    ]);

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.blockingReasons).not.toContain('SKU_CONFIG_AMBIGUOUS');
    expect(result.skuMapping).toMatchObject({
      ruleId: shopRule._id,
      productTypeGroupId: selectedGroupId,
      ambiguous: false,
    });
  });

  test('preview does not mark duplicate same-target SKU config rules as ambiguous', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2520-NK-280226-2206',
    });
    mappingRuleService.buildNormalizedInputs.mockResolvedValueOnce({
      normalizedInputs: [],
      blockingReasons: [],
    });
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValueOnce([
      {
        _id: '660000000000000000010108',
        configCode: 'NK',
        productTypeGroupId: groupId,
        internalTemplateId: templateId,
        priority: 100,
      },
      {
        _id: '660000000000000000010109',
        configCode: 'NK',
        productTypeGroupId: groupId,
        internalTemplateId: templateId,
        priority: 100,
      },
    ]);

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.blockingReasons).not.toContain('SKU_CONFIG_AMBIGUOUS');
    expect(result.skuMapping).toMatchObject({
      productTypeGroupId: groupId,
      internalTemplateId: templateId,
      ambiguous: false,
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
    vendorPublic.listActiveVendorCostCentersByProductIds.mockResolvedValueOnce([beefulNoMatch, mangoteeMatch]);
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

  test('preview uses conditional vendor routing after size and color match', async () => {
    orderPublic.findItemById.mockResolvedValueOnce({
      ...item,
      sku: 'J2501-TS1S-32132-33',
      asin: 'B0COND123',
    });
    const genericProduct = {
      _id: '660000000000000000004301',
      code: 'GENERIC_TEE',
      name: 'Generic Tee',
      status: 'ACTIVE',
      productTypeGroupId: groupId,
      vendorId: '660000000000000000004333',
    };
    const conditionalProduct = {
      _id: '660000000000000000004401',
      code: 'ASH_TEE',
      name: 'Ash Tee',
      status: 'ACTIVE',
      productTypeGroupId: groupId,
      vendorId: '660000000000000000004444',
    };
    const genericMatch = {
      _id: '660000000000000000005301',
      vendorProductId: genericProduct._id,
      vendorId: genericProduct.vendorId,
      code: 'GENERIC_BLACK_L',
      standardSize: 'L',
      standardColor: 'BLACK',
      baseCostAmount: 500,
      status: 'ACTIVE',
    };
    const conditionalMatch = {
      _id: '660000000000000000005401',
      vendorProductId: conditionalProduct._id,
      vendorId: conditionalProduct.vendorId,
      code: 'ASH_BLACK_L',
      standardSize: 'L',
      standardColor: 'BLACK',
      baseCostAmount: 500,
      status: 'ACTIVE',
    };
    vendorPublic.listActiveVendorProductsByProductTypeGroup.mockResolvedValueOnce([genericProduct, conditionalProduct]);
    vendorPublic.listActiveVendorCostCentersByProductIds.mockResolvedValueOnce([genericMatch, conditionalMatch]);
    mappingRuleService.listActiveVendorRoutingRulesForContext.mockResolvedValueOnce([
      { vendorId: genericProduct.vendorId, priority: 1, specificity: 1 },
      {
        vendorId: conditionalProduct.vendorId,
        priority: 1,
        specificity: 4,
        configCode: 'TS1S',
        normalizedSize: 'L',
        normalizedColor: 'BLACK',
      },
    ]);

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(mappingRuleService.listActiveVendorRoutingRulesForContext).toHaveBeenCalledWith(expect.objectContaining({
      configCode: 'TS1S',
      asin: 'B0COND123',
      normalizedSize: 'L',
      normalizedColor: 'BLACK',
    }));
    expect(result.costCenterCandidates[0]).toMatchObject({
      id: conditionalMatch._id,
      vendorProductId: conditionalProduct._id,
      confidence: 'HIGH',
    });
    expect(result.autoMatch).toMatchObject({
      vendorProductId: conditionalProduct._id,
      vendorCostCenterId: conditionalMatch._id,
    });
  });

  test('preview matches a prefixed dimension size and pack color after normalization', async () => {
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
    vendorPublic.listActiveVendorCostCentersByProductIds.mockResolvedValueOnce([{
      ...costCenter,
      _id: '660000000000000000005301',
      code: 'NAPKIN_50',
      sku: 'LNGNKL50',
      standardSize: 'Scalloped - 4.8" x 4.8"',
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

  test('preview auto matches an exact size when the vendor does not differentiate color', async () => {
    mappingRuleService.buildNormalizedInputs.mockResolvedValueOnce({
      normalizedInputs: [
        { semanticRole: 'SIZE', value: '4.3X4.3' },
        { semanticRole: 'COLOR', value: 'OPTION 4' },
      ],
      blockingReasons: [],
    });
    vendorPublic.listActiveVendorCostCentersByProductIds.mockResolvedValueOnce([{
      ...costCenter,
      _id: '660000000000000000005302',
      sku: 'OTHER-SKU',
      standardSize: 'Scalloped - 4.3X4.3 INCHES',
      standardColor: null,
      vendorSize: '4.3X4.3',
      vendorColor: null,
    }]);

    const result = await service.previewFulfillmentPlan(orderItemId, {}, { permissions: ['MAPPING:READ'] });

    expect(result.costCenterCandidates[0]).toMatchObject({
      id: '660000000000000000005302',
      confidence: 'HIGH',
      matchReasons: expect.arrayContaining(['STANDARD_SIZE', 'VENDOR_SIZE']),
    });
    expect(result.autoMatch).toMatchObject({
      vendorCostCenterId: '660000000000000000005302',
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

  test('system handoff can read fulfillment plan without user shop scope', async () => {
    authPublic.canAccessScope.mockReturnValue(false);
    repository.findActiveByOrderItem.mockResolvedValueOnce({
      _id: '660000000000000000006001',
      orderId,
      orderItemId,
      shopId,
      status: 'READY',
      snapshot: {},
    });

    await expect(service.getFulfillmentPlanForOrderItem(orderItemId, {
      system: true,
      source: 'PRODUCTION',
    })).resolves.toMatchObject({
      id: '660000000000000000006001',
      status: 'READY',
    });
  });

  test('batch fulfillment plan read skips per-item order lookup for global mapping read', async () => {
    const secondOrderItemId = '660000000000000000001002';
    repository.listByOrderItemIds.mockResolvedValueOnce([
      {
        _id: '660000000000000000006001',
        orderItemId,
        status: 'READY',
        snapshot: {},
      },
      {
        _id: '660000000000000000006002',
        orderItemId: secondOrderItemId,
        status: 'READY',
        snapshot: {},
      },
    ]);

    const result = await service.listFulfillmentPlansByOrderItemIds(
      [orderItemId, secondOrderItemId],
      { permissions: ['MAPPING:READ'] },
    );

    expect(orderPublic.findItemById).not.toHaveBeenCalled();
    expect(repository.listByOrderItemIds).toHaveBeenCalledWith([orderItemId, secondOrderItemId]);
    expect(result).toHaveLength(2);
  });
});
