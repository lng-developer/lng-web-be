const repository = require('../../../modules/shipment/repositories/shipment.repository');

describe('shipment.repository', () => {
  test('buildFilter supports operator-facing ids and tracking number', () => {
    const filter = repository.buildFilter({
      id: '660000000000000000130001',
      externalOrderId: '112-1234567-1234567',
      vendorExternalOrderId: 'MZ-ORDER-1',
      trackingNumber: '9214490411375403131206',
    });

    expect(String(filter._id)).toBe('660000000000000000130001');
    expect(filter.externalOrderId).toEqual(/112-1234567-1234567/i);
    expect(filter.vendorExternalOrderId).toEqual(/MZ-ORDER-1/i);
    expect(filter.trackingNumber).toEqual(/9214490411375403131206/i);
  });
});
