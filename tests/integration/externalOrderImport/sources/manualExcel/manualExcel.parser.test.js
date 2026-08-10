const { parseUploadedOrderReport } = require('../../../../../src/modules/integration/externalOrderImport/sources/manualExcel/manualExcel.parser');

describe('manualExcel.parser', () => {
  test('parses TSV report and preserves values as strings', () => {
    const result = parseUploadedOrderReport(
      Buffer.from('order-id\torder-item-id\tsku\n113-1\t000123456789012345\tSKU-1'),
      { originalFilename: 'orders.txt', mimeType: 'text/plain' },
    );

    expect(result.headers).toEqual(['order-id', 'order-item-id', 'sku']);
    expect(result.rows).toEqual([{ 'order-id': '113-1', 'order-item-id': '000123456789012345', sku: 'SKU-1' }]);
    expect(result.rowCount).toBe(1);
  });

  test('trims BOM from first header', () => {
    const result = parseUploadedOrderReport(Buffer.from('\uFEFForder-id\torder-item-id\n113-1\tITEM-1'), {
      originalFilename: 'orders.tsv',
      mimeType: 'text/tab-separated-values',
    });

    expect(result.headers[0]).toBe('order-id');
  });

  test('parses simple quoted CSV report', () => {
    const result = parseUploadedOrderReport(Buffer.from('order-id,product-name\n113-1,"Mug, Blue"'), {
      originalFilename: 'orders.csv',
      mimeType: 'text/csv',
    });

    expect(result.rows[0]['product-name']).toBe('Mug, Blue');
  });

  test('parses quoted CSV values that contain line breaks', () => {
    const result = parseUploadedOrderReport(
      Buffer.from('Order ID,Variations,SKU\n4101302696,"Custom:Dilenia & Milton \n20 Years",J2614'),
      { originalFilename: 'etsy.csv', mimeType: 'text/csv' },
    );

    expect(result.rowCount).toBe(1);
    expect(result.rows[0]).toEqual({
      'Order ID': '4101302696',
      Variations: 'Custom:Dilenia & Milton \n20 Years',
      SKU: 'J2614',
    });
  });

  test('rejects unsupported file type', () => {
    expect(() => parseUploadedOrderReport(Buffer.from('x'), {
      originalFilename: 'orders.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })).toThrow('Unsupported file type');
  });
});
