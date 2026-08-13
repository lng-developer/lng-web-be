jest.mock('../../../src/modules/catalog/repositories/listing.repository', () => ({
  findById: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/repositories/listingVariant.repository', () => ({
  create: jest.fn(),
  countByListing: jest.fn(),
  findById: jest.fn(),
  findByListingAndProductType: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/repositories/productTypeGroup.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/repositories/internalTemplate.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../src/modules/media/public', () => ({
  assertMediaAssetExists: jest.fn(),
  assertMediaAssetReady: jest.fn(),
  getAsset: jest.fn(),
}));

jest.mock('../../../src/modules/design/public', () => ({
  createPsdTemplateTaskFromListingVariant: jest.fn(),
}));

jest.mock('../../../src/modules/mapping/public', () => ({
  recheckBlockedFulfillmentPlansForListingVariant: jest.fn(),
}));

jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(() => false),
}));

jest.mock('../../../src/modules/order/public', () => ({
  findAssignedOrderIds: jest.fn(),
  findListingIdsByOrderIds: jest.fn(),
  summarizeSalesByAsins: jest.fn(),
  summarizeSalesByListingIds: jest.fn(),
}));

jest.mock('../../../src/modules/organization/public', () => ({
  listTeamMembers: jest.fn(),
}));

const listingRepository = require('../../../src/modules/catalog/repositories/listing.repository');
const variantRepository = require('../../../src/modules/catalog/repositories/listingVariant.repository');
const productTypeGroupRepository = require('../../../src/modules/catalog/repositories/productTypeGroup.repository');
const templateRepository = require('../../../src/modules/catalog/repositories/internalTemplate.repository');
const mediaPublic = require('../../../src/modules/media/public');
const designPublic = require('../../../src/modules/design/public');
const mappingPublic = require('../../../src/modules/mapping/public');
const orderPublic = require('../../../src/modules/order/public');
const service = require('../../../src/modules/catalog/services/listingVariant.service');

