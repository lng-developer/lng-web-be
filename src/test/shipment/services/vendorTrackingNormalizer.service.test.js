const normalizer = require('../../../modules/shipment/services/vendorTrackingNormalizer.service');

describe('vendorTrackingNormalizer.service', () => {
  test('normalizes provider aliases to current provider keys', () => {
    expect(normalizer.normalizeProviderKey('print way')).toBe('PRINTWAY');
    expect(normalizer.normalizeProviderKey('mango tee')).toBe('MANGOTEE');
    expect(normalizer.normalizeProviderKey('onos')).toBe('ONOSPOD');
  });

  test('extracts tracking from nested payload arrays', () => {
    const result = normalizer.normalizeVendorTrackingPayload('lenful', {
      data: {
        shipments: [{
          tracking: {
            trackingNumber: '9400111899223850000001',
            carrierName: 'USPS',
            url: 'https://tools.usps.com/track/9400111899223850000001',
          },
          status: 'shipped',
        }],
      },
    });

    expect(result).toMatchObject({
      provider: 'LENFUL',
      trackingNumber: '9400111899223850000001',
      carrier: 'USPS',
      trackingUrl: 'https://tools.usps.com/track/9400111899223850000001',
      vendorStatus: 'shipped',
      shipped: true,
    });
  });

  test('marks delivered status', () => {
    const result = normalizer.normalizeVendorTrackingPayload('mangotee', {
      trackingNumber: '1Z999AA10123456784',
      status: 'delivered',
    });

    expect(result.delivered).toBe(true);
  });
});
