const aftershipTracking = require('../../../src/modules/shipment/services/aftershipTracking.service');

describe('aftershipTracking.service', () => {
  describe('sanitizeTrackingNumber', () => {
    it('trims whitespace and handles null/undefined', () => {
      expect(aftershipTracking.sanitizeTrackingNumber('  9400111899562537624649 \t\n ')).toBe('9400111899562537624649');
      expect(aftershipTracking.sanitizeTrackingNumber(null)).toBe('');
      expect(aftershipTracking.sanitizeTrackingNumber(undefined)).toBe('');
      expect(aftershipTracking.sanitizeTrackingNumber('')).toBe('');
    });
  });

  describe('mapSlugToAmazonCarrier', () => {
    it('maps USPS slugs to USPS carrierCode and shipMethod', () => {
      const res = aftershipTracking.mapSlugToAmazonCarrier('usps', 'USPS');
      expect(res.carrierCode).toBe('USPS');
      expect(res.carrierName).toBe('USPS');
      expect(res.shipMethod).toBe('USPS Ground Advantage');
    });

    it('maps UPS slugs to UPS carrierCode', () => {
      const res = aftershipTracking.mapSlugToAmazonCarrier('ups', 'UPS');
      expect(res.carrierCode).toBe('UPS');
      expect(res.carrierName).toBe('UPS');
      expect(res.shipMethod).toBe('UPS Ground');
    });

    it('maps FedEx slugs to FedEx carrierCode', () => {
      const res = aftershipTracking.mapSlugToAmazonCarrier('fedex', 'FedEx');
      expect(res.carrierCode).toBe('FedEx');
      expect(res.carrierName).toBe('FedEx');
      expect(res.shipMethod).toBe('FedEx Ground');
    });

    it('maps YunExpress slugs to YunExpress carrierCode', () => {
      const res = aftershipTracking.mapSlugToAmazonCarrier('yunexpress', 'YunExpress');
      expect(res.carrierCode).toBe('YunExpress');
      expect(res.carrierName).toBe('YunExpress');
      expect(res.shipMethod).toBe('Standard');
    });

    it('maps Viettel Post to Other with carrierName Viettel Post', () => {
      const res = aftershipTracking.mapSlugToAmazonCarrier('viettelpost', 'Viettel Post');
      expect(res.carrierCode).toBe('Other');
      expect(res.carrierName).toBe('Viettel Post');
      expect(res.shipMethod).toBe('Standard');
    });

    it('maps unknown carrier to Other with slug as carrierName', () => {
      const res = aftershipTracking.mapSlugToAmazonCarrier('unknown-courier', 'Custom Courier');
      expect(res.carrierCode).toBe('Other');
      expect(res.carrierName).toBe('Custom Courier');
      expect(res.shipMethod).toBe('Standard');
    });
  });

  describe('formatAmazonShipDate', () => {
    it('formats valid Date to YYYY-MM-DD', () => {
      const fixedNow = new Date('2026-11-14T12:00:00Z');
      const input = new Date('2026-11-12T10:00:00Z');
      expect(aftershipTracking.formatAmazonShipDate(input, fixedNow)).toBe('2026-11-12');
    });

    it('clamps future date to current date to avoid Amazon rejection', () => {
      const fixedNow = new Date('2026-11-14T12:00:00Z');
      const futureDate = new Date('2026-11-20T10:00:00Z');
      expect(aftershipTracking.formatAmazonShipDate(futureDate, fixedNow)).toBe('2026-11-14');
    });

    it('falls back to current date if input is invalid or missing', () => {
      const fixedNow = new Date('2026-11-14T12:00:00Z');
      expect(aftershipTracking.formatAmazonShipDate(null, fixedNow)).toBe('2026-11-14');
      expect(aftershipTracking.formatAmazonShipDate('invalid-date', fixedNow)).toBe('2026-11-14');
    });
  });

  describe('detectCourier', () => {
    it('calls AfterShip detect endpoint and returns top courier', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          meta: { code: 200 },
          data: {
            total: 1,
            couriers: [
              { slug: 'usps', name: 'USPS', other_name: 'United States Postal Service' }
            ]
          }
        })
      });

      const result = await aftershipTracking.detectCourier('9400111899562537624649', {
        fetchImpl: mockFetch,
        apiKey: 'test-key',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.aftership.com/tracking/2024-10/couriers/detect',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'as-api-key': 'test-key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ tracking_number: '9400111899562537624649' })
        })
      );
      expect(result).toEqual({
        slug: 'usps',
        name: 'USPS',
        otherName: 'United States Postal Service',
      });
    });

    it('returns null on network failure without throwing', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const result = await aftershipTracking.detectCourier('9400111899562537624649', {
        fetchImpl: mockFetch,
        apiKey: 'test-key',
      });
      expect(result).toBeNull();
    });

    it('returns null if AfterShip returns empty couriers', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          meta: { code: 200 },
          data: { total: 0, couriers: [] }
        })
      });
      const result = await aftershipTracking.detectCourier('INVALID_TRACKING', {
        fetchImpl: mockFetch,
        apiKey: 'test-key',
      });
      expect(result).toBeNull();
    });
  });

  describe('normalizeForAmazon', () => {
    it('enriches tracking with detected courier and Amazon mapping', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          meta: { code: 200 },
          data: {
            total: 1,
            couriers: [{ slug: 'usps', name: 'USPS' }]
          }
        })
      });

      const fixedNow = new Date('2026-11-14T12:00:00Z');
      const result = await aftershipTracking.normalizeForAmazon({
        trackingNumber: '  9400111899562537624649 ',
        carrier: 'VIETTEL_POST',
        shippedAt: new Date('2026-11-13T08:00:00Z'),
      }, {
        fetchImpl: mockFetch,
        apiKey: 'test-key',
        now: fixedNow,
      });

      expect(result).toEqual({
        trackingNumber: '9400111899562537624649',
        carrier: 'USPS',
        carrierCode: 'USPS',
        carrierName: 'USPS',
        shipMethod: 'USPS Ground Advantage',
        shipDate: '2026-11-13',
        aftershipSlug: 'usps',
        detected: true,
      });
    });

    it('falls back cleanly if AfterShip cannot detect courier', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          meta: { code: 200 },
          data: { total: 0, couriers: [] }
        })
      });

      const fixedNow = new Date('2026-11-14T12:00:00Z');
      const result = await aftershipTracking.normalizeForAmazon({
        trackingNumber: 'CUSTOM12345',
        carrier: 'Viettel Post',
        shippedAt: new Date('2026-11-12T08:00:00Z'),
      }, {
        fetchImpl: mockFetch,
        apiKey: 'test-key',
        now: fixedNow,
      });

      expect(result.trackingNumber).toBe('CUSTOM12345');
      expect(result.carrier).toBe('Viettel Post');
      expect(result.carrierCode).toBe('Other');
      expect(result.carrierName).toBe('Viettel Post');
      expect(result.shipDate).toBe('2026-11-12');
      expect(result.detected).toBe(false);
    });
  });
});