describe('listingVariant.service resolveListingVariant', () => {
  const listingId = '660000000000000000000401';
  const groupId = '660000000000000000000301';
  const variantId = '660000000000000000000501';
  const templateId = '660000000000000000000701';
  const assetId = '660000000000000000000901';
  const listing = { _id: listingId, defaultVariantId: variantId };
  const variant = { _id: variantId, listingId, productTypeGroupId: groupId, status: 'ACTIVE' };

  beforeEach(() => {
    jest.clearAllMocks();
    listingRepository.findById.mockResolvedValue(listing);
    productTypeGroupRepository.findById.mockResolvedValue({ _id: groupId, status: 'ACTIVE' });
    variantRepository.countByListing.mockResolvedValue(1);
    mappingPublic.recheckBlockedFulfillmentPlansForListingVariant.mockResolvedValue({
      checked: 0,
      resolved: 0,
      blocked: 0,
    });
    mediaPublic.getAsset.mockResolvedValue({
      originalFilename: 'template.psd',
      mimeType: 'application/octet-stream',
      size: 1024,
    });
    orderPublic.findAssignedOrderIds.mockResolvedValue([]);
    orderPublic.findListingIdsByOrderIds.mockResolvedValue([]);
  });

  test('resolves the variant for the selected product type', async () => {
    variantRepository.findByListingAndProductType.mockResolvedValue(variant);

    await expect(service.resolveListingVariant(listingId, groupId)).resolves.toEqual({
      source: 'VARIANT',
      listing,
      variant,
    });
  });

  test('uses the default variant only when no product type was selected', async () => {
    variantRepository.findById.mockResolvedValue(variant);

    await expect(service.resolveListingVariant(listingId, null)).resolves.toEqual({
      source: 'DEFAULT_VARIANT',
      listing,
      variant,
    });
  });

  test('falls back to legacy listing fields until variants are migrated', async () => {
    variantRepository.countByListing.mockResolvedValue(0);

    await expect(service.resolveListingVariant(listingId, groupId)).resolves.toEqual({
      source: 'LEGACY',
      listing,
    });
  });

  test('does not fall back when variants exist but the selected product type is missing', async () => {
    variantRepository.findByListingAndProductType.mockResolvedValue(null);

    await expect(service.resolveListingVariant(listingId, groupId)).resolves.toBeNull();
  });

  test('returns PSD readiness from the variant and its internal template', async () => {
    variantRepository.findById.mockResolvedValue({ ...variant, internalTemplateId: templateId });
    templateRepository.findById.mockResolvedValue({
      _id: templateId,
      status: 'ACTIVE',
      requiresPsd: true,
      designAssets: [],
    });

    await expect(service.getListingVariantById(variantId)).resolves.toMatchObject({
      id: variantId,
      psdReadiness: { required: true, status: 'MISSING', effectivePsdAssetId: null },
    });
  });

  test('sets the approved PSD asset on the listing variant', async () => {
    variantRepository.findById.mockResolvedValue(variant);
    variantRepository.update.mockResolvedValue({ ...variant, psdTemplateAssetId: assetId });
    templateRepository.findById.mockResolvedValue(null);

    await expect(service.setListingVariantPsdTemplateAsset(variantId, assetId)).resolves.toMatchObject({
      id: variantId,
      psdTemplateAssetId: assetId,
      psdReadiness: { status: 'PRESENT', source: 'LISTING_VARIANT' },
    });
    expect(mediaPublic.assertMediaAssetReady).toHaveBeenCalledWith(assetId);
    expect(variantRepository.update).toHaveBeenCalledWith(variantId, { psdTemplateAssetId: assetId });
    expect(listingRepository.update).not.toHaveBeenCalled();
    expect(mappingPublic.recheckBlockedFulfillmentPlansForListingVariant).toHaveBeenCalledWith(
      listingId,
      groupId,
      expect.objectContaining({ system: true, source: 'CATALOG_VARIANT' }),
    );
  });

  test('rechecks blocked fulfillment plans after creating a listing variant', async () => {
    listingRepository.findById.mockResolvedValue({ _id: listingId, defaultVariantId: null });
    templateRepository.findById.mockResolvedValue({ _id: templateId, productTypeGroupId: groupId, status: 'ACTIVE' });
    variantRepository.create.mockResolvedValue({
      ...variant,
      internalTemplateId: templateId,
    });

    await service.createListingVariant(listingId, {
      productTypeGroupId: groupId,
      internalTemplateId: templateId,
    }, { permissions: ['CATALOG:WRITE'] });

    expect(mappingPublic.recheckBlockedFulfillmentPlansForListingVariant).toHaveBeenCalledWith(
      listingId,
      groupId,
      expect.objectContaining({ system: true, source: 'CATALOG_VARIANT' }),
    );
  });

  test('sale can create a variant for an assigned order listing with catalog read only', async () => {
    listingRepository.findById.mockResolvedValue({ _id: listingId, defaultVariantId: null });
    templateRepository.findById.mockResolvedValue({ _id: templateId, productTypeGroupId: groupId, status: 'ACTIVE' });
    variantRepository.create.mockResolvedValue({ ...variant, internalTemplateId: templateId });
    orderPublic.findAssignedOrderIds.mockResolvedValue(['660000000000000000000801']);
    orderPublic.findListingIdsByOrderIds.mockResolvedValue([listingId]);

    await expect(service.createListingVariant(listingId, {
      productTypeGroupId: groupId,
      internalTemplateId: templateId,
    }, {
      accountId: '660000000000000000000901',
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: '660000000000000000000802', permissions: ['CATALOG:READ'] }],
    })).resolves.toMatchObject({ id: variantId });
  });

  test('catalog read alone cannot create a variant for an unassigned listing', async () => {
    listingRepository.findById.mockResolvedValue({ _id: listingId, shopId: '660000000000000000000201' });

    await expect(service.createListingVariant(listingId, {
      productTypeGroupId: groupId,
      internalTemplateId: templateId,
    }, {
      permissions: ['CATALOG:READ'],
      scopes: [],
    })).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });

    expect(variantRepository.create).not.toHaveBeenCalled();
  });

  test('accepts the image/psd MIME type emitted by browser uploads', async () => {
    variantRepository.findById.mockResolvedValue(variant);
    variantRepository.update.mockResolvedValue({ ...variant, psdTemplateAssetId: assetId });
    templateRepository.findById.mockResolvedValue(null);
    mediaPublic.getAsset.mockResolvedValue({
      originalFilename: 'template.psd',
      mimeType: 'image/psd',
      size: 1024,
    });

    await expect(service.setListingVariantPsdTemplateAsset(variantId, assetId)).resolves.toMatchObject({
      psdTemplateAssetId: assetId,
    });
  });

  test('accepts a multipart PSD larger than the legacy media upload limit', async () => {
    variantRepository.findById.mockResolvedValue(variant);
    variantRepository.update.mockResolvedValue({ ...variant, psdTemplateAssetId: assetId });
    templateRepository.findById.mockResolvedValue(null);
    mediaPublic.getAsset.mockResolvedValue({
      originalFilename: 'template.psd',
      mimeType: 'image/psd',
      size: 65_578_124,
    });

    await expect(service.setListingVariantPsdTemplateAsset(variantId, assetId)).resolves.toMatchObject({
      psdTemplateAssetId: assetId,
    });
  });

  test('requests an idempotent Design PSD task for a missing variant', async () => {
    variantRepository.findById.mockResolvedValue({ ...variant, internalTemplateId: templateId });
    templateRepository.findById.mockResolvedValue({
      _id: templateId,
      status: 'ACTIVE',
      requiresPsd: true,
      designAssets: [],
    });
    designPublic.createPsdTemplateTaskFromListingVariant.mockResolvedValue({ id: 'task-1' });

    await expect(service.requestListingVariantPsd(listingId, variantId, {
      permissions: ['CATALOG:WRITE'],
    })).resolves.toEqual({ id: 'task-1' });
    expect(designPublic.createPsdTemplateTaskFromListingVariant).toHaveBeenCalledWith(
      listingId,
      variantId,
      { note: 'Requested from Catalog listing variant' },
      expect.objectContaining({ system: true, source: 'CATALOG' }),
    );
  });

  test('sale can request Design PSD for an assigned order listing with catalog read only', async () => {
    variantRepository.findById.mockResolvedValue({ ...variant, internalTemplateId: templateId });
    templateRepository.findById.mockResolvedValue({
      _id: templateId,
      status: 'ACTIVE',
      requiresPsd: true,
      designAssets: [],
    });
    orderPublic.findAssignedOrderIds.mockResolvedValue(['660000000000000000000801']);
    orderPublic.findListingIdsByOrderIds.mockResolvedValue([listingId]);
    designPublic.createPsdTemplateTaskFromListingVariant.mockResolvedValue({ id: 'task-1' });

    await expect(service.requestListingVariantPsd(listingId, variantId, {
      accountId: '660000000000000000000901',
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: '660000000000000000000802', permissions: ['CATALOG:READ'] }],
    })).resolves.toEqual({ id: 'task-1' });
  });
});
