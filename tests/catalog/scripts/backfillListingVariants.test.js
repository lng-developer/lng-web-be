jest.mock('../../../src/modules/catalog/models/listing.model', () => ({
  collection: { find: jest.fn() },
}));

jest.mock('../../../src/modules/catalog/models/listingVariant.model', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));

const Listing = require('../../../src/modules/catalog/models/listing.model');
const ListingVariant = require('../../../src/modules/catalog/models/listingVariant.model');
const { backfillListingVariants } = require('../../../src/modules/catalog/scripts/backfillListingVariants');

test('backfill dry-run reports legacy listings without writing data', async () => {
  Listing.collection.find.mockReturnValue({ toArray: async () => [{
    _id: '660000000000000000000401',
    productTypeGroupId: '660000000000000000000301',
    internalTemplateId: '660000000000000000000701',
  }] });
  ListingVariant.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) });

  await expect(backfillListingVariants()).resolves.toEqual({
    dryRun: true,
    eligible: 1,
    created: 1,
    existing: 0,
  });
  expect(ListingVariant.create).not.toHaveBeenCalled();
});
