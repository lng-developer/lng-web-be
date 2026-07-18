const repository = require('../../../modules/vendorSubmission/repositories/vendorSubmission.repository');

describe('vendorSubmission.repository', () => {
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
});
