jest.mock('../../../modules/order/public', () => ({
  appendTimeline: jest.fn(),
  findById: jest.fn(),
  findItemById: jest.fn(),
  transitionItemStatus: jest.fn(),
}));

jest.mock('../../../modules/shop/public', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../modules/mapping/public', () => ({
  getFulfillmentPlanForOrderItem: jest.fn(),
}));

jest.mock('../../../modules/catalog/public', () => ({
  getInternalTemplateById: jest.fn(),
  getListingById: jest.fn(),
}));

jest.mock('../../../modules/customization/public', () => ({
  getOrderItemCustomizationView: jest.fn(),
  listOrderItemCustomizationViews: jest.fn(),
}));

jest.mock('../../../modules/media/public', () => ({
  assertMediaAssetExists: jest.fn(),
  storeAsset: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
  listAssignableProfiles: jest.fn(),
  listProfilesByAccountIds: jest.fn(),
  listProfilesByEmployeeCodes: jest.fn(),
}));

jest.mock('../../../modules/vendorSubmission/public', () => ({
  createFromProductionTask: jest.fn(),
  listLatestByProductionTaskIds: jest.fn(),
}));

jest.mock('../../../modules/design/public', () => ({
  createPsdTemplateTaskFromListing: jest.fn(),
}));

jest.mock('../../../modules/production/repositories/productionTask.repository', () => ({
  findById: jest.fn(),
  findByOrderItem: jest.fn(),
  list: jest.fn(),
  listForExport: jest.fn(),
  listByOrderItemIds: jest.fn(),
  listPsdBlockedByListingId: jest.fn(),
  listSummariesByOrderItemIds: jest.fn(),
  summarize: jest.fn(),
  updateById: jest.fn(),
  upsertByOrderItem: jest.fn(),
}));

