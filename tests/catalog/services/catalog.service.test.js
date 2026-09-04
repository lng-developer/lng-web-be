jest.mock('../../../src/modules/catalog/repositories/productTypeGroup.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/repositories/listing.repository', () => ({
  create: jest.fn(),
  findByAsin: jest.fn(),
  findById: jest.fn(),
  findByIds: jest.fn(),
  findSummariesByIds: jest.fn(),
  findBySku: jest.fn(),
  list: jest.fn(),
  summarize: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/repositories/internalTemplate.repository', () => ({
  findById: jest.fn(),
  findByIds: jest.fn(),
  list: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/repositories/listingVariant.repository', () => ({
  summarizeByListings: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock('../../../src/modules/shop/public', () => ({
  findById: jest.fn(),
  findByIds: jest.fn(),
  assertShopIsActive: jest.fn(),
  listActiveShops: jest.fn(),
}));

jest.mock('../../../src/modules/media/public', () => ({
  assertMediaAssetExists: jest.fn(),
  assertMediaAssetReady: jest.fn(),
  getAsset: jest.fn(),
  getAssetsByIds: jest.fn(),
  storeAsset: jest.fn(),
}));

jest.mock('../../../src/modules/design/public', () => ({
  createPsdTemplateTaskFromListing: jest.fn(),
  resolveActivePsdTaskForListing: jest.fn(),
}));

jest.mock('../../../src/modules/production/public', () => ({
  recheckPsdBlockedTasksByListing: jest.fn(),
}));

jest.mock('../../../src/modules/order/public', () => ({
  findAssignedOrderIds: jest.fn(),
  findListingIdsByOrderIds: jest.fn(),
  summarizeSalesByAsins: jest.fn(),
  summarizeSalesByListingIds: jest.fn(),
  listTopSalesByListing: jest.fn(),
  updatePsdStatusesForListing: jest.fn(),
}));

jest.mock('../../../src/modules/organization/public', () => ({
  listTeamMembers: jest.fn(),
}));

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../src/modules/hr/public', () => ({
  listEmployeeProfilesByEmployeeCodes: jest.fn(),
}));

jest.mock('../../../src/shared/utils/logger', () => ({
  warn: jest.fn(),
}));

