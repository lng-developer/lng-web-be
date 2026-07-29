const VendorCostCenter = require('../../../modules/vendor/models/vendorCostCenter.model');
const repository = require('../../../modules/vendor/repositories/vendorCostCenter.repository');

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
});
