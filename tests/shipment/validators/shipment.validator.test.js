const {
  listShipmentsQuerySchema,
  vendorTrackingBatchRecheckSchema,
  validate,
} = require('../../../src/modules/shipment/validators/shipment.validator');

describe('shipment validator', () => {
  test('loads and accepts a marketplace confirmation status filter', () => {
    const result = validate(listShipmentsQuerySchema, {
      marketplaceConfirmationStatus: 'confirmed',
    });

    expect(result.details).toBeUndefined();
    expect(result.value.marketplaceConfirmationStatus).toBe('CONFIRMED');
  });

  test('accepts both YYYY-MM-DD and ISO date strings for dateFrom and dateTo', () => {
    const dateOnlyResult = validate(listShipmentsQuerySchema, {
      dateFrom: '2026-11-14',
      dateTo: '2026-11-20',
    });
    expect(dateOnlyResult.details).toBeUndefined();
    expect(dateOnlyResult.value.dateFrom).toBe('2026-11-14');

    const isoResult = validate(listShipmentsQuerySchema, {
      dateFrom: '2026-11-14T00:00:00.000Z',
      dateTo: '2026-11-20T23:59:59.999Z',
    });
    expect(isoResult.details).toBeUndefined();
    expect(new Date(isoResult.value.dateFrom).toISOString()).toBe('2026-11-14T00:00:00.000Z');
  });

  test('accepts vendorTrackingBatchRecheckSchema with perVendor and LNG_GROUP provider', () => {
    const result = validate(vendorTrackingBatchRecheckSchema, {
      provider: 'lng_group',
      limit: 25,
      perVendor: true,
    });

    expect(result.details).toBeUndefined();
    expect(result.value.provider).toBe('LNG_GROUP');
    expect(result.value.limit).toBe(25);
    expect(result.value.perVendor).toBe(true);
  });
});
