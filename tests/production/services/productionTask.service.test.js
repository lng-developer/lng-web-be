const mockSession = {
  withTransaction: jest.fn(async (work) => work()),
  endSession: jest.fn(),
};
jest.mock('mongoose', () => ({
  ...jest.requireActual('mongoose'),
  startSession: jest.fn(async () => mockSession),
}));

jest.mock('../../../src/modules/order/public', () => ({
  appendTimeline: jest.fn(),
  deriveOrderItemWorkflow: jest.requireActual('../../../src/modules/order/services/orderWorkflow.service').deriveOrderItemWorkflow,
  addressValidationStatuses: {
    NOT_CHECKED: 'NOT_CHECKED',
    VALID: 'VALID',
    INVALID: 'INVALID',
    WARNING: 'WARNING',
    OVERRIDDEN: 'OVERRIDDEN',
  },
  findById: jest.fn(),
  findItemById: jest.fn(),
  transitionItemStatus: jest.fn(),
  updateOrderWorkbenchItem: jest.fn(),
}));

jest.mock('../../../src/modules/shop/public', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../src/modules/mapping/public', () => ({
  getFulfillmentPlanForOrderItem: jest.fn(),
  recheckFulfillmentPlan: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/public', () => ({
  getInternalTemplateById: jest.fn(),
  getListingById: jest.fn(),
  getListingVariantById: jest.fn(),
}));

jest.mock('../../../src/modules/customization/public', () => ({
  getOrderItemCustomizationView: jest.fn(),
  listOrderItemCustomizationViews: jest.fn(),
}));

jest.mock('../../../src/modules/media/public', () => ({
  assertMediaAssetExists: jest.fn(),
  discardUnattachedAsset: jest.fn(),
  getStorageProvider: jest.fn(),
  storeAsset: jest.fn(),
}));

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
  listTeamScopedAccountIds: jest.fn(),
  hasTeamQueueScope: jest.fn(),
}));

jest.mock('../../../src/modules/hr/public', () => ({
  listAssignableProfiles: jest.fn(),
  listEmployeeProfilesByAccountIds: jest.fn(),
  listEmployeeProfilesByEmployeeCodes: jest.fn(),
}));

jest.mock('../../../src/modules/organization/public', () => ({
  listAccountOrganizationSummaries: jest.fn(),
  listTeamMembers: jest.fn(),
}));

jest.mock('../../../src/modules/vendorSubmission/public', () => ({
  cancel: jest.fn(),
  createAndSubmitFromProductionTask: jest.fn(),
  getById: jest.fn(),
  getByProductionTaskId: jest.fn(),
  listLatestByProductionTaskIds: jest.fn(),
}));

jest.mock('../../../src/modules/design/public', () => ({
  createPsdTemplateTaskFromListing: jest.fn(),
  createPsdTemplateTaskFromListingVariant: jest.fn(),
}));

jest.mock('../../../src/modules/audit/public', () => ({
  record: jest.fn(),
}));
jest.mock('../../../src/modules/notification/public', () => ({
  notify: jest.fn(),
}));
jest.mock('../../../src/modules/workScore/public', () => ({
  recordProductionScaleScores: jest.fn(),
}));

jest.mock('../../../src/modules/production/repositories/productionTask.repository', () => ({
  findById: jest.fn(),
  findByOrderItem: jest.fn(),
  list: jest.fn(),
  listForExport: jest.fn(),
  listByOrderItemIds: jest.fn(),
  listPsdBlockedByExternalOrderId: jest.fn(),
  listPsdBlockedByListingId: jest.fn(),
  listSummariesByOrderItemIds: jest.fn(),
  summarize: jest.fn(),
  appendFileCheckIfMutable: jest.fn(),
  updateFileCheckOutputIfMutable: jest.fn(),
  updateById: jest.fn(),
  updateByIdIf: jest.fn(),
  updateScaledOutputIfMutable: jest.fn(),
  upsertByOrderItem: jest.fn(),
  upsertByOrderItemWithResult: jest.fn(),
}));

const orderPublic = require('../../../src/modules/order/public');
const errorCodes = require('../../../src/shared/constants/errorCodes');
const shopPublic = require('../../../src/modules/shop/public');
const mappingPublic = require('../../../src/modules/mapping/public');
const catalogPublic = require('../../../src/modules/catalog/public');
const customizationPublic = require('../../../src/modules/customization/public');
const mediaPublic = require('../../../src/modules/media/public');
const authPublic = require('../../../src/modules/auth/public');
const hrPublic = require('../../../src/modules/hr/public');
const organizationPublic = require('../../../src/modules/organization/public');
const vendorSubmissionPublic = require('../../../src/modules/vendorSubmission/public');
const designPublic = require('../../../src/modules/design/public');
const auditPublic = require('../../../src/modules/audit/public');
const notificationPublic = require('../../../src/modules/notification/public');
const workScorePublic = require('../../../src/modules/workScore/public');
const repository = require('../../../src/modules/production/repositories/productionTask.repository');
const service = require('../../../src/modules/production/services/productionTask.service');

