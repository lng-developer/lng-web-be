jest.mock('../../../src/modules/catalog/models/listing.model', () => ({
  countDocuments: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/models/listingVariant.model', () => ({}));

const Listing = require('../../../src/modules/catalog/models/listing.model');
const {
  assessLegacyEtsyListing,
  emptySummary,
} = require('../../../src/modules/catalog/scripts/migrateLegacyListings');

test('etsy listing migration can fall back to legacy shop id', async () => {
  const summary = emptySummary({ dryRun: true });

  const candidate = await assessLegacyEtsyListing({
    _id: 'legacy-etsy-1',
    shopId: '660000000000000000000001',
    listingId: '4527664313',
    SKU: 'j2605-hoodie',
    TITLE: 'Hoodie',
  }, summary, {});

  expect(summary.missingShopMapCount).toBe(0);
  expect(candidate.identity).toMatchObject({
    shopId: '660000000000000000000001',
    salesChannelCode: 'ETSY',
  });
});

test('etsy listing migration builds listing and variant payloads from mappings', async () => {
  Listing.countDocuments.mockResolvedValue(0);
  const summary = emptySummary({ dryRun: true });

  const candidate = await assessLegacyEtsyListing({
    _id: 'legacy-etsy-2',
    shopId: 'old-shop-1',
    listingId: '4527664313',
    SKU: 'j2605-hoodie',
    TITLE: 'Hoodie',
    IMAGE1: 'https://example.test/hoodie.jpg',
    designFile: { url: 'https://old-storage.test/4527664313.zip' },
  }, summary, {
    shopByLegacyId: { 'old-shop-1': '660000000000000000000001' },
    productTypeGroupByLegacyEtsyListingId: { 4527664313: '660000000000000000000301' },
    internalTemplateByLegacyEtsyListingId: { 4527664313: '660000000000000000000701' },
    psdAssetByLegacyUrl: { 'https://old-storage.test/4527664313.zip': '660000000000000000000901' },
  });

  expect(candidate.identity).toMatchObject({
    shopId: '660000000000000000000001',
    salesChannelCode: 'ETSY',
    marketplaceCode: 'US',
    sku: 'J2605-HOODIE',
  });
  expect(candidate.listingPayload).toMatchObject({
    etsyListingId: '4527664313',
    title: 'Hoodie',
    productImageUrl: 'https://example.test/hoodie.jpg',
  });
  expect(candidate.variantPayload).toMatchObject({
    productTypeGroupId: '660000000000000000000301',
    internalTemplateId: '660000000000000000000701',
    psdTemplateAssetId: '660000000000000000000901',
  });
});
