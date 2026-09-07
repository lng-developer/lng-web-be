const mongoose = require('mongoose');
const authPublic = require('../../src/modules/auth/public');
const hrPublic = require('../../src/modules/hr/public');
const orderPublic = require('../../src/modules/order/public');
const catalogPublic = require('../../src/modules/catalog/public');
const customizationPublic = require('../../src/modules/customization/public');
const vendorPublic = require('../../src/modules/vendor/public');
const mediaPublic = require('../../src/modules/media/public');
const shopPublic = require('../../src/modules/shop/public');

jest.mock('../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../src/modules/hr/public', () => ({
  getEmployeeProfileByEmployeeCode: jest.fn(),
  listEmployeeProfilesByAccountIds: jest.fn(),
  listEmployeeProfilesByEmployeeCodes: jest.fn(),
}));

jest.mock('../../src/modules/order/public', () => ({
  addressValidationStatuses: {
    NOT_CHECKED: 'NOT_CHECKED',
    VALID: 'VALID',
    OVERRIDDEN: 'OVERRIDDEN',
  },
  appendTimeline: jest.fn(),
  appendTimelineOnce: jest.fn(),
  deriveOrderItemWorkflow: jest.requireActual('../../src/modules/order/services/orderWorkflow.service').deriveOrderItemWorkflow,
  findById: jest.fn(),
  findItemById: jest.fn(),
  listItemsByOrder: jest.fn(),
  markFulfillmentReady: jest.fn(),
  markOrderDelivered: jest.fn(),
  transitionItemStatus: jest.fn(),
  updateCostCenterStatusForOrder: jest.fn(),
  updateOrderWorkbenchItem: jest.fn(),
  updatePsdStatusForOrder: jest.fn(),
}));

jest.mock('../../src/modules/order/repositories/orderItem.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../src/modules/order/services/orderItemStatusTransition.service', () => ({
  transitionItemStatus: jest.fn(),
}));

jest.mock('../../src/modules/order/services/orderTimeline.service', () => ({
  appendTimeline: jest.fn(),
}));

jest.mock('../../src/modules/catalog/public', () => ({
  findListingBySku: jest.fn(),
  getInternalTemplateById: jest.fn(),
  getListingById: jest.fn(),
  getListingVariantById: jest.fn(),
  resolveListingVariant: jest.fn(),
}));

jest.mock('../../src/modules/customization/public', () => ({
  assertCustomizationReady: jest.fn(),
  getOrderItemCustomizationView: jest.fn(),
  listOrderItemCustomizationViews: jest.fn(),
}));

jest.mock('../../src/modules/vendor/public', () => ({
  getVendorById: jest.fn(),
  getVendorProductById: jest.fn(),
  listActiveVendorCostCenters: jest.fn(),
  listActiveVendorCostCentersByProductIds: jest.fn(),
  listActiveVendorProductsByProductTypeGroup: jest.fn(),
}));

jest.mock('../../src/modules/media/public', () => ({
  assertMediaAssetExists: jest.fn(),
  getPublicAssetUrl: jest.fn(),
}));

jest.mock('../../src/modules/shop/public', () => ({
  findById: jest.fn(),
}));

let mockMappingService;
let mockProductionService;
let mockVendorSubmissionService;
let mockShipmentService;

jest.mock('../../src/modules/mapping/public', () => ({
  getFulfillmentPlanForOrderItem: jest.fn((...args) => mockMappingService.getFulfillmentPlanForOrderItem(...args)),
}));

jest.mock('../../src/modules/production/public', () => ({
  createOrRecheckTaskForOrderItem: jest.fn(),
  getTaskById: jest.fn((...args) => mockProductionService.getTaskById(...args)),
  markSentToVendor: jest.fn((...args) => mockProductionService.markSentToVendor(...args)),
}));

jest.mock('../../src/modules/vendorSubmission/public', () => ({
  createFromProductionTask: jest.fn(),
  getById: jest.fn(),
  getByOrderItemId: jest.fn(),
  listLatestByProductionTaskIds: jest.fn(),
}));

jest.mock('../../src/modules/shipment/public', () => ({
  getShipmentByOrderItem: jest.fn((...args) => mockShipmentService.getShipmentByOrderItem(...args)),
}));

jest.mock('../../src/modules/mapping/services/mappingRule.service', () => ({
  buildNormalizedInputs: jest.fn(),
  listActiveSkuConfigRulesForContext: jest.fn(),
  listActiveSkuNormalizeRulesForContext: jest.fn(),
  listActiveVendorRoutingRulesForContext: jest.fn(),
}));

