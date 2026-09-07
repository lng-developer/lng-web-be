const VendorCostCenter = require('../../../src/modules/vendor/models/vendorCostCenter.model');

describe('VendorCostCenter model indexes', () => {
  test('does not retain unused vendor or print-method compound indexes', () => {
    const indexes = VendorCostCenter.schema.indexes().map(([key]) => key);

    expect(indexes).not.toContainEqual({ vendorId: 1, status: 1 });
    expect(indexes).not.toContainEqual({ vendorProductId: 1, status: 1, printMethod: 1 });
  });
});
