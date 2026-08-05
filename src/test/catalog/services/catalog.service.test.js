jest.mock('../../../modules/catalog/repositories/productTypeGroup.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/catalog/repositories/listing.repository', () => ({
  create: jest.fn(),
  findByAsin: jest.fn(),
  findById: jest.fn(),
  findSummariesByIds: jest.fn(),
  findBySku: jest.fn(),
  list: jest.fn(),
  listForSalesSort: jest.fn(),
  summarize: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/catalog/repositories/internalTemplate.repository', () => ({
  findById: jest.fn(),
  findByIds: jest.fn(),
  list: jest.fn(),
}));

jest.mock('../../../modules/shop/public', () => ({
  findById: jest.fn(),
  assertShopIsActive: jest.fn(),
  listActiveShops: jest.fn(),
}));

jest.mock('../../../modules/media/public', () => ({
  assertMediaAssetExists: jest.fn(),
  getAsset: jest.fn(),
  getAssetsByIds: jest.fn(),
  storeAsset: jest.fn(),
}));

jest.mock('../../../modules/design/public', () => ({
  createPsdTemplateTaskFromListing: jest.fn(),
  resolveActivePsdTaskForListing: jest.fn(),
}));

jest.mock('../../../modules/production/public', () => ({
  recheckPsdBlockedTasksByListing: jest.fn(),
}));

jest.mock('../../../modules/order/public', () => ({
  summarizeSalesByListingIds: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../modules/hr/public', () => ({
  listEmployeeProfilesByEmployeeCodes: jest.fn(),
}));

jest.mock('../../../shared/utils/logger', () => ({
  warn: jest.fn(),
}));

