jest.mock('../../../modules/vendor/models/vendor.model', () => ({
  find: jest.fn(),
}));

const Vendor = require('../../../modules/vendor/models/vendor.model');
const VendorProduct = require('../../../modules/vendor/models/vendorProduct.model');
const repository = require('../../../modules/vendor/repositories/vendorProduct.repository');
const { buildListFilter } = repository;

function mockVendorFind(ids = []) {
  const lean = jest.fn().mockResolvedValue(ids.map((_id) => ({ _id })));
  const select = jest.fn().mockReturnValue({ lean });
  Vendor.find.mockReturnValue({ select });
}

describe('vendorProduct.repository', () => {
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
