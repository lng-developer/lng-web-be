jest.mock('../../../src/modules/vendor/models/vendor.model', () => ({
  find: jest.fn(),
  collection: { name: 'vendors' },
}));

const Vendor = require('../../../src/modules/vendor/models/vendor.model');
const VendorProduct = require('../../../src/modules/vendor/models/vendorProduct.model');
const VendorCostCenter = require('../../../src/modules/vendor/models/vendorCostCenter.model');
const repository = require('../../../src/modules/vendor/repositories/vendorProduct.repository');
const { buildListFilter } = repository;

function mockVendorFind(ids = []) {
  const lean = jest.fn().mockResolvedValue(ids.map((_id) => ({ _id })));
  const select = jest.fn().mockReturnValue({ lean });
  Vendor.find.mockReturnValue({ select });
}

describe('vendorProduct.repository', () => {
  test.each([{ productIds: ['660000000000000000000601'] }, { productIds: [] }])('filters products by active variant IDs before pagination: $productIds', async ({ productIds }) => {
    jest.spyOn(VendorCostCenter, 'distinct').mockResolvedValue(productIds);
    const filter = await buildListFilter({ hasActiveCostCenters: true });
    expect(filter._id).toEqual({ $in: productIds });
    expect(VendorCostCenter.distinct).toHaveBeenCalledWith('vendorProductId', { status: 'ACTIVE' });
  });
  test('does not hide products without variants in the administration list', async () => {
    const distinct = jest.spyOn(VendorCostCenter, 'distinct');
    expect(await buildListFilter({})).toEqual({});
    expect(distinct).not.toHaveBeenCalled();
  });
  test('manual product search can find a product by active variant SKU', async () => {
    mockVendorFind(['660000000000000000000501']);
    jest.spyOn(VendorCostCenter, 'distinct').mockResolvedValue(['660000000000000000000601']);
    const filter = await buildListFilter({ activeVendorsOnly: true, status: 'ACTIVE', q: 'NAP-S' });
    expect(filter.$and[0].$or).toContainEqual({ _id: { $in: ['660000000000000000000601'] } });
    expect(VendorCostCenter.distinct).toHaveBeenCalledWith('vendorProductId', expect.objectContaining({ status: 'ACTIVE' }));
  });
  test('manual search restricts products to active vendors before pagination', async () => {
    mockVendorFind(['660000000000000000000501']);
    const filter = await buildListFilter({ activeVendorsOnly: true, status: 'ACTIVE' });
    expect(filter.vendorId).toEqual({ $in: ['660000000000000000000501'] });
    expect(Vendor.find).toHaveBeenCalledWith({ status: 'ACTIVE' });
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('buildListFilter tokenizes q and lets tokens match vendor or product fields', async () => {
    mockVendorFind(['660000000000000000000501']);

    const filter = await buildListFilter({
      productTypeGroupId: '660000000000000000000301',
      q: ' lng nap ',
      status: 'ACTIVE',
    });

    expect(Vendor.find).toHaveBeenCalledTimes(2);
    expect(filter.productTypeGroupId).toBe('660000000000000000000301');
    expect(filter.status).toBe('ACTIVE');
    expect(filter.$and).toHaveLength(2);
    expect(filter.$and[0].$or.some((clause) => clause.vendorId)).toBe(true);
    expect(filter.$and[0].$or[1].name.test('LNG Group Napkins')).toBe(true);
    expect(filter.$and[1].$or[1].name.test('LNG Group Napkins')).toBe(true);
  });

  test('casts the migration-review vendor filter to ObjectId for the aggregation match', async () => {
    const vendorId = '660000000000000000000501';
    jest.spyOn(VendorProduct, 'aggregate').mockResolvedValue([{ items: [], total: [] }]);

    await repository.listUnassignedForMigration({ vendorId });

    const pipeline = VendorProduct.aggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({
      $match: {
        productTypeGroupId: null,
        vendorId: expect.objectContaining({ toString: expect.any(Function) }),
      },
    });
    expect(String(pipeline[0].$match.vendorId)).toBe(vendorId);
  });

  test('atomically increments the persisted mutation version on update', async () => {
    const productId = '660000000000000000000601';
    const lean = jest.fn().mockResolvedValue({ _id: productId, __v: 4 });
    const populate = jest.fn().mockReturnValue({ lean });
    jest.spyOn(VendorProduct, 'findByIdAndUpdate').mockReturnValue({ populate });

    await repository.update(productId, { name: 'Updated' });

    expect(VendorProduct.findByIdAndUpdate).toHaveBeenCalledWith(
      productId,
      { $set: { name: 'Updated' }, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true },
    );
  });
});
