const ListingVariant = require('../../../src/modules/catalog/models/listingVariant.model');

test('ListingVariant is unique per listing and product type', () => {
  expect(ListingVariant.schema.indexes()).toContainEqual([
    { listingId: 1, productTypeGroupId: 1 },
    expect.objectContaining({ unique: true }),
  ]);
});