jest.mock('../../src/modules/mapping/repositories/fulfillmentPlan.repository', () => ({
  findActiveByOrderItem: jest.fn(),
  findByOrderItem: jest.fn(),
  listByOrderItemIds: jest.fn(),
  upsertByOrderItem: jest.fn(),
}));

jest.mock('../../src/modules/production/repositories/productionTask.repository', () => ({
  findById: jest.fn(),
  findByOrderItem: jest.fn(),
  listSummariesByOrderItemIds: jest.fn(),
  updateById: jest.fn(),
  updateByIdIf: jest.fn(),
  updateScaledOutputIfMutable: jest.fn(),
  updateFileCheckOutputIfMutable: jest.fn(),
  upsertByOrderItem: jest.fn(),
  upsertByOrderItemWithResult: jest.fn(),
}));

jest.mock('../../src/modules/vendorSubmission/repositories/vendorSubmission.repository', () => ({
  create: jest.fn(),
  findActiveByProductionTask: jest.fn(),
  findById: jest.fn(),
  updateById: jest.fn(),
}));

jest.mock('../../src/modules/shipment/repositories/shipment.repository', () => ({
  create: jest.fn(),
  findActiveByVendorSubmission: jest.fn(),
  findById: jest.fn(),
  findByOrderItem: jest.fn(),
  listByOrderItemIds: jest.fn(),
  updateById: jest.fn(),
  updateStatusIfCurrent: jest.fn(),
  updateTrackingIfNotDelivered: jest.fn(),
}));

jest.mock('../../src/modules/finance/repositories/financeSnapshot.repository', () => ({
  findByOrderItem: jest.fn(),
  upsertByOrderItem: jest.fn(),
}));

jest.mock('../../src/modules/finance/repositories/financeImport.repository', () => ({
  sumFeesByOrderItem: jest.fn(),
  sumRefundsByOrderItem: jest.fn(),
}));

jest.mock('../../src/modules/audit/public', () => ({
  record: jest.fn(),
}));

const mappingRuleService = require('../../src/modules/mapping/services/mappingRule.service');
const orderItemRepository = require('../../src/modules/order/repositories/orderItem.repository');
const orderItemStatusTransitionService = require('../../src/modules/order/services/orderItemStatusTransition.service');
const orderTimelineService = require('../../src/modules/order/services/orderTimeline.service');
const fulfillmentPlanRepository = require('../../src/modules/mapping/repositories/fulfillmentPlan.repository');
const productionTaskRepository = require('../../src/modules/production/repositories/productionTask.repository');
const vendorSubmissionRepository = require('../../src/modules/vendorSubmission/repositories/vendorSubmission.repository');
const shipmentRepository = require('../../src/modules/shipment/repositories/shipment.repository');
const financeSnapshotRepository = require('../../src/modules/finance/repositories/financeSnapshot.repository');
const financeImportRepository = require('../../src/modules/finance/repositories/financeImport.repository');
const auditPublic = require('../../src/modules/audit/public');

const financeTransactionSession = {
  withTransaction: jest.fn(async (callback) => callback()),
  endSession: jest.fn(),
};
jest.spyOn(mongoose, 'startSession').mockResolvedValue(financeTransactionSession);

const mappingService = require('../../src/modules/mapping/services/fulfillmentPlan.service');
const productionService = require('../../src/modules/production/services/productionTask.service');
const vendorSubmissionService = require('../../src/modules/vendorSubmission/services/vendorSubmission.service');
const shipmentService = require('../../src/modules/shipment/services/shipment.service');
const financeService = require('../../src/modules/finance/services/financeSnapshot.service');
const vendorSubmissionPublic = require('../../src/modules/vendorSubmission/public');
const orderItemCancelService = require('../../src/modules/order/services/orderItemCancel.service');

mockMappingService = mappingService;
mockProductionService = productionService;
mockVendorSubmissionService = vendorSubmissionService;
mockShipmentService = shipmentService;

