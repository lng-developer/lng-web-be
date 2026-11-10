const adapter = require('../../../src/modules/shipment/services/vendorTrackingAdapters/mangotee.adapter');

describe('MangoTee tracking adapter', () => {
  test('uses the carrier from tracking events before the generic tracking provider', () => {
    expect(adapter.normalizeMangoteeTracking('111-7258289-0765048', {
      data: {
        tracking_number: '9214490424545403065588',
        tracking_status: 'in_transit',
        preferred_carrier: 'usps',
        tracking_provider: 'supplier',
        events: [{ carrier: 'USPS', tracking_number: '9214490424545403065588' }],
      },
    })).toMatchObject({
      carrier: 'USPS',
      trackingNumber: '9214490424545403065588',
    });
  });
});
