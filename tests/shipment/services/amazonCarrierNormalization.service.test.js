const amazonCarrierNormalization = require('../../../src/modules/shipment/services/amazonCarrierNormalization.service');

describe('amazonCarrierNormalization.service', () => {
  it('forces LNG Group tracking to USPS First Class without an external carrier lookup', () => {
    const result = amazonCarrierNormalization.normalizeForAmazon({
      provider: 'LNG_GROUP',
      carrier: 'VIETTEL_POST',
      trackingNumber: ' 9214490374008505127296 ',
      shippedAt: new Date('2026-11-18T08:00:00Z'),
    }, { now: new Date('2026-11-18T12:00:00Z') });

    expect(result).toEqual({
      trackingNumber: '9214490374008505127296',
      carrier: 'USPS',
      carrierCode: 'USPS',
      carrierName: 'USPS',
      shipMethod: 'USPS First Class',
      shipDate: '2026-11-18',
    });
  });

  it('does not force non-LNG providers to USPS', () => {
    const result = amazonCarrierNormalization.normalizeForAmazon({
      provider: 'MERCHIZE',
      carrier: 'VIETTEL_POST',
      trackingNumber: 'CUSTOM12345',
      shippedAt: new Date('2026-11-18T08:00:00Z'),
    }, { now: new Date('2026-11-18T12:00:00Z') });

    expect(result.carrierCode).toBe('Other');
    expect(result.carrierName).toBe('Viettel Post');
    expect(result.shipMethod).toBe('Standard');
  });
});
