const VendorSubmission = require('../../../src/modules/vendorSubmission/models/vendorSubmission.model');
const repository = require('../../../src/modules/vendorSubmission/repositories/vendorSubmission.repository');

describe('vendorSubmission.repository', () => {
  test('personal SKU scope intersects a forged item ID and denies an empty owner set', () => {
    expect(repository.buildFilter({ orderItemId: 'other', sellerOrderItemIds: ['own'] }))
      .toMatchObject({ orderItemId: 'other', $and: [{ orderItemId: { $in: ['own'] } }] });
    expect(repository.buildFilter({ sellerOrderItemIds: [] })).toMatchObject({ $and: [{ orderItemId: { $in: [] } }] });
  });
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

  test('hides cancelled history from the default operator list while allowing an explicit status filter', () => {
    expect(repository.buildFilter({}).status).toEqual({ $ne: 'CANCELLED' });
    expect(repository.buildFilter({ status: 'CANCELLED' }).status).toBe('CANCELLED');
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

  test('lists latest submissions by production task ids through indexed find', async () => {
    const firstTaskId = '660000000000000000120002';
    const secondTaskId = '660000000000000000120003';
    const firstLatest = { _id: '660000000000000000120004', productionTaskId: firstTaskId, updatedAt: new Date('2026-08-02') };
    const firstOlder = { _id: '660000000000000000120005', productionTaskId: firstTaskId, updatedAt: new Date('2026-08-01') };
    const secondLatest = { _id: '660000000000000000120006', productionTaskId: secondTaskId, updatedAt: new Date('2026-08-02') };
    const lean = jest.fn().mockResolvedValue([firstLatest, firstOlder, secondLatest]);
    const select = jest.fn().mockReturnValue({ lean });
    const sort = jest.fn().mockReturnValue({ select });
    jest.spyOn(VendorSubmission, 'find').mockReturnValue({ sort });
    jest.spyOn(VendorSubmission, 'aggregate').mockResolvedValue([]);

    const result = await repository.listLatestByProductionTaskIds([firstTaskId, firstTaskId, secondTaskId]);

    expect(VendorSubmission.find).toHaveBeenCalledWith({
      productionTaskId: {
        $in: expect.arrayContaining([
          expect.objectContaining({ _bsontype: 'ObjectId' }),
        ]),
      },
    });
    expect(sort).toHaveBeenCalledWith({ productionTaskId: 1, updatedAt: -1, _id: -1 });
    expect(select).toHaveBeenCalledWith('_id productionTaskId status submittedAt failedAt failureReason updatedAt');
    expect(lean).toHaveBeenCalled();
    expect(VendorSubmission.aggregate).not.toHaveBeenCalled();
    expect(result).toEqual([firstLatest, secondLatest]);
  });

  test('treats a date-only upper bound as the end of that day', () => {
    expect(repository.buildFilter({ dateTo: '2026-08-01' })).toMatchObject({
      createdAt: { $lte: new Date('2026-08-01T23:59:59.999Z') },
    });
  });

  test('prioritizes tracking submissions that have never been checked, then the oldest check', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const select = jest.fn().mockReturnValue({ lean });
    const limit = jest.fn().mockReturnValue({ select });
    const sort = jest.fn().mockReturnValue({ limit });
    jest.spyOn(VendorSubmission, 'find').mockReturnValue({ sort });
    jest.spyOn(VendorSubmission, 'aggregate').mockResolvedValue([]);

    await repository.listSubmittedForTracking({ limit: 10 });

    expect(VendorSubmission.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ $lookup: expect.objectContaining({ from: 'shipments' }) }),
      expect.objectContaining({ $sort: { 'trackingShipment.lastCheckedAt': 1, updatedAt: 1, _id: 1 } }),
      { $limit: 10 },
    ]));
  });
});