describe('order fulfillment E2E contract', () => {
  const orderId = '660000000000000000200001';
  const orderItemId = '660000000000000000200002';
  const shopId = '660000000000000000200003';
  const listingId = '660000000000000000200004';
  const listingVariantId = '660000000000000000200014';
  const templateId = '660000000000000000200005';
  const productTypeGroupId = '660000000000000000200006';
  const vendorId = '660000000000000000200007';
  const vendorProductId = '660000000000000000200008';
  const vendorCostCenterId = '660000000000000000200009';
  const fulfillmentPlanId = '660000000000000000200010';
  const productionTaskId = '660000000000000000200011';
  const fileCheckId = '660000000000000000200012';
  const psdFileCheckId = '660000000000000000200021';
  const vendorSubmissionId = '660000000000000000200013';
  const shipmentId = '660000000000000000200014';
  const psdAssetId = '660000000000000000200015';
  const scaledAssetId = '660000000000000000200016';
  const psdScaledAssetId = '660000000000000000200022';
  const customerImageAssetId = '660000000000000000200017';
  const accountId = '660000000000000000200018';

  const authContext = {
    accountId,
    permissions: [
      'MAPPING:WRITE',
      'PRODUCTION:WRITE',
      'VENDOR_SUBMISSIONS:WRITE',
      'SHIPMENTS:WRITE',
      'FINANCE:WRITE',
    ],
  };

  function scopedAuthContext(permissions, scopeId = shopId) {
    return {
      accountId,
      permissions: [],
      scopes: [
        {
          scopeType: 'shop',
          scopeId,
          permissions,
        },
      ],
    };
  }

  function useRealScopedAccess() {
    authPublic.canAccessScope.mockImplementation((context = {}, permission, scope = {}) => (
      (context.scopes || []).some((entry) => (
        entry.scopeType === scope.scopeType
        && String(entry.scopeId) === String(scope.scopeId)
        && (entry.permissions || []).includes(permission)
      ))
    ));
  }

  let item;
  let order;
  let fulfillmentPlan;
  let productionTask;
  let vendorSubmission;
  let shipment;
  let financeSnapshot;

  const listing = {
    _id: listingId,
    sku: 'J2508-TS1S-05032026-335',
    title: 'Senior Mom Shirt',
  };
  const listingVariant = {
    id: listingVariantId,
    listingId,
    productTypeGroup: { id: productTypeGroupId, code: 'TSHIRT', name: 'T-Shirt' },
    internalTemplate: { id: templateId, code: 'TS1S_TEMPLATE', name: 'T-shirt Template' },
    psdTemplateAssetId: psdAssetId,
    psdReadiness: { required: true, status: 'PRESENT' },
  };
  const internalTemplate = {
    _id: templateId,
    code: 'TS1S_TEMPLATE',
    name: 'T-shirt Template',
    status: 'ACTIVE',
    requiredFields: [{ key: 'size', label: 'Select Size', required: true, validation: { semanticRole: 'SIZE' } }],
    artworkSlots: [{
      key: 'FRONT',
      label: 'Front artwork',
      required: true,
      acceptedFieldKeys: ['UPLOAD_YOUR_PHOTO'],
    }],
  };
  const vendor = { _id: vendorId, code: 'BEEFUL', name: 'Beeful', status: 'ACTIVE' };
  const vendorProduct = {
    _id: vendorProductId,
    vendorId,
    vendor,
    productTypeGroupId,
    code: 'PRODUCT_1717',
    name: 'Unisex Garment-Dyed Heavyweight T-Shirt',
    status: 'ACTIVE',
    currency: 'USD',
  };
  const vendorCostCenter = {
    _id: vendorCostCenterId,
    vendorId,
    vendorProductId,
    code: 'PRODUCT_1717_M_PEPPER',
    name: 'M / PEPPER',
    sku: 'UT-1717-PER-M',
    standardSize: 'M',
    standardColor: 'PEPPER',
    baseCostAmount: 894,
    currency: 'USD',
    shipping: { priorityEconomyAmount: 1000 },
    additionalCosts: {},
    status: 'ACTIVE',
  };
  const customizationView = {
    payloadId: '660000000000000000200019',
    orderItemId,
    status: 'PARSED',
    needsReview: false,
    customerInputs: {
      options: [
        { label: 'Select Product Type', value: 'Comfort Color T-Shirt' },
        { label: 'Comfort Color', value: 'Pepper' },
        { label: 'Select Size', value: 'M' },
      ],
      texts: [{ label: 'Enter Name', value: 'Hannah' }],
      images: [{ label: 'Upload your photo', assetId: customerImageAssetId }],
    },
    imageAssets: [{ assetId: customerImageAssetId, secureUrl: 'https://example.test/photo.jpg' }],
    failedImages: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    order = {
      _id: orderId,
      status: 'IMPORTED',
      deliveredAt: null,
      addressValidationStatus: 'VALID',
    };
    item = {
      _id: orderItemId,
      orderId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      externalOrderId: '113-7180016-0704235',
      externalItemId: '163790065888801',
      sku: 'J2508-TS1S-05032026-335',
      title: 'Personalized Senior Mom Shirt',
      quantity: 1,
      asin: 'B0GR8K4S5Q',
      status: 'CUSTOMIZATION_PARSED',
      customizationRawSummary: { hasCustomization: true },
      price: {
        itemPriceAmount: 3385,
        shippingPriceAmount: 595,
        itemTaxAmount: 237,
        shippingTaxAmount: 0,
        giftWrapPriceAmount: 0,
        giftWrapTaxAmount: 0,
        itemPromotionDiscountAmount: 0,
        shipPromotionDiscountAmount: 0,
        currency: 'USD',
      },
    };
    fulfillmentPlan = null;
    productionTask = null;
    vendorSubmission = null;
    shipment = null;
    financeSnapshot = null;

    authPublic.canAccessScope.mockReturnValue(true);
    hrPublic.getEmployeeProfileByEmployeeCode.mockResolvedValue(null);
    hrPublic.listEmployeeProfilesByAccountIds.mockResolvedValue([]);
    hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValue([]);
    orderPublic.findById.mockImplementation(async () => order);
    orderPublic.findItemById.mockImplementation(async () => item);
    orderPublic.listItemsByOrder.mockResolvedValue([item]);
    orderPublic.appendTimeline.mockResolvedValue({});
    orderPublic.appendTimelineOnce.mockResolvedValue({});
    orderPublic.updateCostCenterStatusForOrder.mockResolvedValue({});
    orderPublic.updatePsdStatusForOrder.mockResolvedValue({});
    orderPublic.markFulfillmentReady.mockImplementation(async () => {
      item.status = 'FULFILLMENT_READY';
      return { item, readiness: { ready: true } };
    });
    orderPublic.markOrderDelivered.mockImplementation(async (_orderId, deliveredAt) => {
      order.deliveredAt = deliveredAt;
      return order;
    });
    orderPublic.transitionItemStatus.mockImplementation(async (_orderItemId, status) => {
      item.status = status;
      return item;
    });
    orderItemRepository.findById.mockImplementation(async () => item);
    orderItemStatusTransitionService.transitionItemStatus.mockImplementation(async (_orderItemId, status) => {
      item.status = status;
      return item;
    });
    orderTimelineService.appendTimeline.mockResolvedValue({});
    vendorSubmissionPublic.getById.mockImplementation((...args) => mockVendorSubmissionService.getSubmission(...args));
    vendorSubmissionPublic.getByOrderItemId.mockResolvedValue(null);
    vendorSubmissionPublic.listLatestByProductionTaskIds.mockResolvedValue([]);

    catalogPublic.findListingBySku.mockResolvedValue(listing);
    catalogPublic.getInternalTemplateById.mockResolvedValue(internalTemplate);
    catalogPublic.getListingById.mockResolvedValue(listing);
    catalogPublic.getListingVariantById.mockResolvedValue(listingVariant);
    catalogPublic.resolveListingVariant.mockResolvedValue({ source: 'VARIANT', listing, variant: {
      _id: listingVariantId,
      listingId,
      productTypeGroupId,
      internalTemplateId: templateId,
      psdTemplateAssetId: psdAssetId,
    } });
    customizationPublic.assertCustomizationReady.mockResolvedValue({ status: 'PARSED' });
    customizationPublic.getOrderItemCustomizationView.mockResolvedValue(customizationView);
    customizationPublic.listOrderItemCustomizationViews.mockResolvedValue([customizationView]);
    vendorPublic.getVendorById.mockResolvedValue(vendor);
    vendorPublic.getVendorProductById.mockResolvedValue(vendorProduct);
    vendorPublic.listActiveVendorProductsByProductTypeGroup.mockResolvedValue([vendorProduct]);
    vendorPublic.listActiveVendorCostCenters.mockResolvedValue([vendorCostCenter]);
    vendorPublic.listActiveVendorCostCentersByProductIds.mockResolvedValue([vendorCostCenter]);
    mediaPublic.assertMediaAssetExists.mockResolvedValue(true);
    shopPublic.findById.mockResolvedValue({ _id: shopId, code: 'SHOP-TEST', name: 'Test Shop' });

    mappingRuleService.listActiveSkuNormalizeRulesForContext.mockResolvedValue([]);
    mappingRuleService.listActiveSkuConfigRulesForContext.mockResolvedValue([]);
    mappingRuleService.listActiveVendorRoutingRulesForContext.mockResolvedValue([]);
    mappingRuleService.buildNormalizedInputs.mockResolvedValue({
      normalizedInputs: [
        {
          semanticRole: 'SIZE',
          value: 'M',
          originalLabel: 'Select Size',
          originalValue: 'M',
          confidence: 'HIGH',
          reason: 'TEST',
          source: 'HEURISTIC',
        },
        {
          semanticRole: 'COLOR',
          value: 'PEPPER',
          originalLabel: 'Comfort Color',
          originalValue: 'Pepper',
          confidence: 'HIGH',
          reason: 'TEST',
          source: 'HEURISTIC',
        },
      ],
      blockingReasons: [],
    });

    fulfillmentPlanRepository.findByOrderItem.mockImplementation(async () => fulfillmentPlan);
    fulfillmentPlanRepository.findActiveByOrderItem.mockImplementation(async () => fulfillmentPlan);
    fulfillmentPlanRepository.listByOrderItemIds.mockImplementation(async () => (fulfillmentPlan ? [fulfillmentPlan] : []));
    fulfillmentPlanRepository.upsertByOrderItem.mockImplementation(async (_orderItemId, payload) => {
      fulfillmentPlan = {
        _id: fulfillmentPlanId,
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return fulfillmentPlan;
    });

    productionTaskRepository.findById.mockImplementation(async () => productionTask);
    productionTaskRepository.findByOrderItem.mockImplementation(async () => productionTask);
    productionTaskRepository.upsertByOrderItem.mockImplementation(async (_orderItemId, payload) => {
      const requiredFileCheckIndex = (payload.fileChecks || []).findIndex((check) => (
        check.required && check.sourceType === 'CUSTOMER_IMAGE'
      ));
      const fileChecks = (payload.fileChecks || []).map((check, index) => ({
        _id: index === requiredFileCheckIndex ? fileCheckId : psdFileCheckId,
        ...check,
      }));
      productionTask = {
        _id: productionTaskId,
        ...payload,
        fileChecks,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return productionTask;
    });
    productionTaskRepository.upsertByOrderItemWithResult.mockImplementation(async (
      orderItemIdValue, payload, { setOnInsert = {} } = {},
    ) => {
      const created = !productionTask;
      const task = created
        ? await productionTaskRepository.upsertByOrderItem(orderItemIdValue, { ...setOnInsert, ...payload })
        : { ...productionTask, ...payload, updatedAt: new Date() };
      productionTask = task;
      return { task, created };
    });
    productionTaskRepository.updateById.mockImplementation(async (_taskId, patch) => {
      productionTask = { ...productionTask, ...patch, updatedAt: new Date() };
      return productionTask;
    });
    productionTaskRepository.updateByIdIf.mockImplementation(async (taskIdValue, _filter, patch) => (
      productionTaskRepository.updateById(taskIdValue, patch)
    ));
    productionTaskRepository.updateScaledOutputIfMutable.mockImplementation(async (_taskId, patch) => {
      productionTask = { ...productionTask, ...patch, updatedAt: new Date() };
      return productionTask;
    });
    productionTaskRepository.updateFileCheckOutputIfMutable.mockImplementation(async (
      _taskId, targetFileCheckId, _expected, patch,
    ) => {
      productionTask = {
        ...productionTask,
        fileChecks: productionTask.fileChecks.map((check) => (
          String(check._id) === String(targetFileCheckId) ? { ...check, ...patch } : check
        )),
        updatedAt: new Date(),
      };
      return productionTask;
    });

    vendorSubmissionRepository.findActiveByProductionTask.mockImplementation(async () => vendorSubmission);
    vendorSubmissionRepository.findById.mockImplementation(async () => vendorSubmission);
    vendorSubmissionRepository.create.mockImplementation(async (payload) => {
      vendorSubmission = {
        _id: vendorSubmissionId,
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return vendorSubmission;
    });
    vendorSubmissionRepository.updateById.mockImplementation(async (_submissionId, patch) => {
      vendorSubmission = { ...vendorSubmission, ...patch, updatedAt: new Date() };
      return vendorSubmission;
    });

    shipmentRepository.findActiveByVendorSubmission.mockImplementation(async () => shipment);
    shipmentRepository.findById.mockImplementation(async () => shipment);
    shipmentRepository.findByOrderItem.mockImplementation(async () => shipment);
    shipmentRepository.listByOrderItemIds.mockImplementation(async () => (shipment ? [shipment] : []));
    shipmentRepository.create.mockImplementation(async (payload) => {
      shipment = {
        _id: shipmentId,
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return shipment;
    });
    shipmentRepository.updateById.mockImplementation(async (_shipmentId, patch) => {
      shipment = { ...shipment, ...patch, updatedAt: new Date() };
      return shipment;
    });
    shipmentRepository.updateTrackingIfNotDelivered.mockImplementation(async (_shipmentId, patch) => {
      if (!['TRACKING_PENDING', 'SHIPPED'].includes(shipment?.status)) return null;
      shipment = { ...shipment, ...patch, updatedAt: new Date() };
      return shipment;
    });
    shipmentRepository.updateStatusIfCurrent.mockImplementation(async (_shipmentId, status, patch) => {
      if (shipment?.status !== status) return null;
      shipment = { ...shipment, ...patch, updatedAt: new Date() };
      return shipment;
    });

    financeImportRepository.sumFeesByOrderItem.mockResolvedValue(425);
    financeImportRepository.sumRefundsByOrderItem.mockResolvedValue(0);
    financeSnapshotRepository.upsertByOrderItem.mockImplementation(async (_orderItemId, payload) => {
      financeSnapshot = {
        _id: '660000000000000000200020',
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return financeSnapshot;
    });
  });

  test('maps order item through production, vendor submission, shipment, and finance snapshot', async () => {
    const plan = await mappingService.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId,
    }, authContext);

    expect(plan).toMatchObject({
      status: 'READY',
      selectionMode: 'MANUAL',
      vendorProduct: { id: vendorProductId },
      vendorCostCenter: { id: vendorCostCenterId },
      costEstimate: { totalAmount: 994 },
    });
    expect(orderPublic.updateCostCenterStatusForOrder).toHaveBeenCalledWith(orderId);
    expect(orderPublic.updatePsdStatusForOrder).toHaveBeenCalledWith(orderId);

    const task = await productionService.createOrRecheckTaskForOrderItem(orderItemId, authContext);
    expect(task).toMatchObject({
      id: productionTaskId,
      status: 'NEED_SCALE',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
    });
    expect(item.status).toBe('NEED_PRODUCTION');

    await productionService.uploadScaledFile(productionTaskId, psdFileCheckId, psdScaledAssetId, authContext);
    const scaledTask = await productionService.uploadScaledFile(productionTaskId, fileCheckId, scaledAssetId, authContext);
    expect(scaledTask).toMatchObject({
      status: 'NEED_SCALE',
      scaleStatus: 'SCALED',
      qcStatus: 'NOT_READY',
    });
    const qcPendingTask = await productionService.submitScaleForQc(productionTaskId, authContext);
    expect(qcPendingTask).toMatchObject({
      status: 'QC_PENDING',
      scaleStatus: 'SCALED',
      qcStatus: 'PENDING',
    });
    expect(item.status).toBe('IN_PRODUCTION');

    const readyTask = await productionService.submitQc(productionTaskId, { decision: 'PASSED' }, authContext);
    expect(readyTask).toMatchObject({
      status: 'READY_TO_SEND_VENDOR',
      qcStatus: 'PASSED',
    });
    expect(item.status).toBe('READY_TO_SEND_VENDOR');

    const submission = await vendorSubmissionService.createFromProductionTask(productionTaskId, authContext);
    expect(submission).toMatchObject({
      id: vendorSubmissionId,
      status: 'READY',
      orderItemId,
      vendorProductId,
      vendorCostCenterId,
      statusHistory: [expect.objectContaining({
        status: 'READY',
        actorId: accountId,
      })],
    });
    expect(JSON.stringify(await vendorSubmissionService.getPayloadPreview(vendorSubmissionId, authContext)))
      .not.toMatch(/localPath|providerSecret|token|secret/i);

    const submitted = await vendorSubmissionService.markSubmitted(vendorSubmissionId, authContext);
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.statusHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'READY', actorId: accountId }),
      expect.objectContaining({ status: 'SUBMITTED', actorId: accountId }),
    ]));
    expect(productionTask.status).toBe('SENT_TO_VENDOR');
    expect(item.status).toBe('SENT_TO_VENDOR');

    const pendingShipment = await shipmentService.createFromVendorSubmission(vendorSubmissionId, authContext);
    expect(pendingShipment).toMatchObject({
      id: shipmentId,
      status: 'TRACKING_PENDING',
      orderItemId,
    });
    expect(item.status).toBe('TRACKING_PENDING');

    const shipped = await shipmentService.updateTracking(shipmentId, {
      carrier: 'USPS',
      trackingNumber: '940011189922385',
      trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=940011189922385',
    }, authContext);
    expect(shipped).toMatchObject({
      status: 'SHIPPED',
      carrier: 'USPS',
      trackingNumber: '940011189922385',
    });
    expect(item.status).toBe('SHIPPED');

    const delivered = await shipmentService.updateStatus(shipmentId, { status: 'DELIVERED' }, authContext);
    expect(delivered.status).toBe('DELIVERED');
    expect(item.status).toBe('SHIPPED');
    expect(order.deliveredAt).toBeTruthy();

    mongoose.startSession.mockClear();
    const snapshot = await financeService.recalculateOrderItem(orderItemId, authContext);
    expect(snapshot).toMatchObject({
      orderItemId,
      fulfillmentPlanId,
      vendorProductId,
      vendorCostCenterId,
      shipmentId,
      snapshotStatus: 'ESTIMATED',
      revenue: {
        customerPaidAmount: 3980,
        feeAmount: 425,
        refundAmount: 0,
      },
      cost: {
        baseCostAmount: 894,
        totalCostAmount: 994,
        costStatus: 'PRESENT',
      },
      margin: {
        grossProfitAmount: 2561,
      },
    });
    expect(mongoose.startSession).toHaveBeenCalledTimes(1);
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FINANCE_ORDER_ITEM_RECALCULATED',
      entityId: orderItemId,
    }), { session: financeTransactionSession });
  });

  test('delivers the parent order when a sibling is cancelled', async () => {
    const cancelledItem = {
      ...item,
      _id: '660000000000000000200013',
      status: 'CANCELLED',
    };
    shipment = {
      _id: shipmentId,
      orderId,
      orderItemId,
      shopId,
      status: 'TRACKING_PENDING',
    };

    await shipmentService.updateTracking(shipmentId, {
      carrier: 'USPS',
      trackingNumber: '940011189922385',
    }, authContext);
    orderPublic.listItemsByOrder.mockResolvedValue([item, cancelledItem]);

    await shipmentService.updateStatus(shipmentId, { status: 'DELIVERED' }, authContext);

    expect(orderPublic.markOrderDelivered).toHaveBeenCalledTimes(1);
    expect(orderPublic.markOrderDelivered).toHaveBeenCalledWith(orderId, expect.any(Date), {
      source: 'SHIPMENT',
    });
  });

  test('persists vendor selection without marking fulfillment ready when customization is not ready', async () => {
    customizationPublic.getOrderItemCustomizationView.mockResolvedValueOnce({ status: 'PENDING' });

    await expect(mappingService.selectFulfillmentPlan(orderItemId, {
      vendorProductId,
      vendorCostCenterId,
    }, authContext)).resolves.toMatchObject({
      status: 'READY',
      blockingReasons: expect.arrayContaining(['CUSTOMIZATION_NOT_READY']),
    });

    expect(fulfillmentPlanRepository.upsertByOrderItem).toHaveBeenCalledTimes(1);
    expect(orderPublic.markFulfillmentReady).not.toHaveBeenCalled();
  });

  test('does not create vendor submission before production is ready to send vendor', async () => {
    productionTask = {
      _id: productionTaskId,
      orderId,
      orderItemId,
      shopId,
      status: 'NEED_SCALE',
    };

    await expect(vendorSubmissionService.createFromProductionTask(productionTaskId, authContext))
      .rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT_ERROR',
        details: { status: 'NEED_SCALE' },
      });

    expect(vendorSubmissionRepository.create).not.toHaveBeenCalled();
  });

  test('does not create shipment before vendor submission is submitted', async () => {
    vendorSubmission = {
      _id: vendorSubmissionId,
      orderId,
      orderItemId,
      shopId,
      status: 'READY',
    };

    await expect(shipmentService.createFromVendorSubmission(vendorSubmissionId, authContext))
      .rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT_ERROR',
        details: { status: 'READY' },
      });

    expect(shipmentRepository.create).not.toHaveBeenCalled();
  });

  test('does not cancel an item after vendor submission', async () => {
    item.status = 'SENT_TO_VENDOR';
    vendorSubmissionPublic.getByOrderItemId.mockResolvedValue({
      id: vendorSubmissionId,
      orderItemId,
      status: 'SUBMITTED',
    });

    await expect(orderItemCancelService.cancelOrderItem(
      orderItemId,
      { reason: 'Buyer requested cancellation' },
      { accountId, permissions: ['ORDERS:WRITE'] },
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(item.status).toBe('SENT_TO_VENDOR');
    expect(orderItemStatusTransitionService.transitionItemStatus).not.toHaveBeenCalled();
    expect(orderTimelineService.appendTimeline).not.toHaveBeenCalled();
  });

  test('finance snapshot records missing cost when mapping plan is absent', async () => {
    const snapshot = await financeService.recalculateOrderItem(orderItemId, authContext);

    expect(snapshot).toMatchObject({
      orderItemId,
      fulfillmentPlanId: null,
      shipmentId: null,
      snapshotStatus: 'MISSING_COST',
      revenue: {
        customerPaidAmount: 3980,
        feeAmount: 425,
      },
      cost: {
        baseCostAmount: null,
        totalCostAmount: null,
        costStatus: 'MISSING',
      },
      margin: {
        grossProfitAmount: null,
      },
    });
  });

  test('scoped auth can create vendor submission only when production read and submission write scopes pass through', async () => {
    productionTask = {
      _id: productionTaskId,
      id: productionTaskId,
      orderId,
      orderItemId,
      shopId,
      fulfillmentPlanId,
      status: 'READY_TO_SEND_VENDOR',
      scaleStatus: 'SCALED',
      qcStatus: 'PASSED',
      blockers: [],
      fileChecks: [],
      vendorProduct: { id: vendorProductId },
      vendorCostCenter: { id: vendorCostCenterId },
    };
    useRealScopedAccess();
    const scopedContext = scopedAuthContext([
      'PRODUCTION:READ',
      'VENDOR_SUBMISSIONS:WRITE',
    ]);

    const submission = await vendorSubmissionService.createFromProductionTask(productionTaskId, scopedContext);

    expect(submission).toMatchObject({
      id: vendorSubmissionId,
      status: 'READY',
      shopId,
    });
    expect(authPublic.canAccessScope).toHaveBeenCalledWith(scopedContext, 'PRODUCTION:READ', {
      scopeType: 'shop',
      scopeId: shopId,
    });
    expect(authPublic.canAccessScope).toHaveBeenCalledWith(scopedContext, 'VENDOR_SUBMISSIONS:WRITE', {
      scopeType: 'shop',
      scopeId: shopId,
    });
  });

  test('scoped auth cannot create vendor submission when production read scope is missing', async () => {
    productionTask = {
      _id: productionTaskId,
      id: productionTaskId,
      orderId,
      orderItemId,
      shopId,
      status: 'READY_TO_SEND_VENDOR',
      scaleStatus: 'SCALED',
      qcStatus: 'PASSED',
      blockers: [],
      fileChecks: [],
    };
    useRealScopedAccess();
    const scopedContext = scopedAuthContext(['VENDOR_SUBMISSIONS:WRITE']);

    await expect(vendorSubmissionService.createFromProductionTask(productionTaskId, scopedContext))
      .rejects.toMatchObject({
        statusCode: 403,
        code: 'AUTHORIZATION_ERROR',
      });

    expect(vendorSubmissionRepository.create).not.toHaveBeenCalled();
  });

  test('scoped auth cannot create shipment for a submission in an unauthorized shop', async () => {
    vendorSubmission = {
      _id: vendorSubmissionId,
      id: vendorSubmissionId,
      orderId,
      orderItemId,
      shopId,
      status: 'SUBMITTED',
    };
    useRealScopedAccess();
    const scopedContext = scopedAuthContext(['SHIPMENTS:WRITE'], '660000000000000000299999');

    await expect(shipmentService.createFromVendorSubmission(vendorSubmissionId, scopedContext))
      .rejects.toMatchObject({
        statusCode: 403,
        code: 'AUTHORIZATION_ERROR',
      });

    expect(shipmentRepository.create).not.toHaveBeenCalled();
  });

  test('scoped auth cannot recalculate finance snapshot without finance write access to item shop', async () => {
    useRealScopedAccess();
    const scopedContext = scopedAuthContext(['FINANCE:READ']);

    await expect(financeService.recalculateOrderItem(orderItemId, scopedContext))
      .rejects.toMatchObject({
        statusCode: 403,
        code: 'AUTHORIZATION_ERROR',
      });

    expect(financeSnapshotRepository.upsertByOrderItem).not.toHaveBeenCalled();
  });
});
