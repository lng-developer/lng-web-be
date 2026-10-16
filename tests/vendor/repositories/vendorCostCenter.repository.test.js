const VendorCostCenter = require('../../../src/modules/vendor/models/vendorCostCenter.model');
const repository = require('../../../src/modules/vendor/repositories/vendorCostCenter.repository');

describe('vendorCostCenter.repository', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('option queries include vendor dimensions for fallback matching', async () => {
    const query = VendorCostCenter.find();
    jest.spyOn(VendorCostCenter, 'find').mockReturnValue(query);
    jest.spyOn(query, 'lean').mockResolvedValue([]);
    await repository.listOptionsByProduct('660000000000000000000601');
    expect(query.projection()).toMatchObject({ vendorSize: 1, vendorColor: 1, standardSize: 1, standardColor: 1 });
  });

  test('atomically increments the persisted mutation version on update', async () => {
    const costCenterId = '660000000000000000000701';
    const lean = jest.fn().mockResolvedValue({ _id: costCenterId, __v: 5 });
    jest.spyOn(VendorCostCenter, 'findByIdAndUpdate').mockReturnValue({ lean });

    await repository.update(costCenterId, { name: 'Updated' });

    expect(VendorCostCenter.findByIdAndUpdate).toHaveBeenCalledWith(
      costCenterId,
      { $set: { name: 'Updated' }, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true },
    );
  });

  test('search resolves vendor through vendor product owner', async () => {
    jest.spyOn(VendorCostCenter, 'aggregate').mockResolvedValue([{ items: [], total: [] }]);

    await repository.search({ vendorId: '660000000000000000000501', q: 'beeful' });

    const pipeline = VendorCostCenter.aggregate.mock.calls[0][0];
    expect(pipeline[0].$match).not.toHaveProperty('vendorId');
    expect(pipeline.find((stage) => stage.$lookup?.as === 'vendor').$lookup.localField)
      .toBe('vendorProduct.vendorId');
    expect(pipeline.find((stage) => stage.$match?.['vendorProduct.vendorId']).$match['vendorProduct.vendorId'])
      .toBeTruthy();
  });

  test('searches filtered vendor products before cost centers without running an aggregate', async () => {
    const vendorId = '660000000000000000000501';
    const productId = '660000000000000000000601';
    const costCenterId = '660000000000000000000701';
    const vendor = { _id: vendorId, code: 'BEEFUL', status: 'ACTIVE' };
    const product = { _id: productId, vendorId, code: 'TEE', status: 'ACTIVE' };
    const costCenter = { _id: costCenterId, vendorProductId: productId, status: 'ACTIVE', code: 'TEE-BLK-M' };

    jest.spyOn(require('../../../src/modules/vendor/models/vendorProduct.model'), 'find')
      .mockReturnValue({ select: () => ({ lean: jest.fn().mockResolvedValue([product]) }) });
    jest.spyOn(require('../../../src/modules/vendor/models/vendor.model'), 'find')
      .mockReturnValue({ lean: jest.fn().mockResolvedValue([vendor]) });
    jest.spyOn(VendorCostCenter, 'find')
      .mockReturnValue({ sort: () => ({ skip: () => ({ limit: () => ({ lean: jest.fn().mockResolvedValue([costCenter]) }) }) }) });
    jest.spyOn(VendorCostCenter, 'countDocuments').mockResolvedValue(1);
    jest.spyOn(VendorCostCenter, 'aggregate').mockResolvedValue([{ items: [], total: [] }]);

    const result = await repository.search({ vendorId });

    expect(VendorCostCenter.aggregate).not.toHaveBeenCalled();
    expect(result.items).toEqual([{ vendor, vendorProduct: product, vendorCostCenter: costCenter }]);
    expect(result).toMatchObject({ total: 1, page: 1, limit: 20 });
  });

  test('skips the total facet when the caller does not need a count', async () => {
    const row = { vendor: {}, vendorProduct: {}, vendorCostCenter: {} };
    jest.spyOn(VendorCostCenter, 'aggregate').mockResolvedValue([row]);

    const result = await repository.search({ includeTotal: false });

    const pipeline = VendorCostCenter.aggregate.mock.calls[0][0];
    expect(pipeline.some((stage) => stage.$facet)).toBe(false);
    expect(result).toEqual({ items: [row], total: null, page: 1, limit: 20 });
  });
});