jest.mock('../../../shared/network/safeRemoteFetchStream', () => ({
  safeRemoteFetchStream: jest.fn(),
  redactUrl: jest.fn(() => 'https://m.media-amazon.com/[REDACTED_PATH]'),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const errorCodes = require('../../../shared/constants/errorCodes');
const authPublic = require('../../../modules/auth/public');
const hrPublic = require('../../../modules/hr/public');
const designPublic = require('../../../modules/design/public');
const mediaPublic = require('../../../modules/media/public');
const orderPublic = require('../../../modules/order/public');
const productionPublic = require('../../../modules/production/public');
const shopPublic = require('../../../modules/shop/public');
const groupRepository = require('../../../modules/catalog/repositories/productTypeGroup.repository');
const listingRepository = require('../../../modules/catalog/repositories/listing.repository');
const templateRepository = require('../../../modules/catalog/repositories/internalTemplate.repository');
const logger = require('../../../shared/utils/logger');
const { safeRemoteFetchStream } = require('../../../shared/network/safeRemoteFetchStream');
const service = require('../../../modules/catalog/services/catalog.service');

describe('catalog.service', () => {
  const shopId = '660000000000000000000201';
  const otherShopId = '660000000000000000000202';
  const listingId = '660000000000000000000401';
  const groupId = '660000000000000000000301';
  const templateId = '660000000000000000000701';
  const previewAssetId = '660000000000000000000902';

  function listingFixture(overrides = {}) {
    return {
      _id: listingId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: { _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' },
      internalTemplateId: null,
      psdTemplateAssetId: null,
      psdStatus: 'MISSING',
      status: 'ACTIVE',
      qcStatus: 'DRAFT',
      ...overrides,
    };
  }

  function templateFixture(overrides = {}) {
    return {
      _id: templateId,
      productTypeGroupId: groupId,
      code: 'SHIRT_MAIN',
      name: 'Shirt Main',
      status: 'ACTIVE',
      requiresPsd: true,
      designAssets: [],
      ...overrides,
    };
  }

  function scopedShopAuth(permissions, scopedShopId = shopId) {
    return {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: scopedShopId, permissions }],
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockImplementation((authContext = {}, permission, scope = {}) => (
      (authContext.scopes || []).some((grantedScope) => (
        grantedScope.scopeType === scope.scopeType
        && String(grantedScope.scopeId) === String(scope.scopeId)
        && (grantedScope.permissions || []).includes(permission)
      ))
    ));
    hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValue([]);
    shopPublic.assertShopIsActive.mockResolvedValue({ _id: shopId, status: 'ACTIVE' });
    groupRepository.findById.mockResolvedValue({ _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' });
    templateRepository.findById.mockResolvedValue({
      _id: templateId,
      productTypeGroupId: groupId,
      code: 'SHIRT_MAIN',
      name: 'Shirt Main',
      status: 'ACTIVE',
    });
    designPublic.createPsdTemplateTaskFromListing.mockResolvedValue({ id: '660000000000000000000801' });
    mediaPublic.storeAsset.mockResolvedValue({
      _id: '660000000000000000000901',
      mimeType: 'application/octet-stream',
      size: 10,
      sha256: 'hash',
    });
    mediaPublic.getAssetsByIds.mockResolvedValue([]);
    designPublic.resolveActivePsdTaskForListing.mockResolvedValue({
      resolved: true,
      taskId: '660000000000000000000802',
      status: 'APPROVED',
    });
    productionPublic.recheckPsdBlockedTasksByListing.mockResolvedValue({
      checked: 1,
      cleared: 1,
      stillBlocked: 0,
      failed: 0,
      items: [],
    });
    safeRemoteFetchStream.mockResolvedValue({
      stream: Readable.from([Buffer.from([0x89, 0x50, 0x4E, 0x47])]),
      metadata: {
        contentType: 'image/png',
        finalUrlRedacted: 'https://m.media-amazon.com/[REDACTED_PATH]',
        classification: 'png',
      },
    });
  });

  test('createProductTypeGroup passes sortOrder and returns it in DTO', async () => {
    groupRepository.create.mockResolvedValue({
      _id: groupId,
      code: 'SHIRT',
      name: 'Shirt',
      sortOrder: 10,
      status: 'ACTIVE',
    });

    const result = await service.createProductTypeGroup({
      code: 'SHIRT',
      name: 'Shirt',
      sortOrder: 10,
    });

    expect(groupRepository.create).toHaveBeenCalledWith({
      code: 'SHIRT',
      name: 'Shirt',
      sortOrder: 10,
    });
    expect(result).toMatchObject({ id: groupId, sortOrder: 10 });
  });

  test('resolves PSD readiness from an active template asset when Listing has no direct PSD', async () => {
    listingRepository.findById.mockResolvedValue({
      _id: listingId,
      shopId,
      internalTemplateId: templateId,
      psdTemplateAssetId: null,
      psdStatus: 'MISSING',
    });
    mediaPublic.getAsset.mockResolvedValue({
      _id: previewAssetId,
      originalFilename: 'template.psd',
      mimeType: 'application/octet-stream',
    });
    templateRepository.findById.mockResolvedValue({
      _id: templateId,
      status: 'ACTIVE',
      requiresPsd: true,
      designAssets: [{
        type: 'PSD_TEMPLATE',
        mediaAssetId: previewAssetId,
        status: 'ACTIVE',
      }],
    });

    await expect(service.getListingPsdReadiness(listingId)).resolves.toEqual({
      required: true,
      status: 'PRESENT',
      effectivePsdAssetId: previewAssetId,
      source: 'TEMPLATE',
    });
  });

  test('loads listing template and media references concurrently', async () => {
    let resolveTemplates;
    let resolveAssets;
    const templates = new Promise((resolve) => { resolveTemplates = resolve; });
    const assets = new Promise((resolve) => { resolveAssets = resolve; });
    listingRepository.findSummariesByIds.mockResolvedValue([
      listingFixture({ internalTemplateId: templateId, previewAssetId }),
    ]);
    templateRepository.findByIds.mockReturnValue(templates);
    mediaPublic.getAssetsByIds.mockReturnValue(assets);

    const resultPromise = service.getListingSummariesByIds([listingId]);
    await Promise.resolve();

    expect(templateRepository.findByIds).toHaveBeenCalledWith([templateId]);
    expect(mediaPublic.getAssetsByIds).toHaveBeenCalledWith([previewAssetId]);

    resolveTemplates([templateFixture()]);
    resolveAssets([{ _id: previewAssetId, url: 'https://example.test/preview.png' }]);
    const [result] = await resultPromise;
    expect(result.internalTemplateDetail._id).toBe(templateId);
    expect(result.previewAsset._id).toBe(previewAssetId);
  });

  test('getListingOptions limits shops to scoped catalog access', async () => {
    shopPublic.listActiveShops.mockResolvedValue([{
      _id: shopId,
      name: 'Acc1',
      currency: 'USD',
      status: 'ACTIVE',
    }]);
    groupRepository.list.mockResolvedValue({
      items: [{ _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' }],
    });
    templateRepository.list.mockResolvedValue({
      items: [templateFixture()],
    });

    const result = await service.getListingOptions(scopedShopAuth(['CATALOG:WRITE']));

    expect(shopPublic.listActiveShops).toHaveBeenCalledWith({ shopIds: [shopId] });
    expect(result).toMatchObject({
      shops: [{ id: shopId, name: 'Acc1', currency: 'USD', status: 'ACTIVE' }],
      productTypeGroups: [{ id: groupId, code: 'SHIRT' }],
      internalTemplates: [{ id: templateId, code: 'SHIRT_MAIN' }],
    });
  });

  test('getListingOptions returns all active shops for global catalog access', async () => {
    shopPublic.listActiveShops.mockResolvedValue([]);
    groupRepository.list.mockResolvedValue({ items: [] });
    templateRepository.list.mockResolvedValue({ items: [] });

    await service.getListingOptions({ permissions: ['CATALOG:READ'], scopes: [] });

    expect(shopPublic.listActiveShops).toHaveBeenCalledWith({ shopIds: undefined });
  });

  test('filters Listings by effective PSD readiness before pagination', async () => {
    listingRepository.listForSalesSort.mockResolvedValue([
      listingFixture({ _id: '660000000000000000000411', psdTemplateAssetId: '660000000000000000000911' }),
      listingFixture({ _id: '660000000000000000000412', internalTemplateId: '660000000000000000000711' }),
      listingFixture({ _id: '660000000000000000000413', internalTemplateId: '660000000000000000000712' }),
      listingFixture({ _id: '660000000000000000000414' }),
    ]);
    templateRepository.findByIds.mockResolvedValue([
      templateFixture({
        _id: '660000000000000000000711',
        designAssets: [{ type: 'PSD_TEMPLATE', status: 'ACTIVE', mediaAssetId: '660000000000000000000912' }],
      }),
      templateFixture({ _id: '660000000000000000000712', requiresPsd: false }),
    ]);

    const result = await service.listListings(
      { page: 1, limit: 20, psdReadinessStatus: 'MISSING' },
      { permissions: ['CATALOG:READ'], scopes: [] },
    );

    expect(result.items.map(({ id }) => id)).toEqual(['660000000000000000000414']);
    expect(result.pagination.total).toBe(1);
  });

  test('summary counts only effective missing PSD Listings', async () => {
    listingRepository.summarize.mockResolvedValue({
      totalListingCount: 3,
      amazonListingCount: 3,
      etsyListingCount: 0,
      noPsdCount: 3,
      draftCount: 3,
      approvedCount: 0,
      rejectedCount: 0,
    });
    listingRepository.listForSalesSort.mockResolvedValue([
      listingFixture({ _id: '660000000000000000000412', internalTemplateId: '660000000000000000000711' }),
      listingFixture({ _id: '660000000000000000000413', internalTemplateId: '660000000000000000000712' }),
      listingFixture({ _id: '660000000000000000000414' }),
    ]);
    templateRepository.findByIds.mockResolvedValue([
      templateFixture({
        _id: '660000000000000000000711',
        designAssets: [{ type: 'PSD_TEMPLATE', status: 'ACTIVE', mediaAssetId: '660000000000000000000912' }],
      }),
      templateFixture({ _id: '660000000000000000000712', requiresPsd: false }),
    ]);

    await expect(
      service.getListingSummary({}, { permissions: ['CATALOG:READ'], scopes: [] }),
    ).resolves.toMatchObject({ totalListingCount: 3, noPsdCount: 1 });
  });

  test('scoped catalog read includes shops with READ or WRITE access', async () => {
    listingRepository.list.mockResolvedValue({
      items: [{
        _id: listingId,
        shopId,
        sku: 'SKU-1',
        title: 'Test Listing',
        productTypeGroupId: { _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' },
        psdStatus: 'MISSING',
        status: 'ACTIVE',
        qcStatus: 'REJECTED',
        approvedBy: '660000000000000000000901',
        rejectedBy: '660000000000000000000902',
        rejectionReason: 'Too broad for list',
      }],
      total: 1,
      page: 1,
      limit: 20,
    });

    const result = await service.listListings(
      { page: 1, limit: 20 },
      {
        permissions: [],
        scopes: [
          { scopeType: 'shop', scopeId: shopId, permissions: ['CATALOG:READ'] },
          { scopeType: 'shop', scopeId: otherShopId, permissions: ['CATALOG:WRITE'] },
        ],
      },
    );

    expect(listingRepository.list).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      shopIds: [shopId, otherShopId],
    });
    expect(result.items[0]).toMatchObject({
      id: listingId,
      sku: 'SKU-1',
      qcStatus: 'REJECTED',
    });
    expect(result.items[0]).not.toHaveProperty('approvedBy');
    expect(result.items[0]).not.toHaveProperty('rejectedBy');
    expect(result.items[0]).not.toHaveProperty('rejectionReason');
  });

  test('out-of-scope list returns empty page', async () => {
    const result = await service.listListings(
      { page: 2, limit: 10, shopId: otherShopId },
      { permissions: [], scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['CATALOG:READ'] }] },
    );

    expect(listingRepository.list).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      pagination: { total: 0, page: 2, limit: 10 },
    });
  });

  test('out-of-scope detail throws 403', async () => {
    authPublic.canAccessScope.mockReturnValue(false);
    listingRepository.findById.mockResolvedValue({ _id: listingId, shopId: otherShopId });

    await expect(service.getListing(listingId, {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['CATALOG:READ'] }],
    })).rejects.toMatchObject({ code: errorCodes.AUTHORIZATION_ERROR, statusCode: 403 });
  });

  test('shop-scoped CATALOG:WRITE can read listings in its shop', async () => {
    const createdAt = new Date('2026-06-26T00:00:00.000Z');
    const psdAssetId = '660000000000000000000901';
    shopPublic.findById.mockResolvedValue({ _id: shopId, name: 'Acc1', status: 'ACTIVE' });
    mediaPublic.getAssetsByIds.mockResolvedValue([
      {
        _id: psdAssetId,
        originalFilename: 'approved-template.psd',
        mimeType: 'application/octet-stream',
        size: 2048,
        provider: 'local',
      },
    ]);
    listingRepository.list.mockResolvedValue({
      items: [{ _id: listingId, shopId, sku: 'SKU-1', status: 'ACTIVE', createdAt, psdTemplateAssetId: psdAssetId }],
      total: 1,
      page: 1,
      limit: 20,
    });
    listingRepository.findById.mockResolvedValue({ _id: listingId, shopId, sku: 'SKU-1', status: 'ACTIVE' });

    const list = await service.listListings({ page: 1, limit: 20 }, scopedShopAuth(['CATALOG:WRITE']));
    const detail = await service.getListing(listingId, scopedShopAuth(['CATALOG:WRITE']));

    expect(listingRepository.list).toHaveBeenCalledWith(expect.objectContaining({
      shopIds: [shopId],
    }));
    expect(list.items).toHaveLength(1);
    expect(list.items[0].createdAt).toBe(createdAt);
    expect(list.items[0].shop).toEqual({ id: shopId, name: 'Acc1', status: 'ACTIVE' });
    expect(list.items[0].psdTemplateAsset).toMatchObject({
      assetId: psdAssetId,
      originalFilename: 'approved-template.psd',
      downloadUrl: `/api/media/assets/${psdAssetId}/download`,
    });
    expect(detail).toMatchObject({ id: listingId, shopId });
  });

  test('listListings derives seller name from SKU employee code', async () => {
    listingRepository.list.mockResolvedValue({
      items: [{
        _id: listingId,
        shopId,
        sku: 'J2508-TS2S-280226-2017',
        title: 'Test Listing',
        status: 'ACTIVE',
      }],
      total: 1,
      page: 1,
      limit: 20,
    });
    hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValue([
      { employeeCode: 'J2508', fullName: 'Nguyen Duc Son' },
    ]);

    const result = await service.listListings(
      { page: 1, limit: 20 },
      { permissions: ['CATALOG:READ'], scopes: [] },
    );

    expect(hrPublic.listEmployeeProfilesByEmployeeCodes).toHaveBeenCalledWith(['J2508']);
    expect(result.items[0].seller).toEqual({
      employeeCode: 'J2508',
      name: 'Nguyen Duc Son',
    });
  });

  test('listListings does not treat generic SKU prefix as seller code', async () => {
    listingRepository.list.mockResolvedValue({
      items: [{ _id: listingId, shopId, sku: 'SKU-01', status: 'ACTIVE' }],
      total: 1,
      page: 1,
      limit: 20,
    });

    const result = await service.listListings(
      { page: 1, limit: 20 },
      { permissions: ['CATALOG:READ'], scopes: [] },
    );

    expect(hrPublic.listEmployeeProfilesByEmployeeCodes).not.toHaveBeenCalled();
    expect(result.items[0].seller).toBeNull();
  });

  test('listListings can sort by most ordered listings', async () => {
    const listingA = '660000000000000000000411';
    const listingB = '660000000000000000000412';
    listingRepository.listForSalesSort.mockResolvedValue([
      { _id: listingA, shopId, sku: 'SKU-A', status: 'ACTIVE' },
      { _id: listingB, shopId, sku: 'SKU-B', status: 'ACTIVE' },
    ]);
    orderPublic.summarizeSalesByListingIds.mockResolvedValue([
      { listingId: listingA, orderCount: 1, orderItemCount: 1, quantitySold: 1 },
      { listingId: listingB, orderCount: 3, orderItemCount: 3, quantitySold: 4 },
    ]);

    const result = await service.listListings(
      { page: 1, limit: 10, sort: 'orderCountDesc' },
      { permissions: ['CATALOG:READ'], scopes: [] },
    );

    expect(listingRepository.list).not.toHaveBeenCalled();
    expect(result.items.map((item) => item.id)).toEqual([listingB, listingA]);
    expect(result.items[0].salesStats.orderCount).toBe(3);
  });

  test('shop-scoped CATALOG:WRITE cannot read another shop list', async () => {
    const result = await service.listListings(
      { shopId: otherShopId },
      scopedShopAuth(['CATALOG:WRITE']),
    );

    expect(listingRepository.list).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      pagination: { total: 0, page: 1, limit: 20 },
    });
  });

  test('createListing validates shop and product type group through public/repository ports', async () => {
    listingRepository.create.mockResolvedValue({
      _id: listingId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: 'B0TESTASIN',
      etsyListingId: null,
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: { _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' },
      previewAssetId,
      baseCostAmount: 1200,
      currency: 'USD',
      costCenterStatus: 'PRESENT',
      psdStatus: 'MISSING',
      status: 'ACTIVE',
      qcStatus: 'DRAFT',
    });

    const result = await service.createListing({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: groupId,
      previewAssetId,
      asin: 'b0testasin',
      baseCostAmount: 1200,
    }, { permissions: ['CATALOG:WRITE'], scopes: [] });

    expect(shopPublic.assertShopIsActive).toHaveBeenCalledWith(shopId);
    expect(groupRepository.findById).toHaveBeenCalledWith(groupId);
    expect(result).toMatchObject({
      id: listingId,
      asin: 'B0TESTASIN',
      etsyListingId: null,
      sku: 'SKU-1',
      previewAssetId,
      previewAsset: {
        assetId: previewAssetId,
        downloadUrl: `/api/media/assets/${previewAssetId}/download`,
      },
      baseCostAmount: 1200,
      qcStatus: 'DRAFT',
    });
    expect(mediaPublic.assertMediaAssetExists).toHaveBeenCalledWith(previewAssetId);
    mediaPublic.storeAsset.mockResolvedValue({
      _id: '660000000000000000000901',
      mimeType: 'application/octet-stream',
      size: 10,
      sha256: 'hash',
    });
  });

  test('createListing creates PSD design task when PSD is missing', async () => {
    listingRepository.create.mockResolvedValue({
      _id: listingId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: { _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' },
      psdStatus: 'MISSING',
      status: 'ACTIVE',
      qcStatus: 'DRAFT',
    });

    await service.createListing({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: groupId,
    }, { permissions: ['CATALOG:WRITE'], scopes: [] });

    expect(designPublic.createPsdTemplateTaskFromListing).toHaveBeenCalledWith(listingId, {
      note: 'Auto-created from manual listing missing PSD',
    }, expect.objectContaining({
      system: true,
      source: 'CATALOG',
    }));
  });

  test.each([
    ['template PSD', templateFixture({
      designAssets: [{ type: 'PSD_TEMPLATE', status: 'ACTIVE', mediaAssetId: '660000000000000000000912' }],
    })],
    ['PSD not required', templateFixture({ requiresPsd: false })],
  ])('createListing does not create a PSD task when readiness comes from %s', async (label, activeTemplate) => {
    templateRepository.findById.mockResolvedValue(activeTemplate);
    listingRepository.create.mockResolvedValue(listingFixture({ internalTemplateId: templateId }));

    await service.createListing({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: groupId,
      internalTemplateId: templateId,
    }, { permissions: ['CATALOG:WRITE'], scopes: [] });

    expect(label).toBeTruthy();
    expect(designPublic.createPsdTemplateTaskFromListing).not.toHaveBeenCalled();
  });

  test('createListing keeps listing created when PSD design task fails', async () => {
    designPublic.createPsdTemplateTaskFromListing.mockRejectedValue(new Error('design unavailable'));
    listingRepository.create.mockResolvedValue({
      _id: listingId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: { _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' },
      psdStatus: 'MISSING',
      status: 'ACTIVE',
      qcStatus: 'DRAFT',
    });

    const result = await service.createListing({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: groupId,
    }, { permissions: ['CATALOG:WRITE'], scopes: [] });

    expect(result).toMatchObject({ id: listingId, psdStatus: 'MISSING' });
    expect(logger.warn).toHaveBeenCalledWith('Auto PSD design task trigger skipped from catalog listing create', expect.objectContaining({
      listingId,
      error: expect.any(Error),
    }));
  });

  test('scoped CATALOG:READ summary counts only assigned shops', async () => {
    listingRepository.summarize.mockResolvedValue({
      totalListingCount: 2,
      amazonListingCount: 1,
      etsyListingCount: 1,
      noPsdCount: 1,
      draftCount: 1,
      approvedCount: 1,
      rejectedCount: 0,
    });
    listingRepository.listForSalesSort.mockResolvedValue([
      listingFixture({ _id: '660000000000000000000421' }),
      listingFixture({
        _id: '660000000000000000000422',
        psdTemplateAssetId: '660000000000000000000921',
      }),
    ]);

    const result = await service.getListingSummary(
      { productTypeGroupId: groupId },
      {
        permissions: [],
        scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['CATALOG:READ'] }],
      },
    );

    expect(listingRepository.summarize).toHaveBeenCalledWith({
      productTypeGroupId: groupId,
      shopIds: [shopId],
    });
    expect(result).toMatchObject({ totalListingCount: 2, noPsdCount: 1 });
  });

  test('out-of-scope summary returns zero counts', async () => {
    const result = await service.getListingSummary(
      { shopId: otherShopId },
      {
        permissions: [],
        scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['CATALOG:READ'] }],
      },
    );

    expect(listingRepository.summarize).not.toHaveBeenCalled();
    expect(result).toEqual({
      totalListingCount: 0,
      amazonListingCount: 0,
      etsyListingCount: 0,
      noPsdCount: 0,
      draftCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
    });
  });

  test('createListing supports Etsy listing id', async () => {
    listingRepository.create.mockResolvedValue({
      _id: listingId,
      shopId,
      salesChannelCode: 'ETSY',
      marketplaceCode: 'ETSY_US',
      etsyListingId: '1234567890',
      sku: 'SKU-1',
      title: 'Etsy Listing',
      productTypeGroupId: { _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' },
      status: 'ACTIVE',
      qcStatus: 'DRAFT',
    });

    const result = await service.createListing({
      shopId,
      salesChannelCode: 'ETSY',
      marketplaceCode: 'ETSY_US',
      sku: 'SKU-1',
      title: 'Etsy Listing',
      productTypeGroupId: groupId,
      etsyListingId: '1234567890',
    }, { permissions: ['CATALOG:WRITE'], scopes: [] });

    expect(listingRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      salesChannelCode: 'ETSY',
      etsyListingId: '1234567890',
    }));
    expect(result).toMatchObject({ etsyListingId: '1234567890', qcStatus: 'DRAFT' });
  });

  test('createListing with valid internalTemplateId succeeds', async () => {
    listingRepository.create.mockResolvedValue({
      _id: listingId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: { _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' },
      internalTemplateId: { _id: templateId, code: 'SHIRT_MAIN', name: 'Shirt Main', status: 'ACTIVE' },
      status: 'ACTIVE',
    });
    templateRepository.findByIds.mockResolvedValue([]);

    const result = await service.createListing({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: groupId,
      internalTemplateId: templateId,
    }, { permissions: ['CATALOG:WRITE'], scopes: [] });

    expect(templateRepository.findById).toHaveBeenCalledWith(templateId);
    expect(result.internalTemplate).toMatchObject({ id: templateId, code: 'SHIRT_MAIN' });
  });

  test('createListing rejects template product type mismatch', async () => {
    templateRepository.findById.mockResolvedValue({
      _id: templateId,
      productTypeGroupId: '660000000000000000000302',
      status: 'ACTIVE',
    });

    await expect(service.createListing({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: groupId,
      internalTemplateId: templateId,
    }, { permissions: ['CATALOG:WRITE'], scopes: [] })).rejects.toMatchObject({
      code: errorCodes.CONFLICT_ERROR,
      statusCode: 409,
    });
  });

  test('createListing rejects inactive internalTemplateId', async () => {
    templateRepository.findById.mockResolvedValue({ _id: templateId, productTypeGroupId: groupId, status: 'INACTIVE' });

    await expect(service.createListing({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: groupId,
      internalTemplateId: templateId,
    }, { permissions: ['CATALOG:WRITE'], scopes: [] })).rejects.toMatchObject({
      code: errorCodes.CONFLICT_ERROR,
      statusCode: 409,
    });
  });

  test('inactive product type group cannot be used for listing', async () => {
    groupRepository.findById.mockResolvedValue({
      _id: groupId,
      code: 'SHIRT',
      name: 'Shirt',
      status: 'INACTIVE',
    });

    await expect(service.createListing({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: groupId,
    }, { permissions: ['CATALOG:WRITE'], scopes: [] })).rejects.toMatchObject({
      code: errorCodes.CONFLICT_ERROR,
      statusCode: 409,
    });
    expect(listingRepository.create).not.toHaveBeenCalled();
  });

  test('updateListing does not pass identity fields to repository', async () => {
    listingRepository.findById.mockResolvedValue({ _id: listingId, shopId });
    listingRepository.update.mockResolvedValue({
      _id: listingId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Updated',
      asin: 'B0UPDATED',
      etsyListingId: '1234567890',
      productTypeGroupId: { _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' },
      status: 'ACTIVE',
      qcStatus: 'DRAFT',
    });

    await service.updateListing(listingId, {
      shopId: otherShopId,
      salesChannelCode: 'ETSY',
      marketplaceCode: 'ETSY_US',
      sku: 'SKU-2',
      title: 'Updated',
      asin: 'b0updated',
      etsyListingId: '1234567890',
      psdStatus: 'MISSING',
    }, { permissions: ['CATALOG:WRITE'], scopes: [] });

    expect(listingRepository.update).toHaveBeenCalledWith(listingId, {
      title: 'Updated',
      asin: 'b0updated',
      etsyListingId: '1234567890',
    });
  });

  test('rejects a non-PSD media asset as a Listing PSD template', async () => {
    listingRepository.findById.mockResolvedValue({ _id: listingId, shopId });
    mediaPublic.getAsset.mockResolvedValue({
      _id: previewAssetId,
      originalFilename: 'robot.png',
      mimeType: 'image/png',
    });

    await expect(service.setListingPsdTemplateAsset(listingId, previewAssetId)).rejects.toMatchObject({
      code: errorCodes.VALIDATION_ERROR,
    });
  });

  test('updateListing allows internalTemplateId and validates compatibility', async () => {
    listingRepository.findById.mockResolvedValue({ _id: listingId, shopId, productTypeGroupId: groupId });
    listingRepository.update.mockResolvedValue({
      _id: listingId,
      shopId,
      title: 'Updated',
      productTypeGroupId: { _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' },
      internalTemplateId: { _id: templateId, code: 'SHIRT_MAIN', name: 'Shirt Main', status: 'ACTIVE' },
      status: 'ACTIVE',
    });

    await service.updateListing(listingId, {
      internalTemplateId: templateId,
      title: 'Updated',
    }, { permissions: ['CATALOG:WRITE'], scopes: [] });

    expect(listingRepository.update).toHaveBeenCalledWith(listingId, {
      internalTemplateId: templateId,
      title: 'Updated',
    });
  });

  test('duplicate scoped SKU maps to conflict', async () => {
    listingRepository.create.mockRejectedValue({ code: 11000 });

    await expect(service.createListing({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: groupId,
    }, { permissions: ['CATALOG:WRITE'], scopes: [] })).rejects.toMatchObject({
      code: errorCodes.CONFLICT_ERROR,
      statusCode: 409,
    });
  });

  test('public lookup resolves by full identity and requires active approved listing', async () => {
    listingRepository.findBySku.mockResolvedValue({ _id: listingId, status: 'ACTIVE', qcStatus: 'APPROVED' });

    const result = await service.findListingBySku({
      shopId,
      salesChannelCode: 'amazon',
      marketplaceCode: 'amazon_us',
      sku: ' sku-1 ',
    });

    expect(result).toEqual({ _id: listingId, status: 'ACTIVE', qcStatus: 'APPROVED' });
    expect(listingRepository.findBySku).toHaveBeenCalledWith({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      includeInactive: false,
    });
  });

  test('public lookup returns null for inactive listing returned by repository', async () => {
    listingRepository.findBySku.mockResolvedValue({ _id: listingId, status: 'INACTIVE', qcStatus: 'APPROVED' });

    const result = await service.findListingBySku({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
    });

    expect(result).toBeNull();
  });

  test('public lookup returns null for draft or rejected listing returned by repository', async () => {
    listingRepository.findBySku.mockResolvedValue({ _id: listingId, status: 'ACTIVE', qcStatus: 'DRAFT' });

    await expect(service.findListingBySku({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
    })).resolves.toBeNull();

    listingRepository.findBySku.mockResolvedValue({ _id: listingId, status: 'ACTIVE', qcStatus: 'REJECTED' });

    await expect(service.findListingBySku({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
    })).resolves.toBeNull();
  });

  test('updateListing allows previewAssetId and validates media asset', async () => {
    mediaPublic.getAssetsByIds.mockResolvedValue([{
      _id: previewAssetId,
      secureUrl: 'https://res.cloudinary.com/demo/image/upload/listing-preview.jpg',
    }]);
    listingRepository.findById.mockResolvedValue({ _id: listingId, shopId, productTypeGroupId: groupId });
    listingRepository.update.mockResolvedValue({
      _id: listingId,
      shopId,
      title: 'Updated',
      productTypeGroupId: { _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' },
      previewAssetId,
      status: 'ACTIVE',
    });

    const result = await service.updateListing(listingId, {
      previewAssetId,
    }, { permissions: ['CATALOG:WRITE'], scopes: [] });

    expect(mediaPublic.assertMediaAssetExists).toHaveBeenCalledWith(previewAssetId);
    expect(listingRepository.update).toHaveBeenCalledWith(listingId, {
      previewAssetId,
    });
    expect(result.previewAsset).toMatchObject({
      assetId: previewAssetId,
      downloadUrl: `/api/media/assets/${previewAssetId}/download`,
      previewUrl: 'https://res.cloudinary.com/demo/image/upload/listing-preview.jpg',
    });
  });

  test('findListingForOrderItem resolves scoped ASIN before SKU', async () => {
    listingRepository.findByAsin.mockResolvedValue({
      _id: listingId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: 'B0TESTASIN',
      sku: 'SKU-OLD',
      status: 'ACTIVE',
      qcStatus: 'APPROVED',
    });

    const result = await service.findListingForOrderItem({
      shopId,
      salesChannelCode: 'amazon',
      marketplaceCode: 'amazon_us',
      asin: ' b0testasin ',
      sku: 'sku-1',
    });

    expect(result).toMatchObject({ _id: listingId, asin: 'B0TESTASIN' });
    expect(listingRepository.findByAsin).toHaveBeenCalledWith({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: 'B0TESTASIN',
      includeInactive: false,
    });
    expect(listingRepository.findBySku).not.toHaveBeenCalled();
  });

  test('findListingForOrderItem falls back to SKU when ASIN is missing', async () => {
    listingRepository.findBySku.mockResolvedValue({
      _id: listingId,
      sku: 'SKU-1',
      status: 'ACTIVE',
      qcStatus: 'APPROVED',
    });

    const result = await service.findListingForOrderItem({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: ' sku-1 ',
    });

    expect(result).toMatchObject({ _id: listingId, sku: 'SKU-1' });
    expect(listingRepository.findByAsin).not.toHaveBeenCalled();
    expect(listingRepository.findBySku).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      sku: 'SKU-1',
    }));
  });

  test('findOrCreateListingForOrderItem creates approved missing-PSD listing from order item data', async () => {
    listingRepository.findByAsin.mockResolvedValue(null);
    listingRepository.findBySku.mockResolvedValue(null);
    listingRepository.create.mockResolvedValue({
      _id: listingId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: 'B0TESTASIN',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: { _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' },
      internalTemplateId: { _id: templateId, code: 'SHIRT_MAIN', name: 'Shirt Main', status: 'ACTIVE' },
      psdStatus: 'MISSING',
      costCenterStatus: 'MISSING',
      status: 'ACTIVE',
      qcStatus: 'APPROVED',
      approvedAt: new Date('2026-07-14T00:00:00.000Z'),
      approvedBy: null,
    });

    const result = await service.findOrCreateListingForOrderItem({
      shopId,
      salesChannelCode: 'amazon',
      marketplaceCode: 'amazon_us',
      asin: ' b0testasin ',
      sku: ' sku-1 ',
      title: 'Test Listing',
      productTypeGroupId: groupId,
      internalTemplateId: templateId,
      currency: 'usd',
    }, { system: true });

    expect(listingRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: 'B0TESTASIN',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: groupId,
      internalTemplateId: templateId,
      psdStatus: 'MISSING',
      costCenterStatus: 'MISSING',
      status: 'ACTIVE',
      qcStatus: 'APPROVED',
      approvedBy: null,
    }));
    expect(result).toMatchObject({ _id: listingId, qcStatus: 'APPROVED', psdStatus: 'MISSING' });
  });

  test('setListingPreviewFromSourceUrl stores remote image and updates preview asset', async () => {
    listingRepository.findById.mockResolvedValue({
      _id: listingId,
      shopId,
      previewAssetId: null,
    });
    mediaPublic.storeAsset.mockResolvedValue({
      _id: previewAssetId,
      mimeType: 'image/png',
      size: 4,
      sha256: 'preview-hash',
    });
    listingRepository.update.mockResolvedValue({
      _id: listingId,
      shopId,
      previewAssetId,
    });

    const result = await service.setListingPreviewFromSourceUrl(
      listingId,
      'https://m.media-amazon.com/images/S/preview.png',
      { system: true },
    );

    expect(safeRemoteFetchStream).toHaveBeenCalledWith(
      'https://m.media-amazon.com/images/S/preview.png',
      expect.objectContaining({ maxBytes: expect.any(Number) }),
    );
    expect(mediaPublic.storeAsset).toHaveBeenCalledWith(expect.objectContaining({
      stream: expect.any(Object),
      filename: 'preview.png',
      mimeType: 'image/png',
      sourceUrlRedacted: 'https://m.media-amazon.com/[REDACTED_PATH]',
      sourceUrlHash: expect.any(String),
      metadata: expect.objectContaining({
        source: 'LISTING_PREVIEW_IMAGE',
        listingId,
      }),
    }));
    expect(listingRepository.update).toHaveBeenCalledWith(listingId, { previewAssetId });
    expect(result).toMatchObject({ previewAssetId });
  });

  test('findOrCreateListingForOrderItem rejects missing product type group', async () => {
    listingRepository.findByAsin.mockResolvedValue(null);

    await expect(service.findOrCreateListingForOrderItem({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: 'B0TESTASIN',
      sku: 'SKU-1',
      title: 'Test Listing',
    }, { system: true })).rejects.toMatchObject({
      code: errorCodes.VALIDATION_ERROR,
      statusCode: 400,
    });

    expect(listingRepository.create).not.toHaveBeenCalled();
  });

  test('findOrCreateDraftListingForOrderItem creates an unconfigured draft from Amazon identity', async () => {
    listingRepository.findByAsin.mockResolvedValue(null);
    listingRepository.findBySku.mockResolvedValue(null);
    listingRepository.create.mockResolvedValue({
      _id: listingId,
      shopId,
      asin: 'B0TESTASIN',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: null,
      internalTemplateId: null,
      status: 'ACTIVE',
      qcStatus: 'DRAFT',
    });

    const result = await service.findOrCreateDraftListingForOrderItem({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: 'B0TESTASIN',
      sku: 'SKU-1',
      title: 'Test Listing',
    }, { system: true });

    expect(listingRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      asin: 'B0TESTASIN',
      sku: 'SKU-1',
      productTypeGroupId: null,
      internalTemplateId: null,
      status: 'ACTIVE',
      qcStatus: 'DRAFT',
    }));
    expect(result).toMatchObject({ _id: listingId, qcStatus: 'DRAFT', productTypeGroupId: null });
  });

  test('approveListing approves draft listing only', async () => {
    listingRepository.findById.mockResolvedValue({
      _id: listingId,
      shopId,
      qcStatus: 'DRAFT',
    });
    listingRepository.update.mockResolvedValue({
      _id: listingId,
      shopId,
      status: 'ACTIVE',
      qcStatus: 'APPROVED',
      approvedBy: '660000000000000000000901',
      approvedAt: new Date('2026-07-02T00:00:00.000Z'),
    });

    const result = await service.approveListing(listingId, {
      permissions: ['CATALOG:WRITE'],
      accountId: '660000000000000000000901',
    });

    expect(listingRepository.update).toHaveBeenCalledWith(listingId, expect.objectContaining({
      qcStatus: 'APPROVED',
      approvedBy: '660000000000000000000901',
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    }));
    expect(result.qcStatus).toBe('APPROVED');
  });

  test('rejectListing rejects draft listing with reason only', async () => {
    listingRepository.findById.mockResolvedValue({
      _id: listingId,
      shopId,
      qcStatus: 'DRAFT',
    });
    listingRepository.update.mockResolvedValue({
      _id: listingId,
      shopId,
      status: 'ACTIVE',
      qcStatus: 'REJECTED',
      rejectedBy: '660000000000000000000901',
      rejectedAt: new Date('2026-07-02T00:00:00.000Z'),
      rejectionReason: 'Missing PSD',
    });

    const result = await service.rejectListing(listingId, 'Missing PSD', {
      permissions: ['CATALOG:WRITE'],
      accountId: '660000000000000000000901',
    });

    expect(listingRepository.update).toHaveBeenCalledWith(listingId, expect.objectContaining({
      qcStatus: 'REJECTED',
      approvedBy: null,
      approvedAt: null,
      rejectedBy: '660000000000000000000901',
      rejectionReason: 'Missing PSD',
    }));
    expect(result.qcStatus).toBe('REJECTED');
    expect(result.rejectionReason).toBe('Missing PSD');
  });

  test('approved or rejected listing cannot transition again', async () => {
    listingRepository.findById.mockResolvedValueOnce({
      _id: listingId,
      shopId,
      qcStatus: 'APPROVED',
    });

    await expect(service.rejectListing(listingId, 'No', { permissions: ['CATALOG:WRITE'] }))
      .rejects.toMatchObject({ code: errorCodes.CONFLICT_ERROR, statusCode: 409 });

    listingRepository.findById.mockResolvedValueOnce({
      _id: listingId,
      shopId,
      qcStatus: 'REJECTED',
    });

    await expect(service.approveListing(listingId, { permissions: ['CATALOG:WRITE'] }))
      .rejects.toMatchObject({ code: errorCodes.CONFLICT_ERROR, statusCode: 409 });
  });

  test('uploadListingPsdTemplate stores PSD through media public and marks PSD present', async () => {
    const tempPath = path.join(os.tmpdir(), `catalog-psd-${Date.now()}.psd`);
    fs.writeFileSync(tempPath, 'psd');
    listingRepository.findById.mockResolvedValue({
      _id: listingId,
      shopId,
      qcStatus: 'APPROVED',
    });
    listingRepository.update.mockResolvedValue({
      _id: listingId,
      shopId,
      status: 'ACTIVE',
      qcStatus: 'APPROVED',
      psdStatus: 'PRESENT',
      psdTemplateAssetId: '660000000000000000000901',
    });

    const result = await service.uploadListingPsdTemplate(listingId, {
      path: tempPath,
      originalname: 'template.psd',
      mimetype: 'application/octet-stream',
      size: 3,
    }, { permissions: ['CATALOG:WRITE'] });

    expect(mediaPublic.storeAsset).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'template.psd',
      mimeType: 'application/octet-stream',
      metadata: { source: 'CATALOG_LISTING_PSD_TEMPLATE', listingId },
    }));
    expect(listingRepository.update).toHaveBeenCalledWith(listingId, {
      psdTemplateAssetId: '660000000000000000000901',
      psdStatus: 'PRESENT',
    });
    expect(designPublic.resolveActivePsdTaskForListing).toHaveBeenCalledWith(
      listingId,
      '660000000000000000000901',
      expect.objectContaining({ system: true, source: 'CATALOG_LISTING_PSD_TEMPLATE' }),
    );
    expect(productionPublic.recheckPsdBlockedTasksByListing).toHaveBeenCalledWith(
      listingId,
      expect.objectContaining({ system: true, source: 'CATALOG_LISTING_PSD_TEMPLATE' }),
    );
    expect(result.psdTemplateAssetId).toBe('660000000000000000000901');
    expect(result.postActions).toMatchObject({
      designTask: { resolved: true, status: 'APPROVED' },
      productionRecheck: { checked: 1, cleared: 1 },
    });
    expect(result.warnings).toEqual([]);
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  test('uploadListingPsdTemplate keeps PSD update when post actions fail', async () => {
    const tempPath = path.join(os.tmpdir(), `catalog-psd-${Date.now()}.psd`);
    fs.writeFileSync(tempPath, 'psd');
    listingRepository.findById.mockResolvedValue({ _id: listingId, shopId });
    listingRepository.update.mockResolvedValue({
      _id: listingId,
      shopId,
      psdStatus: 'PRESENT',
      psdTemplateAssetId: '660000000000000000000901',
    });
    designPublic.resolveActivePsdTaskForListing.mockRejectedValueOnce(new Error('design down'));
    productionPublic.recheckPsdBlockedTasksByListing.mockRejectedValueOnce(new Error('production down'));

    const result = await service.uploadListingPsdTemplate(listingId, {
      path: tempPath,
      originalname: 'template.psd',
      mimetype: 'application/octet-stream',
      size: 3,
    }, { permissions: ['CATALOG:WRITE'] });

    expect(listingRepository.update).toHaveBeenCalledWith(listingId, {
      psdTemplateAssetId: '660000000000000000000901',
      psdStatus: 'PRESENT',
    });
    expect(result.warnings).toEqual([
      { code: 'PSD_DESIGN_TASK_RESOLVE_FAILED', message: 'design down' },
      { code: 'PSD_PRODUCTION_RECHECK_FAILED', message: 'production down' },
    ]);
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  test('uploadListingPsdTemplate rejects unsupported extension and removes temp file', async () => {
    const tempPath = path.join(os.tmpdir(), `catalog-psd-${Date.now()}.txt`);
    fs.writeFileSync(tempPath, 'text');
    listingRepository.findById.mockResolvedValue({ _id: listingId, shopId });

    await expect(service.uploadListingPsdTemplate(listingId, {
      path: tempPath,
      originalname: 'template.txt',
      mimetype: 'text/plain',
      size: 4,
    }, { permissions: ['CATALOG:WRITE'] })).rejects.toMatchObject({
      code: errorCodes.VALIDATION_ERROR,
      statusCode: 400,
    });

    expect(mediaPublic.storeAsset).not.toHaveBeenCalled();
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  test('setListingPsdTemplateAsset updates only PSD fields after media asset validation', async () => {
    const assetId = '660000000000000000000902';
    listingRepository.findById.mockResolvedValue({ _id: listingId, shopId });
    mediaPublic.assertMediaAssetExists.mockResolvedValue({ _id: assetId });
    mediaPublic.getAsset.mockResolvedValue({
      _id: assetId,
      originalFilename: 'approved-template.psd',
      mimeType: 'application/octet-stream',
    });
    listingRepository.update.mockResolvedValue({
      _id: listingId,
      shopId,
      psdStatus: 'PRESENT',
      psdTemplateAssetId: assetId,
    });

    const result = await service.setListingPsdTemplateAsset(listingId, assetId, {
      source: 'DESIGN_TASK',
      accountId: '660000000000000000000901',
    });

    expect(mediaPublic.assertMediaAssetExists).toHaveBeenCalledWith(assetId);
    expect(listingRepository.update).toHaveBeenCalledWith(listingId, {
      psdTemplateAssetId: assetId,
      psdStatus: 'PRESENT',
    });
    expect(result).toMatchObject({
      id: listingId,
      psdTemplateAssetId: assetId,
      psdStatus: 'PRESENT',
    });
  });
});
