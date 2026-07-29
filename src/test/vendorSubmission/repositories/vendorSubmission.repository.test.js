const VendorSubmission = require('../../../modules/vendorSubmission/models/vendorSubmission.model');
const repository = require('../../../modules/vendorSubmission/repositories/vendorSubmission.repository');

describe('vendorSubmission.repository', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('buildFilter supports operator-facing ids', () => {
    const filter = repository.buildFilter({
      id: '660000000000000000120001',
      externalOrderId: '112-1234567-1234567',
      vendorExternalOrderId: 'MZ-ORDER-1',
    });

    expect(String(filter._id)).toBe('660000000000000000120001');
    expect(filter['payloadSnapshot.orderItem.externalOrderId']).toEqual(/112-1234567-1234567/i);
    expect(filter.vendorExternalOrderId).toEqual(/MZ-ORDER-1/i);
  });

  test('atomically increments the persisted mutation version on update', async () => {
    const submissionId = '660000000000000000120001';
    const lean = jest.fn().mockResolvedValue({ _id: submissionId, __v: 6 });
    jest.spyOn(VendorSubmission, 'findByIdAndUpdate').mockReturnValue({ lean });

    await repository.updateById(submissionId, { status: 'FAILED' });

    expect(VendorSubmission.findByIdAndUpdate).toHaveBeenCalledWith(
      submissionId,
      { $set: { status: 'FAILED' }, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true },
    );
  });
});
