const { listShipmentsQuerySchema, validate } = require('../../../src/modules/shipment/validators/shipment.validator');

describe('shipment validator', () => {
  test('loads and accepts a marketplace confirmation status filter', () => {
    const result = validate(listShipmentsQuerySchema, {
      marketplaceConfirmationStatus: 'confirmed',
    });

    expect(result.details).toBeUndefined();
    expect(result.value.marketplaceConfirmationStatus).toBe('CONFIRMED');
  });
});