const orderPublic = require('../../../modules/order/public');
const shopPublic = require('../../../modules/shop/public');
const mappingPublic = require('../../../modules/mapping/public');
const catalogPublic = require('../../../modules/catalog/public');
const customizationPublic = require('../../../modules/customization/public');
const mediaPublic = require('../../../modules/media/public');
const authPublic = require('../../../modules/auth/public');
const vendorSubmissionPublic = require('../../../modules/vendorSubmission/public');
const designPublic = require('../../../modules/design/public');
const repository = require('../../../modules/production/repositories/productionTask.repository');
const service = require('../../../modules/production/services/productionTask.service');

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

  function scopedShopAuth(accountId, permissions, scopeId = shopId) {
    return {
      accountId,
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId, permissions }],
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
    imageAssets: [{ assetId: mediaAssetId, secureUrl: 'https://example.test/image.png' }],
  };

  beforeEach(() => {
    jest.resetAllMocks();
    orderPublic.findById.mockResolvedValue(order);
    orderPublic.findItemById.mockResolvedValue(item);
    orderPublic.transitionItemStatus.mockResolvedValue({});
    orderPublic.appendTimeline.mockResolvedValue({});
    shopPublic.findById.mockResolvedValue({ _id: shopId, name: 'LNG Main Shop' });
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue(plan);
    catalogPublic.getListingById.mockResolvedValue(listing);
    catalogPublic.getInternalTemplateById.mockResolvedValue(template);
    customizationPublic.getOrderItemCustomizationView.mockResolvedValue(customization);
    customizationPublic.listOrderItemCustomizationViews.mockResolvedValue([]);
    mediaPublic.assertMediaAssetExists.mockResolvedValue({ id: outputAssetId });
    mediaPublic.storeAsset.mockResolvedValue({ id: outputAssetId });
    authPublic.listAssignableProfiles.mockResolvedValue([
      { accountId: designerId, fullName: 'Scale User', employeeCode: 'J2605' },
    ]);
    authPublic.listProfilesByAccountIds.mockResolvedValue([
      { accountId: '660000000000000000000904', fullName: 'Order Owner', employeeCode: 'CS01' },
      { accountId: csAssigneeId, fullName: 'CS User', employeeCode: 'CS02' },
      { accountId: qcUserId, fullName: 'QC User', employeeCode: 'QC01' },
    ]);
    authPublic.listProfilesByEmployeeCodes.mockResolvedValue([
      { employeeCode: 'J2605', fullName: 'Seller User' },
    ]);
    vendorSubmissionPublic.createFromProductionTask.mockResolvedValue({
      id: vendorSubmissionId,
      status: 'READY',
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
    repository.updateById.mockImplementation(async (_taskId, patch) => ({
      _id: taskId,
      shopId,
      orderItemId,
      ...task,
      ...patch,
    }));
  }

  test('blocks task creation when fulfillment plan is missing or not ready', async () => {
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValueOnce(null);

    await expect(service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });
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
      orderItemSnapshot: expect.objectContaining({
        externalOrderId: item.externalOrderId,
        externalItemId: item.externalItemId,
        externalAccountId: item.externalAccountId,
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        asin: item.asin,
        sku: item.sku,
        title: item.title,
        productImageUrl: null,
      }),
      orderSnapshot: expect.objectContaining({
        id: orderId,
        status: 'PROCESSING',
        assignedStaffId: '660000000000000000000904',
      }),
      customizationSnapshot: expect.objectContaining({
        status: customization.status || null,
        imageAssets: [expect.objectContaining({ assetId: mediaAssetId })],
      }),
    }));
    expect(repository.upsertByOrderItem.mock.calls[0][1]).not.toHaveProperty('vendorProductSnapshot');
    expect(repository.upsertByOrderItem.mock.calls[0][1]).not.toHaveProperty('vendorCostCenterSnapshot');
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
    expect(result.fileChecks[1]).toMatchObject({
      slotKey: 'FRONT',
      sourceType: 'CUSTOMER_IMAGE',
      inputAssetId: mediaAssetId,
      scaleStatus: 'NEED_SCALE',
      blockers: ['SCALED_OUTPUT_MISSING'],
    });
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'NEED_PRODUCTION', {
      source: 'PRODUCTION',
    });
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
      productTypeGroupId: { _id: '660000000000000000003001', code: 'SHIRT', name: 'Shirt', status: 'ACTIVE', raw: 'noise' },
      internalTemplateId: { _id: template.id, code: 'TS1S', name: 'Template', status: 'ACTIVE', __v: 7 },
      approvedBy: '660000000000000000000901',
      approvedAt: new Date('2026-07-01T00:00:00.000Z'),
      rejectionReason: 'noise',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      __v: 3,
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

    const payload = repository.upsertByOrderItem.mock.calls[0][1];
    expect(payload.listingSnapshot).toMatchObject({
      id: listing.id,
      title: 'Listing title',
      productTypeGroupId: { id: '660000000000000000003001', code: 'SHIRT', name: 'Shirt' },
    });
    expect(payload.listingSnapshot).not.toHaveProperty('shopId');
    expect(payload.listingSnapshot).not.toHaveProperty('costCenterStatus');
    expect(payload.templateSnapshot).toMatchObject({
      id: template.id,
      code: 'TS1S',
      artworkSlots: template.artworkSlots,
    });
    expect(payload).not.toHaveProperty('vendorProductSnapshot');
    expect(payload).not.toHaveProperty('vendorCostCenterSnapshot');
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
    expect(designPublic.createPsdTemplateTaskFromListing).toHaveBeenCalledWith(
      listing.id,
      { note: 'Auto-created from production PSD_MISSING blocker' },
      expect.objectContaining({
        system: true,
        source: 'PRODUCTION',
      }),
    );
  });

  test('does not auto-create PSD task when PSD is present', async () => {
    await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(designPublic.createPsdTemplateTaskFromListing).not.toHaveBeenCalled();
  });

  test('keeps production task creation successful when PSD task auto-create fails', async () => {
    catalogPublic.getListingById.mockResolvedValueOnce({ ...listing, psdTemplateAssetId: null });
    catalogPublic.getInternalTemplateById.mockResolvedValueOnce({ ...template, designAssets: [] });
    designPublic.createPsdTemplateTaskFromListing.mockRejectedValueOnce(new Error('design offline'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toEqual(expect.arrayContaining(['PSD_MISSING']));
    warnSpy.mockRestore();
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

  test('blocks with CUSTOMER_IMAGE_MISSING when required artwork slot has no customer image', async () => {
    customizationPublic.getOrderItemCustomizationView.mockResolvedValueOnce({ imageAssets: [] });

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toEqual(expect.arrayContaining(['CUSTOMER_IMAGE_MISSING']));
    expect(result.fileChecks[1]).toMatchObject({
      slotKey: 'FRONT',
      inputAssetId: null,
      blockers: ['CUSTOMER_IMAGE_MISSING'],
    });
  });

  test('blocks with TEMPLATE_NOT_FOUND when fulfillment plan template cannot be loaded', async () => {
    catalogPublic.getInternalTemplateById.mockResolvedValueOnce(null);

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toEqual(expect.arrayContaining(['TEMPLATE_NOT_FOUND']));
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
    repository.findByOrderItem.mockResolvedValueOnce({
      _id: taskId,
      assignedDesignUserId: designerId,
      assignedAt,
      designNote: 'Rush design',
    });

    const result = await service.createOrRecheckTaskForOrderItem(orderItemId, { permissions: ['PRODUCTION:WRITE'] });

    expect(repository.upsertByOrderItem).toHaveBeenCalledWith(orderItemId, expect.objectContaining({
      assignedDesignUserId: designerId,
      assignedAt,
      designNote: 'Rush design',
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
      groupId: 'scale-group-1',
      groupType: 'SCALE',
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

    expect(authPublic.listAssignableProfiles).toHaveBeenCalledWith({
      search: 'J26',
      limit: 10,
      requiredPermission: 'DESIGN:WORK',
    });
    expect(result).toEqual({
      items: [{ id: designerId, fullName: 'Scale User', employeeCode: 'J2605' }],
    });
  });

  test('getCsAssignees returns active production-write employee refs', async () => {
    const result = await service.getCsAssignees({ search: 'CS', limit: 10 }, {
      permissions: ['PRODUCTION:READ'],
    });

    expect(authPublic.listAssignableProfiles).toHaveBeenCalledWith({
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
      listingSnapshot: { id: listing.id },
    }]);

    const result = await service.listPsdBlockedTasksByListing(listing.id);

    expect(repository.listPsdBlockedByListingId).toHaveBeenCalledWith(listing.id);
    expect(result).toEqual([{
      id: taskId,
      orderItemId,
      shopId,
      blockers: ['PSD_MISSING'],
    }]);
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
    authPublic.listProfilesByAccountIds.mockResolvedValueOnce([
      { accountId: designerId, fullName: 'Scale User', employeeCode: 'SC01' },
      { accountId: qcUserId, fullName: 'QC User', employeeCode: 'QC01' },
    ]);

    const [summary] = await service.listTaskSummariesByOrderItemIds([orderItemId], { system: true });

    expect(authPublic.listProfilesByAccountIds).toHaveBeenCalledWith([designerId, qcUserId]);
    expect(summary.assignedDesigner).toMatchObject({ id: designerId, fullName: 'Scale User' });
    expect(summary.qcUser).toMatchObject({ id: qcUserId, fullName: 'QC User' });
    expect(summary).not.toHaveProperty('scaleByUser');
    expect(summary).not.toHaveProperty('qcByUser');
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

  test('bulk assign reports inaccessible and not assignable tasks without stopping valid tasks', async () => {
    const authPublic = require('../../../modules/auth/public');
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

    expect(authPublic.listAssignableProfiles).toHaveBeenCalledWith({
      accountIds: [designerId],
      limit: 1,
      requiredPermission: 'DESIGN:WORK',
    });
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
    }));
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

    expect(authPublic.listAssignableProfiles).toHaveBeenCalledWith({
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
    authPublic.listAssignableProfiles.mockResolvedValueOnce([]);
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

    const authContext = scopedShopAuth(designerId, ['DESIGN:WORK']);
    const claimResult = await service.claimDesignTask(taskId, authContext);
    const uploadResult = await service.uploadScaledFile(taskId, fileCheckId, outputAssetId, authContext);

    expect(claimResult).toMatchObject({ assignedDesignUserId: designerId });
    expect(uploadResult).toMatchObject({ scaleStatus: 'SCALED' });
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
    }));
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
    }));
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

  test('upload scaled output moves task to QC_PENDING', async () => {
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{
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
      status: 'QC_PENDING',
      scaleStatus: 'SCALED',
      qcStatus: 'PENDING',
    });
    expect(result.fileChecks[0]).toMatchObject({
      outputAssetId,
      scaleStatus: 'SCALED',
      qcStatus: 'PENDING',
      blockers: [],
    });
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'IN_PRODUCTION', {
      source: 'PRODUCTION',
    });
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'PRODUCTION_SCALED_FILE_UPLOADED',
      source: 'PRODUCTION',
    }));
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
        qcStatus: 'PENDING',
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
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'READY_TO_SEND_VENDOR', {
      source: 'PRODUCTION',
    });
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'PRODUCTION_QC_PASSED',
      source: 'PRODUCTION',
    }));
    expect(vendorSubmissionPublic.createFromProductionTask).toHaveBeenCalledWith(taskId, expect.objectContaining({
      permissions: ['PRODUCTION:WRITE'],
      system: true,
      source: 'PRODUCTION',
    }));
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
        qcStatus: 'PENDING',
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

  test('QC pass still succeeds when auto vendor submission creation fails', async () => {
    vendorSubmissionPublic.createFromProductionTask.mockRejectedValueOnce(new Error('temporary outage'));
    mockTaskUpdate({
      _id: taskId,
      shopId,
      orderItemId,
      fileChecks: [{
        _id: fileCheckId,
        required: true,
        outputAssetId,
        qcStatus: 'PENDING',
        blockers: [],
      }],
    });

    const result = await service.submitQc(taskId, { decision: 'PASSED' }, { permissions: ['PRODUCTION:WRITE'] });

    expect(result.status).toBe('READY_TO_SEND_VENDOR');
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'READY_TO_SEND_VENDOR', {
      source: 'PRODUCTION',
    });
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
        qcStatus: 'PENDING',
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
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'QC_REJECTED', {
      source: 'PRODUCTION',
    });
    expect(vendorSubmissionPublic.createFromProductionTask).not.toHaveBeenCalled();
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
        qcStatus: 'PENDING',
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
        { _id: fileCheckId, required: true, outputAssetId, qcStatus: 'PENDING', blockers: [] },
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
    expect(orderPublic.transitionItemStatus).toHaveBeenCalledWith(orderItemId, 'SENT_TO_VENDOR', {
      source: 'PRODUCTION',
    });
    expect(orderPublic.appendTimeline).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'VENDOR_SUBMISSION_SENT',
      source: 'PRODUCTION',
    }));
  });

  test('bulk push vendor sends ready tasks and reports failures', async () => {
    repository.findById
      .mockResolvedValueOnce({ _id: taskId, shopId, orderItemId, status: 'READY_TO_SEND_VENDOR' })
      .mockResolvedValueOnce({ _id: '660000000000000000100099', shopId, orderItemId, status: 'QC_PENDING' });
    repository.updateById.mockImplementation(async (id, patch) => ({ _id: id, shopId, orderItemId, ...patch }));

    const result = await service.bulkPushVendor({
      taskIds: [taskId, '660000000000000000100099'],
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
      qcStatus: 'PENDING',
      blockers: [],
    }]);

    const result = await service.exportQcTasksExcel({ qcStatus: 'PENDING', sellerCode: 'J2605' }, { permissions: ['PRODUCTION:READ'] });

    expect(repository.listForExport).toHaveBeenCalledWith(expect.objectContaining({
      qcStatus: 'PENDING',
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
    const authPublic = require('../../../modules/auth/public');
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
    const authPublic = require('../../../modules/auth/public');
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
});
