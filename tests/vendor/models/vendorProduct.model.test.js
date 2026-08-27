const VendorProduct = require('../../../src/modules/vendor/models/vendorProduct.model');

describe('VendorProduct model', () => {
  test('allows a product to be imported before its product type is assigned', () => {
    expect(VendorProduct.schema.path('productTypeGroupId').isRequired).toBeUndefined();
  });
});
