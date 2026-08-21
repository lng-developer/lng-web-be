const VendorMigrationReview = require('../../../src/modules/vendor/models/vendorMigrationReview.model');
const repository = require('../../../src/modules/vendor/repositories/vendorMigrationReview.repository');

describe('vendorMigrationReview.repository', () => {
  afterEach(() => jest.restoreAllMocks());

  test('lists pending reviews and bulk assigns selected legacy products', async () => {
    const lean = jest.fn().mockResolvedValue([{ legacyProductId: 'legacy-product-1' }]);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    jest.spyOn(VendorMigrationReview, 'find').mockReturnValue({ sort });
    jest.spyOn(VendorMigrationReview, 'countDocuments').mockResolvedValue(1);
    jest.spyOn(VendorMigrationReview, 'updateMany').mockResolvedValue({ modifiedCount: 1 });

    await expect(repository.list({ page: 1, limit: 20 })).resolves.toEqual({
      items: [{ legacyProductId: 'legacy-product-1' }], total: 1, page: 1, limit: 20,
    });
    await expect(repository.assignProductTypeGroup(['legacy-product-1'], '660000000000000000000301'))
      .resolves.toBe(1);
    expect(VendorMigrationReview.updateMany).toHaveBeenCalledWith(
      { legacyProductId: { $in: ['legacy-product-1'] } },
      { $set: { productTypeGroupId: '660000000000000000000301', status: 'ASSIGNED' } },
    );
  });
});