describe('productionTask.service', () => {
  const taskId = '660000000000000000100001';
  const fileCheckId = '660000000000000000100002';
  const orderId = '660000000000000000000301';
  const orderItemId = '660000000000000000000401';
  const shopId = '660000000000000000000201';
  const otherShopId = '660000000000000000000202';
  const mediaAssetId = '660000000000000000000901';
  const outputAssetId = '660000000000000000000902';
  const designerId = '660000000000000000000903';
  const qcUserId = '660000000000000000000906';
  const csAssigneeId = '660000000000000000000905';
  const vendorSubmissionId = '660000000000000000129001';
  const listingVariantId = '660000000000000000129003';

  function scopedShopAuth(accountId, permissions, scopeId = shopId) {
    return {
      accountId,
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId, permissions }],
    };
  }

  function scopedTeamAuth(accountId, permissions, scopeId = '660000000000000000000102', roles = []) {
    return {
      accountId,
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId, permissions, roles }],
    };
  }

  const item = {
    _id: orderItemId,
    orderId,
    shopId,
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'AMAZON_US',
    externalOrderId: '111-7980434-4279402',
    externalItemId: 'item-1',
    csNote: 'Confirm customer photo before scale',
    externalAccountId: 'SELLER-01',
    asin: 'B0H3ZTRPGJ',
    sku: 'J2605-AP-04062026A111',
    title: 'Custom Photo Plaque',
    quantity: 1,
    status: 'NEED_PRODUCTION',
    groupId: 'scale-group-1',
    groupType: 'SCALE',
  };

  const order = {
    _id: orderId,
    shopId,
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'AMAZON_US',
    externalOrderId: '111-7980434-4279402',
    externalAccountId: 'SELLER-01',
    assignedStaffId: '660000000000000000000904',
    addressValidationStatus: 'VALID',
    status: 'PROCESSING',
  };

  const plan = {
    id: '660000000000000000000701',
    orderId,
    orderItemId,
    status: 'READY',
    listing: { id: '660000000000000000000501', sku: 'SKU-1' },
    internalTemplate: { id: '660000000000000000000601', code: 'TS1S' },
    vendorProduct: { id: '660000000000000000000801', code: 'VP1' },
    vendorCostCenter: { id: '660000000000000000000802', code: 'CC1' },
  };

  const listing = {
    id: '660000000000000000000501',
    psdTemplateAssetId: mediaAssetId,
    internalTemplateId: '660000000000000000000601',
  };

  const template = {
    id: '660000000000000000000601',
    artworkSlots: [{ key: 'FRONT', label: 'Front', required: true }],
    designAssets: [],
  };

  const customization = {
    listingPreviewImageUrl: 'https://m.media-amazon.com/images/S/main-listing.png',
    imageAssets: [{ assetId: mediaAssetId, secureUrl: 'https://example.test/image.png' }],
  };

  beforeEach(() => {
    jest.resetAllMocks();
    notificationPublic.notify.mockResolvedValue({ delivered: true, id: 'notification-1' });
    workScorePublic.recordProductionScaleScores.mockResolvedValue([]);
    mockSession.withTransaction.mockImplementation(async (work) => work());
    require('mongoose').startSession.mockResolvedValue(mockSession);
    orderPublic.findById.mockResolvedValue(order);
    orderPublic.findItemById.mockResolvedValue(item);
    orderPublic.transitionItemStatus.mockResolvedValue({});
    orderPublic.appendTimeline.mockResolvedValue({});
    shopPublic.findById.mockResolvedValue({ _id: shopId, name: 'LNG Main Shop' });
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue(plan);
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue(plan);
    catalogPublic.getListingById.mockResolvedValue(listing);
    catalogPublic.getListingVariantById.mockResolvedValue({ scaleDifficulty: { level: 'NORMAL' } });
    catalogPublic.getInternalTemplateById.mockResolvedValue(template);
    customizationPublic.getOrderItemCustomizationView.mockResolvedValue(customization);
    customizationPublic.listOrderItemCustomizationViews.mockResolvedValue([]);
    mediaPublic.assertMediaAssetExists.mockResolvedValue({ id: outputAssetId });
    mediaPublic.getStorageProvider.mockReturnValue('cloudinary');
    mediaPublic.storeAsset.mockResolvedValue({ id: outputAssetId });
    repository.updateScaledOutputIfMutable.mockImplementation(async (_taskId, patch) => patch);
    repository.appendFileCheckIfMutable.mockImplementation(async (_taskId, fileCheck) => ({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{ _id: fileCheckId, ...fileCheck }],
    }));
    repository.updateFileCheckOutputIfMutable.mockImplementation(async (_taskId, _fileCheckId, _expected, patch) => ({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{ _id: fileCheckId, ...patch }],
    }));
    hrPublic.listAssignableProfiles.mockResolvedValue([
      { accountId: designerId, fullName: 'Scale User', employeeCode: 'J2605' },
      { accountId: qcUserId, fullName: 'QC User', employeeCode: 'J2510' },
    ]);
    hrPublic.listEmployeeProfilesByAccountIds.mockResolvedValue([
      { accountId: '660000000000000000000904', fullName: 'Order Owner', employeeCode: 'CS01' },
      { accountId: csAssigneeId, fullName: 'CS User', employeeCode: 'CS02' },
      { accountId: qcUserId, fullName: 'QC User', employeeCode: 'QC01' },
    ]);
    hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValue([
      { employeeCode: 'J2605', fullName: 'Seller User' },
    ]);
    organizationPublic.listAccountOrganizationSummaries.mockImplementation(async (accountIds = []) => (
      accountIds.map((accountId) => ({
        accountId,
        team: String(accountId) === designerId
          ? { id: '660000000000000000000102', code: 'DES', name: 'Design Team' }
          : { id: '660000000000000000000103', code: 'QC', name: 'QC Team' },
      }))
    ));
    organizationPublic.listTeamMembers.mockResolvedValue({
      leaders: [{ accountId: qcUserId }],
      members: [{ accountId: designerId }],
    });
    authPublic.listTeamScopedAccountIds.mockResolvedValue([qcUserId, designerId]);
    authPublic.hasTeamQueueScope.mockReturnValue(false);
    vendorSubmissionPublic.createAndSubmitFromProductionTask.mockResolvedValue({
      id: vendorSubmissionId,
      status: 'READY',
    });
    vendorSubmissionPublic.cancel.mockResolvedValue({
      id: vendorSubmissionId,
      status: 'CANCELLED',
    });
    vendorSubmissionPublic.getByProductionTaskId.mockResolvedValue(null);
    vendorSubmissionPublic.getById.mockResolvedValue({
      id: vendorSubmissionId,
      productionTaskId: taskId,
      status: 'SUBMITTED',
    });
    vendorSubmissionPublic.listLatestByProductionTaskIds.mockResolvedValue([]);
    designPublic.createPsdTemplateTaskFromListing.mockResolvedValue({
      id: '660000000000000000129002',
      status: 'OPEN',
    });
    repository.findByOrderItem.mockResolvedValue(null);
    repository.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });
    repository.listPsdBlockedByListingId.mockResolvedValue([]);
    repository.summarize.mockResolvedValue({
      total: 0,
      unassigned: 0,
      assigned: 0,
      blocked: 0,
      needScale: 0,
      qcPending: 0,
      readyToSendVendor: 0,
    });
    repository.upsertByOrderItem.mockImplementation(async (_orderItemId, payload) => ({
      _id: taskId,
      ...payload,
      fileChecks: payload.fileChecks.map((check, index) => ({
        _id: index === 0 ? '660000000000000000100003' : fileCheckId,
        ...check,
      })),
    }));
    repository.upsertByOrderItemWithResult.mockImplementation(async (id, payload, options = {}) => ({
      task: await repository.upsertByOrderItem(id, { ...options.setOnInsert, ...payload }),
      created: true,
    }));
    repository.updateByIdIf.mockImplementation(async (id, _filter, patch) => (
      repository.updateById(id, patch)
    ));
    authPublic.canAccessScope.mockImplementation((authContext = {}, permission, scope = {}) => (
      (authContext.scopes || []).some((grantedScope) => (
        grantedScope.scopeType === scope.scopeType
        && String(grantedScope.scopeId) === String(scope.scopeId)
        && (grantedScope.permissions || []).includes(permission)
      ))
    ));
  });

  function mockTaskUpdate(task) {
    repository.findById.mockResolvedValueOnce(task);
    const update = async (_taskId, patch) => ({
      _id: taskId,
      shopId,
      orderItemId,
      ...task,
      ...patch,
    });
    repository.updateById.mockImplementation(update);
    repository.updateByIdIf.mockImplementation(async (id, filter, patch) => ({
      ...await repository.updateById(id, patch),
      ...(filter.fileChecks && !patch.fileChecks ? { fileChecks: filter.fileChecks } : {}),
    }));
    repository.updateScaledOutputIfMutable.mockImplementation(update);
    repository.appendFileCheckIfMutable.mockImplementation(async (_taskId, fileCheck) => ({
      ...task,
      fileChecks: [...(task.fileChecks || []), { _id: fileCheckId, ...fileCheck }],
    }));
    repository.updateFileCheckOutputIfMutable.mockImplementation(async (_taskId, targetId, _expected, patch) => ({
      ...task,
      fileChecks: (task.fileChecks || []).map((check) => (
        String(check._id) === String(targetId) ? { ...check, ...patch } : check
      )),
    }));
  }

  test('blocks task creation when fulfillment plan is missing or not ready', async () => {
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce(null);

    await expect(service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
  });

  test('allows mapping override before task is sent to vendor', async () => {
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: taskId,
      orderItemId,
      shopId,
      status: 'READY_TO_SEND_VENDOR',
    });

    const result = await service.prepareForMappingOverride(orderItemId, {
      permissions: ['PRODUCTION:WRITE'],
    });

    expect(result).toMatchObject({
      allowed: true,
      productionTaskId: taskId,
      productionStatus: 'READY_TO_SEND_VENDOR',
    });
    expect(vendorSubmissionPublic.cancel).not.toHaveBeenCalled();
  });

  test('cancels unsubmitted vendor submission before mapping override', async () => {
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: taskId,
      orderItemId,
      shopId,
      status: 'READY_TO_SEND_VENDOR',
      vendorSubmissionId,
      sentToVendorAt: new Date('2026-07-17T00:00:00.000Z'),
    });
    vendorSubmissionPublic.getByProductionTaskId.mockResolvedValueOnce({
      id: vendorSubmissionId,
      status: 'READY',
    });

    const result = await service.prepareForMappingOverride(orderItemId, {
      permissions: ['PRODUCTION:WRITE'],
      accountId: '660000000000000000000904',
    });

    expect(result).toMatchObject({
      allowed: true,
      cancelledVendorSubmissionId: vendorSubmissionId,
    });
    expect(vendorSubmissionPublic.cancel).toHaveBeenCalledWith(vendorSubmissionId, {
      cancelReason: 'Cancelled before manual vendor rematch',
    }, expect.objectContaining({
      system: true,
      source: 'MAPPING_OVERRIDE',
    }));
    expect(repository.updateById).toHaveBeenCalledWith(taskId, {
      vendorSubmissionId: null,
      sentToVendorAt: null,
    });
  });

  test('clears stale vendor submission pointer before mapping override even without an active submission', async () => {
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: taskId,
      orderItemId,
      shopId,
      status: 'READY_TO_SEND_VENDOR',
      vendorSubmissionId,
      sentToVendorAt: new Date('2026-07-17T00:00:00.000Z'),
    });
    vendorSubmissionPublic.getByProductionTaskId.mockResolvedValueOnce(null);

    const result = await service.prepareForMappingOverride(orderItemId, {
      permissions: ['PRODUCTION:WRITE'],
    });

    expect(result).toMatchObject({
      allowed: true,
      cancelledVendorSubmissionId: null,
    });
    expect(vendorSubmissionPublic.cancel).not.toHaveBeenCalled();
    expect(repository.updateById).toHaveBeenCalledWith(taskId, {
      vendorSubmissionId: null,
      sentToVendorAt: null,
    });
  });

  test('blocks mapping override after task is sent to vendor', async () => {
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: taskId,
      orderItemId,
      shopId,
      status: 'SENT_TO_VENDOR',
    });

    await expect(service.prepareForMappingOverride(orderItemId, {
      permissions: ['PRODUCTION:WRITE'],
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
      details: { status: 'SENT_TO_VENDOR' },
    });
  });

  test('blocks mapping override after vendor submission is submitted', async () => {
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: taskId,
      orderItemId,
      shopId,
      status: 'READY_TO_SEND_VENDOR',
    });
    vendorSubmissionPublic.getByProductionTaskId.mockResolvedValueOnce({
      id: vendorSubmissionId,
      status: 'SUBMITTED',
    });

    await expect(service.prepareForMappingOverride(orderItemId, {
      permissions: ['PRODUCTION:WRITE'],
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
      details: { vendorSubmissionStatus: 'SUBMITTED' },
    });
  });

  test('blocks task creation when fulfillment plan exists but is not READY', async () => {
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce({ ...plan, status: 'BLOCKED' });

    await expect(service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] }))
      .rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT_ERROR',
        details: { blockingReasons: ['MAPPING_NOT_READY'] },
      });
    expect(repository.upsertByOrderItem).not.toHaveBeenCalled();
  });

  test('creates task from ready fulfillment plan and required template slots', async () => {
    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      orderId,
      shopId,
      orderItemId,
      fulfillmentPlanId: plan.id,
      status: 'NEED_SCALE',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
      blockers: ['SCALED_OUTPUT_MISSING'],
      assignedDesignUserId: null,
      assignedAt: null,
      designNote: null,
      csNote: item.csNote,
      orderItemSnapshot: expect.objectContaining({
        externalOrderId: item.externalOrderId,
        externalItemId: item.externalItemId,
        externalAccountId: item.externalAccountId,
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        asin: item.asin,
        sku: item.sku,
        title: item.title,
        productImageUrl: 'https://m.media-amazon.com/images/S/main-listing.png',
      }),
      orderSnapshot: expect.objectContaining({
        id: orderId,
        status: 'PROCESSING',
        assignedStaffId: '660000000000000000000904',
      }),
      customizationSnapshot: expect.objectContaining({
        status: customization.status || null,
        listingPreviewImageUrl: customization.listingPreviewImageUrl,
        imageAssets: [expect.objectContaining({ assetId: mediaAssetId })],
      }),
    }));
    expect(repository.upsertByOrderItem.mock.calls[0][1]).toMatchObject({
      vendorProductSnapshot: expect.objectContaining({
        id: plan.vendorProduct.id,
        code: 'VP1',
      }),
      vendorCostCenterSnapshot: expect.objectContaining({
        id: plan.vendorCostCenter.id,
        code: 'CC1',
      }),
    });
    expect(result.orderItem).toMatchObject({
      externalOrderId: item.externalOrderId,
      salesChannelCode: 'AMAZON',
      sku: item.sku,
      asin: item.asin,
      title: item.title,
    });
    expect(result).toMatchObject({
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      orderStatus: 'PROCESSING',
      orderOwner: { id: '660000000000000000000904', fullName: 'Order Owner', employeeCode: 'CS01' },
      seller: { employeeCode: 'J2605', name: 'Seller User' },
    });
    expect(result.customization).toMatchObject({
      imageAssets: [expect.objectContaining({
        assetId: mediaAssetId,
        assetDownloadUrl: `/api/media/assets/${mediaAssetId}/download`,
      })],
    });
    expect(result.fileChecks).toHaveLength(2);
    expect(orderPublic.updateOrderWorkbenchItem).toHaveBeenCalledWith(
      orderId,
      orderItemId,
      { production: expect.objectContaining({ productionStatus: 'NEED_SCALE' }) },
      expect.objectContaining({ source: 'PRODUCTION' }),
    );
    expect(result.fileChecks[0]).toMatchObject({
      slotKey: 'PSD_TEMPLATE',
      sourceType: 'PSD_TEMPLATE',
      inputAssetId: listing.psdTemplateAssetId,
      outputAssetId: null,
      scaleStatus: 'NOT_REQUIRED',
      blockers: [],
    });
    expect(result.fileChecks[1]).toMatchObject({
      slotKey: 'FRONT',
      sourceType: 'CUSTOMER_IMAGE',
      inputAssetId: mediaAssetId,
      scaleStatus: 'NEED_SCALE',
      blockers: ['SCALED_OUTPUT_MISSING'],
    });
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(
      orderItemId, 'NEED_PRODUCTION', expect.objectContaining({ source: 'PRODUCTION' }),
    );
  });

  test('creates task from the listing variant stored on the fulfillment plan', async () => {
    const variantAssetId = '660000000000000000129004';
    const variantTemplateId = '660000000000000000129005';
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce({
      ...plan,
      listingVariantId,
    });
    catalogPublic.getListingVariantById.mockResolvedValueOnce({
      id: listingVariantId,
      listingId: listing.id,
      productTypeGroup: { id: '660000000000000000129006' },
      internalTemplate: { id: variantTemplateId },
      psdTemplateAssetId: variantAssetId,
      previewAssetId: null,
      psdReadiness: {
        required: true,
        status: 'PRESENT',
        effectivePsdAssetId: variantAssetId,
        source: 'LISTING_VARIANT',
      },
    });
    catalogPublic.getInternalTemplateById.mockResolvedValueOnce({
      ...template,
      id: variantTemplateId,
    });

    const result = await service.createOrRecheckTaskForOrderItem(
      orderItemId,
      { permissions: ['PRODUCTION:WRITE'] },
    );

    expect(catalogPublic.getListingVariantById).toHaveBeenCalledWith(listingVariantId);
    expect(catalogPublic.getInternalTemplateById).toHaveBeenCalledWith(variantTemplateId);
    expect(result.fileChecks[0]).toMatchObject({
      slotKey: 'PSD_TEMPLATE',
      inputAssetId: variantAssetId,
      blockers: [],
    });
    expect(result.listingVariantId).toBe(listingVariantId);
  });

  test('uses listing default PSD when fulfillment plan has no listing variant', async () => {
    const defaultPsdAssetId = '660000000000000000129004';
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce({
      ...plan,
      listingVariantId: null,
    });
    catalogPublic.getListingById.mockResolvedValueOnce({
      ...listing,
      psdTemplateAssetId: null,
      defaultPsdTemplateAssetId: defaultPsdAssetId,
    });

    const result = await service.createOrRecheckTaskForOrderItem(
      orderItemId,
      { permissions: ['PRODUCTION:WRITE'] },
    );

    expect(catalogPublic.getListingVariantById).not.toHaveBeenCalled();
    expect(result.fileChecks[0]).toMatchObject({
      slotKey: 'PSD_TEMPLATE',
      inputAssetId: defaultPsdAssetId,
      blockers: [],
    });
  });

  test('blocks for missing variant PSD without auto-creating a design task', async () => {
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce({ ...plan, listingVariantId });
    catalogPublic.getListingVariantById.mockResolvedValueOnce({
      id: listingVariantId,
      listingId: listing.id,
      productTypeGroup: { id: '660000000000000000129006' },
      internalTemplate: { id: template.id },
      psdTemplateAssetId: null,
      psdReadiness: { required: true, status: 'MISSING', effectivePsdAssetId: null },
    });

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toContain('PSD_MISSING');
    expect(designPublic.createPsdTemplateTaskFromListingVariant).not.toHaveBeenCalled();
    expect(designPublic.createPsdTemplateTaskFromListing).not.toHaveBeenCalled();
  });

  test('blocks scale while the order has an open case', async () => {
    orderPublic.findById.mockResolvedValueOnce({ ...order, caseStatus: 'OPEN' });

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toContain('OPEN_CASE');
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(
      orderItemId,
      'NEED_PRODUCTION',
      expect.objectContaining({ source: 'PRODUCTION' }),
    );
  });

  test('does not block production when variant has PSD but no internal template', async () => {
    const variantAssetId = '660000000000000000129004';
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce({
      ...plan,
      listingVariantId,
      internalTemplate: null,
    });
    catalogPublic.getListingVariantById.mockResolvedValueOnce({
      id: listingVariantId,
      listingId: listing.id,
      productTypeGroup: { id: '660000000000000000129006' },
      internalTemplate: null,
      psdTemplateAssetId: variantAssetId,
      psdReadiness: {
        required: true,
        status: 'PRESENT',
        effectivePsdAssetId: variantAssetId,
        source: 'LISTING_VARIANT',
      },
    });

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(catalogPublic.getInternalTemplateById).not.toHaveBeenCalled();
    expect(result.blockers || []).not.toContain('TEMPLATE_NOT_FOUND');
    expect(result.fileChecks[0]).toMatchObject({
      slotKey: 'PSD_TEMPLATE',
      inputAssetId: variantAssetId,
      blockers: [],
    });
  });

  test('does not fall back to legacy listing when the planned variant is missing', async () => {
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce({ ...plan, listingVariantId });
    catalogPublic.getListingVariantById.mockResolvedValueOnce(null);

    await expect(service.createOrRecheckTaskForOrderItem(
      orderItemId,
      { permissions: ['PRODUCTION:WRITE'] },
    )).rejects.toMatchObject({
      statusCode: 409,
      details: { blockingReasons: ['LISTING_VARIANT_NOT_FOUND'] },
    });
    expect(repository.upsertByOrderItemWithResult).not.toHaveBeenCalled();
  });

  test('recheck preserves an existing scaled output for the same slot and input asset', async () => {
    const existing = {
      _id: taskId,
      orderItemId,
      shopId,
      fileChecks: [
        {
          _id: '660000000000000000100003',
          slotKey: 'PSD_TEMPLATE',
          sourceType: 'PSD_TEMPLATE',
          inputAssetId: mediaAssetId,
          outputAssetId: null,
          scaleStatus: 'NOT_REQUIRED',
          qcStatus: 'NOT_READY',
          blockers: [],
        },
        {
          _id: fileCheckId,
          slotKey: 'FRONT',
          sourceType: 'CUSTOMER_IMAGE',
          inputAssetId: mediaAssetId,
          outputAssetId,
          scaleStatus: 'SCALED',
          qcStatus: 'NOT_READY',
          blockers: [],
        },
      ],
    };
    repository.findByOrderItem.mockResolvedValueOnce(existing);
    repository.updateByIdIf.mockImplementationOnce(async (_id, _filter, patch) => ({ ...existing, ...patch }));

    await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    const fileChecks = repository.updateByIdIf.mock.calls[0][2].fileChecks;
    expect(fileChecks.find((check) => check.slotKey === 'FRONT')).toMatchObject({
      inputAssetId: mediaAssetId,
      outputAssetId,
      scaleStatus: 'SCALED',
      qcStatus: 'NOT_READY',
    });
  });

  test('syncs an order item CS note to an existing production task', async () => {
    const task = { _id: taskId, orderItemId, shopId, csNote: null };
    repository.findByOrderItem.mockResolvedValue(task);
    repository.updateById.mockResolvedValue({ ...task, csNote: 'Confirm artwork before scale' });

    const result = await service.syncCsNoteFromOrderItem(
      orderItemId,
      'Confirm artwork before scale',
      { accountId: '660000000000000000000999' },
    );

    expect(repository.updateById).toHaveBeenCalledWith(taskId, {
      csNote: 'Confirm artwork before scale',
    });
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      orderItemId,
      eventType: 'PRODUCTION_CS_NOTE_SYNCED',
    }));
    expect(result.csNote).toBe('Confirm artwork before scale');
  });

  test('matches customer images to artwork slots by slotKey before index fallback', async () => {
    const backAssetId = '660000000000000000000905';
    catalogPublic.getInternalTemplateById.mockResolvedValueOnce({
      ...template,
      artworkSlots: [
        { key: 'FRONT', label: 'Front', required: true },
        { key: 'BACK', label: 'Back', required: true },
      ],
    });
    customizationPublic.getOrderItemCustomizationView.mockResolvedValueOnce({
      imageAssets: [
        { assetId: backAssetId, filename: 'back.png', slotKey: 'BACK', label: 'Back upload' },
        { assetId: mediaAssetId, filename: 'front.png', slotKey: 'FRONT', label: 'Front upload' },
      ],
    });

    await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    const fileChecks = repository.upsertByOrderItem.mock.calls[0][1].fileChecks;
    expect(fileChecks.find((check) => check.slotKey === 'FRONT')).toMatchObject({
      inputAssetId: mediaAssetId,
      inputSourceLabel: 'Front upload',
      inputSlotKey: 'FRONT',
      inputImageName: 'front.png',
    });
    expect(fileChecks.find((check) => check.slotKey === 'BACK')).toMatchObject({
      inputAssetId: backAssetId,
      inputSourceLabel: 'Back upload',
      inputSlotKey: 'BACK',
      inputImageName: 'back.png',
    });
  });

  test('stores slim production snapshots instead of raw source documents', async () => {
    catalogPublic.getListingById.mockResolvedValueOnce({
      ...listing,
      title: 'Listing title',
      approvedBy: '660000000000000000000901',
      approvedAt: new Date('2026-07-01T00:00:00.000Z'),
      rejectionReason: 'noise',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      __v: 3,
    });
    catalogPublic.getListingVariantById.mockResolvedValueOnce({
      id: listingVariantId,
      listingId: listing.id,
      productTypeGroup: { id: '660000000000000000003001', code: 'SHIRT', name: 'Shirt' },
      internalTemplate: { id: template.id, code: 'TS1S', name: 'Template' },
      previewAssetId: '660000000000000000000904',
      previewAsset: { secureUrl: 'https://res.cloudinary.com/demo/image/upload/listing-preview.jpg' },
      psdTemplateAssetId: mediaAssetId,
      psdReadiness: { required: true, status: 'PRESENT' },
    });
    catalogPublic.getInternalTemplateById.mockResolvedValueOnce({
      ...template,
      code: 'TS1S',
      name: 'Template',
      productTypeGroupId: { _id: '660000000000000000003001', code: 'SHIRT', name: 'Shirt', status: 'ACTIVE', raw: 'noise' },
      description: 'noise',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      __v: 9,
    });
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce({
      ...plan,
      listingVariantId,
      internalTemplate: null,
      vendorProduct: {
        id: plan.vendorProduct.id,
        code: 'VP1',
        name: 'Vendor Product',
        vendor: { _id: '660000000000000000004001', code: 'VENDOR', name: 'Vendor', status: 'ACTIVE', secret: 'noise' },
        matchScore: 100,
      },
      vendorCostCenter: {
        id: plan.vendorCostCenter.id,
        vendorProductId: plan.vendorProduct.id,
        code: 'CC1',
        name: 'Cost Center',
        sku: 'UT-1717',
        baseCostAmount: 100,
        currency: 'USD',
        matchReasons: ['noise'],
        routingSpecificity: 9,
      },
    });
    customizationPublic.getOrderItemCustomizationView.mockResolvedValueOnce({
      imageAssets: [{ assetId: mediaAssetId, secureUrl: 'https://example.test/image.png', sha256: 'noise' }],
    });

    await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(catalogPublic.getInternalTemplateById).toHaveBeenCalledWith(template.id);
    const payload = repository.upsertByOrderItem.mock.calls[0][1];
    expect(payload.listingSnapshot).toMatchObject({
      id: listing.id,
      title: 'Listing title',
    });
    expect(payload.listingSnapshot).not.toHaveProperty('productTypeGroupId');
    expect(payload.listingSnapshot).not.toHaveProperty('previewAsset');
    expect(payload.listingSnapshot).not.toHaveProperty('shopId');
    expect(payload.listingSnapshot).not.toHaveProperty('costCenterStatus');
    expect(payload.templateSnapshot).toMatchObject({
      id: template.id,
      code: 'TS1S',
      artworkSlots: template.artworkSlots,
    });
    expect(payload.vendorProductSnapshot).toMatchObject({
      id: plan.vendorProduct.id,
      code: 'VP1',
      name: 'Vendor Product',
      vendor: { id: '660000000000000000004001', code: 'VENDOR', name: 'Vendor' },
    });
    expect(payload.vendorProductSnapshot).not.toHaveProperty('matchScore');
    expect(payload.vendorCostCenterSnapshot).toMatchObject({
      id: plan.vendorCostCenter.id,
      vendorProductId: plan.vendorProduct.id,
      code: 'CC1',
      name: 'Cost Center',
      sku: 'UT-1717',
      baseCostAmount: 100,
      currency: 'USD',
    });
    expect(payload.vendorCostCenterSnapshot).not.toHaveProperty('matchReasons');
    expect(payload.orderSnapshot).toMatchObject({
      id: orderId,
      status: 'PROCESSING',
      assignedStaffId: '660000000000000000000904',
    });
    expect(payload.customizationSnapshot.imageAssets[0]).toMatchObject({
      assetId: mediaAssetId,
    });
    expect(payload.listingSnapshot).not.toHaveProperty('__v');
    expect(payload.listingSnapshot).not.toHaveProperty('approvedBy');
    expect(payload.listingSnapshot).not.toHaveProperty('previewAsset');
    expect(payload.templateSnapshot).not.toHaveProperty('__v');
    expect(payload.customizationSnapshot.imageAssets[0]).not.toHaveProperty('secureUrl');
    expect(payload.customizationSnapshot.imageAssets[0]).not.toHaveProperty('sha256');
  });

  test('blocks with PSD_MISSING when listing and template do not provide PSD asset', async () => {
    catalogPublic.getListingById.mockResolvedValueOnce({ ...listing, psdTemplateAssetId: null });
    catalogPublic.getInternalTemplateById.mockResolvedValueOnce({ ...template, designAssets: [] });

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toEqual(expect.arrayContaining(['PSD_MISSING']));
    expect(result.fileChecks[0]).toMatchObject({
      slotKey: 'PSD_TEMPLATE',
      inputAssetId: null,
      blockers: ['PSD_MISSING'],
    });
    expect(designPublic.createPsdTemplateTaskFromListing).not.toHaveBeenCalled();
  });

  test('does not auto-create PSD task when PSD is present', async () => {
    await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(designPublic.createPsdTemplateTaskFromListing).not.toHaveBeenCalled();
  });

  test('does not depend on Design availability when PSD is missing', async () => {
    catalogPublic.getListingById.mockResolvedValueOnce({ ...listing, psdTemplateAssetId: null });
    catalogPublic.getInternalTemplateById.mockResolvedValueOnce({ ...template, designAssets: [] });
    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toEqual(expect.arrayContaining(['PSD_MISSING']));
    expect(designPublic.createPsdTemplateTaskFromListing).not.toHaveBeenCalled();
  });

  test('uploads scaled output file through media and attaches returned asset', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempPath = path.join(os.tmpdir(), `scaled-output-${Date.now()}.png`);
    fs.writeFileSync(tempPath, 'scaled');
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{
        _id: fileCheckId,
        blockers: ['SCALED_OUTPUT_MISSING'],
        scaleStatus: 'NEED_SCALE',
        qcStatus: 'NOT_READY',
      }],
    });

    const result = await service.uploadScaledOutputFile(taskId, fileCheckId, {
      path: tempPath,
      originalname: 'scaled.png',
      mimetype: 'image/png',
      size: 6,
    }, { permissions: ['PRODUCTION:WRITE'], accountId: designerId });

    expect(mediaPublic.storeAsset).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'scaled.png',
      mimeType: 'image/png',
      shopId,
      ownerType: 'PRODUCTION_TASK',
      ownerId: taskId,
      metadata: expect.objectContaining({
        source: 'PRODUCTION_SCALED_OUTPUT',
        taskId,
        fileCheckId,
        uploadedBy: designerId,
      }),
    }));
    expect(mediaPublic.assertMediaAssetExists).toHaveBeenCalledWith(outputAssetId);
    expect(result.fileChecks[0].outputAssetId).toBe(outputAssetId);
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  test('rejects scaled output file when storage provider is not Cloudinary', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempPath = path.join(os.tmpdir(), `scaled-output-local-${Date.now()}.png`);
    fs.writeFileSync(tempPath, 'scaled');
    mediaPublic.getStorageProvider.mockReturnValue('local');

    await expect(service.uploadScaledOutputFile(taskId, fileCheckId, {
      path: tempPath,
      originalname: 'scaled.png',
      mimetype: 'image/png',
      size: 6,
    }, { permissions: ['PRODUCTION:WRITE'], accountId: designerId })).rejects.toMatchObject({
      code: errorCodes.CONFLICT_ERROR,
      details: {
        currentProvider: 'local',
        requiredProvider: 'cloudinary',
      },
    });

    expect(mediaPublic.storeAsset).not.toHaveBeenCalled();
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  test('adds manual file check for scale work', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [],
    });

    const result = await service.addManualFileCheck(taskId, {
      slotKey: 'front',
      slotLabel: 'Front',
      sourceType: 'CUSTOMER_IMAGE',
      inputAssetId: mediaAssetId,
    }, { permissions: ['PRODUCTION:WRITE'] });

    expect(mediaPublic.assertMediaAssetExists).toHaveBeenCalledWith(mediaAssetId);
    expect(repository.appendFileCheckIfMutable).toHaveBeenCalledWith(taskId, expect.objectContaining({
        slotKey: 'FRONT',
        slotLabel: 'Front',
        sourceType: 'CUSTOMER_IMAGE',
        inputAssetId: mediaAssetId,
        outputAssetId: null,
        scaleStatus: 'NEED_SCALE',
        qcStatus: 'NOT_READY',
        blockers: ['SCALED_OUTPUT_MISSING'],
    }), { session: mockSession });
    expect(orderPublic.transitionItemStatus).toHaveBeenCalled();
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'PRODUCTION_MANUAL_FILE_CHECK_ADDED',
    }), { session: mockSession });
    expect(result.fileChecks[0].slotKey).toBe('FRONT');
    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PRODUCTION_FILE_CHECK_ADDED',
      entityType: 'PRODUCTION_TASK',
      entityId: taskId,
      scopeType: 'SHOP',
      scopeId: shopId,
      metadata: expect.not.objectContaining({ note: expect.anything() }),
    }), { session: mockSession });
  });

  test('rejects duplicate manual file check slot key', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{ _id: fileCheckId, slotKey: 'FRONT' }],
    });

    await expect(service.addManualFileCheck(taskId, {
      slotKey: 'front',
      inputAssetId: mediaAssetId,
    }, { permissions: ['PRODUCTION:WRITE'] })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('rejects direct scaled output replacement after QC passed without side effects', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'READY_TO_SEND_VENDOR',
      qcStatus: 'PASSED',
      fileChecks: [{
        _id: fileCheckId,
        required: true,
        outputAssetId,
        scaleStatus: 'SCALED',
        qcStatus: 'PASSED',
      }],
    });

    await expect(service.uploadScaledFile(
      taskId,
      fileCheckId,
      mediaAssetId,
      { permissions: ['PRODUCTION:WRITE'] },
    )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });

    expect(mediaPublic.assertMediaAssetExists).not.toHaveBeenCalled();
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
    expect(orderPublic.appendTimeline).not.toHaveBeenCalled();
  });

  test('rejects multipart scaled output after QC passed before storing media', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempPath = path.join(os.tmpdir(), `locked-scaled-output-${Date.now()}.png`);
    fs.writeFileSync(tempPath, 'scaled');
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'READY_TO_SEND_VENDOR',
      qcStatus: 'PASSED',
      fileChecks: [{ _id: fileCheckId, required: true, outputAssetId, qcStatus: 'PASSED' }],
    });

    await expect(service.uploadScaledOutputFile(taskId, fileCheckId, {
      path: tempPath,
      originalname: 'replacement.png',
      mimetype: 'image/png',
      size: 6,
    }, { permissions: ['PRODUCTION:WRITE'], accountId: designerId })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(mediaPublic.storeAsset).not.toHaveBeenCalled();
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
    expect(orderPublic.appendTimeline).not.toHaveBeenCalled();
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  test('rejects manual file check creation after QC passed without side effects', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'READY_TO_SEND_VENDOR',
      qcStatus: 'PASSED',
      fileChecks: [{ _id: fileCheckId, required: true, outputAssetId, qcStatus: 'PASSED' }],
    });

    await expect(service.addManualFileCheck(taskId, {
      slotKey: 'BACK',
      inputAssetId: mediaAssetId,
    }, { permissions: ['PRODUCTION:WRITE'] })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(mediaPublic.assertMediaAssetExists).not.toHaveBeenCalled();
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
    expect(orderPublic.appendTimeline).not.toHaveBeenCalled();
  });

  test('rejects stale manual file check creation when QC passes before its conditional write', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
      fileChecks: [],
    });
    repository.appendFileCheckIfMutable.mockResolvedValueOnce(null);

    await expect(service.addManualFileCheck(taskId, {
      slotKey: 'BACK',
      inputAssetId: mediaAssetId,
    }, { permissions: ['PRODUCTION:WRITE'] })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(repository.appendFileCheckIfMutable).toHaveBeenCalledWith(
      taskId, expect.objectContaining({ slotKey: 'BACK' }), { session: mockSession },
    );
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
    expect(orderPublic.appendTimeline).not.toHaveBeenCalled();
  });

  test('creates manual file check and uploads scaled output in one step', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempPath = path.join(os.tmpdir(), `manual-scaled-output-${Date.now()}.png`);
    fs.writeFileSync(tempPath, 'scaled');
    const createdFileCheckId = '660000000000000000100003';
    const updatedTask = {
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{
        _id: createdFileCheckId,
        slotKey: 'FRONT',
        slotLabel: 'Front',
        sourceType: 'CUSTOMER_IMAGE',
        inputAssetId: null,
        outputAssetId: null,
        scaleStatus: 'NOT_REQUIRED',
        qcStatus: 'NOT_READY',
        blockers: [],
      }],
    };
    repository.findById
      .mockResolvedValueOnce({ _id: taskId, shopId, orderItemId, fileChecks: [] })
      .mockResolvedValueOnce({ _id: taskId, shopId, orderItemId, fileChecks: [] })
      .mockResolvedValueOnce(updatedTask);
    repository.appendFileCheckIfMutable.mockResolvedValueOnce(updatedTask);
    repository.updateFileCheckOutputIfMutable.mockImplementationOnce(async (_taskId, _fileCheckId, _expected, patch) => ({
      ...updatedTask,
      fileChecks: updatedTask.fileChecks.map((check) => ({ ...check, ...patch })),
    }));
    repository.updateByIdIf.mockImplementation(async (_taskId, filter, patch) => ({
      ...updatedTask, fileChecks: filter.fileChecks || updatedTask.fileChecks, ...patch,
    }));

    const result = await service.addManualScaledOutputFile(taskId, {
      slotKey: 'front',
      slotLabel: 'Front',
      sourceType: 'CUSTOMER_IMAGE',
    }, {
      path: tempPath,
      originalname: 'front.png',
      mimetype: 'image/png',
      size: 6,
    }, { permissions: ['PRODUCTION:WRITE'], accountId: designerId });

    expect(mediaPublic.storeAsset).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'front.png',
      metadata: expect.objectContaining({
        source: 'PRODUCTION_SCALED_OUTPUT',
        taskId,
        fileCheckId: createdFileCheckId,
      }),
    }));
    expect(repository.updateFileCheckOutputIfMutable).toHaveBeenCalledWith(
      taskId,
      createdFileCheckId,
      expect.objectContaining({ outputAssetId: null }),
      expect.objectContaining({ outputAssetId, scaleStatus: 'SCALED', qcStatus: 'NOT_READY' }),
      { session: mockSession },
    );
    expect(result).toMatchObject({
      status: 'NEED_SCALE',
      scaleStatus: 'SCALED',
      qcStatus: 'NOT_READY',
    });
    expect(result.fileChecks[0].outputAssetId).toBe(outputAssetId);
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  test('manual scaled output reuses existing slot key', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempPath = path.join(os.tmpdir(), `existing-manual-scaled-output-${Date.now()}.png`);
    fs.writeFileSync(tempPath, 'scaled');
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{
        _id: fileCheckId,
        slotKey: 'FRONT',
        blockers: ['SCALED_OUTPUT_MISSING'],
        scaleStatus: 'NEED_SCALE',
        qcStatus: 'NOT_READY',
      }],
    }).mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{
        _id: fileCheckId,
        slotKey: 'FRONT',
        blockers: ['SCALED_OUTPUT_MISSING'],
        scaleStatus: 'NEED_SCALE',
        qcStatus: 'NOT_READY',
      }],
    });
    repository.updateById.mockImplementationOnce(async (_taskId, patch) => ({
      _id: taskId,
      shopId,
      orderItemId,
      ...patch,
    }));

    await service.addManualScaledOutputFile(taskId, {
      slotKey: 'front',
    }, {
      path: tempPath,
      originalname: 'front.png',
      mimetype: 'image/png',
      size: 6,
    }, { permissions: ['PRODUCTION:WRITE'], accountId: designerId });

    expect(repository.updateFileCheckOutputIfMutable).toHaveBeenCalledTimes(1);
    expect(mediaPublic.storeAsset).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ fileCheckId }),
    }));
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  test('does not block text-only customization when template has a required artwork slot', async () => {
    customizationPublic.getOrderItemCustomizationView.mockResolvedValueOnce({
      customerInputs: {
        texts: [{ label: 'Personalization', value: 'Blacky & Martie 60 1966-2026' }],
        options: [{ label: 'Quantity', value: 'Pack 50pcs' }],
        images: [],
      },
      imageAssets: [],
    });

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.blockers).not.toContain('CUSTOMER_IMAGE_MISSING');
    expect(result.fileChecks[1]).toMatchObject({
      slotKey: 'FRONT',
      inputAssetId: null,
      required: false,
      blockers: [],
    });
  });

  test('blocks with CUSTOMER_IMAGE_MISSING when a required customer image input has no asset', async () => {
    customizationPublic.getOrderItemCustomizationView.mockResolvedValueOnce({
      customerInputs: {
        texts: [],
        options: [],
        images: [{ label: 'Customer Photo', name: 'Customer Photo', value: '1 file' }],
      },
      imageAssets: [],
    });

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toEqual(expect.arrayContaining(['CUSTOMER_IMAGE_MISSING']));
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'PRODUCTION_TASK_CREATED',
      metadata: { blockers: ['CUSTOMER_IMAGE_MISSING'] },
    }), { session: mockSession });
    expect(result.fileChecks[1]).toMatchObject({
      slotKey: 'FRONT',
      inputAssetId: null,
      required: true,
      blockers: ['CUSTOMER_IMAGE_MISSING'],
    });
  });

  test('does not block when fulfillment plan template cannot be loaded', async () => {
    catalogPublic.getInternalTemplateById.mockResolvedValueOnce(null);

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('NEED_SCALE');
    expect(result.blockers || []).not.toContain('TEMPLATE_NOT_FOUND');
  });

  test('refreshes a stale ready fulfillment plan before PSD recheck', async () => {
    const stalePlan = { ...plan, listingVariantId: null };
    const refreshedPlan = { ...plan, listingVariantId };
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce(stalePlan);
    mappingPublic.recheckFulfillmentPlan.mockResolvedValueOnce(refreshedPlan);
    catalogPublic.getListingVariantById.mockResolvedValueOnce({
      id: listingVariantId,
      listingId: plan.listing.id,
      psdTemplateAssetId: mediaAssetId,
      psdReadiness: { status: 'PRESENT', effectivePsdAssetId: mediaAssetId },
      internalTemplate: { id: template.id },
    });

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, {
      permissions: ['PRODUCTION:WRITE'],
      accountId: designerId,
    });

    expect(mappingPublic.recheckFulfillmentPlan).toHaveBeenCalledWith(orderItemId, {}, expect.objectContaining({
      source: 'PRODUCTION_PSD_RECHECK',
      system: true,
    }));
    expect(result.blockers).not.toContain('PSD_MISSING');
    expect(result.fileChecks[0]).toMatchObject({
      slotKey: 'PSD_TEMPLATE',
      inputAssetId: mediaAssetId,
      blockers: [],
    });
  });

  test('multi-slot task creates one file check per required artwork slot', async () => {
    catalogPublic.getInternalTemplateById.mockResolvedValueOnce({
      ...template,
      artworkSlots: [
        { key: 'FRONT', label: 'Front', required: true },
        { key: 'BACK', label: 'Back', required: true },
      ],
    });
    customizationPublic.getOrderItemCustomizationView.mockResolvedValueOnce({
      imageAssets: [{ assetId: mediaAssetId }],
    });

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.fileChecks).toHaveLength(3);
    expect(result.status).toBe('NEED_SCALE');
    expect(result.fileChecks[1]).toMatchObject({ slotKey: 'FRONT', inputAssetId: mediaAssetId });
    expect(result.fileChecks[2]).toMatchObject({ slotKey: 'BACK', inputAssetId: mediaAssetId });
  });

  test('optional artwork slot without customer image does not block task creation', async () => {
    catalogPublic.getInternalTemplateById.mockResolvedValueOnce({
      ...template,
      artworkSlots: [{ key: 'BACK', label: 'Back', required: false }],
    });
    customizationPublic.getOrderItemCustomizationView.mockResolvedValueOnce({ imageAssets: [] });

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('NEED_SCALE');
    expect(result.blockers).not.toContain('CUSTOMER_IMAGE_MISSING');
    expect(result.fileChecks[1]).toMatchObject({
      slotKey: 'BACK',
      required: false,
      inputAssetId: null,
      scaleStatus: 'NOT_REQUIRED',
      blockers: [],
    });
  });

  test('recheck preserves existing design assignment fields', async () => {
    const assignedAt = new Date('2026-07-05T01:00:00.000Z');
    const existing = {
      _id: taskId,
      orderItemId,
      shopId,
      status: 'NEED_SCALE',
      assignedDesignUserId: designerId,
      assignedAt,
      designNote: 'Rush design',
      fileChecks: [],
    };
    repository.findByOrderItem.mockResolvedValueOnce(existing);
    repository.updateByIdIf.mockImplementationOnce(async (_id, _filter, patch) => ({ ...existing, ...patch }));

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    const patch = repository.updateByIdIf.mock.calls[0][2];
    expect(patch).not.toEqual(expect.objectContaining({
      assignedDesignUserId: expect.anything(), designNote: expect.anything(),
    }));
    expect(result).toMatchObject({
      assignedDesignUserId: designerId,
      assignedAt,
      designNote: 'Rush design',
      designAssignmentStatus: 'ASSIGNED',
    });
  });

  test('lists task queue with filters and assignment summary', async () => {
    vendorSubmissionPublic.listLatestByProductionTaskIds.mockResolvedValueOnce([{
      id: vendorSubmissionId,
      productionTaskId: taskId,
      status: 'FAILED',
      failedAt: new Date('2026-07-06T00:00:00.000Z'),
      failureReason: 'Vendor rejected payload',
      updatedAt: new Date('2026-07-06T00:01:00.000Z'),
    }]);
    customizationPublic.listOrderItemCustomizationViews.mockResolvedValueOnce([{
      orderItemId,
      ...customization,
    }]);
    repository.list.mockResolvedValueOnce({
      items: [{
      _id: taskId,
      shopId,
      orderItemId,
      orderItemSnapshot: {
        externalOrderId: item.externalOrderId,
        sku: item.sku,
        asin: item.asin,
        title: item.title,
        productImageUrl: 'https://image.test/listing.png',
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        externalAccountId: 'SELLER-01',
        status: 'NEED_PRODUCTION',
        groupId: 'scale-group-1',
        groupType: 'SCALE',
      },
      orderSnapshot: {
        id: orderId,
        status: 'PROCESSING',
        assignedStaffId: '660000000000000000000904',
        externalAccountId: 'SELLER-01',
        orderedAt: new Date('2026-07-01T10:00:00.000Z'),
        shippingAddress: { name: 'Jane Buyer' },
        shippingService: { level: 'Expedited', name: 'Amazon Expedited' },
      },
      listingSnapshot: plan.listing,
      templateSnapshot: plan.internalTemplate,
      vendorProductSnapshot: plan.vendorProduct,
      vendorCostCenterSnapshot: plan.vendorCostCenter,
      fileChecks: [{
        _id: fileCheckId,
        slotKey: 'FRONT',
        required: true,
        sourceType: 'CUSTOMER_IMAGE',
        inputAssetId: mediaAssetId,
        outputAssetId,
      }],
      status: 'NEED_SCALE',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
      blockers: ['SCALED_OUTPUT_MISSING'],
      assignedDesignUserId: null,
      assignedAt: null,
      designNote: null,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      }],
      total: 1,
      page: 2,
      limit: 10,
    });

    const result = await service.listTasks({
      status: 'NEED_SCALE',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
      salesChannelCode: 'amazon',
      blocker: 'SCALED_OUTPUT_MISSING',
      designAssignmentStatus: 'ASSIGNED',
      search: 'J2605',
      scaleBy: designerId,
      qcBy: '660000000000000000000904',
      csAssigneeId,
      csStatus: 'IN_PROGRESS',
      dateFrom: '2026-07-01T00:00:00.000Z',
      assignedAtFrom: '2026-07-03T00:00:00.000Z',
      readyAtTo: '2026-07-04T00:00:00.000Z',
      sort: '-readyAt,assignedAt',
      shopId,
      sellerCode: 'J2605',
      tab: 'FAILED',
      page: 2,
      limit: 10,
    }, { permissions: ['PRODUCTION:READ'] });

    expect(repository.list).toHaveBeenCalledWith({
      status: 'NEED_SCALE',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
      salesChannelCode: 'AMAZON',
      blocker: 'SCALED_OUTPUT_MISSING',
      designAssignmentStatus: 'ASSIGNED',
      search: 'J2605',
      assignedDesignUserId: designerId,
      qcBy: '660000000000000000000904',
      csAssigneeId,
      csStatus: 'IN_PROGRESS',
      dateFrom: new Date('2026-07-01T00:00:00.000Z'),
      assignedAtFrom: new Date('2026-07-03T00:00:00.000Z'),
      readyAtTo: new Date('2026-07-04T00:00:00.000Z'),
      sort: '-readyAt,assignedAt',
      shopId,
      sellerCode: 'J2605',
      tab: 'FAILED',
      page: 2,
      limit: 10,
    });
    expect(result).toMatchObject({ total: 1, page: 2, limit: 10 });
    expect(customizationPublic.listOrderItemCustomizationViews).toHaveBeenCalledWith([orderItemId], {
      permissions: ['PRODUCTION:READ'],
    });
    expect(result.items[0]).toMatchObject({
      id: taskId,
      orderItem: {
        externalOrderId: item.externalOrderId,
        sku: item.sku,
        asin: item.asin,
        title: item.title,
      },
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      shopId,
      shopName: 'LNG Main Shop',
      shop: { id: shopId, name: 'LNG Main Shop' },
      orderDate: new Date('2026-07-01T10:00:00.000Z'),
      shippingType: 'Expedited',
      fulfillName: 'Jane Buyer',
      productImageUrl: 'https://image.test/listing.png',
      orderStatus: 'PROCESSING',
      orderOwner: { id: '660000000000000000000904', fullName: 'Order Owner', employeeCode: 'CS01' },
      seller: { employeeCode: 'J2605', name: 'Seller User' },
      createdAt: expect.anything(),
      updatedAt: expect.anything(),
      customization: expect.objectContaining({
        imageAssets: [expect.objectContaining({
          assetId: mediaAssetId,
          assetDownloadUrl: `/api/media/assets/${mediaAssetId}/download`,
        })],
      }),
      vendorProduct: plan.vendorProduct,
      vendorCostCenter: plan.vendorCostCenter,
      scaleContext: {
        status: 'OUTPUT_UPLOADED',
        canScale: false,
        use: {
          listing: plan.listing,
          template: plan.internalTemplate,
          scaleSlots: [expect.objectContaining({
            slotKey: 'FRONT',
            inputAssetId: mediaAssetId,
            outputAssetId,
            outputStatus: 'UPLOADED',
          })],
        },
      },
      productionStatus: 'NEED_SCALE',
      assignedDesignUserId: null,
      designAssignmentStatus: 'UNASSIGNED',
      csAssigneeId: null,
      csStatus: 'UNASSIGNED',
      vendorSubmission: {
        id: vendorSubmissionId,
        status: 'FAILED',
        failureReason: 'Vendor rejected payload',
      },
    });
    expect(vendorSubmissionPublic.listLatestByProductionTaskIds).toHaveBeenCalledWith([taskId]);
    expect(result.items[0]).not.toHaveProperty('listing');
    expect(result.items[0]).not.toHaveProperty('internalTemplate');
    expect(result.items[0]).not.toHaveProperty('fileChecks');
  });

  test('shop-scoped production read can list only its shop tasks', async () => {
    repository.list.mockResolvedValueOnce({
      items: [{ _id: taskId, shopId, orderItemId, status: 'NEED_SCALE' }],
      total: 1,
      page: 1,
      limit: 50,
    });

    const result = await service.listTasks({}, scopedShopAuth(csAssigneeId, ['PRODUCTION:READ']));

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      shopIds: [shopId],
    }));
    expect(result.items).toHaveLength(1);
  });

  test('shop-scoped production read gets empty queue outside its shop', async () => {
    const result = await service.listTasks(
      { shopId: otherShopId },
      scopedShopAuth(csAssigneeId, ['PRODUCTION:READ'], shopId),
    );

    expect(repository.list).not.toHaveBeenCalled();
    expect(result).toMatchObject({ items: [], total: 0 });
  });

  test('shop-scoped scale designer can list task queue with DESIGN:WORK', async () => {
    repository.list.mockResolvedValueOnce({
      items: [{ _id: taskId, shopId, orderItemId, status: 'NEED_SCALE' }],
      total: 1,
      page: 1,
      limit: 50,
    });

    await service.listTasks({}, scopedShopAuth(designerId, ['DESIGN:WORK']));

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      shopIds: [shopId],
    }));
  });

  test('team-scoped scale designer lists only own production tasks without shop scope', async () => {
    repository.list.mockResolvedValueOnce({
      items: [{ _id: taskId, shopId, orderItemId, status: 'NEED_SCALE', assignedDesignUserId: designerId }],
      total: 1,
      page: 1,
      limit: 50,
    });

    await service.listTasks({}, scopedTeamAuth(designerId, ['DESIGN:WORK']));

    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      assignedDesignUserId: designerId,
    }));
    expect(repository.list.mock.calls.at(-1)[0]).not.toHaveProperty('shopIds');
    expect(repository.list.mock.calls.at(-1)[0]).not.toHaveProperty('assignedDesignUserIds');
  });

  test('team leader can list team-assigned production tasks without shop scope', async () => {
    authPublic.hasTeamQueueScope.mockReturnValueOnce(true);
    repository.list.mockResolvedValueOnce({
      items: [{ _id: taskId, shopId, orderItemId, status: 'NEED_SCALE', assignedDesignUserId: designerId }],
      total: 1,
      page: 1,
      limit: 50,
    });

    await service.listTasks({}, scopedTeamAuth(qcUserId, ['DESIGN:WORK'], '660000000000000000000102', ['TEAM_LEADER']));

    expect(repository.list).toHaveBeenCalledWith({
      assignedDesignUserIds: [qcUserId, designerId],
      includeUnassignedDesignUser: true,
    });
  });

  test('team-scoped reviewer can read a production task assigned to a team member', async () => {
    authPublic.hasTeamQueueScope.mockReturnValueOnce(true);
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'QC_PENDING',
      assignedDesignUserId: designerId,
    });

    await expect(service.canReadTaskById(taskId, scopedTeamAuth(qcUserId, ['DESIGN:REVIEW'])))
      .resolves.toBe(true);
  });

  test('gets task by id through public-safe service and enforces shop access', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'READY_TO_SEND_VENDOR',
      orderItemSnapshot: item,
      vendorProductSnapshot: plan.vendorProduct,
      vendorCostCenterSnapshot: plan.vendorCostCenter,
    });

    const result = await service.getTaskById(taskId, { permissions: ['PRODUCTION:READ'] });

    expect(repository.findById).toHaveBeenCalledWith(taskId);
    expect(result).toMatchObject({
      id: taskId,
      shopId,
      orderItemId,
      status: 'READY_TO_SEND_VENDOR',
      vendorProduct: plan.vendorProduct,
      vendorCostCenter: plan.vendorCostCenter,
    });
  });

  test('summarizes task queue with the same normalized filters', async () => {
    repository.summarize.mockResolvedValueOnce({
      total: 7,
      unassigned: 2,
      assigned: 5,
      blocked: 1,
      needScale: 3,
      qcPending: 2,
      readyToSendVendor: 1,
      addressInvalid: 1,
      failed: 2,
      byScaleStatus: { NEED_SCALE: 3, SCALED: 4 },
      byQcStatus: { NOT_READY: 3, PENDING: 2, PASSED: 2 },
      byAssignmentStatus: { UNASSIGNED: 2, ASSIGNED: 3, OUTPUT_UPLOADED: 2 },
      csUnassigned: 4,
      csAssigned: 3,
      byCsStatus: { UNASSIGNED: 4, ASSIGNED: 2, DONE: 1 },
      bySalesChannelCode: { AMAZON: 5, ETSY: 2 },
    });

    const result = await service.summarizeTasks({
      status: 'NEED_SCALE',
      salesChannelCode: 'etsy',
      blocker: 'SCALED_OUTPUT_MISSING',
      search: 'J2605',
      csStatus: 'assigned',
      csUnassigned: true,
      shopId,
      sellerCode: 'J2605',
      tab: 'ADDRESS_INVALID',
    }, { permissions: ['PRODUCTION:READ'] });

    expect(repository.summarize).toHaveBeenCalledWith({
      status: 'NEED_SCALE',
      salesChannelCode: 'ETSY',
      blocker: 'SCALED_OUTPUT_MISSING',
      search: 'J2605',
      csStatus: 'ASSIGNED',
      csAssigneeId: null,
      shopId,
      sellerCode: 'J2605',
      tab: 'ADDRESS_INVALID',
    });
    expect(result).toEqual({
      total: 7,
      unassigned: 2,
      assigned: 5,
      blocked: 1,
      needScale: 3,
      qcPending: 2,
      readyToSendVendor: 1,
      addressInvalid: 1,
      failed: 2,
      byScaleStatus: { NEED_SCALE: 3, SCALED: 4 },
      byQcStatus: { NOT_READY: 3, PENDING: 2, PASSED: 2 },
      byAssignmentStatus: { UNASSIGNED: 2, ASSIGNED: 3, OUTPUT_UPLOADED: 2 },
      csUnassigned: 4,
      csAssigned: 3,
      byCsStatus: { UNASSIGNED: 4, ASSIGNED: 2, DONE: 1 },
      bySalesChannelCode: { AMAZON: 5, ETSY: 2 },
    });
  });

  test('getScaleAssignees returns active assignable employee refs', async () => {
    const result = await service.getScaleAssignees({ search: 'J26', limit: 10 }, {
      permissions: ['PRODUCTION:READ'],
    });

    expect(hrPublic.listAssignableProfiles).toHaveBeenCalledWith({
      search: 'J26',
      limit: 10,
      requiredPermission: 'DESIGN:WORK',
    });
    expect(organizationPublic.listAccountOrganizationSummaries).toHaveBeenCalledWith([designerId, qcUserId]);
    expect(result).toEqual({
      items: [{ id: designerId, fullName: 'Scale User', employeeCode: 'J2605' }],
    });
  });

  test('getCsAssignees returns active production-write employee refs', async () => {
    hrPublic.listAssignableProfiles.mockResolvedValueOnce([
      { accountId: designerId, fullName: 'Scale User', employeeCode: 'J2605' },
    ]);
    const result = await service.getCsAssignees({ search: 'CS', limit: 10 }, {
      permissions: ['PRODUCTION:READ'],
    });

    expect(hrPublic.listAssignableProfiles).toHaveBeenCalledWith({
      search: 'CS',
      limit: 10,
      requiredPermission: 'PRODUCTION:WRITE',
    });
    expect(result).toEqual({
      items: [{ id: designerId, fullName: 'Scale User', employeeCode: 'J2605' }],
    });
  });

  test('production public ports reject missing auth unless system context is explicit', async () => {
    repository.listSummariesByOrderItemIds.mockResolvedValueOnce([{
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
    }]);

    await expect(service.listTaskSummariesByOrderItemIds([orderItemId]))
      .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });

    repository.listSummariesByOrderItemIds.mockResolvedValueOnce([{
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
    }]);

    await expect(service.listTaskSummariesByOrderItemIds([orderItemId], { system: true }))
      .resolves.toEqual([expect.objectContaining({ id: taskId, orderItemId })]);
  });

  test('lists compact PSD-blocked tasks by listing for design recheck', async () => {
    repository.listPsdBlockedByListingId.mockResolvedValueOnce([{
      _id: taskId,
      orderItemId,
      shopId,
      blockers: ['PSD_MISSING'],
      orderItemSnapshot: { externalOrderId: item.externalOrderId },
      listingSnapshot: { id: listing.id },
    }]);

    const result = await service.listPsdBlockedTasksByListing(listing.id);

    expect(repository.listPsdBlockedByListingId).toHaveBeenCalledWith(listing.id);
    expect(result).toEqual([{
      id: taskId,
      orderItemId,
      externalOrderId: item.externalOrderId,
      listingId: listing.id,
      productImageUrl: null,
      shopId,
      blockers: ['PSD_MISSING'],
    }]);
  });

  test('lists PSD-blocked tasks by external order id for design filters', async () => {
    repository.listPsdBlockedByExternalOrderId.mockResolvedValueOnce([{
      _id: taskId,
      orderItemId,
      shopId,
      blockers: ['PSD_MISSING'],
      orderItemSnapshot: { externalOrderId: item.externalOrderId },
      listingSnapshot: { id: listing.id },
    }]);

    const result = await service.listPsdBlockedTasksByExternalOrderId(item.externalOrderId);

    expect(repository.listPsdBlockedByExternalOrderId).toHaveBeenCalledWith(item.externalOrderId);
    expect(result).toEqual([{
      id: taskId,
      orderItemId,
      externalOrderId: item.externalOrderId,
      listingId: listing.id,
      productImageUrl: null,
      shopId,
      blockers: ['PSD_MISSING'],
    }]);
  });

  test('rechecks PSD-blocked tasks by listing only', async () => {
    repository.listPsdBlockedByListingId.mockResolvedValueOnce([{
      _id: taskId,
      orderItemId,
      shopId,
      blockers: ['PSD_MISSING'],
      listingSnapshot: { id: listing.id },
    }]);

    const result = await service.recheckPsdBlockedTasksByListing(listing.id, {
      permissions: ['PRODUCTION:WRITE'],
    });

    expect(repository.listPsdBlockedByListingId).toHaveBeenCalledWith(listing.id);
    expect(result).toMatchObject({
      checked: 1,
      cleared: 1,
      stillBlocked: 0,
      failed: 0,
    });
    expect(result.items[0]).toMatchObject({
      taskId,
      orderItemId,
      status: 'CLEARED',
    });
  });

  test('recheck PSD-blocked tasks by listing reports per-task failures', async () => {
    repository.listPsdBlockedByListingId.mockResolvedValueOnce([{
      _id: taskId,
      orderItemId,
      shopId,
      blockers: ['PSD_MISSING'],
      listingSnapshot: { id: listing.id },
    }]);
    mappingPublic.getFulfillmentPlanForOrderItem.mockRejectedValueOnce(new Error('mapping down'));

    const result = await service.recheckPsdBlockedTasksByListing(listing.id, {
      permissions: ['PRODUCTION:WRITE'],
    });

    expect(result).toMatchObject({
      checked: 1,
      cleared: 0,
      stillBlocked: 0,
      failed: 1,
    });
    expect(result.items[0]).toMatchObject({
      taskId,
      orderItemId,
      status: 'FAILED',
      message: 'mapping down',
    });
  });

  test('rechecks PSD-blocked tasks and reports cleared blockers', async () => {
    repository.list.mockResolvedValueOnce({
      items: [{
        _id: taskId,
        shopId,
        orderItemId,
        blockers: ['PSD_MISSING'],
      }],
      total: 1,
      page: 1,
      limit: 100,
    });

    const result = await service.recheckPsdBlockedTasks({
      shopId,
      limit: 150,
    }, { permissions: ['PRODUCTION:WRITE'] });

    expect(repository.list).toHaveBeenCalledWith({
      shopId,
      blocker: 'PSD_MISSING',
      page: 1,
      limit: 100,
    });
    expect(result).toMatchObject({
      checked: 1,
      cleared: 1,
      stillBlocked: 0,
    });
    expect(result.items[0]).toMatchObject({
      taskId,
      status: 'CLEARED',
      blockers: ['SCALED_OUTPUT_MISSING'],
    });
  });

  test('recheck PSD-blocked task remains blocked when listing still lacks PSD', async () => {
    repository.list.mockResolvedValueOnce({
      items: [{ _id: taskId, shopId, orderItemId, blockers: ['PSD_MISSING'] }],
      total: 1,
      page: 1,
      limit: 50,
    });
    catalogPublic.getListingById.mockResolvedValueOnce({ ...listing, psdTemplateAssetId: null });

    const result = await service.recheckPsdBlockedTasks({}, { permissions: ['PRODUCTION:WRITE'] });

    expect(result).toMatchObject({
      checked: 1,
      cleared: 0,
      stillBlocked: 1,
    });
    expect(result.items[0]).toMatchObject({
      taskId,
      status: 'STILL_BLOCKED',
      blockers: expect.arrayContaining(['PSD_MISSING']),
    });
  });

  test('loads task shop, users, and vendor submission concurrently', async () => {
    let resolveShop;
    let resolveUsers;
    let resolveVendor;
    const shopPromise = new Promise((resolve) => { resolveShop = resolve; });
    const usersPromise = new Promise((resolve) => { resolveUsers = resolve; });
    const vendorPromise = new Promise((resolve) => { resolveVendor = resolve; });
    repository.listSummariesByOrderItemIds.mockResolvedValueOnce([{
      _id: taskId,
      orderId,
      orderItemId,
      shopId,
      status: 'READY_TO_SEND_VENDOR',
      assignedDesignUserId: designerId,
      vendorSubmissionId,
      orderSnapshot: order,
      orderItemSnapshot: item,
    }]);
    shopPublic.findById.mockReturnValue(shopPromise);
    hrPublic.listEmployeeProfilesByAccountIds.mockReturnValue(usersPromise);
    hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValue([
      { employeeCode: 'J2605', fullName: 'Seller User' },
    ]);
    vendorSubmissionPublic.listLatestByProductionTaskIds.mockReturnValue(vendorPromise);

    const resultPromise = service.listTaskSummariesByOrderItemIds([orderItemId], { system: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(shopPublic.findById).toHaveBeenCalledWith(shopId);
    expect(hrPublic.listEmployeeProfilesByAccountIds).toHaveBeenCalledWith([
      designerId,
      order.assignedStaffId,
    ]);
    expect(vendorSubmissionPublic.listLatestByProductionTaskIds).toHaveBeenCalledWith([taskId]);

    resolveShop({ _id: shopId, name: 'LNG Main Shop' });
    resolveUsers([
      { accountId: designerId, fullName: 'Scale User', employeeCode: 'SC01' },
      { accountId: order.assignedStaffId, fullName: 'Order Owner', employeeCode: 'CS01' },
    ]);
    resolveVendor([{
      id: vendorSubmissionId,
      productionTaskId: taskId,
      status: 'SUBMITTED',
    }]);

    const [summary] = await resultPromise;
    expect(summary.shop).toMatchObject({ id: shopId, name: 'LNG Main Shop' });
    expect(summary.assignedDesigner).toMatchObject({ id: designerId, fullName: 'Scale User' });
    expect(summary.seller).toMatchObject({ employeeCode: 'J2605', name: 'Seller User' });
    expect(summary.vendorSubmission).toMatchObject({ id: vendorSubmissionId, status: 'SUBMITTED' });
  });

  test('list task summaries includes scale and qc user names', async () => {
    const qcUserId = '660000000000000000000904';
    repository.listSummariesByOrderItemIds.mockResolvedValueOnce([{
      _id: taskId,
      shopId,
      orderItemId,
      status: 'READY_TO_SEND_VENDOR',
      assignedDesignUserId: designerId,
      qcBy: qcUserId,
    }]);
    hrPublic.listEmployeeProfilesByAccountIds.mockResolvedValueOnce([
      { accountId: designerId, fullName: 'Scale User', employeeCode: 'SC01' },
      { accountId: qcUserId, fullName: 'QC User', employeeCode: 'QC01' },
    ]);

    const [summary] = await service.listTaskSummariesByOrderItemIds([orderItemId], { system: true });

    expect(hrPublic.listEmployeeProfilesByAccountIds).toHaveBeenCalledWith([designerId, qcUserId]);
    expect(summary.assignedDesigner).toMatchObject({ id: designerId, fullName: 'Scale User' });
    expect(summary.qcUser).toMatchObject({ id: qcUserId, fullName: 'QC User' });
    expect(summary).not.toHaveProperty('scaleByUser');
    expect(summary).not.toHaveProperty('qcByUser');
  });

  test('lists order workbench summaries without shop, order, or vendor enrichment', async () => {
    const qcUserId = '660000000000000000000904';
    repository.listSummariesByOrderItemIds.mockResolvedValueOnce([{
      _id: taskId,
      shopId,
      orderItemId,
      status: 'READY_TO_SEND_VENDOR',
      assignedDesignUserId: designerId,
      qcBy: qcUserId,
    }]);
    hrPublic.listEmployeeProfilesByAccountIds.mockResolvedValueOnce([
      { accountId: designerId, fullName: 'Scale User' },
      { accountId: qcUserId, fullName: 'QC User' },
    ]);

    const [summary] = await service.listWorkbenchTaskSummariesByOrderItemIds([orderItemId], { system: true });

    expect(summary).toMatchObject({
      id: taskId,
      orderItemId,
      productionStatus: 'READY_TO_SEND_VENDOR',
      assignedDesigner: { id: designerId, fullName: 'Scale User' },
      qcUser: { id: qcUserId, fullName: 'QC User' },
    });
    expect(shopPublic.findById).not.toHaveBeenCalled();
    expect(orderPublic.findById).not.toHaveBeenCalled();
    expect(vendorSubmissionPublic.listLatestByProductionTaskIds).not.toHaveBeenCalled();
  });

  test('bulk assign updates assignable tasks and reports failures', async () => {
    const missingTaskId = '660000000000000000100099';
    const invalidTaskId = 'bad-id';
    repository.findById
      .mockResolvedValueOnce({ _id: taskId, shopId, orderItemId, status: 'NEED_SCALE' })
      .mockResolvedValueOnce(null);
    repository.updateById.mockImplementation(async (id, patch) => ({
      _id: id,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      ...patch,
    }));

    const result = await service.bulkAssignDesignTasks({
      taskIds: [taskId, missingTaskId, invalidTaskId],
      assignedDesignUserId: designerId,
      designNote: 'Batch 1',
    }, { permissions: ['PRODUCTION:WRITE'] });

    expect(repository.updateById).toHaveBeenCalledTimes(1);
    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      assignedDesignUserId: designerId,
      assignedAt: expect.any(Date),
      designNote: 'Batch 1',
    }));
    expect(result.assigned).toHaveLength(1);
    expect(result.assigned[0]).toMatchObject({
      id: taskId,
      assignedDesignUserId: designerId,
      designAssignmentStatus: 'ASSIGNED',
    });
    expect(result.failed).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: missingTaskId, code: 'RESOURCE_NOT_FOUND' }),
      expect.objectContaining({ taskId: invalidTaskId, code: 'VALIDATION_ERROR' }),
    ]));
  });

  test('bulk assign can reassign a QC rejected task for design rework', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'QC_REJECTED',
      assignedDesignUserId: '660000000000000000000905',
    });
    repository.updateById.mockImplementation(async (id, patch) => ({
      _id: id,
      shopId,
      orderItemId,
      status: 'QC_REJECTED',
      ...patch,
    }));

    const result = await service.bulkAssignDesignTasks({
      taskIds: [taskId],
      assignedDesignUserId: designerId,
    }, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.failed).toEqual([]);
    expect(result.assigned).toEqual([
      expect.objectContaining({ id: taskId, assignedDesignUserId: designerId }),
    ]);
  });

  test('bulk assign reports inaccessible and not assignable tasks without stopping valid tasks', async () => {
    const authPublic = require('../../../src/modules/auth/public');
    const blockedShopId = '660000000000000000000299';
    const blockedTaskId = '660000000000000000100010';
    const readyTaskId = '660000000000000000100011';
    authPublic.canAccessScope.mockImplementation((_auth, _permission, scope) => scope.scopeId !== blockedShopId);
    repository.findById
      .mockResolvedValueOnce({ _id: taskId, shopId, orderItemId, status: 'BLOCKED' })
      .mockResolvedValueOnce({ _id: blockedTaskId, shopId: blockedShopId, orderItemId, status: 'NEED_SCALE' })
      .mockResolvedValueOnce({ _id: readyTaskId, shopId, orderItemId, status: 'READY_TO_SEND_VENDOR' });
    repository.updateById.mockImplementation(async (id, patch) => ({
      _id: id,
      shopId,
      orderItemId,
      status: 'BLOCKED',
      ...patch,
    }));

    const result = await service.bulkAssignDesignTasks({
      taskIds: [taskId, blockedTaskId, readyTaskId],
      assignedDesignUserId: designerId,
    }, { permissions: [], scopes: [] });

    expect(repository.updateById).toHaveBeenCalledTimes(1);
    expect(result.assigned).toHaveLength(1);
    expect(result.failed).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: blockedTaskId, code: 'AUTHORIZATION_ERROR' }),
      expect.objectContaining({ taskId: readyTaskId, code: 'CONFLICT_ERROR' }),
    ]));
  });

  test('assign design task stores designer and note', async () => {
    hrPublic.listAssignableProfiles.mockResolvedValueOnce([
      { accountId: designerId, fullName: 'Scale User', employeeCode: 'J2605' },
    ]);
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
    });

    const result = await service.assignDesignTask(taskId, {
      assignedDesignUserId: designerId,
      designNote: 'Use front mockup first',
    }, { permissions: ['PRODUCTION:WRITE'] });

    expect(hrPublic.listAssignableProfiles).toHaveBeenCalledWith({
      accountIds: [designerId],
      limit: 1,
      requiredPermission: 'DESIGN:WORK',
    });
    expect(organizationPublic.listAccountOrganizationSummaries).toHaveBeenCalledWith([designerId]);
    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      assignedDesignUserId: designerId,
      assignedAt: expect.any(Date),
      designNote: 'Use front mockup first',
    }));
    expect(result).toMatchObject({
      assignedDesignUserId: designerId,
      designNote: 'Use front mockup first',
      designAssignmentStatus: 'ASSIGNED',
    });
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'PRODUCTION_DESIGN_ASSIGNED',
      source: 'PRODUCTION',
    }), { session: mockSession });
  });

  test('assign CS task stores assignee, actor, status, and note', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
    });

    const result = await service.assignCsTask(taskId, {
      csAssigneeId,
      csNote: 'Check address before scaling',
    }, { permissions: ['PRODUCTION:WRITE'], accountId: designerId });

    expect(hrPublic.listAssignableProfiles).toHaveBeenCalledWith({
      accountIds: [csAssigneeId],
      limit: 1,
      requiredPermission: 'PRODUCTION:WRITE',
    });
    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      csAssigneeId,
      csAssignedBy: designerId,
      csAssignedAt: expect.any(Date),
      csStatus: 'ASSIGNED',
      csNote: 'Check address before scaling',
    }));
    expect(result).toMatchObject({
      csAssigneeId,
      csStatus: 'ASSIGNED',
      csNote: 'Check address before scaling',
    });
  });

  test('assign CS task unassigns with null assignee', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      csAssigneeId,
    });

    const result = await service.assignCsTask(taskId, {
      csAssigneeId: null,
    }, { permissions: ['PRODUCTION:WRITE'], accountId: designerId });

    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      csAssigneeId: null,
      csAssignedBy: null,
      csAssignedAt: null,
      csStatus: 'UNASSIGNED',
    }));
    expect(result).toMatchObject({
      csAssigneeId: null,
      csStatus: 'UNASSIGNED',
    });
  });

  test('assign design task rejects accounts that cannot work scale tasks', async () => {
    hrPublic.listAssignableProfiles.mockResolvedValueOnce([]);
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
    });

    await expect(service.assignDesignTask(taskId, {
      assignedDesignUserId: designerId,
    }, { permissions: ['PRODUCTION:WRITE'] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('team leader can assign an unassigned production task to a team member without shop scope', async () => {
    authPublic.hasTeamQueueScope.mockReturnValueOnce(true);
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId: otherShopId,
      orderItemId,
      status: 'NEED_SCALE',
      assignedDesignUserId: null,
    });
    repository.updateById.mockResolvedValueOnce({
      _id: taskId,
      shopId: otherShopId,
      orderItemId,
      status: 'NEED_SCALE',
      assignedDesignUserId: designerId,
      assignedAt: new Date(),
    });

    const result = await service.assignDesignTask(taskId, {
      assignedDesignUserId: designerId,
    }, scopedTeamAuth(qcUserId, ['DESIGN:REVIEW'], '660000000000000000000102', ['TEAM_LEADER']));

    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      assignedDesignUserId: designerId,
    }));
    expect(result).toMatchObject({ assignedDesignUserId: designerId });
  });

  test('team leader cannot assign a production task to an account outside the team', async () => {
    authPublic.hasTeamQueueScope.mockReturnValueOnce(true);
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId: otherShopId,
      orderItemId,
      status: 'NEED_SCALE',
      assignedDesignUserId: null,
    });

    await expect(service.assignDesignTask(taskId, {
      assignedDesignUserId: '660000000000000000000999',
    }, scopedTeamAuth(qcUserId, ['DESIGN:REVIEW'], '660000000000000000000102', ['TEAM_LEADER'])))
      .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('assign design task rejects non-scale design workers', async () => {
    hrPublic.listAssignableProfiles.mockResolvedValueOnce([
      { accountId: qcUserId, fullName: 'QC User', employeeCode: 'J2510' },
    ]);
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
    });

    await expect(service.assignDesignTask(taskId, {
      assignedDesignUserId: qcUserId,
    }, { permissions: ['PRODUCTION:WRITE'] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('scale designer can claim and upload with shop-scoped DESIGN:WORK only', async () => {
    repository.findById.mockResolvedValue({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      assignedDesignUserId: null,
      fileChecks: [{
        _id: fileCheckId,
        required: true,
        blockers: ['SCALED_OUTPUT_MISSING'],
      }],
    });
    repository.updateById.mockImplementation(async (_taskId, patch) => ({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      ...patch,
    }));
    repository.updateFileCheckOutputIfMutable.mockImplementationOnce(async (_taskId, _fileCheckId, _expected, patch) => ({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      fileChecks: [{ _id: fileCheckId, required: true, blockers: [], ...patch }],
    }));

    const authContext = scopedShopAuth(designerId, ['DESIGN:WORK']);
    const claimResult = await service.claimDesignTask(taskId, authContext);
    const uploadResult = await service.uploadScaledFile(taskId, fileCheckId, outputAssetId, authContext);

    expect(claimResult).toMatchObject({ assignedDesignUserId: designerId });
    expect(uploadResult).toMatchObject({ scaleStatus: 'SCALED' });
  });

  test('team-scoped scale designer can upload an assigned task without shop scope', async () => {
    repository.findById.mockResolvedValue({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      assignedDesignUserId: designerId,
      addressValidationStatus: 'VALID',
      fileChecks: [{
        _id: fileCheckId,
        required: true,
        blockers: ['SCALED_OUTPUT_MISSING'],
      }],
    });
    repository.updateFileCheckOutputIfMutable.mockImplementationOnce(async (_taskId, _fileCheckId, _expected, patch) => ({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      assignedDesignUserId: designerId,
      fileChecks: [{ _id: fileCheckId, required: true, blockers: [], ...patch }],
    }));

    const result = await service.uploadScaledFile(
      taskId,
      fileCheckId,
      outputAssetId,
      scopedTeamAuth(designerId, ['DESIGN:WORK']),
    );

    expect(result).toMatchObject({ scaleStatus: 'SCALED' });
  });

  test('team-scoped scale designer cannot claim an unassigned task without shop scope', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      assignedDesignUserId: null,
    });

    await expect(service.claimDesignTask(
      taskId,
      scopedTeamAuth(designerId, ['DESIGN:WORK']),
    )).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });

    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('scale designer cannot claim tasks from another shop', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId: otherShopId,
      orderItemId,
      status: 'NEED_SCALE',
      assignedDesignUserId: null,
    });

    await expect(service.claimDesignTask(
      taskId,
      scopedShopAuth(designerId, ['DESIGN:WORK'], shopId),
    )).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('claim design task assigns current account when unassigned', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'BLOCKED',
      assignedDesignUserId: null,
    });

    const result = await service.claimDesignTask(taskId, {
      permissions: ['PRODUCTION:WRITE'],
      accountId: designerId,
    });

    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      assignedDesignUserId: designerId,
      assignedAt: expect.any(Date),
    }));
    expect(result).toMatchObject({
      assignedDesignUserId: designerId,
      designAssignmentStatus: 'ASSIGNED',
    });
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'PRODUCTION_DESIGN_CLAIMED',
      source: 'PRODUCTION',
    }), { session: mockSession });
  });

  test('does not emit claim evidence when the conditional update loses a race', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      assignedDesignUserId: null,
    });
    repository.updateByIdIf.mockResolvedValueOnce(null);

    await expect(service.claimDesignTask(taskId, {
      permissions: ['PRODUCTION:WRITE'],
      accountId: designerId,
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });

    expect(orderPublic.appendTimeline).not.toHaveBeenCalled();
    expect(auditPublic.record).not.toHaveBeenCalled();
  });

  test('claim design task rejects when task is assigned to someone else', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      assignedDesignUserId: '660000000000000000000904',
    });

    await expect(service.claimDesignTask(taskId, {
      permissions: ['PRODUCTION:WRITE'],
      accountId: designerId,
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('assign and claim reject tasks that are already past design work', async () => {
    repository.findById
      .mockResolvedValueOnce({ _id: taskId, shopId, orderItemId, status: 'READY_TO_SEND_VENDOR' })
      .mockResolvedValueOnce({ _id: taskId, shopId, orderItemId, status: 'SENT_TO_VENDOR', assignedDesignUserId: null });

    await expect(service.assignDesignTask(taskId, {
      assignedDesignUserId: designerId,
    }, { permissions: ['PRODUCTION:WRITE'] })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.claimDesignTask(taskId, {
      permissions: ['PRODUCTION:WRITE'],
      accountId: designerId,
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('updates design note without changing assignee', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      assignedDesignUserId: designerId,
      assignedAt: new Date('2026-07-05T01:00:00.000Z'),
    });

    const result = await service.updateDesignNote(taskId, { designNote: 'Waiting for better image' }, { permissions: ['PRODUCTION:WRITE'] });

    expect(repository.updateById).toHaveBeenCalledWith(taskId, { designNote: 'Waiting for better image' });
    expect(result).toMatchObject({
      assignedDesignUserId: designerId,
      designNote: 'Waiting for better image',
    });
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'PRODUCTION_DESIGN_NOTE_UPDATED',
      source: 'PRODUCTION',
    }), { session: mockSession });
  });

  test('updates CS note without changing assignment', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      csAssigneeId,
      csStatus: 'ASSIGNED',
    });

    const result = await service.updateCsNote(taskId, {
      csNote: 'Customer image needs crop review',
    }, { permissions: ['PRODUCTION:WRITE'] });

    expect(repository.updateById).toHaveBeenCalledWith(taskId, {
      csNote: 'Customer image needs crop review',
    });
    expect(result).toMatchObject({
      csAssigneeId,
      csStatus: 'ASSIGNED',
      csNote: 'Customer image needs crop review',
    });
  });

  test('updates CS status only when task has CS assignee', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      csAssigneeId,
      csStatus: 'ASSIGNED',
    });

    const result = await service.updateCsStatus(taskId, {
      csStatus: 'DONE',
    }, { permissions: ['PRODUCTION:WRITE'] });

    expect(repository.updateById).toHaveBeenCalledWith(taskId, {
      csStatus: 'DONE',
    });
    expect(result).toMatchObject({ csStatus: 'DONE' });
  });

  test('rejects in-progress CS status without assignee', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      csAssigneeId: null,
    });

    await expect(service.updateCsStatus(taskId, {
      csStatus: 'IN_PROGRESS',
    }, { permissions: ['PRODUCTION:WRITE'] })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('upload scaled output keeps task in scale queue until designer submits QC', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      assignedDesignUserId: designerId,
      fileChecks: [{
        _id: '660000000000000000100004',
        slotKey: 'PSD_TEMPLATE',
        required: true,
        sourceType: 'PSD_TEMPLATE',
        inputAssetId: listing.psdTemplateAssetId,
        outputAssetId: null,
        scaleStatus: 'NOT_REQUIRED',
        qcStatus: 'NOT_READY',
        blockers: [],
      }, {
        _id: fileCheckId,
        slotKey: 'FRONT',
        required: true,
        sourceType: 'CUSTOMER_IMAGE',
        inputAssetId: mediaAssetId,
        outputAssetId: null,
        scaleStatus: 'NEED_SCALE',
        qcStatus: 'NOT_READY',
        blockers: ['SCALED_OUTPUT_MISSING'],
      }],
    });

    const result = await service.uploadScaledFile(taskId, fileCheckId, outputAssetId, { permissions: ['PRODUCTION:WRITE'] });

    expect(mediaPublic.assertMediaAssetExists).toHaveBeenCalledWith(outputAssetId);
    expect(result).toMatchObject({
      status: 'NEED_SCALE',
      scaleStatus: 'SCALED',
      qcStatus: 'NOT_READY',
    });
    expect(result.fileChecks[1]).toMatchObject({
      outputAssetId,
      outputWorkerId: designerId,
      scaleStatus: 'SCALED',
      qcStatus: 'NOT_READY',
      blockers: [],
    });
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(
      orderItemId, 'NEED_PRODUCTION', expect.objectContaining({ source: 'PRODUCTION' }),
    );
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'PRODUCTION_SCALED_FILE_UPLOADED',
      source: 'PRODUCTION',
    }), { session: mockSession });
  });

  test('replacing a rejected scaled output clears its QC blocker and returns to scale review', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'QC_REJECTED',
      scaleStatus: 'SCALED',
      qcStatus: 'REJECTED',
      blockers: ['QC_REJECTED'],
      fileChecks: [{
        _id: fileCheckId,
        slotKey: 'FRONT',
        required: true,
        sourceType: 'CUSTOMER_IMAGE',
        inputAssetId: mediaAssetId,
        outputAssetId: '660000000000000000000902',
        scaleStatus: 'SCALED',
        qcStatus: 'REJECTED',
        blockers: ['QC_REJECTED'],
        note: 'Artwork is cropped too tightly',
      }],
    });

    const result = await service.uploadScaledFile(
      taskId,
      fileCheckId,
      outputAssetId,
      { permissions: ['PRODUCTION:WRITE'] },
    );

    expect(result).toMatchObject({
      status: 'NEED_SCALE',
      scaleStatus: 'SCALED',
      qcStatus: 'NOT_READY',
      blockers: [],
    });
    expect(result.fileChecks[0]).toMatchObject({
      outputAssetId,
      qcStatus: 'NOT_READY',
      blockers: [],
      note: 'Artwork is cropped too tightly',
    });
  });

  test('designer submits scaled outputs to QC after inspection', async () => {
    const task = {
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      scaleStatus: 'SCALED',
      qcStatus: 'NOT_READY',
      blockers: [],
      fileChecks: [{
        _id: fileCheckId,
        slotKey: 'FRONT',
        required: true,
        sourceType: 'CUSTOMER_IMAGE',
        inputAssetId: mediaAssetId,
        outputAssetId,
        scaleStatus: 'SCALED',
        qcStatus: 'NOT_READY',
        blockers: [],
      }],
    };
    repository.findById.mockResolvedValueOnce(task);
    repository.updateByIdIf.mockImplementationOnce(async (id, filter, patch) => ({
      ...task,
      ...patch,
    }));

    const result = await service.submitScaleForQc(taskId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result).toMatchObject({
      status: 'QC_PENDING',
      scaleStatus: 'SCALED',
      qcStatus: 'PENDING',
    });
    expect(result.fileChecks[0]).toMatchObject({ qcStatus: 'PENDING' });
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(
      orderItemId, 'IN_PRODUCTION', expect.objectContaining({ source: 'PRODUCTION' }),
    );
  });

  test('rejects stale scaled output upload when QC passes before its conditional write', async () => {
    const staleTask = {
      _id: taskId,
      shopId,
      orderItemId,
      status: 'QC_PENDING',
      qcStatus: 'NOT_READY',
      fileChecks: [{
        _id: fileCheckId,
        required: true,
        inputAssetId: mediaAssetId,
        outputAssetId: '660000000000000000000902',
        scaleStatus: 'SCALED',
        qcStatus: 'NOT_READY',
        blockers: [],
      }],
    };
    repository.findById.mockResolvedValueOnce(staleTask);
    repository.updateFileCheckOutputIfMutable.mockResolvedValueOnce(null);

    await expect(service.uploadScaledFile(
      taskId,
      fileCheckId,
      outputAssetId,
      { permissions: ['PRODUCTION:WRITE'] },
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(repository.updateFileCheckOutputIfMutable).toHaveBeenCalledWith(
      taskId, fileCheckId, expect.objectContaining({ qcStatus: 'NOT_READY' }), expect.any(Object), { session: mockSession },
    );
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
    expect(orderPublic.appendTimeline).not.toHaveBeenCalled();
  });

  test('discards multipart media when QC passes before the conditional write', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempPath = path.join(os.tmpdir(), `stale-scaled-output-${Date.now()}.png`);
    fs.writeFileSync(tempPath, 'scaled');
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'QC_PENDING',
      qcStatus: 'NOT_READY',
      fileChecks: [{ _id: fileCheckId, outputAssetId, scaleStatus: 'SCALED', qcStatus: 'PENDING' }],
    });
    repository.updateFileCheckOutputIfMutable.mockResolvedValueOnce(null);

    await expect(service.uploadScaledOutputFile(taskId, fileCheckId, {
      path: tempPath,
      originalname: 'replacement.png',
      mimetype: 'image/png',
      size: 6,
    }, { permissions: ['PRODUCTION:WRITE'], accountId: designerId })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(mediaPublic.discardUnattachedAsset).toHaveBeenCalledWith(
      outputAssetId,
      {
        source: 'PRODUCTION_SCALED_OUTPUT',
        taskId,
        fileCheckId,
        uploadedBy: designerId,
      },
      'QC_PASS_CAS_LOST',
    );
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  test('preserves the CAS conflict when multipart media cleanup fails', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempPath = path.join(os.tmpdir(), `cleanup-failed-scaled-output-${Date.now()}.png`);
    fs.writeFileSync(tempPath, 'scaled');
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'QC_PENDING',
      qcStatus: 'NOT_READY',
      fileChecks: [{ _id: fileCheckId, outputAssetId, scaleStatus: 'SCALED', qcStatus: 'PENDING' }],
    });
    repository.updateFileCheckOutputIfMutable.mockResolvedValueOnce(null);
    mediaPublic.discardUnattachedAsset.mockRejectedValueOnce(new Error('cloudinary unavailable'));

    await expect(service.uploadScaledOutputFile(taskId, fileCheckId, {
      path: tempPath,
      originalname: 'replacement.png',
      mimetype: 'image/png',
      size: 6,
    }, { permissions: ['PRODUCTION:WRITE'], accountId: designerId })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
  });

  test('rejects scaled output when the current order address is not valid', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{ _id: fileCheckId, required: true }],
    });
    orderPublic.findById.mockResolvedValueOnce({
      ...order,
      addressValidationStatus: 'INVALID',
    });

    await expect(service.uploadScaledFile(
      taskId,
      fileCheckId,
      outputAssetId,
      { permissions: ['PRODUCTION:WRITE'] },
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
      details: { addressValidationStatus: 'INVALID' },
    });

    expect(mediaPublic.assertMediaAssetExists).not.toHaveBeenCalled();
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('rejects scaled output with a not-checked address before media access', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderId,
      orderItemId,
      fileChecks: [{ _id: fileCheckId, required: true }],
    });
    orderPublic.findById.mockResolvedValueOnce({
      _id: orderId,
      addressValidationStatus: 'NOT_CHECKED',
    });

    await expect(service.uploadScaledFile(
      taskId,
      fileCheckId,
      outputAssetId,
      { permissions: ['PRODUCTION:WRITE'] },
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
      details: { addressValidationStatus: 'NOT_CHECKED' },
    });

    expect(mediaPublic.assertMediaAssetExists).not.toHaveBeenCalled();
  });

  test('rejects multipart scaled output before storing a file for an invalid address', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{ _id: fileCheckId, required: true }],
    });
    orderPublic.findById.mockResolvedValueOnce({
      ...order,
      addressValidationStatus: 'NOT_CHECKED',
    });

    await expect(service.uploadScaledOutputFile(taskId, fileCheckId, {
      path: 'C:\\temp\\missing-file.psd',
      originalname: 'output.psd',
    }, { permissions: ['PRODUCTION:WRITE'] })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });

    expect(mediaPublic.storeAsset).not.toHaveBeenCalled();
  });

  test('upload scaled output clears customer image missing blocker for manual override', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{
        _id: fileCheckId,
        slotKey: 'FRONT',
        required: false,
        sourceType: 'CUSTOMER_IMAGE',
        inputAssetId: null,
        outputAssetId: null,
        scaleStatus: 'NOT_REQUIRED',
        qcStatus: 'NOT_READY',
        blockers: ['CUSTOMER_IMAGE_MISSING'],
      }],
    });

    const result = await service.uploadScaledFile(taskId, fileCheckId, outputAssetId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result).toMatchObject({
      status: 'NEED_SCALE',
      scaleStatus: 'SCALED',
      qcStatus: 'NOT_READY',
    });
    expect(result.fileChecks[0]).toMatchObject({
      outputAssetId,
      scaleStatus: 'SCALED',
      qcStatus: 'NOT_READY',
      blockers: [],
    });
  });

  test('upload scaled output rejects missing media asset without changing task', async () => {
    mediaPublic.assertMediaAssetExists.mockRejectedValueOnce(new Error('missing media'));
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{ _id: fileCheckId, required: true }],
    });

    await expect(service.uploadScaledFile(taskId, fileCheckId, outputAssetId, { permissions: ['PRODUCTION:WRITE'] }))
      .rejects.toThrow('missing media');
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalledWith(orderItemId, 'IN_PRODUCTION', expect.anything());
  });

  test('upload scaled output rejects unknown file check without changing task', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{ _id: fileCheckId, required: true }],
    });

    await expect(service.uploadScaledFile(
      taskId,
      '660000000000000000109999',
      outputAssetId,
      { permissions: ['PRODUCTION:WRITE'] },
    )).rejects.toMatchObject({ statusCode: 404, code: 'RESOURCE_NOT_FOUND' });
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalledWith(orderItemId, 'IN_PRODUCTION', expect.anything());
  });

  test('QC pass moves task and order item to ready to send vendor', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{
        _id: fileCheckId,
        required: true,
        outputAssetId,
        qcStatus: 'NOT_READY',
        blockers: [],
      }],
    });

    const result = await service.submitQc(taskId, { decision: 'PASSED' }, { permissions: ['PRODUCTION:WRITE'] });

    expect(result).toMatchObject({
      status: 'READY_TO_SEND_VENDOR',
      scaleStatus: 'SCALED',
      qcStatus: 'PASSED',
      blockers: [],
    });
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(
      orderItemId, 'READY_TO_SEND_VENDOR', expect.objectContaining({ source: 'PRODUCTION' }),
    );
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'PRODUCTION_QC_PASSED',
      source: 'PRODUCTION',
    }), { session: mockSession });
    expect(vendorSubmissionPublic.createAndSubmitFromProductionTask).toHaveBeenCalledWith(taskId, expect.objectContaining({
      permissions: ['PRODUCTION:WRITE'],
      system: true,
      source: 'PRODUCTION',
    }));
  });

  test('QC pass does not require an output for the PSD template input', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [
        {
          _id: '660000000000000000100003',
          slotKey: 'PSD_TEMPLATE',
          sourceType: 'PSD_TEMPLATE',
          required: true,
          inputAssetId: mediaAssetId,
          outputAssetId: null,
          qcStatus: 'NOT_READY',
          blockers: [],
        },
        {
          _id: fileCheckId,
          slotKey: 'FRONT',
          sourceType: 'CUSTOMER_IMAGE',
          required: true,
          inputAssetId: mediaAssetId,
          outputAssetId,
          qcStatus: 'NOT_READY',
          blockers: [],
        },
      ],
    });

    const result = await service.submitQc(taskId, { decision: 'PASSED' }, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('READY_TO_SEND_VENDOR');
  });

  test('QC reviewer can submit QC with shop-scoped DESIGN:REVIEW only', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{
        _id: fileCheckId,
        required: true,
        outputAssetId,
        qcStatus: 'NOT_READY',
        blockers: [],
      }],
    });
    repository.updateById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'READY_TO_SEND_VENDOR',
      scaleStatus: 'SCALED',
      qcStatus: 'PASSED',
      blockers: [],
      qcBy: qcUserId,
    });

    const result = await service.submitQc(
      taskId,
      { decision: 'PASSED' },
      scopedShopAuth(qcUserId, ['DESIGN:REVIEW']),
    );

    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      qcBy: qcUserId,
      qcStatus: 'PASSED',
    }));
    expect(result).toMatchObject({ qcBy: qcUserId });
  });

  test('team-scoped QC reviewer can submit QC without shop scope', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId: otherShopId,
      orderItemId,
      assignedDesignUserId: designerId,
      fileChecks: [{
        _id: fileCheckId,
        required: true,
        outputAssetId,
        qcStatus: 'NOT_READY',
        blockers: [],
      }],
    });
    repository.updateById.mockResolvedValueOnce({
      _id: taskId,
      shopId: otherShopId,
      orderItemId,
      status: 'READY_TO_SEND_VENDOR',
      scaleStatus: 'SCALED',
      qcStatus: 'PASSED',
      blockers: [],
      qcBy: qcUserId,
    });

    const result = await service.submitQc(
      taskId,
      { decision: 'PASSED' },
      scopedTeamAuth(qcUserId, ['DESIGN:REVIEW']),
    );

    expect(repository.updateById).toHaveBeenCalledWith(taskId, expect.objectContaining({
      qcBy: qcUserId,
      qcStatus: 'PASSED',
    }));
    expect(result).toMatchObject({ qcBy: qcUserId });
  });

  test('QC pass records one score for every passing Scale output', async () => {
    catalogPublic.getListingVariantById.mockResolvedValueOnce({ scaleDifficulty: { level: 'HARD' } });
    const checks = [1, 2, 3].map((value) => ({
      _id: `66000000000000000010001${value}`,
      slotKey: `SLOT_${value}`,
      required: true,
      sourceType: 'CUSTOMER_IMAGE',
      outputAssetId: `66000000000000000020001${value}`,
      outputWorkerId: designerId,
      qcStatus: 'NOT_READY',
      blockers: [],
    }));
    mockTaskUpdate({ _id: taskId, shopId, orderItemId, listingVariantId, fileChecks: checks });

    await service.submitQc(taskId, { decision: 'PASSED' }, { permissions: ['PRODUCTION:WRITE'], accountId: qcUserId });

    expect(workScorePublic.recordProductionScaleScores).toHaveBeenCalledWith(expect.objectContaining({
      productionTaskId: taskId,
      shopId,
      contextSnapshot: expect.objectContaining({ scaleDifficultyLevel: 'HARD' }),
      outputs: checks.map((check) => expect.objectContaining({
        fileCheckId: check._id,
        assetId: check.outputAssetId,
        workerId: designerId,
        contextSnapshot: expect.objectContaining({ scaleDifficultyLevel: 'HARD' }),
      })),
    }));
  });

  test('QC pass remains successful when scoring fails', async () => {
    workScorePublic.recordProductionScaleScores.mockRejectedValueOnce(new Error('temporary scoring outage'));
    mockTaskUpdate({
      _id: taskId, shopId, orderItemId,
      fileChecks: [{
        _id: fileCheckId, slotKey: 'FRONT', required: true, sourceType: 'CUSTOMER_IMAGE',
        outputAssetId, outputWorkerId: designerId, qcStatus: 'NOT_READY', blockers: [],
      }],
    });

    const result = await service.submitQc(taskId, { decision: 'PASSED' }, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('READY_TO_SEND_VENDOR');
    expect(result.warnings).toContainEqual({ code: 'SCORE_CREATION_FAILED' });
  });

  test('QC pass still succeeds when auto vendor submission creation fails', async () => {
    vendorSubmissionPublic.createAndSubmitFromProductionTask.mockRejectedValueOnce(new Error('temporary outage'));
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{
        _id: fileCheckId,
        required: true,
        outputAssetId,
        qcStatus: 'NOT_READY',
        blockers: [],
      }],
    });

    const result = await service.submitQc(taskId, { decision: 'PASSED' }, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('READY_TO_SEND_VENDOR');
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(
      orderItemId, 'READY_TO_SEND_VENDOR', expect.objectContaining({ source: 'PRODUCTION' }),
    );
  });

  test('QC reject stores blocker and moves order item to QC_REJECTED', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{
        _id: fileCheckId,
        required: true,
        outputAssetId,
        qcStatus: 'NOT_READY',
        blockers: [],
      }],
    });

    const result = await service.submitQc(taskId, { decision: 'REJECTED', note: 'Bad crop' }, { permissions: ['PRODUCTION:WRITE'] });

    expect(result).toMatchObject({
      status: 'QC_REJECTED',
      qcStatus: 'REJECTED',
      blockers: ['QC_REJECTED'],
    });
    expect(result.fileChecks[0]).toMatchObject({
      qcStatus: 'REJECTED',
      note: 'Bad crop',
      blockers: ['QC_REJECTED'],
    });
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(
      orderItemId, 'QC_REJECTED', expect.objectContaining({ source: 'PRODUCTION' }),
    );
    expect(vendorSubmissionPublic.createAndSubmitFromProductionTask).not.toHaveBeenCalled();
  });

  test('QC file decisions reject only failed slots and retain passed slot results', async () => {
    const backFileCheckId = '660000000000000000100003';
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [
        { _id: fileCheckId, required: true, outputAssetId, qcStatus: 'NOT_READY', blockers: [] },
        { _id: backFileCheckId, required: true, outputAssetId, qcStatus: 'NOT_READY', blockers: [] },
      ],
    });

    const result = await service.submitQc(taskId, {
      fileDecisions: [
        { fileCheckId, decision: 'PASSED' },
        { fileCheckId: backFileCheckId, decision: 'REJECTED', note: 'Outside safe area' },
      ],
    }, { permissions: ['PRODUCTION:WRITE'] });

    expect(result).toMatchObject({ status: 'QC_REJECTED', qcStatus: 'REJECTED' });
    expect(result.fileChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fileCheckId, qcStatus: 'PASSED', blockers: [] }),
      expect.objectContaining({ id: backFileCheckId, qcStatus: 'REJECTED', note: 'Outside safe area', blockers: ['QC_REJECTED'] }),
    ]));
  });

  test('QC pass rejects when required scaled output is missing', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{
        _id: fileCheckId,
        required: true,
        outputAssetId: null,
        qcStatus: 'NOT_READY',
        blockers: ['SCALED_OUTPUT_MISSING'],
      }],
    });

    await expect(service.submitQc(taskId, { decision: 'PASSED' }, { permissions: ['PRODUCTION:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalledWith(orderItemId, 'READY_TO_SEND_VENDOR', expect.anything());
  });

  test('QC rejects invalid decision without changing task', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{ _id: fileCheckId, required: true, outputAssetId }],
    });

    await expect(service.submitQc(taskId, { decision: 'MAYBE' }, { permissions: ['PRODUCTION:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
    expect(repository.updateById).not.toHaveBeenCalled();
    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
  });

  test('QC pass ignores optional file checks without scaled output', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [
        { _id: fileCheckId, required: true, outputAssetId, qcStatus: 'NOT_READY', blockers: [] },
        {
          _id: '660000000000000000100004',
          required: false,
          outputAssetId: null,
          qcStatus: 'NOT_READY',
          blockers: [],
        },
      ],
    });

    const result = await service.submitQc(taskId, { decision: 'PASSED' }, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('READY_TO_SEND_VENDOR');
    expect(result.fileChecks[0].qcStatus).toBe('PASSED');
    expect(result.fileChecks[1].qcStatus).toBe('NOT_READY');
  });

  test('mark sent to vendor rejects task that is not ready', async () => {
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'QC_PENDING',
    });

    await expect(service.markSentToVendor(taskId, null, { permissions: ['PRODUCTION:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
  });

  test('mark sent to vendor updates ready task and order item', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'READY_TO_SEND_VENDOR',
    });

    const result = await service.markSentToVendor(taskId, '660000000000000000000999', { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('SENT_TO_VENDOR');
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(
      orderItemId, 'SENT_TO_VENDOR', expect.objectContaining({ source: 'PRODUCTION' }),
    );
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'VENDOR_SUBMISSION_SENT',
      source: 'PRODUCTION',
    }), { session: mockSession });
  });

  test('mark sent to vendor requires a submitted submission for the same production task', async () => {
    vendorSubmissionPublic.getById.mockResolvedValueOnce({
      id: vendorSubmissionId,
      productionTaskId: '660000000000000000100099',
      status: 'READY',
    });
    repository.findById.mockResolvedValueOnce({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'READY_TO_SEND_VENDOR',
    });

    await expect(service.markSentToVendor(taskId, vendorSubmissionId, { permissions: ['PRODUCTION:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  test('bulk push vendor sends ready tasks and reports failures', async () => {
    repository.findById
      .mockResolvedValueOnce({ _id: taskId, shopId, orderItemId, status: 'READY_TO_SEND_VENDOR' })
      .mockResolvedValueOnce({ _id: '660000000000000000100099', shopId, orderItemId, status: 'QC_PENDING' });
    repository.updateById.mockImplementation(async (id, patch) => ({ _id: id, shopId, orderItemId, ...patch }));

    const result = await service.bulkPushVendor({
      taskIds: [taskId, '660000000000000000100099'],
      vendorSubmissionIdsByTaskId: { [taskId]: vendorSubmissionId },
    }, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.sent).toHaveLength(1);
    expect(result.sent[0]).toMatchObject({ id: taskId, status: 'SENT_TO_VENDOR' });
    expect(result.failed).toEqual([expect.objectContaining({
      taskId: '660000000000000000100099',
      message: 'Production task is not ready to send vendor',
    })]);
  });

  test('exports QC page tasks as Excel using current filters', async () => {
    repository.listForExport.mockResolvedValueOnce([{
      _id: taskId,
      shopId,
      orderItemSnapshot: {
        externalOrderId: item.externalOrderId,
        sku: item.sku,
        title: item.title,
      },
      orderSnapshot: {
        orderedAt: new Date('2026-07-01T10:00:00.000Z'),
        shippingService: { level: 'Expedited' },
        shippingAddress: { name: 'Jane Buyer' },
      },
      status: 'QC_PENDING',
      scaleStatus: 'SCALED',
      qcStatus: 'NOT_READY',
      blockers: [],
    }]);

    const result = await service.exportQcTasksExcel({ qcStatus: 'NOT_READY', sellerCode: 'J2605' }, { permissions: ['PRODUCTION:READ'] });

    expect(repository.listForExport).toHaveBeenCalledWith(expect.objectContaining({
      qcStatus: 'NOT_READY',
      sellerCode: 'J2605',
    }));
    expect(result.filename).toMatch(/production-qc-tasks-/);
    expect(result.filename).toMatch(/\.xls$/);
    expect(result.contentType).toBe('application/vnd.ms-excel; charset=utf-8');
    expect(result.content).toContain('<Workbook');
    expect(result.content).toContain('Task ID');
    expect(result.content).toContain('QC Status');
    expect(result.content).toContain(taskId);
    expect(result.content).toContain('LNG Main Shop');
  });

  test('scoped user cannot mutate another shop task', async () => {
    const authPublic = require('../../../src/modules/auth/public');
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(service.createOrRecheckTaskForOrderItem(orderItemId, {
      permissions: [],
      scopes: [],
    })).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });
  });

  test('scoped user cannot list summaries for another shop task', async () => {
    const authPublic = require('../../../src/modules/auth/public');
    authPublic.canAccessScope.mockReturnValue(false);
    repository.listSummariesByOrderItemIds.mockResolvedValueOnce([{
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
    }]);

    await expect(service.listTaskSummariesByOrderItemIds([orderItemId], {
      permissions: [],
      scopes: [],
    })).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });
  });

  test('recheck does not transition a preserved sent task backward', async () => {
    const existing = {
      _id: taskId, orderItemId, shopId, status: 'SENT_TO_VENDOR',
      scaleStatus: 'SCALED', qcStatus: 'PASSED', fileChecks: [],
    };
    repository.findByOrderItem.mockResolvedValueOnce(existing);
    repository.updateByIdIf.mockImplementationOnce(async (_id, _filter, patch) => ({ ...existing, ...patch }));

    await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(orderPublic.transitionItemStatus).not.toHaveBeenCalled();
  });

  test.each([
    ['PRODUCTION_DESIGN_ASSIGNED', async () => {
      mockTaskUpdate({ _id: taskId, shopId, orderItemId, status: 'NEED_SCALE' });
      await service.assignDesignTask(taskId, {
        assignedDesignUserId: designerId, designNote: 'private design note',
      }, { permissions: ['PRODUCTION:WRITE'], accountId: designerId, auditContext: {} });
    }],
    ['PRODUCTION_CS_ASSIGNED', async () => {
      mockTaskUpdate({ _id: taskId, shopId, orderItemId, status: 'NEED_SCALE', csStatus: 'UNASSIGNED' });
      await service.assignCsTask(taskId, {
        csAssigneeId, csNote: 'private customer note',
      }, { permissions: ['PRODUCTION:WRITE'], accountId: designerId, auditContext: {} });
    }],
    ['PRODUCTION_DESIGN_CLAIMED', async () => {
      mockTaskUpdate({ _id: taskId, shopId, orderItemId, status: 'NEED_SCALE', assignedDesignUserId: null });
      await service.claimDesignTask(taskId, {
        permissions: ['PRODUCTION:WRITE'], accountId: designerId, auditContext: {},
      });
    }],
    ['PRODUCTION_DESIGN_NOTE_UPDATED', async () => {
      mockTaskUpdate({ _id: taskId, shopId, orderItemId, status: 'NEED_SCALE', designNote: null });
      await service.updateDesignNote(taskId, { designNote: 'private design note' }, {
        permissions: ['PRODUCTION:WRITE'], accountId: designerId, auditContext: {},
      });
    }],
    ['PRODUCTION_QC_REJECTED', async () => {
      mockTaskUpdate({
        _id: taskId, shopId, orderItemId, status: 'QC_PENDING', qcStatus: 'NOT_READY',
        fileChecks: [{ _id: fileCheckId, required: true, outputAssetId, blockers: [] }],
      });
      await service.submitQc(taskId, { decision: 'REJECTED', note: 'private QC note' }, {
        permissions: ['PRODUCTION:WRITE'], accountId: qcUserId, auditContext: {},
      });
    }],
    ['PRODUCTION_SENT_TO_VENDOR', async () => {
      mockTaskUpdate({ _id: taskId, shopId, orderItemId, status: 'READY_TO_SEND_VENDOR' });
      await service.markSentToVendor(taskId, vendorSubmissionId, {
        permissions: ['PRODUCTION:WRITE'], accountId: designerId, auditContext: {},
      });
    }],
  ])('records sanitized %s evidence in the mutation transaction', async (action, execute) => {
    await execute();

    const [event, options] = auditPublic.record.mock.calls.at(-1);
    expect(event).toMatchObject({
      actorType: 'ACCOUNT', action, entityType: 'PRODUCTION_TASK', entityId: taskId,
      scopeType: 'SHOP', scopeId: shopId,
    });
    expect(options).toEqual({ session: mockSession });
    expect(JSON.stringify(event)).not.toMatch(/private (design|customer|QC) note/);
  });

  test('appends a manual file check atomically instead of replacing a stale array', async () => {
    const task = {
      _id: taskId, shopId, orderItemId, status: 'NEED_SCALE', qcStatus: 'NOT_READY',
      fileChecks: [{ _id: '660000000000000000100003', slotKey: 'BACK' }],
    };
    repository.findById.mockResolvedValueOnce(task);
    repository.appendFileCheckIfMutable.mockResolvedValueOnce({
      ...task,
      fileChecks: [...task.fileChecks, { _id: fileCheckId, slotKey: 'FRONT', required: false, sourceType: 'CUSTOMER_IMAGE' }],
    });
    repository.updateByIdIf.mockImplementationOnce(async (_id, _filter, patch) => ({
      ...task,
      fileChecks: [...task.fileChecks, { _id: fileCheckId, slotKey: 'FRONT', required: false, sourceType: 'CUSTOMER_IMAGE' }],
      ...patch,
    }));
    repository.updateFileCheckOutputIfMutable.mockImplementationOnce(async (_taskId, _fileCheckId, _expected, patch) => ({
      _id: taskId,
      shopId,
      orderItemId,
      status: 'NEED_SCALE',
      fileChecks: [{ _id: fileCheckId, required: true, blockers: [], ...patch }],
    }));

    await service.addManualFileCheck(taskId, { slotKey: 'FRONT' }, { permissions: ['PRODUCTION:WRITE'] });

    expect(repository.appendFileCheckIfMutable).toHaveBeenCalledWith(
      taskId, expect.objectContaining({ slotKey: 'FRONT' }), { session: mockSession },
    );
    expect(repository.updateScaledOutputIfMutable).not.toHaveBeenCalled();
  });

  test('updates one output using its authoritative same-status snapshot', async () => {
    const task = {
      _id: taskId, shopId, orderItemId, status: 'QC_PENDING', qcStatus: 'NOT_READY',
      fileChecks: [{
        _id: fileCheckId, outputAssetId: mediaAssetId, scaleStatus: 'SCALED', qcStatus: 'NOT_READY', blockers: [],
      }],
    };
    repository.findById.mockResolvedValueOnce(task);
    repository.updateFileCheckOutputIfMutable.mockResolvedValueOnce({
      ...task, fileChecks: [{ ...task.fileChecks[0], outputAssetId }],
    });
    repository.updateByIdIf.mockImplementationOnce(async (_id, _filter, patch) => ({
      ...task, fileChecks: [{ ...task.fileChecks[0], outputAssetId }], ...patch,
    }));

    await service.uploadScaledFile(taskId, fileCheckId, outputAssetId, { permissions: ['PRODUCTION:WRITE'] });

    expect(repository.updateFileCheckOutputIfMutable).toHaveBeenCalledWith(
      taskId,
      fileCheckId,
      expect.objectContaining({ outputAssetId: mediaAssetId, qcStatus: 'NOT_READY' }),
      expect.objectContaining({ outputAssetId }),
      { session: mockSession },
    );
    expect(repository.updateScaledOutputIfMutable).not.toHaveBeenCalled();
  });

  test('QC CAS includes file checks when concurrent writers keep the same qcStatus', async () => {
    const fileChecks = [{ _id: fileCheckId, required: true, outputAssetId, qcStatus: 'NOT_READY', blockers: [] }];
    mockTaskUpdate({
      _id: taskId, shopId, orderItemId, status: 'QC_PENDING', qcStatus: 'NOT_READY', fileChecks,
    });

    await service.submitQc(taskId, { decision: 'REJECTED', note: 'retry crop' }, {
      permissions: ['PRODUCTION:WRITE'],
    });

    expect(repository.updateByIdIf).toHaveBeenCalledWith(
      taskId,
      expect.objectContaining({ qcStatus: 'NOT_READY', fileChecks }),
      expect.any(Object),
      { session: mockSession },
    );
  });

  test('design assignment CAS includes the note when the assignment also patches it', async () => {
    mockTaskUpdate({
      _id: taskId, shopId, orderItemId, status: 'NEED_SCALE',
      assignedDesignUserId: null, designNote: 'first writer',
    });

    await service.assignDesignTask(taskId, {
      assignedDesignUserId: designerId,
      designNote: 'assignment note',
    }, { permissions: ['PRODUCTION:WRITE'] });

    expect(repository.updateByIdIf).toHaveBeenCalledWith(
      taskId,
      expect.objectContaining({ assignedDesignUserId: null, designNote: 'first writer' }),
      expect.objectContaining({ designNote: 'assignment note' }),
      { session: mockSession },
    );
  });

  test('CS assignment CAS includes the note when the assignment also patches it', async () => {
    mockTaskUpdate({
      _id: taskId, shopId, orderItemId, status: 'NEED_SCALE',
      csAssigneeId: null, csStatus: 'UNASSIGNED', csNote: 'first writer',
    });

    await service.assignCsTask(taskId, {
      csAssigneeId,
      csNote: 'assignment note',
    }, { permissions: ['PRODUCTION:WRITE'] });

    expect(repository.updateByIdIf).toHaveBeenCalledWith(
      taskId,
      expect.objectContaining({ csAssigneeId: null, csStatus: 'UNASSIGNED', csNote: 'first writer' }),
      expect.objectContaining({ csNote: 'assignment note' }),
      { session: mockSession },
    );
  });

  test('discards stored multipart media after audit rollback without masking the audit failure', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempPath = path.join(os.tmpdir(), `audit-failed-scaled-output-${Date.now()}.png`);
    const auditError = new Error('audit unavailable');
    fs.writeFileSync(tempPath, 'scaled');
    mockTaskUpdate({
      _id: taskId, shopId, orderItemId, status: 'QC_PENDING', qcStatus: 'NOT_READY',
      fileChecks: [{ _id: fileCheckId, outputAssetId: null, scaleStatus: 'NEED_SCALE', qcStatus: 'PENDING' }],
    });
    auditPublic.record.mockRejectedValueOnce(auditError);

    await expect(service.uploadScaledOutputFile(taskId, fileCheckId, {
      path: tempPath, originalname: 'replacement.png', mimetype: 'image/png', size: 6,
    }, { permissions: ['PRODUCTION:WRITE'], accountId: designerId })).rejects.toBe(auditError);

    expect(mediaPublic.discardUnattachedAsset).toHaveBeenCalledWith(
      outputAssetId,
      expect.objectContaining({ taskId, fileCheckId }),
      'PRODUCTION_ATTACHMENT_FAILED',
    );
  });

  test('keeps a true system cascade anonymous even when legacy context carries an account', async () => {
    mockTaskUpdate({ _id: taskId, shopId, orderItemId, status: 'NEED_SCALE', designNote: null });

    await service.updateDesignNote(taskId, { designNote: 'worker update' }, {
      permissions: ['PRODUCTION:WRITE'],
      accountId: designerId,
      system: true,
      auditContext: {},
    });

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'SYSTEM', actorAccountId: null, source: 'SYSTEM',
    }), { session: mockSession });
  });

  test('preserves the initiating account and HTTP source for a human vendor-submission cascade', async () => {
    mockTaskUpdate({ _id: taskId, shopId, orderItemId, status: 'READY_TO_SEND_VENDOR' });

    await service.markSentToVendor(taskId, vendorSubmissionId, {
      permissions: ['PRODUCTION:WRITE'],
      accountId: designerId,
      system: true,
      source: 'VENDOR_SUBMISSION',
      auditActorType: 'ACCOUNT',
      auditSource: 'HTTP',
    });

    expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'ACCOUNT', actorAccountId: designerId, source: 'HTTP',
    }), { session: mockSession });
  });

  test('recheck refreshes derived blockers while preserving current operator file state', async () => {
    const updatedAt = new Date('2026-07-28T10:00:00.000Z');
    const current = {
      _id: taskId,
      orderItemId,
      shopId,
      status: 'BLOCKED',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
      blockers: ['PSD_MISSING'],
      assignedDesignUserId: designerId,
      designNote: 'operator note',
      updatedAt,
      fileChecks: [{
        _id: fileCheckId,
        slotKey: 'FRONT',
        slotLabel: 'Old label',
        required: true,
        sourceType: 'CUSTOMER_IMAGE',
        inputAssetId: mediaAssetId,
        outputAssetId,
        scaleStatus: 'SCALED',
        qcStatus: 'NOT_READY',
        blockers: [],
        note: 'keep check note',
      }],
    };
    repository.findByOrderItem.mockResolvedValueOnce(current);
    repository.updateByIdIf.mockImplementationOnce(async (_id, _filter, patch) => ({ ...current, ...patch }));

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, {
      permissions: ['PRODUCTION:WRITE'],
    });

    expect(repository.findByOrderItem).toHaveBeenCalledWith(orderItemId, { session: mockSession });
    expect(repository.updateByIdIf).toHaveBeenCalledWith(
      taskId,
      { updatedAt },
      expect.objectContaining({
        status: 'NEED_SCALE', blockers: [],
        fileChecks: expect.arrayContaining([expect.objectContaining({
          _id: fileCheckId,
          slotKey: 'FRONT',
          slotLabel: 'Front',
          outputAssetId,
          qcStatus: 'NOT_READY',
          note: 'keep check note',
        })]),
      }),
      { session: mockSession },
    );
    expect(result).toMatchObject({
      status: 'NEED_SCALE', assignedDesignUserId: designerId, designNote: 'operator note',
    });
  });
});
