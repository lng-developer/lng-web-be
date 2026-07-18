jest.mock('../../../modules/vendor/models/vendor.model', () => ({
  find: jest.fn(),
}));

const Vendor = require('../../../modules/vendor/models/vendor.model');
const { buildListFilter } = require('../../../modules/vendor/repositories/vendorProduct.repository');

function mockVendorFind(ids = []) {
  const lean = jest.fn().mockResolvedValue(ids.map((_id) => ({ _id })));
  const select = jest.fn().mockReturnValue({ lean });
  Vendor.find.mockReturnValue({ select });
}

describe('vendorProduct.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
