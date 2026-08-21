const VendorCostCenter = require('../../../src/modules/vendor/models/vendorCostCenter.model');
const repository = require('../../../src/modules/vendor/repositories/vendorCostCenter.repository');

describe('vendorCostCenter.repository', () => {
  afterEach(() => {
    jest.restoreAllMocks();
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

    await repository.search({ vendorId: '660000000000000000000501' });

    const pipeline = VendorCostCenter.aggregate.mock.calls[0][0];
    expect(pipeline[0].$match).not.toHaveProperty('vendorId');
    expect(pipeline.find((stage) => stage.$lookup?.as === 'vendor').$lookup.localField)
      .toBe('vendorProduct.vendorId');
    expect(pipeline.find((stage) => stage.$match?.['vendorProduct.vendorId']).$match['vendorProduct.vendorId'])
      .toBeTruthy();
  });
});
