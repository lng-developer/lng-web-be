const {
  parseCsv,
  validateVendorImportTemplate,
} = require('../../../src/modules/vendor/scripts/validateVendorImportTemplate');

describe('validateVendorImportTemplate', () => {
  test('parseCsv handles quoted commas', () => {
    expect(parseCsv('code,name\nA,"Hello, world"\n')).toEqual([
      { code: 'A', name: 'Hello, world' },
    ]);
  });

  test('parseCsv handles quoted newlines without creating extra rows', () => {
    expect(parseCsv('code,name\nA,"Hello\nworld"\nB,Done\n')).toEqual([
      { code: 'A', name: 'Hello\nworld' },
      { code: 'B', name: 'Done' },
    ]);
  });

  test('reports duplicate vendors, missing product links, and non-integer money', () => {
    const summary = validateVendorImportTemplate({
      vendors: [
        { code: 'PRINTWAY', name: 'Printway', fulfillmentType: 'POD', status: 'ACTIVE' },
        { code: 'PRINTWAY', name: 'Printway Duplicate', fulfillmentType: 'POD', status: 'ACTIVE' },
      ],
      vendorProducts: [
        {
          vendorCode: 'PRINTWAY',
          code: 'PRODUCT_12',
          name: 'Premium Shirt',
          productTypeGroupCode: 'SHIRT',
          minProductionDays: '2',
          maxProductionDays: '4',
          baseCostAmount: '0',
          currency: 'USD',
          status: 'ACTIVE',
        },
        {
          vendorCode: 'MISSING_VENDOR',
          code: 'PRODUCT_13',
          name: 'Missing Vendor Product',
          productTypeGroupCode: '',
          minProductionDays: '1.5',
          baseCostAmount: '12.34',
          currency: 'USD',
          status: 'ACTIVE',
        },
      ],
      vendorCostCenters: [
        {
          vendorProductCode: 'PRODUCT_12',
          code: 'BLACK_L',
          name: 'Black / L',
          weight: 'bad',
          baseCostAmount: '1200',
          domesticEconomyAmount: '100',
          status: 'ACTIVE',
        },
        {
          vendorProductCode: 'PRODUCT_12',
          code: 'BLACK_L',
          name: 'Duplicate',
          importTaxAmount: '0.25',
          baseCostAmount: 'bad',
          status: 'ACTIVE',
        },
        {
          vendorProductCode: 'PRODUCT_MISSING',
          code: 'WHITE_M',
          name: 'Missing Product',
          baseCostAmount: '1200',
          status: 'ACTIVE',
        },
      ],
    });

    expect(summary.valid).toBe(false);
    expect(summary.counts).toEqual({ vendors: 2, vendorProducts: 2, vendorCostCenters: 3 });
    expect(summary.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'DUPLICATE_VENDOR_CODE', key: 'PRINTWAY' }),
      expect.objectContaining({ type: 'UNKNOWN_VENDOR_CODE', key: 'MISSING_VENDOR' }),
      expect.objectContaining({ type: 'MISSING_PRODUCT_TYPE_GROUP_CODE', key: 'PRODUCT_13' }),
      expect.objectContaining({ type: 'INVALID_MONEY_MINOR_UNIT', field: 'baseCostAmount', key: 'PRODUCT_13' }),
      expect.objectContaining({ type: 'INVALID_NON_NEGATIVE_INTEGER', field: 'minProductionDays', key: 'PRODUCT_13' }),
      expect.objectContaining({ type: 'INVALID_NUMBER', field: 'weight', key: 'BLACK_L' }),
      expect.objectContaining({ type: 'INVALID_MONEY_MINOR_UNIT', field: 'importTaxAmount', key: 'BLACK_L' }),
      expect.objectContaining({ type: 'DUPLICATE_COST_CENTER_CODE', key: 'PRODUCT_12:BLACK_L' }),
      expect.objectContaining({ type: 'UNKNOWN_VENDOR_PRODUCT_CODE', key: 'PRODUCT_MISSING' }),
    ]));
  });
});
