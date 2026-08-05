jest.mock('../../../modules/catalog/repositories/listing.repository', () => ({
  findById: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/catalog/repositories/listingVariant.repository', () => ({
  countByListing: jest.fn(),
  findById: jest.fn(),
  findByListingAndProductType: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/catalog/repositories/internalTemplate.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../modules/media/public', () => ({
  assertMediaAssetExists: jest.fn(),
  getAsset: jest.fn(),
}));

jest.mock('../../../modules/design/public', () => ({
  createPsdTemplateTaskFromListingVariant: jest.fn(),
}));

const listingRepository = require('../../../modules/catalog/repositories/listing.repository');
const variantRepository = require('../../../modules/catalog/repositories/listingVariant.repository');
const templateRepository = require('../../../modules/catalog/repositories/internalTemplate.repository');
const mediaPublic = require('../../../modules/media/public');
const designPublic = require('../../../modules/design/public');
const service = require('../../../modules/catalog/services/listingVariant.service');

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
    variantRepository.countByListing.mockResolvedValue(1);
    mediaPublic.getAsset.mockResolvedValue({
      originalFilename: 'template.psd',
      mimeType: 'application/octet-stream',
      size: 1024,
    });
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
    expect(mediaPublic.assertMediaAssetExists).toHaveBeenCalledWith(assetId);
    expect(variantRepository.update).toHaveBeenCalledWith(variantId, { psdTemplateAssetId: assetId });
    expect(listingRepository.update).not.toHaveBeenCalled();
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
});
