const {
  dedupeCodeRows,
} = require('../../../src/modules/vendor/scripts/convertLegacyVendorExport');

describe('convertLegacyVendorExport helpers', () => {
  test('dedupeCodeRows appends stable legacy suffix for duplicate keys', () => {
    const rows = dedupeCodeRows([
      { legacyId: '64f000000000000000000001', vendorCode: 'A', code: 'PRODUCT_1' },
      { legacyId: '64f000000000000000000002', vendorCode: 'A', code: 'PRODUCT_1' },
      { legacyId: '64f000000000000000000003', vendorCode: 'B', code: 'PRODUCT_1' },
    ], (row) => `${row.vendorCode}:${row.code}`);

    expect(rows).toEqual([
      expect.objectContaining({ code: 'PRODUCT_1' }),
      expect.objectContaining({ code: 'PRODUCT_1_000002' }),
      expect.objectContaining({ code: 'PRODUCT_1' }),
    ]);
  });
});
