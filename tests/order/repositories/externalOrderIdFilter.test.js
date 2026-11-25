const { externalOrderIdFilter } = require('../../../src/modules/order/repositories/externalOrderIdFilter');

describe('dedicated external order ID filter', () => {
  test('uses equality for a complete Amazon ID, including pasted whitespace', () => {
    expect(externalOrderIdFilter(' 113-7301293-4168246 ')).toBe('113-7301293-4168246');
  });
  test.each(['113', '113-7301293', 'ETSY-123', '1234567890'])('keeps partial search for %s', (value) => {
    expect(externalOrderIdFilter(value)).toEqual({ $regex: value, $options: 'i' });
  });
  test('escapes regex syntax in partial inputs', () => {
    expect(externalOrderIdFilter('ID.*')).toEqual({ $regex: 'ID\\.\\*', $options: 'i' });
  });
});
