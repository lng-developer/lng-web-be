jest.mock('../../../modules/catalog/repositories/productTypeGroup.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/catalog/repositories/listing.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findBySku: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/catalog/repositories/internalTemplate.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../modules/shop/public', () => ({
  assertShopIsActive: jest.fn(),
}));

jest.mock('../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

const errorCodes = require('../../../shared/constants/errorCodes');
const authPublic = require('../../../modules/auth/public');
const shopPublic = require('../../../modules/shop/public');
const groupRepository = require('../../../modules/catalog/repositories/productTypeGroup.repository');
const listingRepository = require('../../../modules/catalog/repositories/listing.repository');
const templateRepository = require('../../../modules/catalog/repositories/internalTemplate.repository');
const service = require('../../../modules/catalog/services/catalog.service');

describe('catalog.service', () => {
  const shopId = '660000000000000000000201';
  const otherShopId = '660000000000000000000202';
  const listingId = '660000000000000000000401';
  const groupId = '660000000000000000000301';
  const templateId = '660000000000000000000701';

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    shopPublic.assertShopIsActive.mockResolvedValue({ _id: shopId, status: 'ACTIVE' });
    groupRepository.findById.mockResolvedValue({ _id: groupId, code: 'SHIRT', name: 'Shirt', status: 'ACTIVE' });
    templateRepository.findById.mockResolvedValue({
      _id: templateId,
      productTypeGroupId: groupId,
      code: 'SHIRT_MAIN',
      name: 'Shirt Main',
      status: 'ACTIVE',
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

  test('scoped CATALOG:READ lists only assigned shops', async () => {
    listingRepository.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });

    await service.listListings(
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
      shopIds: [shopId],
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

  test('out-of-scope detail throws 403', async () => {
    authPublic.canAccessScope.mockReturnValue(false);
    listingRepository.findById.mockResolvedValue({ _id: listingId, shopId: otherShopId });

    await expect(service.getListing(listingId, {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['CATALOG:READ'] }],
    })).rejects.toMatchObject({ code: errorCodes.AUTHORIZATION_ERROR, statusCode: 403 });
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
});
