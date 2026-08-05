jest.mock('../../../modules/catalog/models/listing.model', () => ({
  find: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../../../modules/catalog/models/listingVariant.model', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));

const Listing = require('../../../modules/catalog/models/listing.model');
const ListingVariant = require('../../../modules/catalog/models/listingVariant.model');
const { backfillListingVariants } = require('../../../modules/catalog/scripts/backfillListingVariants');

test('backfill dry-run reports legacy listings without writing data', async () => {
  Listing.find.mockReturnValue({
    select: () => ({
      lean: async () => [{
        _id: '660000000000000000000401',
        productTypeGroupId: '660000000000000000000301',
        internalTemplateId: '660000000000000000000701',
        defaultVariantId: null,
      }],
    }),
  });
  ListingVariant.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) });

  await expect(backfillListingVariants()).resolves.toEqual({
    dryRun: true,
    eligible: 1,
    created: 1,
    existing: 0,
    defaultsSet: 1,
  });
  expect(ListingVariant.create).not.toHaveBeenCalled();
  expect(Listing.updateOne).not.toHaveBeenCalled();
});
