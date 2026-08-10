const VendorSubmission = require('../../../src/modules/vendorSubmission/models/vendorSubmission.model');
const repository = require('../../../src/modules/vendorSubmission/repositories/vendorSubmission.repository');

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

  test('claims only a ready submission for one submit operation', async () => {
    const submissionId = '660000000000000000120001';
    const claimedAt = new Date('2026-08-01T00:00:00.000Z');
    const lean = jest.fn().mockResolvedValue({ _id: submissionId, status: 'SUBMITTING' });
    jest.spyOn(VendorSubmission, 'findOneAndUpdate').mockReturnValue({ lean });

    await repository.claimReadyForSubmit(submissionId, {
      provider: 'MERCHIZE', operationKey: `vendor-submission:${submissionId}`, claimedAt,
    });

    expect(VendorSubmission.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: submissionId, status: 'READY' },
      {
        $set: {
          status: 'SUBMITTING', provider: 'MERCHIZE',
          submitOperationKey: `vendor-submission:${submissionId}`, submitClaimedAt: claimedAt,
        },
        $inc: { __v: 1, submitAttemptCount: 1 },
      },
      { returnDocument: 'after', runValidators: true },
    );
  });

  test('conditionally transitions only from allowed statuses', async () => {
    const lean = jest.fn().mockResolvedValue(null);
    jest.spyOn(VendorSubmission, 'findOneAndUpdate').mockReturnValue({ lean });

    await repository.transitionStatus('660000000000000000120001', ['SUBMITTING'], { status: 'SUBMITTED' });

    expect(VendorSubmission.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: '660000000000000000120001', status: { $in: ['SUBMITTING'] } },
      { $set: { status: 'SUBMITTED' }, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true },
    );
  });

  test('treats a date-only upper bound as the end of that day', () => {
    expect(repository.buildFilter({ dateTo: '2026-08-01' })).toMatchObject({
      createdAt: { $lte: new Date('2026-08-01T23:59:59.999Z') },
    });
  });
});
