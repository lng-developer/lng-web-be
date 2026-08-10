const Vendor = require('../../../src/modules/vendor/models/vendor.model');
const repository = require('../../../src/modules/vendor/repositories/vendor.repository');

describe('vendor.repository', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('buildFilter supports operator-facing vendor id', () => {
    const filter = repository.buildFilter({
      id: '660000000000000000000501',
      code: 'print',
    });

    expect(String(filter._id)).toBe('660000000000000000000501');
    expect(filter.code).toEqual(/^print/i);
  });

  test('atomically increments the persisted mutation version on update', async () => {
    const vendorId = '660000000000000000000501';
    const lean = jest.fn().mockResolvedValue({ _id: vendorId, __v: 3 });
    jest.spyOn(Vendor, 'findByIdAndUpdate').mockReturnValue({ lean });

    await repository.update(vendorId, { name: 'Updated' });

    expect(Vendor.findByIdAndUpdate).toHaveBeenCalledWith(
      vendorId,
      { $set: { name: 'Updated' }, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true },
    );
  });
});
