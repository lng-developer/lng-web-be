const {
  buildProductTypeGroupLookup,
  mapLegacyCostCenter,
  mapLegacyProduct,
  mapLegacyVendor,
  moneyToMinorUnits,
  toCode,
} = require('../../../modules/vendor/scripts/legacyVendorExport.mapper');

describe('legacy vendor export mapper', () => {
  test('maps legacy vendor with deterministic code and preserves legacy fulfillment type', () => {
    expect(mapLegacyVendor({
      _id: { $oid: 'vendor1' },
      name: 'Luxury Pro',
      status: 'Active',
      fulfillment_type: 'Manual',
    })).toMatchObject({
      legacyId: 'vendor1',
      code: 'LUXURY_PRO',
      name: 'Luxury Pro',
      fulfillmentType: 'POD',
      legacyFulfillmentType: 'Manual',
      status: 'ACTIVE',
    });
  });

  test('maps product type group code from legacy group item vendor product id', () => {
    const lookup = buildProductTypeGroupLookup([
      {
        name: 'Raglan Shirt',
        items: [{ vendor_product: { $oid: 'product1' } }],
      },
    ]);

    expect(lookup.get('product1')).toBe('RAGLAN_SHIRT');
  });

  test('maps vendor product to template row with imageUrl and product type group code', () => {
    const row = mapLegacyProduct({
      _id: { $oid: 'product1' },
      vendor_id: { $oid: 'vendor1' },
      product_id: '12',
      product_name: 'Premium Long Sleeve',
      image: 'https://cdn.example.test/image.jpg',
      status: 'Active',
    }, {
      vendorCodeById: new Map([['vendor1', 'PRINTWAY']]),
      productTypeGroupCodeByProductId: new Map([['product1', 'LONG_SLEEVE']]),
    });

    expect(row).toMatchObject({
      vendorCode: 'PRINTWAY',
      code: 'PRODUCT_12',
      externalProductId: '12',
      name: 'Premium Long Sleeve',
      productTypeGroupCode: 'LONG_SLEEVE',
      imageUrl: 'https://cdn.example.test/image.jpg',
      status: 'ACTIVE',
    });
  });

  test('maps cost center and converts dollar amounts to integer minor units', () => {
    const row = mapLegacyCostCenter({
      _id: { $oid: 'cost1' },
      vendor_product: { $oid: 'product1' },
      vendor_size: '2XL',
      vendor_color: 'Black',
      standard_size: '2XL',
      standard_color: 'Black',
      sku: '515',
      lng_code: 'LNG-515',
      base_cost: 22.35,
      dosmetic: { economy: 1.2, additional: 0.5 },
      international: { economy: 4, additional: 1.25 },
      priority: { economy: 2, additional: 0 },
      additional_costs: { embroidery: 3, two_sided_print: 2.5 },
      status: 'Active',
    }, {
      productCodeById: new Map([['product1', 'PRODUCT_12']]),
    });

    expect(row).toMatchObject({
      vendorProductCode: 'PRODUCT_12',
      code: 'PRODUCT_12_2XL_BLACK_515',
      baseCostAmount: 2235,
      domesticEconomyAmount: 120,
      domesticAdditionalAmount: 50,
      internationalEconomyAmount: 400,
      internationalAdditionalAmount: 125,
      priorityEconomyAmount: 200,
      embroideryAmount: 300,
      twoSidedPrintAmount: 250,
      status: 'ACTIVE',
    });
  });

  test('moneyToMinorUnits and toCode are deterministic', () => {
    expect(moneyToMinorUnits(12.34)).toBe(1234);
    expect(moneyToMinorUnits('0.49')).toBe(49);
    expect(toCode('Premium Long Sleeve')).toBe('PREMIUM_LONG_SLEEVE');
  });
});
