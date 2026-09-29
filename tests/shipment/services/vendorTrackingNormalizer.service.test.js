const normalizer = require('../../../src/modules/shipment/services/vendorTrackingNormalizer.service');

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

  test('keeps only an explicit vendor ship date, never its updated timestamp', () => {
    const shipped = normalizer.normalizeVendorTrackingPayload('mangotee', {
      trackingNumber: '1Z999AA10123456784',
      carrier: 'UPS',
      shipped_at: '2026-09-28T12:00:00.000Z',
      updated_at: '2026-09-29T12:00:00.000Z',
    });
    const updatedOnly = normalizer.normalizeVendorTrackingPayload('mangotee', {
      trackingNumber: '1Z999AA10123456784',
      carrier: 'UPS',
      updated_at: '2026-09-29T12:00:00.000Z',
    });

    expect(shipped.vendorShippedAt).toBe('2026-09-28T12:00:00.000Z');
    expect(updatedOnly.vendorShippedAt).toBeNull();
  });

  test.each([
    ['delivered', 'DELIVERED'],
    ['fulfilled', 'SHIPPED'],
    ['delivery_exception', 'EXCEPTION'],
    ['return_to_sender', 'RETURNED'],
    ['cancelled', 'CANCELLED'],
    ['canceled', 'CANCELLED'],
  ])('maps %s to canonical shipment status %s', (status, shipmentStatus) => {
    const result = normalizer.normalizeVendorTrackingPayload('mangotee', {
      trackingNumber: '1Z999AA10123456784',
      status,
    });

    expect(result.shipmentStatus).toBe(shipmentStatus);
  });
});
