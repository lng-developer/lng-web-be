const {
  mapMerchizeRowsToTemplate,
} = require('../../../src/modules/vendor/scripts/merchizeXlsx.mapper');
const {
  mapOnosRowsToTemplate,
} = require('../../../src/modules/vendor/scripts/onosXlsx.mapper');

describe('vendor XLSX template mappers', () => {
  test('maps Merchize rows to standard vendor template rows', () => {
    const result = mapMerchizeRowsToTemplate([
      {
        'Product Title': 'All-over Print Zip Polo Shirt (Lightweight)',
        Link: 'https://merchize.com/product/all-over-print-zip-polo-shirt-lightweight',
        'SKU product': 'ZIPLVN',
        SIZES: 'S',
        'SKU variant': 'ZIPLVN000000AA01',
        'Tier 1 (0 - 999)': '14.2',
        'US import Tax/item': '0.4',
        'US shipping fee (1st item)': '0',
        'US additional shipping fee': '0',
        'ROW shipping fee (1st item)': '8.9',
        'ROW additional shipping fee': '8.9',
        'Design Template': 'https://drive.google.com/template',
        'Min production time': '2',
        'Max production time': '4',
      },
    ], {
      vendorCode: 'MERCHIZE',
      productTypeGroupCode: 'ZIP_POLO',
    });

    expect(result.vendorProducts).toEqual([
      expect.objectContaining({
        vendorCode: 'MERCHIZE',
        code: 'ZIPLVN',
        name: 'All-over Print Zip Polo Shirt (Lightweight)',
        externalProductId: 'ZIPLVN',
        productTypeGroupCode: 'ZIP_POLO',
        productUrl: 'https://merchize.com/product/all-over-print-zip-polo-shirt-lightweight',
        designTemplateUrl: 'https://drive.google.com/template',
        minProductionDays: 2,
        maxProductionDays: 4,
      }),
    ]);
    expect(result.vendorCostCenters).toEqual([
      expect.objectContaining({
        vendorProductCode: 'ZIPLVN',
        code: 'ZIPLVN000000AA01',
        sku: 'ZIPLVN000000AA01',
        vendorSize: 'S',
        standardSize: 'S',
        baseCostAmount: 1420,
        domesticEconomyAmount: 0,
        internationalEconomyAmount: 890,
        importTaxAmount: 40,
      }),
    ]);
  });

  test('maps ONOS rows to standard vendor template rows', () => {
    const result = mapOnosRowsToTemplate([
      ['All-Over Print Baby Jersey Bodysuit', '', '', 'VARIANT_SKU', 'SIZE', 'COLOR', 'WEIGHT', 'WIDTH', 'LENGTH', 'HEIGHT', 'COD', 'COMBO Express US', 'COMBO Ship By Tiktok', 'IMPORT US TAX'],
      ['AOP-BB-JER-SUIT-3M', '3M', '', '', '120', '13', '10', '2', '5.3', '12.05', '9.3', '0.28'],
    ], {
      vendorCode: 'ONOS',
      productCode: 'AOP_BABY_JERSEY_BODYSUIT',
      productTypeGroupCode: 'BABY_JERSEY_BODYSUIT',
    });

    expect(result.vendorProducts).toEqual([
      expect.objectContaining({
        vendorCode: 'ONOS',
        code: 'AOP_BABY_JERSEY_BODYSUIT',
        name: 'All-Over Print Baby Jersey Bodysuit',
        productTypeGroupCode: 'BABY_JERSEY_BODYSUIT',
      }),
    ]);
    expect(result.vendorCostCenters).toEqual([
      expect.objectContaining({
        vendorProductCode: 'AOP_BABY_JERSEY_BODYSUIT',
        code: 'AOP_BB_JER_SUIT_3M',
        sku: 'AOP-BB-JER-SUIT-3M',
        vendorSize: '3M',
        standardSize: '3M',
        weight: 120,
        width: 13,
        length: 10,
        height: 2,
        baseCostAmount: 1205,
        domesticEconomyAmount: 1205,
        importTaxAmount: 28,
      }),
    ]);
  });
});
