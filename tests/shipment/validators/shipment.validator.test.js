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
