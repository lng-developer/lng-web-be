const Vendor = require('../../../modules/vendor/models/vendor.model');
const VendorProduct = require('../../../modules/vendor/models/vendorProduct.model');
const VendorCostCenter = require('../../../modules/vendor/models/vendorCostCenter.model');

describe('vendor models', () => {
  test('Vendor code is uppercase unique immutable', () => {
    const codePath = Vendor.schema.path('code');
    const fulfillmentTypePath = Vendor.schema.path('fulfillmentType');
    const uniqueIndexes = Vendor.schema.indexes()
      .filter(([, options]) => options && options.unique)
      .map(([fields]) => fields);

    expect(codePath.options.uppercase).toBe(true);
    expect(codePath.options.trim).toBe(true);
    expect(codePath.options.immutable).toBe(true);
    expect(fulfillmentTypePath.options.required).toBe(true);
    expect(fulfillmentTypePath.options.uppercase).toBe(true);
    expect(fulfillmentTypePath.enumValues).toEqual(expect.arrayContaining(['FBM', 'POD', 'CUSTOM']));
    expect(uniqueIndexes).toContainEqual({ code: 1 });
  });

  test('VendorProduct rejects float and negative baseCostAmount', async () => {
    await expect(new VendorProduct({
      vendorId: '660000000000000000000501',
      productTypeGroupId: '660000000000000000000301',
      code: 'SHIRT',
      name: 'Shirt',
      imageUrl: 'https://cdn.example.test/shirt.jpg',
      baseCostAmount: 12.34,
    }).validate()).rejects.toThrow();

    await expect(new VendorProduct({
      vendorId: '660000000000000000000501',
      productTypeGroupId: '660000000000000000000301',
      code: 'SHIRT',
      name: 'Shirt',
      imageUrl: 'https://cdn.example.test/shirt.jpg',
      baseCostAmount: -1,
    }).validate()).rejects.toThrow();
  });

  test('VendorProduct stores optional imageUrl for legacy vendor product image', () => {
    const imagePath = VendorProduct.schema.path('imageUrl');

    expect(imagePath.options.trim).toBe(true);
    expect(imagePath.options.default).toBeNull();
  });

  test('VendorProduct stores generic vendor import metadata', async () => {
    expect(VendorProduct.schema.path('productUrl')).toBeTruthy();
    expect(VendorProduct.schema.path('designTemplateUrl')).toBeTruthy();
    expect(VendorProduct.schema.path('minProductionDays')).toBeTruthy();
    expect(VendorProduct.schema.path('maxProductionDays')).toBeTruthy();

    await expect(new VendorProduct({
      vendorId: '660000000000000000000501',
      productTypeGroupId: '660000000000000000000301',
      code: 'SHIRT',
      name: 'Shirt',
      minProductionDays: 1.5,
    }).validate()).rejects.toThrow();
  });

  test('VendorCostCenter has unique code within one product and explicit pricing fields', () => {
    const uniqueIndexes = VendorCostCenter.schema.indexes()
      .filter(([, options]) => options && options.unique)
      .map(([fields]) => fields);

    expect(uniqueIndexes).toContainEqual({ vendorProductId: 1, code: 1 });
    expect(VendorCostCenter.schema.path('vendorSize')).toBeTruthy();
    expect(VendorCostCenter.schema.path('vendorColor')).toBeTruthy();
    expect(VendorCostCenter.schema.path('standardSize')).toBeTruthy();
    expect(VendorCostCenter.schema.path('standardColor')).toBeTruthy();
    expect(VendorCostCenter.schema.path('domesticShipping.economyAmount')).toBeTruthy();
    expect(VendorCostCenter.schema.path('internationalShipping.additionalAmount')).toBeTruthy();
    expect(VendorCostCenter.schema.path('additionalCosts.embroideryAmount')).toBeTruthy();
    expect(VendorCostCenter.schema.path('weight')).toBeTruthy();
    expect(VendorCostCenter.schema.path('weightUnit')).toBeTruthy();
    expect(VendorCostCenter.schema.path('width')).toBeTruthy();
    expect(VendorCostCenter.schema.path('length')).toBeTruthy();
    expect(VendorCostCenter.schema.path('height')).toBeTruthy();
    expect(VendorCostCenter.schema.path('dimensionUnit')).toBeTruthy();
    expect(VendorCostCenter.schema.path('importTaxAmount')).toBeTruthy();
  });

  test('VendorCostCenter importTaxAmount rejects float and negative values', async () => {
    const base = {
      vendorProductId: '660000000000000000000701',
      vendorId: '660000000000000000000501',
      code: 'BLACK_L',
      name: 'Black / L',
    };

    await expect(new VendorCostCenter({ ...base, importTaxAmount: 1.23 }).validate()).rejects.toThrow();
    await expect(new VendorCostCenter({ ...base, importTaxAmount: -1 }).validate()).rejects.toThrow();
  });
});
