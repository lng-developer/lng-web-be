const { toShipmentDto } = require('../../../src/modules/shipment/dtos/shipment.dto');

describe('shipment.dto', () => {
  test('exposes vendor and order display ids', () => {
    const dto = toShipmentDto({
      _id: '660000000000000000130001',
      vendorSubmissionId: '660000000000000000130002',
      orderId: '660000000000000000130003',
      orderItemId: '660000000000000000130004',
      shopId: '660000000000000000130005',
      status: 'TRACKING_PENDING',
      provider: 'MERCHIZE',
      externalOrderId: '112-1234567-1234567',
      vendorExternalOrderId: 'MZ-ORDER-1',
    });

    expect(dto).toMatchObject({
      externalOrderId: '112-1234567-1234567',
      vendorExternalOrderId: 'MZ-ORDER-1',
      provider: 'MERCHIZE',
    });
  });
});
