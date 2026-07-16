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
  findBySku: jest.fn(),
  list: jest.fn(),
  summarize: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/catalog/repositories/internalTemplate.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../modules/shop/public', () => ({
  assertShopIsActive: jest.fn(),
}));

jest.mock('../../../modules/media/public', () => ({
  assertMediaAssetExists: jest.fn(),
  storeAsset: jest.fn(),
}));

jest.mock('../../../modules/design/public', () => ({
  createPsdTemplateTaskFromListing: jest.fn(),
  resolveActivePsdTaskForListing: jest.fn(),
}));

jest.mock('../../../modules/production/public', () => ({
  recheckPsdBlockedTasksByListing: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../shared/utils/logger', () => ({
  warn: jest.fn(),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const errorCodes = require('../../../shared/constants/errorCodes');
const authPublic = require('../../../modules/auth/public');
const designPublic = require('../../../modules/design/public');
const mediaPublic = require('../../../modules/media/public');
const productionPublic = require('../../../modules/production/public');
const shopPublic = require('../../../modules/shop/public');
const groupRepository = require('../../../modules/catalog/repositories/productTypeGroup.repository');
const listingRepository = require('../../../modules/catalog/repositories/listing.repository');
const templateRepository = require('../../../modules/catalog/repositories/internalTemplate.repository');
const logger = require('../../../shared/utils/logger');
const service = require('../../../modules/catalog/services/catalog.service');

describe('catalog.service', () => {
  const shopId = '660000000000000000000201';
  const otherShopId = '660000000000000000000202';
  const listingId = '660000000000000000000401';
  const groupId = '660000000000000000000301';
  const templateId = '660000000000000000000701';

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
    listingRepository.list.mockResolvedValue({
      items: [{ _id: listingId, shopId, sku: 'SKU-1', status: 'ACTIVE' }],
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
    expect(detail).toMatchObject({ id: listingId, shopId });
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
      baseCostAmount: 1200,
      qcStatus: 'DRAFT',
    });
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
    }, { permissions: ['CATALOG:WRITE'], scopes: [] });

    expect(listingRepository.update).toHaveBeenCalledWith(listingId, {
      title: 'Updated',
      asin: 'b0updated',
      etsyListingId: '1234567890',
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
