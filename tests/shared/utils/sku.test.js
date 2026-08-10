const { parseSku } = require('../../../src/shared/utils/sku');

describe('parseSku', () => {
  test('parses a canonical internal SKU', () => {
    expect(parseSku('J2508-TS1S-05032026-335')).toEqual({
      originalSku: 'J2508-TS1S-05032026-335',
      normalizedSku: 'J2508-TS1S-05032026-335',
      segments: ['J2508', 'TS1S', '05032026', '335'],
      employeeCode: 'J2508',
      configCode: 'TS1S',
      dateCode: '05032026',
      sequence: '335',
    });
  });

  test('normalizes case and rejects a non-internal SKU', () => {
    expect(parseSku(' j2508-ts1s-25022026-666 ').employeeCode).toBe('J2508');
    expect(parseSku('AMAZON-TS1S-25022026-666')).toMatchObject({
      employeeCode: null,
      configCode: null,
      dateCode: null,
      sequence: null,
    });
    expect(parseSku('seller_J2508-RAW-05032026-335')).toMatchObject({
      employeeCode: null,
      configCode: null,
      dateCode: null,
      sequence: null,
    });
  });
});