jest.mock('../../../src/shared/network/safeRemoteFetchStream', () => ({
  safeRemoteFetchStream: jest.fn(),
  redactUrl: jest.fn(() => 'https://m.media-amazon.com/[REDACTED_PATH]'),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const errorCodes = require('../../../src/shared/constants/errorCodes');
const authPublic = require('../../../src/modules/auth/public');
const hrPublic = require('../../../src/modules/hr/public');
const designPublic = require('../../../src/modules/design/public');
const mediaPublic = require('../../../src/modules/media/public');
const orderPublic = require('../../../src/modules/order/public');
const organizationPublic = require('../../../src/modules/organization/public');
const productionPublic = require('../../../src/modules/production/public');
const shopPublic = require('../../../src/modules/shop/public');
const groupRepository = require('../../../src/modules/catalog/repositories/productTypeGroup.repository');
const listingRepository = require('../../../src/modules/catalog/repositories/listing.repository');
const templateRepository = require('../../../src/modules/catalog/repositories/internalTemplate.repository');
const logger = require('../../../src/shared/utils/logger');
const { safeRemoteFetchStream } = require('../../../src/shared/network/safeRemoteFetchStream');
const service = require('../../../src/modules/catalog/services/catalog.service');

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
      productImageUrl: 'https://m.media-amazon.com/images/S/listing.png',
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
    shopPublic.findByIds.mockResolvedValue([]);
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
    mediaPublic.assertMediaAssetReady.mockResolvedValue({ id: '660000000000000000000901' });
    mediaPublic.getAsset.mockResolvedValue({
      originalFilename: 'template.psd',
      mimeType: 'application/octet-stream',
      size: 1024,
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
      salesChannels: [
        { code: 'AMAZON', name: 'AMAZON' },
        { code: 'ETSY', name: 'ETSY' },
        { code: 'SHOPIFY', name: 'SHOPIFY' },
        { code: 'TIKTOK_SHOP', name: 'TIKTOK_SHOP' },
        { code: 'WALMART', name: 'WALMART' },
        { code: 'CUSTOM', name: 'CUSTOM' },
      ],
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

  test('getListingOptions hides shops without catalog scope', async () => {
    shopPublic.listActiveShops.mockResolvedValue([]);
    groupRepository.list.mockResolvedValue({ items: [] });
    templateRepository.list.mockResolvedValue({ items: [] });

    await service.getListingOptions({ accountId: '660000000000000000000901', permissions: [], scopes: [] });

    expect(shopPublic.listActiveShops).toHaveBeenCalledWith({ shopIds: [] });
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

  test('authenticated users without catalog scope do not receive the catalog overview', async () => {
    const result = await service.listListings(
      { page: 1, limit: 20 },
      { accountId: '660000000000000000000901', permissions: [], scopes: [] },
    );

    expect(listingRepository.list).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      pagination: { total: 0, page: 1, limit: 20 },
    });
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

  test('team-scoped catalog reader sees listings assigned to its team', async () => {
    const accountId = '660000000000000000000901';
    const orderId = '660000000000000000000801';
    orderPublic.findAssignedOrderIds.mockResolvedValue([orderId]);
    orderPublic.findListingIdsByOrderIds.mockResolvedValue([listingId]);
    listingRepository.list.mockResolvedValue({
      items: [listingFixture()],
      total: 1,
      page: 1,
      limit: 20,
    });

    const result = await service.listListings(
      { page: 1, limit: 20 },
      {
        accountId,
        permissions: [],
        scopes: [{ scopeType: 'team', scopeId: '660000000000000000000802', permissions: ['CATALOG:READ'] }],
      },
    );

    expect(listingRepository.list).toHaveBeenCalledWith({ page: 1, limit: 20, listingIds: [listingId] });
    expect(result.items).toHaveLength(1);
  });

  test('team leader catalog reader sees listings assigned to its team', async () => {
    const accountId = '660000000000000000000901';
    const memberId = '660000000000000000000902';
    const orderId = '660000000000000000000801';
    orderPublic.findAssignedOrderIds.mockResolvedValue([orderId]);
    orderPublic.findListingIdsByOrderIds.mockResolvedValue([listingId]);
    organizationPublic.listTeamMembers.mockResolvedValue({
      leaders: [{ accountId }],
      members: [{ accountId: memberId }],
    });
    listingRepository.list.mockResolvedValue({
      items: [listingFixture()],
      total: 1,
      page: 1,
      limit: 20,
    });

    await service.listListings(
      { page: 1, limit: 20 },
      {
        accountId,
        permissions: [],
        scopes: [
          { scopeType: 'team', scopeId: '660000000000000000000802', roles: ['TEAM_LEADER'], permissions: ['TEAMS:READ'] },
          { scopeType: 'team', scopeId: '660000000000000000000802', roles: ['CS_OPERATOR'], permissions: ['CATALOG:READ'] },
        ],
      },
    );

    expect(orderPublic.findAssignedOrderIds).toHaveBeenCalledWith([accountId, memberId]);
  });

  test('team-scoped catalog reader can open assigned order listing detail', async () => {
    const accountId = '660000000000000000000901';
    orderPublic.findAssignedOrderIds.mockResolvedValue(['660000000000000000000801']);
    orderPublic.findListingIdsByOrderIds.mockResolvedValue([listingId]);
    listingRepository.findById.mockResolvedValue(listingFixture({ shopId: otherShopId }));

    await expect(service.getListing(listingId, {
      accountId,
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: '660000000000000000000802', permissions: ['CATALOG:READ'] }],
    })).resolves.toMatchObject({ id: listingId });
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
    shopPublic.findByIds.mockResolvedValue([{ _id: shopId, name: 'Acc1', status: 'ACTIVE' }]);
    listingRepository.list.mockResolvedValue({
      items: [{ _id: listingId, shopId, sku: 'SKU-1', status: 'ACTIVE', createdAt }],
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

  test('listListings loads shops in one batch while seller enrichment runs in parallel', async () => {
    listingRepository.list.mockResolvedValue({
      items: [{ _id: listingId, shopId, sku: 'J2508-TS2S-280226-2017', title: 'Test Listing', status: 'ACTIVE' }],
      total: 1,
      page: 1,
      limit: 20,
    });
    let resolveShop;
    shopPublic.findByIds.mockImplementation(() => new Promise((resolve) => { resolveShop = resolve; }));
    hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValue([]);

    const result = service.listListings({ page: 1, limit: 20 }, { permissions: ['CATALOG:READ'], scopes: [] });
    await Promise.resolve();

    try {
      expect(hrPublic.listEmployeeProfilesByEmployeeCodes).toHaveBeenCalledWith(['J2508']);
    } finally {
      expect(shopPublic.findByIds).toHaveBeenCalledWith([shopId]);
      resolveShop([{ _id: shopId, name: 'Acc1', status: 'ACTIVE' }]);
      await result;
      shopPublic.findByIds.mockResolvedValue([{ _id: shopId, name: 'Acc1', status: 'ACTIVE' }]);
    }
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
    const listings = [
      { _id: listingA, shopId, sku: 'SKU-A', status: 'ACTIVE' },
      { _id: listingB, shopId, sku: 'SKU-B', status: 'ACTIVE' },
    ];
    listingRepository.findByIds.mockResolvedValue(listings);
    orderPublic.listTopSalesByListing.mockResolvedValue([
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

  test('sales sort fetches full listing documents only for the top-five rows', async () => {
    const listingA = '660000000000000000000411';
    const listingB = '660000000000000000000412';
    const summaries = [
      { _id: listingA, shopId, sku: 'SKU-A', status: 'ACTIVE', createdAt: new Date('2026-01-01') },
      { _id: listingB, shopId, sku: 'SKU-B', status: 'ACTIVE', createdAt: new Date('2026-01-02') },
    ];
    listingRepository.findByIds.mockResolvedValue([{
      ...summaries[1],
      title: 'Top Listing',
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
    }]);
    orderPublic.listTopSalesByListing.mockResolvedValue([
      { listingId: listingA, orderCount: 1, orderItemCount: 1, quantitySold: 1 },
      { listingId: listingB, orderCount: 2, orderItemCount: 2, quantitySold: 2 },
    ]);

    const result = await service.listListings(
      { page: 1, limit: 1, sort: 'quantitySoldDesc' },
      { permissions: ['CATALOG:READ'], scopes: [] },
    );

    expect(orderPublic.listTopSalesByListing).toHaveBeenCalledWith({
      page: 1, limit: 5, sort: 'quantitySoldDesc',
    });
    expect(listingRepository.findByIds).toHaveBeenCalledWith([listingA, listingB]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(listingB);
  });

  test('sales-sorted listings derive ASIN totals without the order-item lookup', async () => {
    const listingA = '660000000000000000000411';
    const listingB = '660000000000000000000412';
    const listings = [
      { _id: listingA, shopId, sku: 'SKU-A', asin: 'B0ASIN', status: 'ACTIVE' },
      { _id: listingB, shopId, sku: 'SKU-B', asin: 'B0ASIN', status: 'ACTIVE' },
    ];
    listingRepository.findByIds.mockResolvedValue(listings);
    orderPublic.listTopSalesByListing.mockResolvedValue([
      {
        listingId: listingA,
        orderCount: 1,
        orderItemCount: 1,
        quantitySold: 2,
        lastSoldAt: new Date('2026-12-31T00:00:00.000Z'),
      },
      {
        listingId: listingB,
        orderCount: 3,
        orderItemCount: 4,
        quantitySold: 5,
        lastSoldAt: new Date('2027-01-01T00:00:00.000Z'),
      },
    ]);

    const result = await service.listListings(
      { page: 1, limit: 10, sort: 'quantitySoldDesc' },
      { permissions: ['CATALOG:READ'], scopes: [] },
    );

    expect(orderPublic.summarizeSalesByAsins).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({
      id: listingB,
      salesStats: { quantitySold: 5 },
      asinSalesStats: {
        orderCount: 4,
        orderItemCount: 5,
        quantitySold: 7,
        lastSoldAt: new Date('2027-01-01T00:00:00.000Z'),
      },
    });
  });

  test('listListings includes ASIN-level sales totals across duplicate listings', async () => {
    listingRepository.list.mockResolvedValue({
      items: [{ _id: listingId, shopId, sku: 'SKU-A', asin: 'B0ASIN', status: 'ACTIVE' }],
      total: 1,
      page: 1,
      limit: 20,
    });
    orderPublic.summarizeSalesByListingIds.mockResolvedValue([
      { listingId, orderCount: 1, orderItemCount: 1, quantitySold: 1 },
    ]);
    orderPublic.summarizeSalesByAsins.mockResolvedValue([
      { asin: 'B0ASIN', orderCount: 3, orderItemCount: 3, quantitySold: 5 },
    ]);

    const result = await service.listListings(
      { page: 1, limit: 20 },
      { permissions: ['CATALOG:READ'], scopes: [] },
    );

    expect(orderPublic.summarizeSalesByAsins).toHaveBeenCalledWith(['B0ASIN']);
    expect(result.items[0].salesStats.quantitySold).toBe(1);
    expect(result.items[0].asinSalesStats.quantitySold).toBe(5);
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

  test('createListing validates shop and stores only Listing identity fields', async () => {
    listingRepository.create.mockResolvedValue({
      _id: listingId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: 'B0TESTASIN',
      etsyListingId: null,
      sku: 'SKU-1',
      title: 'Test Listing',
      productImageUrl: 'https://m.media-amazon.com/images/S/listing.png',
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
      productImageUrl: 'https://m.media-amazon.com/images/S/listing.png',
      productTypeGroupId: groupId,
      previewAssetId,
      asin: 'b0testasin',
      baseCostAmount: 1200,
    }, { permissions: ['CATALOG:WRITE'], scopes: [] });

    expect(shopPublic.assertShopIsActive).toHaveBeenCalledWith(shopId);
    expect(groupRepository.findById).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: listingId,
      asin: 'B0TESTASIN',
      etsyListingId: null,
      sku: 'SKU-1',
      productImageUrl: 'https://m.media-amazon.com/images/S/listing.png',
      baseCostAmount: 1200,
      qcStatus: 'DRAFT',
    });
    expect(mediaPublic.assertMediaAssetExists).not.toHaveBeenCalled();
    mediaPublic.storeAsset.mockResolvedValue({
      _id: '660000000000000000000901',
      mimeType: 'application/octet-stream',
      size: 10,
      sha256: 'hash',
    });
  });

  test('createListing does not auto-create a PSD design task', async () => {
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

    expect(designPublic.createPsdTemplateTaskFromListing).not.toHaveBeenCalled();
  });

  test('requestListingPsd creates a listing-level PSD task', async () => {
    listingRepository.findById.mockResolvedValue(listingFixture({
      _id: listingId,
      shopId,
      defaultPsdTemplateAssetId: null,
    }));

    await expect(service.requestListingPsd(listingId, {
      permissions: ['CATALOG:WRITE'],
      scopes: [],
    })).resolves.toEqual({ id: '660000000000000000000801' });

    expect(designPublic.createPsdTemplateTaskFromListing).toHaveBeenCalledWith(
      listingId,
      { note: 'Requested from Catalog listing' },
      expect.objectContaining({ system: true, source: 'CATALOG' }),
    );
  });

  test('requestListingPsd rejects listings that already have a default PSD', async () => {
    listingRepository.findById.mockResolvedValue(listingFixture({
      _id: listingId,
      shopId,
      defaultPsdTemplateAssetId: '660000000000000000000901',
    }));

    await expect(service.requestListingPsd(listingId, {
      permissions: ['CATALOG:WRITE'],
      scopes: [],
    })).rejects.toMatchObject({ code: 'CONFLICT_ERROR' });
    expect(designPublic.createPsdTemplateTaskFromListing).not.toHaveBeenCalled();
  });

  test('setListingPsdTemplateAsset stores default PSD and rechecks dependent work', async () => {
    const psdAssetId = '660000000000000000000901';
    listingRepository.findById.mockResolvedValue(listingFixture({
      _id: listingId,
      shopId,
      defaultPsdTemplateAssetId: null,
    }));
    listingRepository.update.mockResolvedValue(listingFixture({
      _id: listingId,
      shopId,
      defaultPsdTemplateAssetId: psdAssetId,
    }));

    await expect(service.setListingPsdTemplateAsset(listingId, psdAssetId, {
      source: 'DESIGN_TASK',
      accountId: '660000000000000000000901',
    })).resolves.toMatchObject({ id: listingId, defaultPsdTemplateAssetId: psdAssetId });

    expect(listingRepository.update).toHaveBeenCalledWith(listingId, {
      defaultPsdTemplateAssetId: psdAssetId,
    });
    expect(orderPublic.updatePsdStatusesForListing).toHaveBeenCalledWith(listingId);
    expect(productionPublic.recheckPsdBlockedTasksByListing).toHaveBeenCalledWith(
      listingId,
      expect.objectContaining({ system: true, source: 'CATALOG_LISTING_PSD' }),
    );
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

  test('createListing does not call Design even when the legacy dependency would fail', async () => {
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

    expect(result).toMatchObject({ id: listingId });
    expect(result).not.toHaveProperty('psdStatus');
    expect(designPublic.createPsdTemplateTaskFromListing).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('scoped CATALOG:READ summary counts only assigned shops', async () => {
    listingRepository.summarize.mockResolvedValue({
      totalListingCount: 2,
      amazonListingCount: 1,
      etsyListingCount: 1,
      draftCount: 1,
      approvedCount: 1,
      rejectedCount: 0,
    });
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
    expect(result).toMatchObject({ totalListingCount: 2 });
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
      draftCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      noPsdCount: 0,
      channelCounts: [],
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

  test('createListing ignores variant-owned internalTemplateId', async () => {
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

    expect(templateRepository.findById).not.toHaveBeenCalled();
    expect(result.internalTemplate).toBeUndefined();
  });

  test('createListing does not validate variant-owned template compatibility', async () => {
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
    }, { permissions: ['CATALOG:WRITE'], scopes: [] })).resolves.toBeDefined();
    expect(templateRepository.findById).not.toHaveBeenCalled();
  });

  test('createListing ignores inactive variant-owned internalTemplateId', async () => {
    templateRepository.findById.mockResolvedValue({ _id: templateId, productTypeGroupId: groupId, status: 'INACTIVE' });

    await expect(service.createListing({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      title: 'Test Listing',
      productTypeGroupId: groupId,
      internalTemplateId: templateId,
    }, { permissions: ['CATALOG:WRITE'], scopes: [] })).resolves.toBeDefined();
    expect(templateRepository.findById).not.toHaveBeenCalled();
  });

  test('createListing ignores variant-owned product type group', async () => {
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
    }, { permissions: ['CATALOG:WRITE'], scopes: [] })).resolves.toBeDefined();
    expect(groupRepository.findById).not.toHaveBeenCalled();
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

  test('does not expose Listing-level PSD upload', () => {
    expect(service.uploadListingPsdTemplate).toBeUndefined();
    expect(service.setListingPsdTemplateAsset).toEqual(expect.any(Function));
  });

  test('updateListing ignores variant-owned internalTemplateId', async () => {
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

  test('updateListing ignores variant-owned previewAssetId', async () => {
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

    await service.updateListing(listingId, {
      previewAssetId,
    }, { permissions: ['CATALOG:WRITE'], scopes: [] });

    expect(mediaPublic.assertMediaAssetExists).not.toHaveBeenCalled();
    expect(listingRepository.update).toHaveBeenCalledWith(listingId, {});
  });

  test('findListingForOrderItem resolves global marketplace ASIN before shop SKU', async () => {
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
      status: 'ACTIVE',
      qcStatus: 'APPROVED',
      approvedBy: null,
    }));
    expect(result).toMatchObject({ _id: listingId, qcStatus: 'APPROVED' });
  });

  test('does not expose Listing-level preview mutation', () => {
    expect(service.setListingPreviewFromSourceUrl).toBeUndefined();
  });

  test('findOrCreateListingForOrderItem creates identity without product type group', async () => {
    listingRepository.findByAsin.mockResolvedValue(null);

    await expect(service.findOrCreateListingForOrderItem({
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      asin: 'B0TESTASIN',
      sku: 'SKU-1',
      title: 'Test Listing',
    }, { system: true })).resolves.toBeDefined();

    expect(listingRepository.create).toHaveBeenCalled();
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
      status: 'ACTIVE',
      qcStatus: 'DRAFT',
    }));
    expect(result).toMatchObject({ _id: listingId, qcStatus: 'DRAFT' });
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

  test('does not expose Listing-level PSD upload', () => {
    expect(service.uploadListingPsdTemplate).toBeUndefined();
    expect(service.setListingPsdTemplateAsset).toEqual(expect.any(Function));
  });
});
